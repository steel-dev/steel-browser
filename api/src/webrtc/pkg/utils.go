package utils

import (
	"context"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

func GetLocalIP() string {
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err != nil {
		return "127.0.0.1"
	}
	defer conn.Close()
	localAddr := conn.LocalAddr().(*net.UDPAddr)
	return localAddr.IP.String()
}

func GetExternalIP() string {
	// List of services to try
	services := []string{
		"https://api.ipify.org",
		"https://icanhazip.com",
		"https://ipecho.net/plain",
		"https://myexternalip.com/raw",
	}

	client := &http.Client{Timeout: 10 * time.Second}

	for _, service := range services {
		resp, err := client.Get(service)
		if err != nil {
			continue
		}
		defer resp.Body.Close()

		if resp.StatusCode == 200 {
			body, err := io.ReadAll(resp.Body)
			if err != nil {
				continue
			}

			ip := strings.TrimSpace(string(body))
			return ip
		}
	}

	return "0.0.0.0"
}

func HealthCheck(ws *websocket.Conn, ctx context.Context, cancel context.CancelFunc) {
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
}
