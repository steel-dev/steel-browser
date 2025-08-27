package main

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"html/template"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"
	"webrtc/internal/config"
	"webrtc/internal/steelrtc"
	utils "webrtc/pkg"

	"github.com/gorilla/websocket"
	"github.com/pion/webrtc/v3"
)

var (
	upgrader       = websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
	videoTracks    []*webrtc.TrackLocalStaticRTP
	videoTrackLock sync.RWMutex
	udpConn        *net.UDPConn // so we can close it on shutdown
	//go:embed web/live-session-streamer.html
	tmplFS embed.FS
)

// Message types for signalinig and interactions
type Message struct {
	Type string `json:"type"`
	Data any    `json:"data"`
}

func main() {
	log.Println("Starting Steel WebRTC server")
	// Writing HTML file to memory
	tmpl, err := template.ParseFS(tmplFS, "web/live-session-streamer.html")
	if err != nil {
		log.Fatal(err)
	}

	// --- Signal handling ---
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	// Start RTP listener for ffmpeg stream
	go func() {
		steelrtc.StartRTPListener(videoTracks, &videoTrackLock)
	}()

	// --- HTTP server with graceful shutdown ---
	// srv := &http.Server{Addr: fmt.Sprintf("%s:%s", config.Host, config.Port), Handler: nil}
	srv := &http.Server{Addr: fmt.Sprintf(":%s", config.Port), Handler: nil}

	// WebSocket handler for signaling and interactions
	http.HandleFunc("/v1/sessions/webrtc", func(w http.ResponseWriter, r *http.Request) {

		// Log connection details
		origin := r.Header.Get("Origin")
		userAgent := r.Header.Get("User-Agent")
		log.Printf("WebSocket connection attempt - Origin: %s, User-Agent: %s", origin, userAgent)

		// Upgrade to WebSocket
		ws, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("WebSocket upgrade failed: %v", err)
			return
		}
		defer func() {
			log.Println("Closing WebSocket connection")
			ws.Close()
		}()

		log.Printf("WebSocket connection established successfully from %s", origin)

		// Set connection timeouts and ping handling
		ws.SetReadDeadline(time.Now().Add(60 * time.Second))
		ws.SetPongHandler(func(string) error {
			ws.SetReadDeadline(time.Now().Add(60 * time.Second))
			return nil
		})

		// Create context for cleanup
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()

		// Start ping routine
		go func() {
			utils.HealthCheck(ws, ctx, cancel)
		}()

		peerConnection, videoTrack, err := steelrtc.CreatePeerConnection()
		if err != nil {
			log.Printf("Failed to create peer connection: %v", err)
			return
		}
		defer peerConnection.Close()

		// Add this track to global list for RTP forwarding
		videoTrackLock.Lock()
		videoTracks = append(videoTracks, videoTrack)
		videoTrackLock.Unlock()

		// Handle ICE candidates
		peerConnection.OnICECandidate(func(candidate *webrtc.ICECandidate) {
			if candidate == nil {
				log.Println("ICE gathering complete")
				return
			}

			log.Printf("Generated ICE candidate: %s", candidate.String())

			msg := Message{
				Type: "ice-candidate",
				Data: candidate.ToJSON(),
			}

			if err := ws.WriteJSON(msg); err != nil {
				log.Printf("Failed to send ICE candidate: %v", err)
			}
		})

		for {
			var msg Message
			err := ws.ReadJSON(&msg)
			if err != nil {
				log.Println("WebSocket read error:", err)
				break
			}

			switch msg.Type {
			case "offer":
				// Parse the offer from the data field
				offerData, err := json.Marshal(msg.Data)
				if err != nil {
					log.Printf("Failed to marshal offer data: %v", err)
					break
				}

				var offer webrtc.SessionDescription
				if err := json.Unmarshal(offerData, &offer); err != nil {
					log.Printf("Failed to unmarshal offer: %v", err)
					break
				}

				log.Println("Received offer, setting remote description")
				if err := peerConnection.SetRemoteDescription(offer); err != nil {
					log.Printf("SetRemoteDescription failed: %v", err)
					break
				}

				log.Println("Creating answer")
				answer, err := peerConnection.CreateAnswer(nil)
				if err != nil {
					log.Printf("CreateAnswer failed: %v", err)
					break
				}

				log.Println("Setting local description")
				if err := peerConnection.SetLocalDescription(answer); err != nil {
					log.Printf("SetLocalDescription failed: %v", err)
					break
				}

				// Send the answer
				answerMsg := Message{
					Type: "answer",
					Data: answer,
				}

				log.Println("Sending answer to client")
				if err := ws.WriteJSON(answerMsg); err != nil {
					log.Printf("Failed to send answer: %v", err)
					break
				}

				log.Println("Answer sent successfully")

			case "ice-candidate":
				// Parse the ICE candidate from the data field
				candidateData, err := json.Marshal(msg.Data)
				if err != nil {
					log.Printf("Failed to marshal candidate data: %v", err)
					continue
				}

				var candidate webrtc.ICECandidateInit
				if err := json.Unmarshal(candidateData, &candidate); err != nil {
					log.Printf("Failed to unmarshal ICE candidate: %v", err)
					continue
				}

				log.Printf("Received ICE candidate: %s", candidate.Candidate)
				if err := peerConnection.AddICECandidate(candidate); err != nil {
					log.Printf("Failed to add ICE candidate: %v", err)
				}

			case "mouse":
				// Handle mouse events
				eventData, err := json.Marshal(msg.Data)
				if err != nil {
					log.Printf("Failed to marshal mouse data: %v", err)
					continue
				}

				var mouseEvent steelrtc.MouseEvent
				if err := json.Unmarshal(eventData, &mouseEvent); err != nil {
					log.Printf("Failed to unmarshal mouse event: %v", err)
					continue
				}

				if err := steelrtc.HandleMouseEvent(mouseEvent); err != nil {
					log.Printf("Failed to handle mouse event: %v", err)
				}

			case "keyboard":
				// Handle keyboard events
				eventData, err := json.Marshal(msg.Data)
				if err != nil {
					log.Printf("Failed to marshal keyboard data: %v", err)
					continue
				}

				var keyboardEvent steelrtc.KeyboardEvent
				if err := json.Unmarshal(eventData, &keyboardEvent); err != nil {
					log.Printf("Failed to unmarshal keyboard event: %v", err)
					continue
				}

				if err := steelrtc.HandleKeyboardEvent(keyboardEvent); err != nil {
					log.Printf("Failed to handle keyboard event: %v", err)
				}

			case "clipboard":
				// Handle clipboard events
				eventData, err := json.Marshal(msg.Data)
				if err != nil {
					log.Printf("Failed to marshal clipboard data: %v", err)
					continue
				}

				var clipboardEvent steelrtc.ClipboardEvent
				if err := json.Unmarshal(eventData, &clipboardEvent); err != nil {
					log.Printf("Failed to unmarshal clipboard event: %v", err)
					continue
				}

				if err := steelrtc.HandleClipboardEvent(clipboardEvent); err != nil {
					log.Printf("Failed to handle clipboard event: %v", err)
				}

			default:
				log.Printf("Unknown message type: %s", msg.Type)
			}
		}

		log.Println("WebSocket connection closed")
	})

	// Serve HTML page with interaction support
	http.HandleFunc("/sessions/debug", func(w http.ResponseWriter, r *http.Request) {

		// Fix this template implementation
		w.Header().Set("Content-Type", "text/html")

		// Execute template directly to response writer
		data := struct {
			ICE_SERVERS string
			WS_URL      string
		}{
			ICE_SERVERS: config.IceServersJSON,
			WS_URL:      fmt.Sprintf("ws://%s:%s%s", config.Host, config.Port, "/v1/sessions/webrtc"),
		}
		if err := tmpl.Execute(w, data); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	})

	// Start HTTP server
	go func() {
		fmt.Printf("HTTP server listening on %s:%s", config.Host, config.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal("HTTP server error:", err)
		}
	}()

	// --- Wait for signal ---
	<-sigCh
	log.Println("Shutdown signal received")

	if udpConn != nil {
		udpConn.Close() // unblock ReadFromUDP
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Println("HTTP server shutdown error:", err)
	}

	log.Println("Exit complete")
}
