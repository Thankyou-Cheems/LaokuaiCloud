package websocket

import (
	"bufio"
	"context"
	"crypto/sha1"
	"encoding/base64"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestShutdownKeepAliveStopIsIdempotent(t *testing.T) {
	k := &KeepAlive{stop: make(chan struct{}), done: make(chan struct{})}
	k.Stop()
	k.Stop()
	select {
	case <-k.stop:
	default:
		t.Fatal("pinger not stopped")
	}
	close(k.done)
	if err := k.Wait(context.Background()); err != nil {
		t.Fatal(err)
	}
}

// net.Pipe has no OS listener. A real gorilla writer holds our JSON mutex while
// its peer stops reading; shutdown still has to close the underlying transport.
func TestShutdownBypassesBlockedJSONWriter(t *testing.T) {
	client, peer := net.Pipe()
	defer client.Close()
	defer peer.Close()
	started := make(chan struct{})
	finish := make(chan struct{})
	defer close(finish)
	go func() {
		request, err := http.ReadRequest(bufio.NewReader(peer))
		if err != nil {
			return
		}
		sum := sha1.Sum([]byte(request.Header.Get("Sec-WebSocket-Key") + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
		fmt.Fprintf(peer, "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n", base64.StdEncoding.EncodeToString(sum[:]))
		one := make([]byte, 1)
		if _, err := peer.Read(one); err != nil {
			return
		}
		close(started)
		<-finish
	}()
	address, _ := url.Parse("ws://synthetic.invalid/blocked")
	connection, _, err := websocket.NewClient(client, address, nil, 1024, 1024)
	if err != nil {
		t.Fatal(err)
	}
	writer := NewThreadSafeWriter(connection)
	writeDone := make(chan error, 1)
	go func() { writeDone <- writer.WriteJSON(strings.Repeat("synthetic", 2048)) }()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("writer never blocked")
	}
	closed := make(chan error, 1)
	go func() { closed <- writer.ShutdownClose() }()
	select {
	case err := <-closed:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("shutdown waited on JSON mutex")
	}
	select {
	case err := <-writeDone:
		if err == nil {
			t.Fatal("blocked writer unexpectedly succeeded")
		}
	case <-time.After(time.Second):
		t.Fatal("close did not release writer")
	}
}
func TestShutdownKeepAliveWaitBounded(t *testing.T) {
	k := &KeepAlive{done: make(chan struct{})}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if !errors.Is(k.Wait(ctx), context.Canceled) {
		t.Fatal("pinger wait ignored cancellation")
	}
	var none *KeepAlive
	if err := none.Wait(context.Background()); err != nil {
		t.Fatal(err)
	}
}
