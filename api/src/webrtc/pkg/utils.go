package utils

import (
	"context"
	"log"
	"net"
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
