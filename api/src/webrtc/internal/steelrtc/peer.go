package steelrtc

import (
	"encoding/json"
	"log"
	"net"
	"sync"
	"time"
	"webrtc/internal/config"

	"github.com/pion/webrtc/v3"
)

// Peer represents a single WebRTC peer connection.
type Peer struct {
	Conn      *webrtc.PeerConnection
	DataChan  *webrtc.DataChannel
	closeOnce sync.Once
	onICE     func(c *webrtc.ICECandidate) // callback to signal ICE candidates
	onMessage func(msg string)             // callback for datachannel messages
}

func CreatePeerConnection() (*webrtc.PeerConnection, *webrtc.TrackLocalStaticRTP, error) {
	var (
		peerConnection *webrtc.PeerConnection
		videoTracks    []*webrtc.TrackLocalStaticRTP
		videoTrackLock sync.RWMutex
	)

	publicIP := config.ExternalIP

	log.Println("Using external IP for ICE:", publicIP)
	// localIP := getLocalIP()
	// log.Println("Using local IP for ICE:", localIP)

	// Create a MediaEngine and register VP8 codec
	m := &webrtc.MediaEngine{}
	if err := m.RegisterCodec(webrtc.RTPCodecParameters{
		RTPCodecCapability: webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8, ClockRate: 90000},
		PayloadType:        96,
	}, webrtc.RTPCodecTypeVideo); err != nil {
		return nil, nil, err
	}

	// Set ICE settings
	settingEngine := webrtc.SettingEngine{}
	settingEngine.SetEphemeralUDPPortRange(10000, 10010) // Port range for ephemeral UDP ports, when changed it needs to be changed in Docker

	// Use actual external IP instead of host.docker.internal
	if net.ParseIP(publicIP) != nil {
		settingEngine.SetNAT1To1IPs([]string{publicIP}, webrtc.ICECandidateTypeHost)
		log.Printf("Set NAT1To1IP to: %s", publicIP)
	} else {
		log.Printf("Invalid external IP: %s", publicIP)
	}

	// if net.ParseIP(localIP) != nil {
	// 	settingEngine.SetNAT1To1IPs([]string{localIP}, webrtc.ICECandidateTypeHost)
	// 	log.Printf("Set NAT1To1IP to: %s", localIP)
	// } else {
	// 	log.Printf("Invalid external IP: %s", localIP)
	// }
	settingEngine.SetICETimeouts(10*time.Second, 5*time.Second, 1*time.Second)

	settingEngine.SetNetworkTypes([]webrtc.NetworkType{
		webrtc.NetworkTypeUDP4,
		webrtc.NetworkTypeUDP6,
		// webrtc.NetworkTypeTCP4, // ICE-TCP passive
		// webrtc.NetworkTypeTCP6, // ICE-TCP passive
	})

	// Create API with media engine and setting engine
	api := webrtc.NewAPI(
		webrtc.WithMediaEngine(m),
		webrtc.WithSettingEngine(settingEngine),
	)

	// Create a new PeerConnection
	var iceServers []webrtc.ICEServer
	if err := json.Unmarshal([]byte(config.IceServersJSON), &iceServers); err != nil {
		log.Fatal("Invalid ICE_SERVERS_JSON:", err)
	}

	log.Println("ICE Servers:", iceServers)

	// Use in PeerConnection
	peerConnection, err := api.NewPeerConnection(webrtc.Configuration{
		ICEServers: iceServers,
	})
	if err != nil {
		log.Fatal(err)
	}

	// Create a video track
	videoTrack, err := webrtc.NewTrackLocalStaticRTP(webrtc.RTPCodecCapability{
		MimeType: webrtc.MimeTypeVP8,
	}, "video", "pion-video")
	if err != nil {
		peerConnection.Close()
		return nil, nil, err
	}

	// Add the track to the peer connection
	rtpSender, err := peerConnection.AddTrack(videoTrack)
	if err != nil {
		peerConnection.Close()
		return nil, nil, err
	}

	// Read RTCP packets
	go func() {
		rtcpBuf := make([]byte, 1500)
		for {
			if _, _, rtcpErr := rtpSender.Read(rtcpBuf); rtcpErr != nil {
				return
			}
		}
	}()

	peerConnection.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate != nil {
			log.Printf("Generated ICE candidate: %s (type: %s)", candidate.String(), candidate.Typ.String())
		}
	})

	peerConnection.OnICEGatheringStateChange(func(state webrtc.ICEGathererState) {
		log.Printf("ICE Gathering State: %s", state.String())
	})

	// Setup ICE connection monitoring
	peerConnection.OnICEConnectionStateChange(func(state webrtc.ICEConnectionState) {
		log.Printf("ICE Connection State changed: %s\n", state.String())

		if state == webrtc.ICEConnectionStateFailed || state == webrtc.ICEConnectionStateClosed {
			// Remove track from the global list when connection fails or closes
			videoTrackLock.Lock()
			for i, track := range videoTracks {
				if track == videoTrack {
					videoTracks = append(videoTracks[:i], videoTracks[i+1:]...)
					break
				}
			}
			videoTrackLock.Unlock()
		}
	})

	return peerConnection, videoTrack, nil
}
