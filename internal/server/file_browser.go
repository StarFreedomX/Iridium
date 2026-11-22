package server

import (
	"context"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/kumoSleeping/iridium/internal/api"
	"github.com/kumoSleeping/iridium/internal/files"
	"github.com/kumoSleeping/iridium/internal/remote"
)

func (s *Server) fileBrowserRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/internal/web/files", s.approver(s.browseFiles))
	mux.HandleFunc("GET /v1/internal/web/files/content", s.approver(s.browseFile))
}

func (s *Server) browseFiles(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	q := r.URL.Query()
	if machine := q.Get("machine"); machine != "" {
		mc, hi := s.machineAt(w, machine)
		if mc == nil {
			return
		}
		dir := nativePath(hi, q.Get("path"))
		if !remote.IsAbs(hi.Sep, dir) {
			fail(w, http.StatusBadRequest, "not an absolute path")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
		defer cancel()
		entries, err := mc.List(ctx, dir)
		if err != nil {
			s.remoteFileError(w, err)
			return
		}
		out := api.DirListing{Path: pagePath(hi, dir), Entries: make([]api.DirEntry, 0, len(entries))}
		for _, e := range entries {
			out.Entries = append(out.Entries, api.DirEntry(e))
		}
		reply(w, http.StatusOK, out)
		return
	}
	dir := q.Get("path")
	if dir == "" {
		dir = "~"
	}
	p, err := s.hostPath(callerOf(r), dir)
	if err != nil {
		s.error(w, err)
		return
	}
	out, err := s.files.List(p)
	if err != nil {
		s.fileError(w, err)
		return
	}
	reply(w, http.StatusOK, out)
}

func (s *Server) browseFile(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	if machine := q.Get("machine"); machine != "" {
		mc, hi := s.machineAt(w, machine)
		if mc == nil {
			return
		}
		p := nativePath(hi, q.Get("path"))
		if !remote.IsAbs(hi.Sep, p) {
			fail(w, http.StatusBadRequest, "not an absolute path")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
		defer cancel()
		st, err := mc.Stat(ctx, p)
		if err != nil {
			s.remoteFileError(w, err)
			return
		}
		if st.Type != "file" || st.Size < 0 {
			s.fileError(w, files.ErrNotFile)
			return
		}
		src := browserRemoteFile{ctx: r.Context(), machine: mc, path: p}
		serveBrowserFile(w, r, remote.Base(hi.Sep, p), time.UnixMilli(st.Mtime), io.NewSectionReader(src, 0, st.Size))
		return
	}
	p, err := s.hostPath(callerOf(r), q.Get("path"))
	if err == nil {
		p, err = s.files.Guarded(p)
	}
	if err != nil {
		s.fileError(w, err)
		return
	}
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
	serveBrowserFile(w, r, st.Name(), st.ModTime(), f)
}

func serveBrowserFile(w http.ResponseWriter, r *http.Request, name string, mtime time.Time, src io.ReadSeeker) {
	h := w.Header()
	h.Set("Cache-Control", "no-store")
	h.Set("Cross-Origin-Resource-Policy", "same-origin")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Security-Policy", "default-src 'none'; sandbox")
	typ, disp := "application/octet-stream", "attachment"
	if !r.URL.Query().Has("download") {
		switch candidate := mime.TypeByExtension(strings.ToLower(filepath.Ext(name))); candidate {
		case "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp", "application/pdf":
			typ, disp = candidate, "inline"
		}
	}
	h.Set("Content-Type", typ)
	h.Set("Content-Disposition", mime.FormatMediaType(disp, map[string]string{"filename": name}))
	http.ServeContent(w, r, name, mtime, src)
}

type browserRemoteFile struct {
	ctx     context.Context
	machine *remote.Machine
	path    string
}

func (f browserRemoteFile) ReadAt(dst []byte, offset int64) (int, error) {
	ctx, cancel := context.WithTimeout(f.ctx, 20*time.Second)
	defer cancel()
	b, err := f.machine.ReadAt(ctx, f.path, offset, int64(len(dst)))
	if err != nil {
		return 0, err
	}
	if n := copy(dst, b); n < len(dst) {
		return n, io.ErrUnexpectedEOF
	}
	return len(dst), nil
}
