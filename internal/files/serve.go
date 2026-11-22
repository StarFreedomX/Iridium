package files

import (
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Files whose bytes are hashed for the sha256 header on first serving; larger ones get it once
// worked out (by .../info or an upload's check).
const sumOnServe = 64 << 20

// sandbox is every served file's Content-Security-Policy: nothing in it runs or loads, so an
// SVG or HTML file cannot act as the page.
const sandbox = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; media-src 'self'; sandbox"

// ServeFile serves the file at path (checked by the caller): Range and If-Range, ETag from its
// size and modification time, its sha256 in Repr-Digest and X-Sha256 where known, its sniffed
// type, and the sandbox CSP. Images, video, audio, PDF and plain text show inline; the rest,
// and any with ?download, download.
func (s *Service) ServeFile(w http.ResponseWriter, r *http.Request, path string) {
	s.serve(w, r, path, sniff(path), r.URL.Query().Has("download"))
}

func (s *Service) serve(w http.ResponseWriter, r *http.Request, path, typ string, download bool) {
	f, err := os.Open(path)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || !st.Mode().IsRegular() {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	h := w.Header()
	h.Set("ETag", ETag(st))
	h.Set("Cache-Control", "private, no-cache")
	h.Set("Content-Security-Policy", sandbox)
	h.Set("Accept-Ranges", "bytes")
	sum, ok := s.knownSum(path, st)
	if !ok && st.Size() <= sumOnServe && r.Method == http.MethodGet && r.Header.Get("Range") == "" {
		sum, err = s.Sum(path)
		ok = err == nil
	}
	if ok {
		h.Set("X-Sha256", sum)
		if b, err := hexToBase64(sum); err == nil {
			h.Set("Repr-Digest", "sha-256=:"+b+":")
		}
	}
	serveContent(w, r, st.Name(), typ, st.ModTime(), f, download || !inline(typ))
}

// ServePathContent serves a regular file read by path (checked by the caller, local or remote):
// Range via http.ServeContent, no-store, same-origin CORP and a strict sandbox CSP. Only raster
// images and PDF show inline; everything else, and any with ?download, downloads as
// application/octet-stream.
func ServePathContent(w http.ResponseWriter, r *http.Request, name string, mtime time.Time, src io.ReadSeeker) {
	h := w.Header()
	h.Set("Cache-Control", "no-store")
	h.Set("Cross-Origin-Resource-Policy", "same-origin")
	h.Set("Content-Security-Policy", "default-src 'none'; sandbox")
	typ := "application/octet-stream"
	if !r.URL.Query().Has("download") {
		switch candidate := mime.TypeByExtension(strings.ToLower(filepath.Ext(name))); candidate {
		case "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp", "application/pdf":
			typ = candidate
		}
	}
	serveContent(w, r, name, typ, mtime, src, typ == "application/octet-stream")
}

func serveContent(w http.ResponseWriter, r *http.Request, name, typ string, mtime time.Time, src io.ReadSeeker, download bool) {
	disp := "inline"
	if download {
		disp = "attachment"
	}
	h := w.Header()
	h.Set("Content-Type", typ)
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Disposition", mime.FormatMediaType(disp, map[string]string{"filename": name}))
	http.ServeContent(w, r, name, mtime, src)
}

// ETag is a file's validator: its size and modification time.
func ETag(st os.FileInfo) string {
	return fmt.Sprintf(`"%s-%s"`, strconv.FormatInt(st.Size(), 36), strconv.FormatInt(st.ModTime().UnixNano(), 36))
}

func inline(typ string) bool {
	b := baseType(typ)
	switch {
	case strings.HasPrefix(b, "image/"), strings.HasPrefix(b, "video/"), strings.HasPrefix(b, "audio/"):
		return true
	case b == "application/pdf", b == "text/plain", b == "text/markdown", b == "application/json", b == "text/csv":
		return true
	}
	return false
}
