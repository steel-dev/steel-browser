package config

var Port = 3001                                                                                                                                          // Port number for the server
var Host = "0.0.0.0"                                                                                                                                     // Hostname or IP address of the server
var Version = "0.2.4"                                                                                                                                    // Steel-Browser Version
var ExternalIP = "127.0.0.1"                                                                                                                             // Communicating with TURN servers
var LocalIP = "127.0.0.1"                                                                                                                                // If using locally, this is the IP address of the local machine
var Env = "development"                                                                                                                                  // Environment for the server
var WebRTCEndpoint = "v1/sessions/webrtc"                                                                                                                // Endpoint for WebRTC signaling
var Display = ":10"                                                                                                                                      // Display for the browser
var IceServersJSON = `[{"URLs":["stun:stun.l.google.com:19302"]},{"URLs":["stun:stun1.l.google.com:19302"]},{"URLs":["stun:stun2.l.google.com:19302"]}]` // JSON string for ICE servers
