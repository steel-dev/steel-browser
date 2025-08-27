package main

import (
	"context"
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
	// //go:embed web/live-session-streamer.html
	// tmplFS embed.FS
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

	display := config.Display

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
	// tmpl, err := template.ParseFS(tmplFS, "web/live-session-streamer.html")
	// if err != nil {
	// 	log.Fatal(err)
	// }

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
	http.HandleFunc(config.WebRTCEndpoint, func(w http.ResponseWriter, r *http.Request) {

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

		// Fix this template implementation
		// log.Default().Printf("ICE JSON servers: %v", config.IceServersJSON)

		// data := struct {
		// 	ICE_SERVERS template.JS
		// 	WS_URL      string
		// }{
		// 	ICE_SERVERS: template.JS(config.IceServersJSON),
		// 	WS_URL:      fmt.Sprintf("ws://%s:%s%s", config.Host, config.Port, config.WebRTCEndpoint),
		// }
		// tmpl.Execute(w, data)
		w.Write([]byte(`
	<!DOCTYPE html>
	<html>
	<head>
	    <title>Interactive WebRTC Stream</title>
	    <style>
	        body {
	            margin: 0;
	            padding: 20px;
	            font-family: Arial, sans-serif;
	            background: #f0f0f0;
	        }
	        .container {
	            max-width: 1800px;
	            margin: 0 auto;
	        }
	        #videoCanvas {
	            width: 100%;
	            max-width: 1800px;
	            border: 2px solid #333;
	            cursor: none;
	            display: block;
	            margin: 0 auto 20px auto;
	            background: #000;
	        }
	        #videoCanvas:focus {
	            outline: 2px solid #007bff;
	            outline-offset: 2px;
	        }
	        #hiddenVideo {
	            display: none;
	        }
	        .controls {
	            text-align: center;
	            margin: 20px 0;
	        }
	        .control-group {
	            margin: 10px;
	            display: inline-block;
	        }
	        input, textarea, button {
	            padding: 8px;
	            margin: 5px;
	            font-size: 14px;
	        }
	        #clipboardText {
	            width: 300px;
	            height: 60px;
	        }
	        .status {
	            text-align: center;
	            padding: 10px;
	            margin: 10px 0;
	            border-radius: 4px;
	        }
	        .status.connected { background: #d4edda; color: #155724; }
	        .status.disconnected { background: #f8d7da; color: #721c24; }
	    </style>
	</head>
	<body>
	    <div class="container">
	        <h1>Interactive WebRTC Stream</h1>
	        <div id="status" class="status disconnected">Disconnected</div>

	        <video autoplay playsinline muted style="display:block; width:640px; height:auto;"></video>
	        <canvas id="videoCanvas"></canvas>

	        <div class="controls">
	            <div class="control-group">
	                <h3>Clipboard</h3>
	                <textarea id="clipboardText" placeholder="Text to paste..."></textarea><br>
	                <button onclick="pasteText()">Paste to Stream</button>
	                <button onclick="copyFromStream()">Copy from Stream</button>
	            </div>

	            <div class="control-group">
	                <h3>Keyboard</h3>
	                <input type="text" id="keyInput" placeholder="Type here to send keys..." style="width: 200px;">
	                <button onclick="sendSpecialKey('ctrl+c')">Ctrl+C</button>
	                <button onclick="sendSpecialKey('ctrl+v')">Ctrl+V</button>
	                <button onclick="sendSpecialKey('ctrl+a')">Ctrl+A</button>
	            </div>
	        </div>
	    </div>

	    <script>
	        const ws = new WebSocket('ws://localhost:3001/v1/sessions/webrtc');
	        const pc = new RTCPeerConnection({
         iceServers: [
             {
               urls: "stun:stun.relay.metered.ca:80",
             },
             {
               urls: "turn:global.relay.metered.ca:80",
               username: "0ee5e77192b5e67f471b8bc9",
               credential: "6K8IOBskAee2gm7i",
             },
             {
               urls: "turn:global.relay.metered.ca:80?transport=tcp",
               username: "0ee5e77192b5e67f471b8bc9",
               credential: "6K8IOBskAee2gm7i",
             },
             {
               urls: "turn:global.relay.metered.ca:443",
               username: "0ee5e77192b5e67f471b8bc9",
               credential: "6K8IOBskAee2gm7i",
             },
             {
               urls: "turns:global.relay.metered.ca:443?transport=tcp",
               username: "0ee5e77192b5e67f471b8bc9",
               credential: "6K8IOBskAee2gm7i",
             },
         ],
	        });

	        const hiddenVideo = document.getElementById('hiddenVideo');
	        const canvas = document.getElementById('videoCanvas');
	        const ctx = canvas.getContext('2d');
	        const status = document.getElementById('status');
	        let animationFrame;

	        // Add transceiver to receive video
	        pc.addTransceiver('video', { direction: 'recvonly' });

	        pc.ontrack = (event) => {
	            console.log('Received track:', event.track);
	            hiddenVideo.srcObject = event.streams[0];

	            hiddenVideo.addEventListener('loadedmetadata', () => {
					console.log("Video metadata loaded:", hiddenVideo.videoWidth, hiddenVideo.videoHeight);
	                // Set canvas size to match video
	                canvas.width = hiddenVideo.videoWidth;
	                canvas.height = hiddenVideo.videoHeight;

	                // Start rendering video to canvas
	                renderVideoToCanvas();
	            });
	        };

	        function renderVideoToCanvas() {
	            if (hiddenVideo.videoWidth > 0 && hiddenVideo.videoHeight > 0) {
	                ctx.drawImage(hiddenVideo, 0, 0, canvas.width, canvas.height);
	            }
	            animationFrame = requestAnimationFrame(renderVideoToCanvas);
	        }

	        pc.onicecandidate = (event) => {
	            if (event.candidate) {
	                ws.send(JSON.stringify({
	                    type: 'ice-candidate',
	                    data: {
	                        candidate: event.candidate.candidate,
	                        sdpMid: event.candidate.sdpMid,
	                        sdpMLineIndex: event.candidate.sdpMLineIndex
	                    }
	                }));
	            }
	        };

	        pc.oniceconnectionstatechange = () => {
	            console.log('ICE connection state:', pc.iceConnectionState);
	            updateStatus(pc.iceConnectionState);
	        };

	        function updateStatus(state) {
	            if (state === 'connected' || state === 'completed') {
	                status.textContent = 'Connected';
	                status.className = 'status connected';
	            } else {
	                status.textContent = 'Disconnected (' + state + ')';
	                status.className = 'status disconnected';
	            }
	        }

	        // Mouse event handling on canvas
	        canvas.addEventListener('mousemove', (e) => {
	            const rect = canvas.getBoundingClientRect();
	            const scaleX = canvas.width / rect.width;
	            const scaleY = canvas.height / rect.height;
	            const x = Math.floor((e.clientX - rect.left) * scaleX);
	            const y = Math.floor((e.clientY - rect.top) * scaleY);

	            ws.send(JSON.stringify({
	                type: 'mouse',
	                data: { x, y, action: 'move' }
	            }));
	        });

	        canvas.addEventListener('click', (e) => {
	            e.preventDefault();
	            const rect = canvas.getBoundingClientRect();
	            const scaleX = canvas.width / rect.width;
	            const scaleY = canvas.height / rect.height;
	            const x = Math.floor((e.clientX - rect.left) * scaleX);
	            const y = Math.floor((e.clientY - rect.top) * scaleY);

	            ws.send(JSON.stringify({
	                type: 'mouse',
	                data: { x, y, button: 'left', action: 'click' }
	            }));
	        });

	        canvas.addEventListener('contextmenu', (e) => {
	            e.preventDefault();
	            const rect = canvas.getBoundingClientRect();
	            const scaleX = canvas.width / rect.width;
	            const scaleY = canvas.height / rect.height;
	            const x = Math.floor((e.clientX - rect.left) * scaleX);
	            const y = Math.floor((e.clientY - rect.top) * scaleY);

	            ws.send(JSON.stringify({
	                type: 'mouse',
	                data: { x, y, button: 'right', action: 'click' }
	            }));
	        });

	        // Mouse down/up for drag operations
	        canvas.addEventListener('mousedown', (e) => {
	            e.preventDefault();
	            const rect = canvas.getBoundingClientRect();
	            const scaleX = canvas.width / rect.width;
	            const scaleY = canvas.height / rect.height;
	            const x = Math.floor((e.clientX - rect.left) * scaleX);
	            const y = Math.floor((e.clientY - rect.top) * scaleY);

	            let button = 'left';
	            if (e.button === 1) button = 'middle';
	            if (e.button === 2) button = 'right';

	            ws.send(JSON.stringify({
	                type: 'mouse',
	                data: { x, y, button, action: 'down' }
	            }));
	        });

	        canvas.addEventListener('mouseup', (e) => {
	            e.preventDefault();
	            const rect = canvas.getBoundingClientRect();
	            const scaleX = canvas.width / rect.width;
	            const scaleY = canvas.height / rect.height;
	            const x = Math.floor((e.clientX - rect.left) * scaleX);
	            const y = Math.floor((e.clientY - rect.top) * scaleY);

	            let button = 'left';
	            if (e.button === 1) button = 'middle';
	            if (e.button === 2) button = 'right';

	            ws.send(JSON.stringify({
	                type: 'mouse',
	                data: { x, y, button, action: 'up' }
	            }));
	        });

	        // Scroll wheel support
	        canvas.addEventListener('wheel', (e) => {
	            e.preventDefault();
	            const rect = canvas.getBoundingClientRect();
	            const scaleX = canvas.width / rect.width;
	            const scaleY = canvas.height / rect.height;
	            const x = Math.floor((e.clientX - rect.left) * scaleX);
	            const y = Math.floor((e.clientY - rect.top) * scaleY);

	            // Send scroll as mouse button 4 (scroll up) or 5 (scroll down)
	            const button = e.deltaY < 0 ? '4' : '5';
	            ws.send(JSON.stringify({
	                type: 'mouse',
	                data: { x, y, button, action: 'click' }
	            }));
	        });

	        // Make canvas focusable for keyboard events
	        canvas.setAttribute('tabindex', '0');
	        canvas.addEventListener('focus', () => {
	            console.log('Canvas focused - keyboard input enabled');
	        });

	        canvas.addEventListener('keydown', (e) => {
	            e.preventDefault();

	            let key = e.key;
	            // Handle special key combinations
	            if (e.ctrlKey && e.key !== 'Control') {
	                key = 'ctrl+' + e.key.toLowerCase();
	            } else if (e.altKey && e.key !== 'Alt') {
	                key = 'alt+' + e.key.toLowerCase();
	            } else if (e.shiftKey && e.key !== 'Shift') {
	                // For printable characters, shift is handled naturally
	                // For special keys, we might want to handle them
	                if (e.key.length > 1) {
	                    key = 'shift+' + e.key.toLowerCase();
	                }
	            }

	            ws.send(JSON.stringify({
	                type: 'keyboard',
	                data: { key: key, action: 'down' }
	            }));
	        });

	        canvas.addEventListener('keyup', (e) => {
	            e.preventDefault();

	            let key = e.key;
	            if (e.ctrlKey && e.key !== 'Control') {
	                key = 'ctrl+' + e.key.toLowerCase();
	            } else if (e.altKey && e.key !== 'Alt') {
	                key = 'alt+' + e.key.toLowerCase();
	            } else if (e.shiftKey && e.key !== 'Shift') {
	                if (e.key.length > 1) {
	                    key = 'shift+' + e.key.toLowerCase();
	                }
	            }

	            ws.send(JSON.stringify({
	                type: 'keyboard',
	                data: { key: key, action: 'up' }
	            }));
	        });

	        // Keyboard event handling
	        document.getElementById('keyInput').addEventListener('input', (e) => {
	            const text = e.target.value;
	            if (text) {
	                ws.send(JSON.stringify({
	                    type: 'keyboard',
	                    data: { key: text, action: 'type' }
	                }));
	                e.target.value = ''; // Clear input
	            }
	        });

	        // Global keyboard capture when video is focused
	        canvas.addEventListener('keydown', (e) => {
	            e.preventDefault();
	            ws.send(JSON.stringify({
	                type: 'keyboard',
	                data: { key: e.key, action: 'down' }
	            }));
	        });

	        // Clipboard functions
	        function pasteText() {
	            const text = document.getElementById('clipboardText').value;
	            if (text) {
	                ws.send(JSON.stringify({ type: 'clipboard', data: { text: text, action: 'paste' }}));
	            }
	        }

	        function copyFromStream() {
	            ws.send(JSON.stringify({
	                type: 'clipboard',
	                data: { action: 'copy' }
	            }));
	        }

	        function sendSpecialKey(key) {
	            ws.send(JSON.stringify({
	                type: 'keyboard',
	                data: { key: key, action: 'down' }
	            }));
	        }

	        // WebSocket handling
	        ws.onopen = async () => {
	            console.log('WebSocket connected');
	            const offer = await pc.createOffer();
	            await pc.setLocalDescription(offer);
	            ws.send(JSON.stringify({
	                type: 'offer',
	                data: {
	                    type: offer.type,
	                    sdp: offer.sdp
	                }
	            }));
	        };

	        ws.onmessage = async (event) => {
	            const msg = JSON.parse(event.data);

	            if (msg.type === 'answer') {
	                await pc.setRemoteDescription(msg.data);
	            } else if (msg.type === 'ice-candidate') {
	                await pc.addIceCandidate(msg.data);
	            }
	        };

	        ws.onerror = (error) => {
	            console.error('WebSocket error:', error);
	        };

	        ws.onclose = () => {
	            console.log('WebSocket closed');
	            updateStatus('disconnected');
	            // Stop animation frame when connection closes
	            if (animationFrame) {
	                cancelAnimationFrame(animationFrame);
	            }
	        };
	    </script>
	</body>
	</html>
	        `))

	})

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
