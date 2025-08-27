package steelrtc

import (
	"fmt"
	"os"
	"strings"
	"webrtc/internal/config"
	internalConfig "webrtc/internal/config"
)

// ConnectionConfig holds the configuration for different environments
type ConnectionConfig struct {
	ICEServers []string
	Host       string
	Port       string
}

// ConnectionFactory creates connections based on environment
type ConnectionFactory struct {
	config ConnectionConfig
}

// NewConnectionFactory creates a new connection factory based on ENV variable
func NewConnectionFactory() *ConnectionFactory {
	env := strings.ToLower(config.Env)
	if env == "" {
		env = "development" // default to development if not set
	}

	var config ConnectionConfig

	switch env {
	case "production":
		// Use ICE_SERVERS environment variable for production
		iceServers := internalConfig.IceServersJSON
		if iceServers != "" {
			// Split comma-separated ICE servers
			config.ICEServers = strings.Split(iceServers, ",")
		} else {
			// Fallback production ICE servers
			config.ICEServers = []string{
				"stun:stun.l.google.com:19302",
				"stun:stun1.l.google.com:19302",
			}
		}
		config.Host = "0.0.0.0" // External IP for production
		config.Port = "3001"

	case "staging":
		// Use different ICE servers for staging
		config.ICEServers = []string{
			"stun:stun.l.google.com:19302",
			"turn:staging-turn.example.com:3478",
		}
		config.Host = "0.0.0.0" // External IP for staging
		config.Port = "3001"

	case "development":
	default:
		// Use local ICE servers for development
		config.ICEServers = []string{
			"stun:localhost:3478",
			"turn:localhost:3478",
		}
		config.Host = "127.0.0.1" // Local IP for development
		config.Port = "3001"
	}

	return &ConnectionFactory{
		config: config,
	}
}

// GetConfig returns the current configuration
func (cf *ConnectionFactory) GetConfig() ConnectionConfig {
	return cf.config
}

// CreateConnection simulates creating a connection with the configured settings
func (cf *ConnectionFactory) CreateConnection() (*Connection, error) {
	fmt.Printf("Creating connection for environment: %s\n", os.Getenv("ENV"))
	fmt.Printf("Using ICE servers: %v\n", cf.config.ICEServers)
	fmt.Printf("Host: %s, Port: %s\n", cf.config.Host, cf.config.Port)

	// Here you would implement your actual connection logic
	conn := &Connection{
		ICEServers: cf.config.ICEServers,
		Address:    fmt.Sprintf("%s:%s", cf.config.Host, cf.config.Port),
		IsLocal:    cf.config.Host == "127.0.0.1",
	}

	return conn, nil
}

// Connection represents a network connection
type Connection struct {
	ICEServers []string
	Address    string
	IsLocal    bool
}

// Close closes the connection
func (c *Connection) Close() error {
	fmt.Println("Connection closed")
	return nil
}
