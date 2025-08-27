package steelrtc

import (
	"io"
	"log"
	"net"
	"sync"
	"time"

	"github.com/pion/rtp"
	"github.com/pion/webrtc/v3"
)

func StartRTPListener(videoTracks []*webrtc.TrackLocalStaticRTP,
	videoTrackLock *sync.RWMutex) {
	log.Println("Starting RTP listener on port 5004...")

	// Listen for RTP packets
	addr := net.UDPAddr{IP: net.ParseIP("0.0.0.0"), Port: 5004}
	udpConn, err := net.ListenUDP("udp", &addr)
	if err != nil {
		log.Fatal("Failed to listen on UDP: ", err)
	}

	defer udpConn.Close()

	log.Println("RTP listener started successfully on port 5004")

	buf := make([]byte, 1600)
	packetCounter := 0
	lastLog := time.Now()

	for {
		n, _, err := udpConn.ReadFromUDP(buf)
		if err != nil {
			log.Println("Error reading RTP:", err)
			continue
		}

		packetCounter++
		if time.Since(lastLog) > 5*time.Second {
			log.Printf("Received %d RTP packets in the last 5 seconds", packetCounter)
			packetCounter = 0
			lastLog = time.Now()
		}

		packet := &rtp.Packet{}
		if err := packet.Unmarshal(buf[:n]); err != nil {
			log.Println("Error unmarshaling RTP:", err)
			continue
		}

		// Forward RTP packet to all connected video tracks
		videoTrackLock.RLock()
		for _, track := range videoTracks {
			if err := track.WriteRTP(packet); err != nil && err != io.ErrClosedPipe {
				log.Println("Error writing RTP to track:", err)
			}
		}
		videoTrackLock.RUnlock()
	}
}
