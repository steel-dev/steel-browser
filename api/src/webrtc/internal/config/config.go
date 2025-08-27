package config

import "os"

// helper: get env var or default
func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}

var Port = getEnv("PORT", "3001")                                                                                                                                                    // Port number for the server
var Host = getEnv("HOST", "0.0.0.0")                                                                                                                                                 // Hostname or IP address of the server
var Version = getEnv("VERSION", "0.2.4")                                                                                                                                             // Steel-Browser Version
var ExternalIP = getEnv("EXTERNAL_IP", "127.0.0.1")                                                                                                                                  // Communicating with TURN servers
var LocalIP = getEnv("LOCAL_IP", "127.0.0.1")                                                                                                                                        // If using locally, this is the IP address of the local machine
var Env = getEnv("ENV", "development")                                                                                                                                               // Environment for the server
var Display = getEnv("DISPLAY", ":10")                                                                                                                                               // Display for the browser
var IceServersJSON = getEnv("ICE_SERVERS_JSON", `[{"urls":["stun:stun.l.google.com:19302"]},{"urls":["stun:stun1.l.google.com:19302"]},{"urls":["stun:stun2.l.google.com:19302"]}]`) // JSON string for ICE servers
