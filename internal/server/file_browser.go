package server

import (
	"context"
	"io"
	"net/http"
	"os"
	"slices"
	"time"

	"github.com/kumoSleeping/iridium/internal/access"
	"github.com/kumoSleeping/iridium/internal/api"
	"github.com/kumoSleeping/iridium/internal/files"
	"github.com/kumoSleeping/iridium/internal/gate"
	"github.com/kumoSleeping/iridium/internal/remote"
	"github.com/kumoSleeping/iridium/internal/remote/wire"
)

// browseTimeout caps one remote list, stat or read call for the web file browser.
const browseTimeout = 20 * time.Second

// browserScope is the login's allowed roots on app, nil when the whole computer is in scope, or
// access.Denied when the computer is out of scope.
func (s *Server) browserScope(c caller, app string) ([]string, error) {
	p := s.permsFor(c)
	if slices.Contains(p.Scope, api.PermsAll) {
		return nil, nil
	}
	var roots []string
	for _, place := range p.Scope {
		at, root := s.parsePlace(place)
		if at != app {
			continue
		}
		if root == "" {
			return nil, nil
		}
		roots = append(roots, root)
	}
	if len(roots) == 0 {
		return nil, &access.Denied{Reason: "this computer is out of this login's scope"}
	}
	return roots, nil
}

// browserLocation is a resolved web file-browser target: the computer (nil for the host), its
// native path, and the login's scope roots there (nil when unrestricted).
type browserLocation struct {
	machine *remote.Machine
	hello   *wire.Hello
	path    string
	scope   []string
}

// browserAt resolves the request's computer, path (defaulting to the first allowed root, the
// computer's first shared root, or home) and login scope; it has answered when nil.
func (s *Server) browserAt(w http.ResponseWriter, r *http.Request) *browserLocation {
	q := r.URL.Query()
	path := q.Get("path")
	app, c := gate.HostID, callerOf(r)
	at := &browserLocation{}
	if mid := q.Get("machine"); mid != "" {
		at.machine, at.hello = s.machineAt(w, mid)
		if at.machine == nil {
			return nil
		}
		app = at.machine.ID()
	}
	scope, err := s.browserScope(c, app)
	if err != nil {
		s.error(w, err)
		return nil
	}
	if path == "" {
		path = "~"
		if len(scope) > 0 {
			path = scope[0]
		} else if at.hello != nil && len(at.hello.Roots) > 0 {
			path = at.hello.Roots[0]
		}
	}
	at.scope = scope
	if at.machine == nil {
		at.path, err = s.hostPath(c, path)
		if err != nil {
			s.error(w, err)
			return nil
		}
		for i, root := range scope {
			scope[i], _ = s.hostPath(c, root)
		}
		return at
	}
	at.path = nativePath(at.hello, path)
	if !remote.IsAbs(at.hello.Sep, at.path) {
		fail(w, http.StatusBadRequest, "not an absolute path")
		return nil
	}
	for i, root := range scope {
		scope[i] = nativePath(at.hello, root)
	}
	return at
}

// browseFiles is GET /v1/internal/web/files: one level of a folder on the host or a connected
// computer. An empty path opens the first allowed root or home.
func (s *Server) browseFiles(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	at := s.browserAt(w, r)
	if at == nil {
		return
	}
	if at.machine == nil {
		out, err := s.files.List(at.path, at.scope...)
		if err != nil {
			s.fileError(w, err)
			return
		}
		reply(w, http.StatusOK, out)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), browseTimeout)
	defer cancel()
	out, err := listRemoteDir(ctx, at.machine, at.path, at.scope...)
	if err != nil {
		s.browserRemoteError(w, err)
		return
	}
	out.Path = pagePath(at.hello, out.Path)
	reply(w, http.StatusOK, out)
}

// browseFile is GET /v1/internal/web/files/content: one regular file on the host or a connected
// computer, served with Range support for preview or download.
func (s *Server) browseFile(w http.ResponseWriter, r *http.Request) {
	at := s.browserAt(w, r)
	if at == nil {
		return
	}
	if at.machine != nil {
		ctx, cancel := context.WithTimeout(r.Context(), browseTimeout)
		defer cancel()
		st, err := at.machine.Stat(ctx, at.path, at.scope...)
		if err != nil {
			s.browserRemoteError(w, err)
			return
		}
		if st.Type != "file" || st.Size < 0 {
			s.fileError(w, files.ErrNotFile)
			return
		}
		src := browserRemoteFile{ctx: r.Context(), machine: at.machine, path: at.path, scope: at.scope}
		s.serveBrowserFile(w, r, at, remote.Base(at.hello.Sep, at.path), time.UnixMilli(st.Mtime), io.NewSectionReader(src, 0, st.Size))
		return
	}
	p, err := s.files.Guarded(at.path, at.scope...)
	if err != nil {
		s.fileError(w, err)
		return
	}
	// Stat before opening so a named pipe cannot block the request, then re-stat the open file.
	st, err := os.Stat(p)
	if err != nil {
		s.fileError(w, err)
		return
	}
	if !st.Mode().IsRegular() {
		s.fileError(w, files.ErrNotFile)
		return
	}
	f, err := os.Open(p)
	if err != nil {
		s.fileError(w, err)
		return
	}
	defer f.Close()
	st, err = f.Stat()
	if err != nil {
		s.fileError(w, err)
		return
	}
	if !st.Mode().IsRegular() {
		s.fileError(w, files.ErrNotFile)
		return
	}
	s.serveBrowserFile(w, r, at, st.Name(), st.ModTime(), f)
}

// serveBrowserFile serves one host or remote file through ServePathContent (wrapping remote
// responses in browserRemoteWriter) and logs successful GET reads with who read what and how many
// bytes were written.
func (s *Server) serveBrowserFile(w http.ResponseWriter, r *http.Request, at *browserLocation, name string, mtime time.Time, src io.ReadSeeker) {
	machine := gate.HostID
	if at.machine != nil {
		machine = at.machine.ID()
		w = browserRemoteWriter{w}
	}
	out := browserFileResponse{ResponseWriter: w}
	files.ServePathContent(&out, r, name, mtime, src)
	if r.Method == http.MethodGet && (out.status == http.StatusOK || out.status == http.StatusPartialContent) {
		c := callerOf(r)
		action := "preview"
		if r.URL.Query().Has("download") {
			action = "download"
		}
		s.logf("file browser: read login=%q name=%q machine=%q path=%q action=%s status=%d bytes=%d", c.ID(), c.Name, machine, at.path, action, out.status, out.bytes)
	}
}

// browserFileResponse captures status and bytes written without losing the underlying writer's
// ReadFrom (browserRemoteWriter's wire.MaxRead buffer for remote files, sendfile for host files).
type browserFileResponse struct {
	http.ResponseWriter
	status int
	bytes  int64
}

func (w *browserFileResponse) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *browserFileResponse) Write(p []byte) (int, error) {
	n, err := w.ResponseWriter.Write(p)
	w.bytes += int64(n)
	return n, err
}

func (w *browserFileResponse) ReadFrom(src io.Reader) (int64, error) {
	n, err := io.Copy(w.ResponseWriter, src)
	w.bytes += n
	return n, err
}

// browserRemoteError maps executor errors for the web file browser: an older executor without
// ".scoped" reads answers 409 so the caller knows to update it.
func (s *Server) browserRemoteError(w http.ResponseWriter, err error) {
	if wire.IsCode(err, wire.CodeUnsupported) {
		refuse(w, http.StatusConflict, "scoped_files_unsupported", "update the connected computer to browse within a login's scope")
		return
	}
	s.remoteFileError(w, err)
}

// browserRemoteWriter lets http.ServeContent copy a remote file in wire.MaxRead pieces instead of
// its default 32 KB buffer, avoiding thousands of round trips on large downloads. ServeContent
// passes a LimitedReader for the response length, so short files and ranges allocate only what
// they need.
type browserRemoteWriter struct{ http.ResponseWriter }

func (w browserRemoteWriter) ReadFrom(src io.Reader) (int64, error) {
	size := int64(wire.MaxRead)
	if limit, ok := src.(*io.LimitedReader); ok {
		if limit.N <= 0 {
			return 0, nil
		}
		size = min(size, limit.N)
	}
	// Hide ResponseWriter's ReadFrom so CopyBuffer uses our buffer rather than its smaller one.
	return io.CopyBuffer(struct{ io.Writer }{w.ResponseWriter}, src, make([]byte, size))
}

// browserRemoteFile adapts a remote file to io.ReaderAt for http.ServeContent via io.SectionReader,
// splitting reads across wire.MaxRead chunks and forwarding scope on each read.
type browserRemoteFile struct {
	ctx     context.Context
	machine *remote.Machine
	path    string
	scope   []string
}

func (f browserRemoteFile) ReadAt(dst []byte, offset int64) (int, error) {
	ctx, cancel := context.WithTimeout(f.ctx, browseTimeout)
	defer cancel()
	total := 0
	for total < len(dst) {
		chunk := dst[total : total+min(len(dst)-total, wire.MaxRead)]
		b, err := f.machine.ReadAt(ctx, f.path, offset+int64(total), int64(len(chunk)), f.scope...)
		if err != nil {
			return total, err
		}
		n := copy(chunk, b)
		total += n
		if n < len(chunk) {
			return total, io.ErrUnexpectedEOF
		}
	}
	return total, nil
}
