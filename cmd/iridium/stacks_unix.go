//go:build unix

package main

import (
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"
)

// dumpStacksOn writes where every goroutine stands to a file in the state directory each time the
// daemon gets SIGUSR1 (kill -USR1 <pid>, at its own machine only): for a session that stays at
// work after its turn ended, to see what it waits on.
func dumpStacksOn(state string) {
	c := make(chan os.Signal, 1)
	signal.Notify(c, syscall.SIGUSR1)
	go func() {
		for range c {
			buf := make([]byte, 16<<20)
			buf = buf[:runtime.Stack(buf, true)]
			path := filepath.Join(state, "stacks-"+time.Now().Format("20060102-150405")+".txt")
			if err := os.WriteFile(path, buf, 0o600); err != nil {
				log.Printf("stacks: %v", err)
				continue
			}
			log.Printf("stacks: written to %s", path)
		}
	}()
}
