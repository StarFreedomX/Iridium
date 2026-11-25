package server

import (
	"context"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/kumoSleeping/iridium/internal/api"
	"github.com/kumoSleeping/iridium/internal/remote"
	"github.com/kumoSleeping/iridium/internal/remote/wire"
)

// Folders at another machine's executor (docs/exec.md), for the folder picker: the page sees its
// paths '/'-separated (C:/Users/kumo), the executor gets its own separator. "" and "~" are its home.

// machineAt is executor mid, connected; it has answered when nil.
func (s *Server) machineAt(w http.ResponseWriter, mid string) (*remote.Machine, *wire.Hello) {
	if s.Remote == nil {
		refuse(w, http.StatusUnprocessableEntity, "not_here", "no executors here")
		return nil, nil
	}
	mc := s.Remote.Find(mid)
	if mc == nil {
		refuse(w, http.StatusUnprocessableEntity, "no_such_app", "no such computer")
		return nil, nil
	}
	hi, ok := mc.Hello()
	if !ok {
		fail(w, http.StatusConflict, "machine not connected")
		return nil, nil
	}
	return mc, hi
}

// nativePath is page path p as the machine writes it: its separator, ~ for its home, a bare drive
// its root.
func nativePath(hi *wire.Hello, p string) string {
	switch {
	case p == "" || p == "~":
		return hi.Home
	case strings.HasPrefix(p, "~/"):
		p = strings.TrimSuffix(hi.Home, hi.Sep) + "/" + p[2:]
	}
	if hi.Sep == `\` {
		p = strings.ReplaceAll(p, "/", `\`)
		if len(p) == 2 && p[1] == ':' {
			p += `\`
		}
	}
	return p
}

func pagePath(hi *wire.Hello, p string) string {
	if hi.Sep == `\` {
		return strings.ReplaceAll(p, `\`, "/")
	}
	return p
}

// parentPath is p's parent there, "" at a root.
func parentPath(hi *wire.Hello, p string) string {
	t := strings.TrimSuffix(p, hi.Sep)
	i := strings.LastIndex(t, hi.Sep)
	switch {
	case i < 0 || t == "" || hi.Sep == `\` && len(t) == 2 && t[1] == ':':
		return ""
	case i == 0:
		return hi.Sep
	case hi.Sep == `\` && i == 2 && t[1] == ':':
		return t[:3]
	}
	return t[:i]
}

// pageMachinePath is executor mid, connected, and page path as that machine writes it (~ for its
// home, absolute); it has answered when nil.
func (s *Server) pageMachinePath(w http.ResponseWriter, mid, path string) (*remote.Machine, *wire.Hello, string) {
	mc, hi := s.machineAt(w, mid)
	if mc == nil {
		return nil, nil, ""
	}
	dir := nativePath(hi, path)
	if !remote.IsAbs(hi.Sep, dir) {
		fail(w, http.StatusBadRequest, "not an absolute path")
		return nil, nil, ""
	}
	return mc, hi, dir
}

func (s *Server) remoteFolders(w http.ResponseWriter, r *http.Request, mid, path string) {
	mc, hi, dir := s.pageMachinePath(w, mid, path)
	if mc == nil {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	ents, err := mc.List(ctx, dir)
	if err != nil {
		s.remoteError(w, err)
		return
	}
	out := api.Folders{Path: pagePath(hi, dir), Folders: []string{}}
	for _, e := range ents {
		if e.Type == "dir" && !strings.HasPrefix(e.Name, ".") {
			out.Folders = append(out.Folders, e.Name)
		}
	}
	slices.SortFunc(out.Folders, func(a, b string) int {
		if c := strings.Compare(strings.ToLower(a), strings.ToLower(b)); c != 0 {
			return c
		}
		return strings.Compare(a, b)
	})
	if p := parentPath(hi, dir); p != "" {
		out.Parent = pagePath(hi, p)
	}
	reply(w, http.StatusOK, out)
}

func (s *Server) remoteMkdir(w http.ResponseWriter, r *http.Request, req api.NewFolder) {
	mc, hi := s.machineAt(w, req.Machine)
	if mc == nil {
		return
	}
	if req.Name == "" || req.Name == "." || req.Name == ".." || strings.ContainsAny(req.Name, `/\:*?"<>|`+"\x00") {
		fail(w, http.StatusBadRequest, "not a folder name")
		return
	}
	dir := nativePath(hi, req.Path)
	if !remote.IsAbs(hi.Sep, dir) {
		fail(w, http.StatusBadRequest, "not an absolute path")
		return
	}
	scope, err := s.browserScope(callerOf(r), mc.ID())
	if err != nil {
		s.error(w, err)
		return
	}
	p := remote.Join(hi.Sep, dir, req.Name)
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	if len(scope) > 0 {
		// Let the executor authorize the resolved parent so a grant and a request
		// may use different names for the same directory.
		for i, root := range scope {
			scope[i] = nativePath(hi, root)
		}
		// Ordinary stat honors scope without treating dot directories as browser-hidden.
		var st wire.Stat
		if err := mc.Call(ctx, "fs.stat", wire.StatParams{Path: dir, Scope: scope}, &st); err != nil {
			s.remoteError(w, err)
			return
		}
		if st.Type != "dir" {
			fail(w, http.StatusBadRequest, "not a directory")
			return
		}
		// Very old executors ignore Scope on stat. Prove that scope is enforced before
		// trusting the successful stat above, so a symlink cannot escape a restricted login.
		err := mc.Call(ctx, "fs.stat", wire.StatParams{Path: dir, Scope: []string{""}}, &st)
		if err == nil {
			refuse(w, http.StatusConflict, "scoped_files_unsupported", "update the connected computer to create folders with a restricted login")
			return
		}
		if !wire.IsCode(err, wire.CodeDenied) {
			s.remoteError(w, err)
			return
		}
	}
	// The target is checked within scope too: only "not found" goes on to mkdir, so a symlink
	// named like the new folder that points out of scope is refused (403), not reported as there.
	var target wire.Stat
	err = mc.Call(ctx, "fs.stat", wire.StatParams{Path: p, Scope: scope}, &target)
	if err == nil {
		fail(w, http.StatusConflict, "already there")
		return
	}
	if !wire.IsCode(err, wire.CodeNotFound) {
		s.remoteError(w, err)
		return
	}
	if err := mc.Call(ctx, "fs.mkdir", wire.PathParams{Path: p, Scope: scope}, nil); err != nil {
		s.remoteError(w, err)
		return
	}
	reply(w, http.StatusOK, api.FolderReply{Path: pagePath(hi, p)})
}

// dshWorkspaces is GET /v1/internal/machines/{id}/dsh/workspaces: the folders a new dsh session there may
// open in, dsh's own workspaces first (docs/exec.md "远端 DSH").
func (s *Server) dshWorkspaces(w http.ResponseWriter, r *http.Request) {
	mc, hi := s.machineAt(w, r.PathValue("id"))
	if mc == nil {
		return
	}
	if s.Discover == nil {
		reply(w, http.StatusOK, []api.DshWorkspace{})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
	defer cancel()
	ws, err := s.Discover.DshWorkspaces(ctx, mc.ID())
	if err != nil {
		s.remoteError(w, err)
		return
	}
	for i := range ws {
		ws[i].Path = pagePath(hi, ws[i].Path)
	}
	reply(w, http.StatusOK, ws)
}

// dshSync is POST /v1/internal/machines/{id}/dsh/sync: the dsh there read again now, its workspaces and
// sessions, models and presets (a remote group's menu; docs/exec.md "远端 DSH").
func (s *Server) dshSync(w http.ResponseWriter, r *http.Request) {
	mc, _ := s.machineAt(w, r.PathValue("id"))
	if mc == nil {
		return
	}
	if _, ok := mc.Agent(string(api.AgentDsh)); !ok {
		refuse(w, http.StatusUnprocessableEntity, "no_such_agent", "no dsh at "+mc.ID())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
	defer cancel()
	if err := s.m.Sync(ctx, api.AgentDsh, mc.ID()); err != nil {
		s.remoteError(w, err)
		return
	}
	reply(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) remoteError(w http.ResponseWriter, err error) {
	switch {
	case wire.IsCode(err, wire.CodeNotFound):
		refuse(w, http.StatusUnprocessableEntity, "no_such_path", err.Error())
	case wire.IsCode(err, wire.CodeDenied):
		refuse(w, http.StatusForbidden, "denied", err.Error())
	case wire.IsCode(err, wire.CodeBadRequest):
		fail(w, http.StatusBadRequest, err.Error())
	default:
		fail(w, http.StatusBadGateway, err.Error())
	}
}
