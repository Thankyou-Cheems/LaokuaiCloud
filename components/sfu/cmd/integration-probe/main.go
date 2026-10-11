// Test-only loopback wrapper. Source-only hardening pending safe-environment validation.
// No config.Load, owner, external ICE or capture; no Windows no-prompt claim.
package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	gw "github.com/gorilla/websocket"
	"github.com/pion/ice/v4"
	"github.com/pion/interceptor"
	"github.com/pion/rtp"
	"github.com/pion/turn/v5"
	p "github.com/pion/webrtc/v4"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"sfu-v2/internal/config"
	"sfu-v2/internal/room"
	"sfu-v2/internal/signaling"
	"sfu-v2/internal/testtransport"
	"sfu-v2/internal/track"
	pm "sfu-v2/internal/webrtc"
	ws "sfu-v2/internal/websocket"
	"sfu-v2/pkg/types"
	"sync"
	"sync/atomic"
	"time"
)

type syntheticPeer struct {
	pc        *p.PeerConnection
	conn      *gw.Conn
	mu        sync.Mutex
	packets   atomic.Int64
	done      chan struct{}
	closeOnce sync.Once
	lastError atomic.Value
}

func (c *syntheticPeer) send(event string, data any) error {
	body, err := json.Marshal(data)
	if err != nil {
		return err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.conn.WriteJSON(types.WebSocketMessage{Event: event, Data: string(body)})
}
func (c *syntheticPeer) close() {
	c.closeOnce.Do(func() { close(c.done); c.conn.Close(); c.pc.Close() })
}
func api() *p.API {
	se := p.SettingEngine{}
	guarded, err := testtransport.New()
	if err != nil {
		panic(err)
	}
	se.SetNet(guarded)
	se.SetICEMulticastDNSMode(ice.MulticastDNSModeDisabled)
	se.SetRemoteIPFilter(func(ip net.IP) bool { return ip.IsLoopback() })
	se.SetIncludeLoopbackCandidate(true)
	se.SetIPFilter(func(ip net.IP) bool { return ip.IsLoopback() })
	se.SetNetworkTypes([]p.NetworkType{p.NetworkTypeUDP4})
	engine := &p.MediaEngine{}
	if err := engine.RegisterDefaultCodecs(); err != nil {
		panic(err)
	}
	registry := &interceptor.Registry{}
	if err := p.RegisterDefaultInterceptors(engine, registry); err != nil {
		panic(err)
	}
	registry.Add(metadataFactory{})
	return p.NewAPI(p.WithSettingEngine(se), p.WithMediaEngine(engine), p.WithInterceptorRegistry(registry))
}
func joinClient(url string, join types.ClientJoinData, publish bool) (*syntheticPeer, error) {
	conn, _, err := gw.DefaultDialer.Dial(url, nil)
	if err != nil {
		return nil, err
	}
	pc, err := api().NewPeerConnection(p.Configuration{})
	if err != nil {
		conn.Close()
		return nil, err
	}
	c := &syntheticPeer{pc: pc, conn: conn, done: make(chan struct{})}
	c.lastError.Store("")
	pc.OnTrack(func(remote *p.TrackRemote, _ *p.RTPReceiver) {
		go func() {
			for {
				_, _, err := remote.ReadRTP()
				if err != nil {
					return
				}
				c.packets.Add(1)
			}
		}()
	})
	if err = c.send("client_join", join); err != nil {
		c.close()
		return nil, err
	}
	go func() {
		defer c.close()
		var mic *p.TrackLocalStaticRTP
		var pending []p.ICECandidateInit
		for {
			var msg types.WebSocketMessage
			if err := conn.ReadJSON(&msg); err != nil {
				c.lastError.Store("websocket closed")
				return
			}
			switch msg.Event {
			case "offer":
				var offer p.SessionDescription
				if err := json.Unmarshal([]byte(msg.Data), &offer); err != nil {
					c.lastError.Store(err.Error())
					return
				}
				if err := pc.SetRemoteDescription(offer); err != nil {
					c.lastError.Store(err.Error())
					return
				}
				for _, candidate := range pending {
					pc.AddICECandidate(candidate)
				}
				pending = nil
				if publish && mic == nil {
					mic, err = p.NewTrackLocalStaticRTP(p.RTPCodecCapability{MimeType: p.MimeTypeOpus, ClockRate: 48000, Channels: 2}, "synthetic-mic-"+join.UserID, join.UserID)
					if err != nil {
						c.lastError.Store(err.Error())
						return
					}
					sender, e := pc.AddTrack(mic)
					if e != nil {
						c.lastError.Store(e.Error())
						return
					}
					go func() {
						buf := make([]byte, 1500)
						for {
							if _, _, err := sender.Read(buf); err != nil {
								return
							}
						}
					}()
					go func() {
						ticker := time.NewTicker(20 * time.Millisecond)
						defer ticker.Stop()
						for seq := uint16(0); ; seq++ {
							select {
							case <-c.done:
								return
							case <-ticker.C:
							}
							_ = mic.WriteRTP(&rtp.Packet{Header: rtp.Header{Version: 2, SequenceNumber: seq, Timestamp: uint32(seq) * 960}, Payload: []byte{0x10, 0, 0, 0}})
						}
					}()
				}
				answer, e := pc.CreateAnswer(nil)
				if e != nil {
					c.lastError.Store(e.Error())
					return
				}
				gathered := p.GatheringCompletePromise(pc)
				if e = pc.SetLocalDescription(answer); e != nil {
					c.lastError.Store(e.Error())
					return
				}
				<-gathered
				if e = c.send("answer", pc.LocalDescription()); e != nil {
					c.lastError.Store(e.Error())
					return
				}
			case "candidate":
				var candidate p.ICECandidateInit
				if json.Unmarshal([]byte(msg.Data), &candidate) == nil {
					if pc.RemoteDescription() == nil {
						pending = append(pending, candidate)
					} else {
						pc.AddICECandidate(candidate)
					}
				}
			case "room_error":
				c.lastError.Store(msg.Data)
			}
		}
	}()
	return c, nil
}

func main() {
	if os.Getenv("GRYT_LOOPBACK_TEST_AUTHORIZED") != "1" {
		fmt.Fprintln(os.Stderr, "Network fixture disabled; requires explicit authorization for verified safe environment")
		return
	}
	// Production logger can include candidates/errors. Keep it out of durable fixture output.
	log.SetOutput(io.Discard)
	rooms := room.NewManager(false)
	rooms.SetRequireClientToken(true)
	tracks := track.NewManager(false)
	peers := pm.NewManager(false)
	cfg := &config.Config{MaxPeers: 32, PingInterval: time.Second * 20, PongTimeout: time.Second * 60, ICEAdvertiseIPs: []string{"127.0.0.1"}, RequireClientToken: true, AudioOnly: true, MicrophoneOpus20: true, HybridEnabled: os.Getenv("HYBRID_LOOPBACK_ENABLED") == "true"}
	coordinator := signaling.NewCoordinator(tracks, peers, rooms, false)
	coordinator.SetMicrophoneOpus20(true)
	handler := ws.NewHandler(cfg, api(), tracks, peers, rooms, coordinator)
	mux := http.NewServeMux()
	mux.HandleFunc("/rtp-observations", func(w http.ResponseWriter, r *http.Request) {
		observations.Lock()
		defer observations.Unlock()
		json.NewEncoder(w).Encode(observations.Values)
	})
	mux.HandleFunc("/server", handler.HandleWebSocket)
	mux.HandleFunc("/client", handler.HandleWebSocket)
	var mu sync.Mutex
	clients := map[string]*syntheticPeer{}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		panic(err)
	}
	base := "http://" + listener.Addr().String()
	url := "ws://" + listener.Addr().String() + "/client"
	// TCP control and UDP relay both bind loopback. Permissions deny every nonloopback peer.
	turnListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		panic(err)
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		panic(err)
	}
	username, password, realm := "synthetic-sdk", hex.EncodeToString(secret), "loopback-fixture"
	relayNet, err := testtransport.New()
	if err != nil {
		panic(err)
	}
	turnServer, err := turn.NewServer(turn.ServerConfig{
		Realm: realm,
		AuthHandler: func(request *turn.RequestAttributes) (string, []byte, bool) {
			if request.Username != username || request.Realm != realm {
				return "", nil, false
			}
			return username, turn.GenerateAuthKey(username, realm, password), true
		},
		ListenerConfigs: []turn.ListenerConfig{{Listener: turnListener,
			RelayAddressGenerator: &turn.RelayAddressGeneratorStatic{RelayAddress: net.ParseIP("127.0.0.1"), Address: "127.0.0.1", Net: relayNet},
			PermissionHandler:     func(client net.Addr, peer net.IP) bool { return peer.IsLoopback() },
		}},
	})
	if err != nil {
		panic(err)
	}
	defer turnServer.Close()
	mux.HandleFunc("/turn-fixture", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(w).Encode(map[string]string{"urls": "turn:" + turnListener.Addr().String() + "?transport=tcp", "username": username, "credential": password})
	})
	mux.HandleFunc("/join", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			w.WriteHeader(405)
			return
		}
		var request struct {
			ID      string               `json:"id"`
			Join    types.ClientJoinData `json:"join"`
			Publish bool                 `json:"publish"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16384)).Decode(&request) != nil {
			w.WriteHeader(400)
			return
		}
		client, e := joinClient(url, request.Join, request.Publish)
		if e != nil {
			w.WriteHeader(500)
			json.NewEncoder(w).Encode(map[string]string{"error": "join transport failed"})
			return
		}
		mu.Lock()
		clients[request.ID] = client
		mu.Unlock()
		json.NewEncoder(w).Encode(map[string]bool{"created": true})
	})
	mux.HandleFunc("/close", func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		client := clients[r.URL.Query().Get("id")]
		mu.Unlock()
		if client != nil {
			client.close()
		}
		json.NewEncoder(w).Encode(map[string]bool{"closed": true})
	})
	mux.HandleFunc("/snapshot", func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		states := map[string]any{}
		for id, c := range clients {
			states[id] = map[string]any{"state": c.pc.ConnectionState().String(), "receivedPackets": c.packets.Load(), "error": c.lastError.Load()}
		}
		mu.Unlock()
		json.NewEncoder(w).Encode(map[string]any{"totalPeers": rooms.TotalPeers(), "rooms": rooms.GetRoomPeersForServer("synthetic-server"), "tracks": tracks.GetRoomStats(), "clients": states})
	})
	fmt.Println(base)
	if err := http.Serve(listener, mux); err != nil {
		panic(err)
	}
}
