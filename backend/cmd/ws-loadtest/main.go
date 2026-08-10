// Command ws-loadtest opens N concurrent map WebSocket connections against a
// running API to verify goroutine growth stays bounded (pair with pprof).
//
// Usage:
//
//	go run ./cmd/ws-loadtest -url ws://127.0.0.1:8080/v1/ws/map -n 5000 -token <session>
//
// On the API process:
//
//	import _ "net/http/pprof"
//	// or: go tool pprof http://127.0.0.1:6060/debug/pprof/goroutine
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"runtime"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
)

func main() {
	url := flag.String("url", "ws://127.0.0.1:8080/v1/ws/map", "WebSocket base URL without token")
	token := flag.String("token", "", "session token (required)")
	n := flag.Int("n", 5000, "concurrent connections")
	hold := flag.Duration("hold", 10*time.Second, "how long to hold connections open")
	flag.Parse()

	if *token == "" {
		fmt.Fprintln(os.Stderr, "-token is required")
		os.Exit(2)
	}

	full := fmt.Sprintf("%s?token=%s", *url, *token)
	before := runtime.NumGoroutine()
	fmt.Printf("client goroutines before dial: %d\n", before)
	fmt.Printf("dialing %d connections to %s\n", *n, *url)

	var ok atomic.Int64
	var fail atomic.Int64
	conns := make([]*websocket.Conn, *n)
	var wg sync.WaitGroup
	sem := make(chan struct{}, 200)

	for i := 0; i < *n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			conn, _, err := websocket.Dial(ctx, full, nil)
			if err != nil {
				fail.Add(1)
				return
			}
			bbox := []byte(`{"type":"viewport","bbox":[26,36,45,42]}`)
			_ = conn.Write(ctx, websocket.MessageText, bbox)
			conns[i] = conn
			ok.Add(1)
		}(i)
	}
	wg.Wait()
	fmt.Printf("connected=%d failed=%d client_goroutines=%d\n", ok.Load(), fail.Load(), runtime.NumGoroutine())
	fmt.Printf("hold for %s — sample server pprof goroutine profile now\n", *hold)
	time.Sleep(*hold)

	for _, c := range conns {
		if c != nil {
			_ = c.Close(websocket.StatusNormalClosure, "")
		}
	}
	time.Sleep(2 * time.Second)
	fmt.Printf("after close client_goroutines=%d (before=%d)\n", runtime.NumGoroutine(), before)
}
