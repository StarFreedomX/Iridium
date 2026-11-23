package desktop

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

// A download from a window's own Iridium is the app's own, not the web view's: the web view says
// nothing of how far it is (mygo tells only its start and end), and on Windows its SmartScreen
// stopped an .exe without a word (QGI, 2026-11-23). The app fetches it with the page's cookies,
// telling the page how far it has come (its toast, web/src/irapp.ts).

// dlClient has no deadline for the whole body, only for the answer to start and for a pause in
// it: a large file takes as long as it takes.
var dlClient = &http.Client{Transport: &http.Transport{
	Proxy:                 http.ProxyFromEnvironment,
	DialContext:           (&net.Dialer{Timeout: 15 * time.Second}).DialContext,
	TLSHandshakeTimeout:   15 * time.Second,
	ResponseHeaderTimeout: 30 * time.Second,
}}

// fetch saves raw at path via a unique hidden .part file in the same directory, renamed at the end
// and removed on error or cancellation (no half a file left under the name). progress is called
// once headers arrive with the total (-1: not said), at most every 200 ms as bytes come, and once
// at the end.
func fetch(ctx context.Context, raw, path string, cookies []*http.Cookie, progress func(got, total int64)) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
	if err != nil {
		return err
	}
	for _, c := range cookies {
		req.AddCookie(c)
	}
	resp, err := dlClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".iridium-*.part")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	defer f.Close()
	total, got, last := resp.ContentLength, int64(0), time.Now()
	progress(got, total)
	buf := make([]byte, 256<<10)
	for {
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			if _, err := f.Write(buf[:n]); err != nil {
				return err
			}
			got += int64(n)
			if now := time.Now(); now.Sub(last) >= 200*time.Millisecond {
				last = now
				progress(got, total)
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			return rerr
		}
	}
	if err := f.Close(); err != nil {
		return err
	}
	if total >= 0 && got != total {
		return fmt.Errorf("cut short: %d of %d bytes", got, total)
	}
	progress(got, total)
	if err := ctx.Err(); err != nil {
		return err
	}
	return os.Rename(f.Name(), path)
}
