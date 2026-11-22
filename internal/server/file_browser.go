package server

import (
	"context"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/kumoSleeping/iridium/internal/files"
	"github.com/kumoSleeping/iridium/internal/remote"
	"github.com/kumoSleeping/iridium/internal/remote/wire"
)

// browseTimeout caps one remote list, stat or read call for the web file browser.
const browseTimeout = 20 * time.Second

// browseFiles is GET /v1/internal/web/files: one level of a folder on the host or a connected
// computer, for the web file browser. Empty path defaults to home; remote paths return
// '/'-separated as the page writes them.
func (s *Server) browseFiles(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	q := r.URL.Query()
	machine, path := q.Get("machine"), q.Get("path")
	if machine == "" {
		if path == "" {
			path = "~"
		}
		s.listHostDir(w, r, path)
		return
	}

	mc, hi, dir := s.pageMachinePath(w, machine, path)
	if mc == nil {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), browseTimeout)
	defer cancel()
	out, err := listRemoteDir(ctx, mc, dir)
	if err != nil {
		s.remoteFileError(w, err)
		return
	}
	out.Path = pagePath(hi, out.Path)
	reply(w, http.StatusOK, out)
}

// browseFile is GET /v1/internal/web/files/content: one regular file on the host or a connected
// computer, served with Range support for preview or download.
func (s *Server) browseFile(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	if machine := q.Get("machine"); machine != "" {
		mc, hi, p := s.pageMachinePath(w, machine, q.Get("path"))
		if mc == nil {
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), browseTimeout)
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
		files.ServePathContent(w, r, remote.Base(hi.Sep, p), time.UnixMilli(st.Mtime), io.NewSectionReader(src, 0, st.Size))
		return
	}
	p, err := s.hostPath(callerOf(r), q.Get("path"))
	if err != nil {
		s.error(w, err)
		return
	}
	p, err = s.files.Guarded(p)
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
	files.ServePathContent(w, r, st.Name(), st.ModTime(), f)
}

// browserRemoteFile adapts a remote file to io.ReaderAt for http.ServeContent via io.SectionReader,
// splitting reads across wire.MaxRead chunks.
type browserRemoteFile struct {
	ctx     context.Context
	machine *remote.Machine
	path    string
}

func (f browserRemoteFile) ReadAt(dst []byte, offset int64) (int, error) {
	ctx, cancel := context.WithTimeout(f.ctx, browseTimeout)
	defer cancel()
	total := 0
	for total < len(dst) {
		chunk := dst[total : total+min(len(dst)-total, wire.MaxRead)]
		b, err := f.machine.ReadAt(ctx, f.path, offset+int64(total), int64(len(chunk)))
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
