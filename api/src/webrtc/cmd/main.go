package main

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"strconv"
	"sync"
	"syscall"
	"text/template"
	"time"
	"webrtc/internal/config"
	"webrtc/internal/steelrtc"

	"github.com/gorilla/websocket"
	"github.com/joho/godotenv"
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

// Mouse event data
type MouseEvent struct {
	X      int    `json:"x"`
	Y      int    `json:"y"`
	Button string `json:"button"` // "left", "right", "middle"
	Action string `json:"action"` // "down", "up", "click", "move"
}

// Keyboard event data
type KeyboardEvent struct {
	Key    string `json:"key"`
	Action string `json:"action"` // "down", "up", "type"
}

// Clipboard event data
type ClipboardEvent struct {
	Text   string `json:"text"`
	Action string `json:"action"` // "copy", "paste"
}

// Handle mouse events by sending them to xdotool
func handleMouseEvent(event MouseEvent) error {
	log.Printf("Mouse event: %+v", event)

	display := os.Getenv("DISPLAY")
	if display == "" {
		display = ":10"
	}

	var cmd *exec.Cmd

	switch event.Action {
	case "move":
		cmd = exec.Command("xdotool", "mousemove", strconv.Itoa(event.X), strconv.Itoa(event.Y))
	case "click":
		buttonNum := "1" // left click
		if event.Button == "right" {
			buttonNum = "3"
		} else if event.Button == "middle" {
			buttonNum = "2"
		}
		// Move first, then click
		exec.Command("xdotool", "mousemove", strconv.Itoa(event.X), strconv.Itoa(event.Y)).Run()
		cmd = exec.Command("xdotool", "click", buttonNum)
	case "down":
		buttonNum := "1"
		if event.Button == "right" {
			buttonNum = "3"
		} else if event.Button == "middle" {
			buttonNum = "2"
		}
		exec.Command("xdotool", "mousemove", strconv.Itoa(event.X), strconv.Itoa(event.Y)).Run()
		cmd = exec.Command("xdotool", "mousedown", buttonNum)
	case "up":
		buttonNum := "1"
		if event.Button == "right" {
			buttonNum = "3"
		} else if event.Button == "middle" {
			buttonNum = "2"
		}
		cmd = exec.Command("xdotool", "mouseup", buttonNum)
	}

	if cmd != nil {
		cmd.Env = append(os.Environ(), "DISPLAY="+display)
		return cmd.Run()
	}

	return nil
}

// Handle keyboard events
func handleKeyboardEvent(event KeyboardEvent) error {
	log.Printf("Keyboard event: %+v", event)

	display := os.Getenv("DISPLAY")
	if display == "" {
		display = ":10"
	}

	var cmd *exec.Cmd

	switch event.Action {
	case "type":
		cmd = exec.Command("xdotool", "type", event.Key)
	case "down":
		cmd = exec.Command("xdotool", "keydown", event.Key)
	case "up":
		cmd = exec.Command("xdotool", "keyup", event.Key)
	}

	if cmd != nil {
		cmd.Env = append(os.Environ(), "DISPLAY="+display)
		return cmd.Run()
	}

	return nil
}

// Handle clipboard events
func handleClipboardEvent(event ClipboardEvent) error {
	log.Printf("Clipboard event: %+v", event)

	display := os.Getenv("DISPLAY")
	if display == "" {
		display = ":10"
	}

	var cmd *exec.Cmd

	switch event.Action {
	case "paste":
		// Set clipboard content then paste
		cmd = exec.Command("sh", "-c", "echo '"+event.Text+"' | xclip -selection clipboard")
		cmd.Env = append(os.Environ(), "DISPLAY="+display)
		if err := cmd.Run(); err != nil {
			return err
		}
		// Now paste with Ctrl+V
		cmd = exec.Command("xdotool", "key", "ctrl+v")
	case "copy":
		// Send Ctrl+C to copy
		cmd = exec.Command("xdotool", "key", "ctrl+c")
	}

	if cmd != nil {
		cmd.Env = append(os.Environ(), "DISPLAY="+display)
		return cmd.Run()
	}

	return nil
}

func main() {
	log.Println("Starting Steel WebRTC server")
	// Writing HTML file to memory
	tmpl, err := template.ParseFS(tmplFS, "web/live-session-streamer.html")
	if err != nil {
		log.Fatal(err)
	}
	envErr := godotenv.Load(".env")
	if envErr != nil {
		log.Println("No .env file found, relying on environment variables")
	}

	// --- Signal handling ---
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	// Start RTP listener for ffmpeg stream
	go func() {
		steelrtc.StartRTPListener(videoTracks, &videoTrackLock)
	}()

	// --- HTTP server with graceful shutdown ---
	srv := &http.Server{Addr: fmt.Sprintf("%s:%d", config.Host, config.Port), Handler: nil}

	// WebSocket handler for signaling and interactions
	http.HandleFunc("/"+config.WebRTCEndpoint, func(w http.ResponseWriter, r *http.Request) {

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
			ticker := time.NewTicker(54 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-ticker.C:
					if err := ws.WriteMessage(websocket.PingMessage, nil); err != nil {
						log.Println("Ping failed:", err)
						cancel()
						return
					}
				case <-ctx.Done():
					return
				}
			}
		}()

		// Your existing peer connection creation code...
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

				var mouseEvent MouseEvent
				if err := json.Unmarshal(eventData, &mouseEvent); err != nil {
					log.Printf("Failed to unmarshal mouse event: %v", err)
					continue
				}

				if err := handleMouseEvent(mouseEvent); err != nil {
					log.Printf("Failed to handle mouse event: %v", err)
				}

			case "keyboard":
				// Handle keyboard events
				eventData, err := json.Marshal(msg.Data)
				if err != nil {
					log.Printf("Failed to marshal keyboard data: %v", err)
					continue
				}

				var keyboardEvent KeyboardEvent
				if err := json.Unmarshal(eventData, &keyboardEvent); err != nil {
					log.Printf("Failed to unmarshal keyboard event: %v", err)
					continue
				}

				if err := handleKeyboardEvent(keyboardEvent); err != nil {
					log.Printf("Failed to handle keyboard event: %v", err)
				}

			case "clipboard":
				// Handle clipboard events
				eventData, err := json.Marshal(msg.Data)
				if err != nil {
					log.Printf("Failed to marshal clipboard data: %v", err)
					continue
				}

				var clipboardEvent ClipboardEvent
				if err := json.Unmarshal(eventData, &clipboardEvent); err != nil {
					log.Printf("Failed to unmarshal clipboard event: %v", err)
					continue
				}

				if err := handleClipboardEvent(clipboardEvent); err != nil {
					log.Printf("Failed to handle clipboard event: %v", err)
				}

			default:
				log.Printf("Unknown message type: %s", msg.Type)
			}
		}

		log.Println("WebSocket connection closed")
	})

	// Serve HTML page with interaction support
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if serversJSON := os.Getenv("ICE_SERVERS_JSON"); serversJSON != "" {
			log.Default().Printf("ICE JSON servers: %v", serversJSON)
			data := map[string]any{
				"ICE_SERVERS": template.JSEscapeString(serversJSON),
				"WS_URL":      fmt.Sprintf("ws://%s:%d/%s", config.Host, config.Port, config.WebRTCEndpoint),
			}
			tmpl.Execute(w, data)
		}
	})

	go func() {
		fmt.Printf("HTTP server listening on %s:%d", config.Host, config.Port)
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
