// Test-only socket guard. No network or listener is created by New.
package testtransport

import (
	"context"
	"fmt"
	"github.com/pion/transport/v4"
	"github.com/pion/transport/v4/stdnet"
	"net"
)

type Net struct{ transport.Net }

func New() (*Net, error) {
	base, err := stdnet.NewNet()
	if err != nil {
		return nil, err
	}
	return &Net{base}, nil
}
func literalLoopback(address string) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return err
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		return fmt.Errorf("test transport refuses nonliteral/nonloopback address")
	}
	return nil
}
func (n *Net) ListenPacket(network, address string) (net.PacketConn, error) {
	if err := literalLoopback(address); err != nil {
		return nil, err
	}
	return n.Net.ListenPacket(network, address)
}
func (n *Net) ListenUDP(network string, address *net.UDPAddr) (transport.UDPConn, error) {
	if address == nil || !address.IP.IsLoopback() {
		return nil, fmt.Errorf("test transport refuses wildcard/nonloopback UDP bind")
	}
	return n.Net.ListenUDP(network, address)
}
func (n *Net) ListenTCP(network string, address *net.TCPAddr) (transport.TCPListener, error) {
	if address == nil || !address.IP.IsLoopback() {
		return nil, fmt.Errorf("test transport refuses wildcard/nonloopback TCP bind")
	}
	return n.Net.ListenTCP(network, address)
}
func (n *Net) Dial(network, address string) (net.Conn, error) {
	if err := literalLoopback(address); err != nil {
		return nil, err
	}
	return n.Net.Dial(network, address)
}
func (n *Net) DialUDP(network string, local, remote *net.UDPAddr) (transport.UDPConn, error) {
	if remote == nil || !remote.IP.IsLoopback() {
		return nil, fmt.Errorf("test transport refuses nonloopback UDP peer")
	}
	if local == nil {
		ip := net.IPv4(127, 0, 0, 1)
		if remote.IP.To4() == nil {
			ip = net.IPv6loopback
		}
		local = &net.UDPAddr{IP: ip}
	}
	if !local.IP.IsLoopback() {
		return nil, fmt.Errorf("test transport refuses wildcard/nonloopback UDP source")
	}
	return n.Net.DialUDP(network, local, remote)
}
func (n *Net) DialTCP(network string, local, remote *net.TCPAddr) (transport.TCPConn, error) {
	if remote == nil || !remote.IP.IsLoopback() {
		return nil, fmt.Errorf("test transport refuses nonloopback TCP peer")
	}
	if local == nil {
		ip := net.IPv4(127, 0, 0, 1)
		if remote.IP.To4() == nil {
			ip = net.IPv6loopback
		}
		local = &net.TCPAddr{IP: ip}
	}
	if !local.IP.IsLoopback() {
		return nil, fmt.Errorf("test transport refuses wildcard/nonloopback TCP source")
	}
	return n.Net.DialTCP(network, local, remote)
}

type listenConfig struct{ transport.ListenConfig }

func (c listenConfig) Listen(ctx context.Context, network, address string) (net.Listener, error) {
	if err := literalLoopback(address); err != nil {
		return nil, err
	}
	return c.ListenConfig.Listen(ctx, network, address)
}
func (c listenConfig) ListenPacket(ctx context.Context, network, address string) (net.PacketConn, error) {
	if err := literalLoopback(address); err != nil {
		return nil, err
	}
	return c.ListenConfig.ListenPacket(ctx, network, address)
}
func (n *Net) CreateListenConfig(config *net.ListenConfig) transport.ListenConfig {
	return listenConfig{n.Net.CreateListenConfig(config)}
}

type dialer struct{ transport.Dialer }

func (d dialer) Dial(network, address string) (net.Conn, error) {
	if err := literalLoopback(address); err != nil {
		return nil, err
	}
	return d.Dialer.Dial(network, address)
}
func (n *Net) CreateDialer(config *net.Dialer) transport.Dialer {
	return dialer{n.Net.CreateDialer(config)}
}
