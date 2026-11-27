package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"

	"github.com/kumoSleeping/iridium/internal/api"
	"github.com/kumoSleeping/iridium/internal/satori"
)

// A channel's first screen in one answer (GET /v1/internal/sessions/{id}/first): its state,
// its members, how far each has read, its log's newest page, its agents' states and the work
// under their words; for a transcript-only view (?record=1, a subagent, or elsewhere), its
// state and its record's newest page alone.
// Each part is the answer of the API it stands for, asked here as the caller, so what a caller
// may read and how it is masked are those APIs' own; a part that failed is left out, and the
// page asks for it as before.

// firstKey is the handler the parts are asked of (withSatori), in the request's context.
type firstKey struct{}

// firstWorkMax is how many messages' work a first screen brings at most, the newest.
const firstWorkMax = 80

// firstBack is how many pages back the log is read at most, as the page does (alignBack).
const firstBack = 20

type firstPage struct {
	Data  []json.RawMessage `json:"data"`
	XData struct {
		Start  int64       `json:"start"`
		End    int64       `json:"end"`
		More   bool        `json:"more"`
		Blocks []api.Block `json:"blocks,omitempty"`
	} `json:"_data"`
}

// firstWork is the minimal work summary under a message of an agent: where it is from in that
// agent's record, and its blocks stripped to the fields needed to draw a collapsed work line
// (icons, counts, failures, edit diff stats, and single-step titles) without heavy inputs or tool
// outputs. Full blocks are fetched on demand via internal/block.list when the user inspects it.
type firstWork struct {
	Session string      `json:"session"`
	Block   string      `json:"block,omitempty"`
	From    *int64      `json:"from,omitempty"`
	To      int64       `json:"to,omitempty"`
	Brief   bool        `json:"brief,omitempty"`
	Blocks  []api.Block `json:"blocks"`
}

type firstScreen struct {
	Session  json.RawMessage            `json:"session"`
	Page     json.RawMessage            `json:"page,omitempty"`
	Members  json.RawMessage            `json:"members,omitempty"`
	Reads    json.RawMessage            `json:"reads,omitempty"`
	Log      *firstPage                 `json:"log,omitempty"`
	Sessions map[string]json.RawMessage `json:"sessions,omitempty"`
	Work     []firstWork                `json:"work,omitempty"`
}

// memWriter keeps an answer in memory.
type memWriter struct {
	h    http.Header
	code int
	buf  bytes.Buffer
}

func (m *memWriter) Header() http.Header { return m.h }
func (m *memWriter) WriteHeader(code int) {
	if m.code == 0 {
		m.code = code
	}
}
func (m *memWriter) Write(p []byte) (int, error) {
	m.WriteHeader(http.StatusOK)
	return m.buf.Write(p)
}

// line is the line of a block's at ("<line>.<n>").
func line(at string) int64 {
	s, _, _ := strings.Cut(at, ".")
	n, _ := strconv.ParseInt(s, 10, 64)
	return n
}

// workAt picks the blocks under a message from the page of its agent's record around it, as the
// page does (web chat/channel/lib.ts workOf): said with ir, those of lines from..to; said
// straight out, those after the last thing the agent said or was given before the block.
func workAt(blocks []api.Block, block string, from *int64, to int64) []int {
	var out []int
	if from != nil && *from >= 0 && to > 0 {
		for i, b := range blocks {
			if l := line(b.At); l >= *from && l < to && b.Kind != "user" && b.Kind != "system" {
				out = append(out, i)
			}
		}
		return out
	}
	if block == "" {
		return nil
	}
	end := line(block)
	for i := len(blocks) - 1; i >= 0; i-- {
		b := blocks[i]
		if line(b.At) >= end {
			continue
		}
		if b.Kind == "user" || b.Kind == "system" || (b.Kind == "assistant" && strings.TrimSpace(b.Text) != "") {
			break
		}
		out = append([]int{i}, out...)
	}
	return out
}

func (s *Server) first(w http.ResponseWriter, r *http.Request) {
	h, _ := r.Context().Value(firstKey{}).(http.Handler)
	if h == nil {
		refuse(w, http.StatusNotFound, "not_found", "no first screen here")
		return
	}
	id := r.PathValue("id")
	// As the page speaks in Satori: its app and login (what /v1/internal/me says).
	hdr := r.Header.Clone()
	hdr.Del("Accept-Encoding")
	hdr.Del("Content-Length")
	hdr.Set("Content-Type", "application/json")
	if c, ok := (satoriBackend{s}).Who(r); ok && c.Login != "" {
		hdr.Set(satori.HeaderPlatform, c.App)
		hdr.Set(satori.HeaderUser, c.Login)
	}
	ask := func(method, path string, body any) (json.RawMessage, int) {
		var raw []byte
		if body != nil {
			raw, _ = json.Marshal(body)
		}
		req, err := http.NewRequestWithContext(r.Context(), method, path, bytes.NewReader(raw))
		if err != nil {
			return nil, http.StatusBadRequest
		}
		req.Header = hdr.Clone()
		req.RemoteAddr, req.RequestURI, req.Host = r.RemoteAddr, path, r.Host
		req.TLS = r.TLS
		m := &memWriter{h: http.Header{}}
		h.ServeHTTP(m, req)
		if m.code == 0 {
			m.code = http.StatusOK
		}
		return bytes.TrimSpace(m.buf.Bytes()), m.code
	}
	ok := func(raw json.RawMessage, code int) json.RawMessage {
		if code != http.StatusOK || !json.Valid(raw) {
			return nil
		}
		return raw
	}
	sessionPath := func(x string) string { return "/v1/internal/sessions/" + url.PathEscape(x) }
	channelPath := "/v1/internal/channels/" + url.PathEscape(id)

	// Its state, and either its record (?record=1) or its channel's members, reads and newest log.
	q := r.URL.Query()
	recordOnly := q.Get("record") == "1"
	var out firstScreen
	var stateCode int
	var wg sync.WaitGroup
	wg.Go(func() { out.Session, stateCode = ask("GET", sessionPath(id), nil) })
	if recordOnly {
		wg.Go(func() { out.Page = ok(ask("POST", "/v1/internal/block.list", map[string]any{"channel_id": id})) })
	} else {
		wg.Go(func() { out.Members = ok(ask("GET", channelPath+"/members", nil)) })
		wg.Go(func() { out.Reads = ok(ask("GET", channelPath+"/reads", nil)) })
		wg.Go(func() { out.Log = firstLog(ask, id, 0, false) })
	}
	wg.Wait()
	if stateCode != http.StatusOK {
		// No such session, or not the caller's to see: as its state's API says it.
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(stateCode)
		_, _ = w.Write(out.Session)
		return
	}
	if recordOnly {
		reply(w, http.StatusOK, out)
		return
	}
	// Subagents and external (elsewhere) sessions are read-only transcripts, not channels.
	var meta struct {
		Subagent bool       `json:"subagent"`
		Status   api.Status `json:"status"`
	}
	if json.Unmarshal(out.Session, &meta) == nil && (meta.Subagent || meta.Status == api.StatusElsewhere) {
		out.Page = ok(ask("POST", "/v1/internal/block.list", map[string]any{"channel_id": id}))
		out.Reads, out.Log = nil, nil
		reply(w, http.StatusOK, out)
		return
	}

	// Its agents' states (other than id, which is already in Session) and the work under all
	// agents' words in the log.
	var ms api.ChannelMembers
	_ = json.Unmarshal(out.Members, &ms)
	var others []string
	for _, m := range ms.Members {
		if m.Session != "" && m.Session != id {
			others = append(others, m.Session)
		}
	}
	if len(others) > 0 {
		var mu sync.Mutex
		out.Sessions = map[string]json.RawMessage{}
		for _, x := range others {
			wg.Go(func() {
				if st := ok(ask("GET", sessionPath(x), nil)); st != nil {
					mu.Lock()
					out.Sessions[x] = st
					mu.Unlock()
				}
			})
		}
	}
	if out.Log != nil {
		wg.Go(func() { out.Work = firstWorks(ask, out.Log, "", 0) })
	}
	wg.Wait()
	reply(w, http.StatusOK, out)
}

type logHead struct {
	ID      string `json:"id"`
	At      int64  `json:"created_at"`
	Content string `json:"content"`
	User    *struct {
		ID string `json:"id"`
	} `json:"user"`
	Data *struct {
		Session string `json:"session"`
		Block   string `json:"block"`
		From    *int64 `json:"from"`
		To      int64  `json:"to"`
	} `json:"_data"`
}

// firstLog is the channel's log as the page holds it at first: its newest page, and those
// before it until they reach back to since (known: there is a since to reach back to).
func firstLog(ask func(method, path string, body any) (json.RawMessage, int), id string, since int64, known bool) *firstPage {
	var log firstPage
	raw, code := ask("POST", "/v1/message.list", map[string]any{"channel_id": id})
	if code != http.StatusOK || json.Unmarshal(raw, &log) != nil {
		return nil
	}
	if log.Data == nil {
		log.Data = []json.RawMessage{}
	}
	for i := 0; known && i < firstBack && log.XData.More && len(log.Data) > 0; i++ {
		var head logHead
		if json.Unmarshal(log.Data[0], &head) != nil || head.At <= since {
			break
		}
		var p firstPage
		raw, code := ask("POST", "/v1/message.list", map[string]any{"channel_id": id, "next": head.ID, "direction": "before"})
		if code != http.StatusOK || json.Unmarshal(raw, &p) != nil {
			break
		}
		if len(p.Data) == 0 {
			log.XData.More = false
			break
		}
		log.Data = append(p.Data, log.Data...)
		log.XData.Start, log.XData.More = p.XData.Start, p.XData.More
	}
	return &log
}

// parseWorkTag reads the last <iridium:work .../> tag in content, matching web chat/channel/lib.ts workIn.
func parseWorkTag(content string) (from, to int64, steps int, ok bool) {
	at := strings.LastIndex(content, "<iridium:work")
	if at < 0 {
		return 0, 0, 0, false
	}
	rest := content[at:]
	end := strings.IndexByte(rest, '>')
	if end < 0 {
		return 0, 0, 0, false
	}
	head := rest[:end]
	attr := func(key string) (int64, bool) {
		needle := " " + key + `="`
		i := strings.Index(head, needle)
		if i < 0 {
			return 0, false
		}
		v := head[i+len(needle):]
		j := strings.IndexByte(v, '"')
		if j < 0 {
			return 0, false
		}
		n, err := strconv.ParseInt(v[:j], 10, 64)
		return n, err == nil
	}
	st, _ := attr("steps")
	fr, hasFrom := attr("from")
	t, _ := attr("to")
	if !hasFrom || st <= 0 {
		return 0, 0, 0, false
	}
	return fr, max(t, 0), int(st), true
}

// clipRunes truncates s to at most n runes.
func clipRunes(s string, n int) string {
	if len(s) <= n {
		return s
	}
	i := 0
	for pos := range s {
		if i == n {
			return s[:pos]
		}
		i++
	}
	return s
}

func splitLines(s string) []string {
	if s == "" {
		return nil
	}
	return strings.Split(strings.TrimSuffix(s, "\n"), "\n")
}

// lineDiff counts lines added and removed between a and b (matching web chat/fold.ts lineDiff).
func lineDiff(a, b string) (added, taken int) {
	x, y := splitLines(a), splitLines(b)
	s := 0
	for s < len(x) && s < len(y) && x[s] == y[s] {
		s++
	}
	e := 0
	for e < len(x)-s && e < len(y)-s && x[len(x)-1-e] == y[len(y)-1-e] {
		e++
	}
	p, q := x[s:len(x)-e], y[s:len(y)-e]
	common := 0
	if len(p) > 0 && len(q) > 0 && len(p)*len(q) <= 250_000 {
		prev := make([]int, len(q)+1)
		row := make([]int, len(q)+1)
		for _, u := range p {
			row[0] = 0
			for j, v := range q {
				if u == v {
					row[j+1] = prev[j] + 1
				} else if prev[j+1] >= row[j] {
					row[j+1] = prev[j+1]
				} else {
					row[j+1] = row[j]
				}
			}
			prev, row = row, prev
		}
		common = prev[len(q)]
	}
	return len(q) - common, len(p) - common
}

// patchDiff counts + and - lines in a unified or apply_patch diff (matching fold.ts patchDiff).
func patchDiff(text string) (added, taken int) {
	if text == "" {
		return 0, 0
	}
	ls := strings.Split(text, "\n")
	for i := 0; i < len(ls); i++ {
		l := ls[i]
		if strings.HasPrefix(l, "--- ") && i+1 < len(ls) && strings.HasPrefix(ls[i+1], "+++ ") {
			i++
		} else if strings.HasPrefix(l, "@@") || strings.HasPrefix(l, "*** ") || strings.HasPrefix(l, "diff --git ") || strings.HasPrefix(l, "index ") {
			continue
		} else if strings.HasPrefix(l, "+") {
			added++
		} else if strings.HasPrefix(l, "-") {
			taken++
		}
	}
	return added, taken
}

func editDiff(name string, in map[string]any, raw string) (added, taken int) {
	low := strings.ToLower(name)
	str := func(m map[string]any, keys ...string) string {
		for _, k := range keys {
			if v, ok := m[k].(string); ok && v != "" {
				return v
			}
		}
		return ""
	}
	switch low {
	case "write":
		return len(splitLines(str(in, "content"))), 0
	case "notebookedit":
		if str(in, "edit_mode") == "delete" {
			return 0, 0
		}
		return len(splitLines(str(in, "new_source"))), 0
	case "apply_patch":
		if cs, ok := in["changes"].([]any); ok {
			for _, c := range cs {
				m, _ := c.(map[string]any)
				if m == nil {
					continue
				}
				kind := str(m, "type")
				if km, ok := m["kind"].(map[string]any); ok && kind == "" {
					kind = str(km, "type")
				}
				txt := str(m, "diff", "unified_diff", "content")
				switch kind {
				case "add":
					added += len(splitLines(txt))
				case "delete":
					taken += len(splitLines(txt))
				default:
					a, t := patchDiff(txt)
					added, taken = added+a, taken+t
				}
			}
			return added, taken
		}
		p := str(in, "input", "patch")
		if p == "" && in == nil {
			p = raw
		}
		return patchDiff(p)
	case "edit", "multiedit":
		if es, ok := in["edits"].([]any); ok {
			for _, e := range es {
				m, _ := e.(map[string]any)
				if m == nil {
					continue
				}
				a, t := lineDiff(str(m, "old_string", "oldText"), str(m, "new_string", "newText"))
				added, taken = added+a, taken+t
			}
			return added, taken
		}
		return lineDiff(str(in, "old_string", "oldText"), str(in, "new_string", "newText"))
	default:
		return 0, 0
	}
}

// briefInput reduces a tool call's JSON input to only the small fields needed to render a
// collapsed work row (icon classification, single-step argument, and edit diff counts).
func briefInput(name, raw string) string {
	if raw == "" {
		return ""
	}
	var in map[string]any
	if err := json.Unmarshal([]byte(raw), &in); err != nil || in == nil {
		return clipRunes(raw, 256)
	}
	out := map[string]any{}
	copyStr := func(limit int, keys ...string) {
		for _, k := range keys {
			if s, ok := in[k].(string); ok && s != "" {
				out[k] = clipRunes(s, limit)
			}
		}
	}
	copyStr(240, "file_path", "notebook_path", "path")
	copyStr(400, "command", "cmd")
	if _, has := out["command"]; !has {
		if l, ok := in["command"].([]any); ok {
			var parts []string
			for _, x := range l {
				if s, ok := x.(string); ok {
					parts = append(parts, s)
				}
			}
			if len(parts) > 0 {
				out["command"] = clipRunes(strings.Join(parts, " "), 400)
			}
		}
	}
	copyStr(200, "pattern", "query", "url")
	copyStr(160, "description", "prompt", "subject", "plan")
	if todos, ok := in["todos"].([]any); ok {
		out["todos"] = make([]int, len(todos))
	}
	if cs, ok := in["changes"].([]any); ok {
		var paths []map[string]string
		for _, c := range cs {
			if m, ok := c.(map[string]any); ok {
				if p, ok := m["path"].(string); ok && p != "" {
					paths = append(paths, map[string]string{"path": clipRunes(p, 240)})
				}
			}
		}
		if len(paths) > 0 {
			out["changes"] = paths
		}
	}
	if add, del := editDiff(name, in, raw); add > 0 || del > 0 {
		out["_diff"] = map[string]int{"added": add, "taken": del}
	}
	if len(out) == 0 {
		for k, v := range in {
			if s, ok := v.(string); ok && s != "" {
				out[k] = clipRunes(s, 160)
				break
			}
		}
	}
	if len(out) == 0 {
		return "{}"
	}
	b, err := json.Marshal(out)
	if err != nil {
		return "{}"
	}
	return string(b)
}

// briefBlock strips heavy text/output/image fields from a thinking or tool block while preserving
// everything required for collapsed work-line rendering.
func briefBlock(b api.Block) (api.Block, bool) {
	switch b.Kind {
	case api.BlockKindThinking:
		if strings.TrimSpace(b.Text) == "" {
			return api.Block{}, false
		}
		return api.Block{At: b.At, Kind: b.Kind, Time: b.Time, Text: "…"}, true
	case api.BlockKindTool:
		out := api.Block{
			At:    b.At,
			Kind:  b.Kind,
			ID:    b.ID,
			Name:  b.Name,
			Time:  b.Time,
			Input: briefInput(b.Name, b.Input),
		}
		if b.Result != nil {
			out.Result = &api.Result{
				At:    b.Result.At,
				Time:  b.Result.Time,
				Error: b.Result.Error,
			}
		}
		return out, true
	default:
		return api.Block{}, false
	}
}

// briefSpan selects the blocks in one work span, pairs separate result blocks onto their tool
// calls, caps by steps when to is unset, and returns their minimal brief forms.
func briefSpan(blocks []api.Block, block string, from *int64, to int64, steps int) []api.Block {
	var picked []api.Block
	if from != nil && *from >= 0 {
		// Pair separate result blocks in the same window so error/timing stay attached.
		res := map[string]api.Block{}
		for _, b := range blocks {
			if b.Kind == api.BlockKindResult && b.ID != "" && line(b.At) >= *from && (to == 0 || line(b.At) < to) {
				res[b.ID] = b
			}
		}
		calls := 0
		for _, b := range blocks {
			l := line(b.At)
			if l < *from || (to > 0 && l >= to) {
				continue
			}
			if b.Kind != api.BlockKindTool && b.Kind != api.BlockKindThinking {
				continue
			}
			if b.Kind == api.BlockKindTool {
				if to == 0 && steps > 0 && calls >= steps {
					break
				}
				calls++
				if b.Result == nil && b.ID != "" {
					if r, ok := res[b.ID]; ok {
						b.Result = &api.Result{At: r.At, Time: r.Time, Error: r.Error}
					}
				}
			}
			if bb, ok := briefBlock(b); ok {
				picked = append(picked, bb)
			}
		}
		return picked
	}
	for _, j := range workAt(blocks, block, from, to) {
		if bb, ok := briefBlock(blocks[j]); ok {
			picked = append(picked, bb)
		}
	}
	return picked
}

type workReq struct {
	session string
	block   string
	from    *int64
	to      int64
	steps   int
}

// firstWorks returns minimal brief tool summaries for the newest messages in log (both
// <iridium:work> spans and legacy _data.from/block spans), batching block.list per session.
func firstWorks(ask func(method, path string, body any) (json.RawMessage, int), log *firstPage, own string, since int64) []firstWork {
	var want []workReq
	seen := map[string]bool{}
	for i := len(log.Data) - 1; i >= 0 && len(want) < firstWorkMax; i-- {
		var m logHead
		if json.Unmarshal(log.Data[i], &m) != nil || m.User == nil || !strings.HasPrefix(m.User.ID, "agent:") {
			continue
		}
		if m.At < since {
			continue
		}
		sess := strings.TrimPrefix(m.User.ID, "agent:")
		if m.Data != nil && m.Data.Session != "" {
			sess = m.Data.Session
		}
		if sess == "" || sess == own {
			continue
		}
		var req workReq
		if wf, wt, ws, ok := parseWorkTag(m.Content); ok {
			from := wf
			req = workReq{session: sess, from: &from, to: wt, steps: ws}
		} else if m.Data != nil && (m.Data.From != nil || m.Data.Block != "") {
			req = workReq{session: sess, block: m.Data.Block, from: m.Data.From, to: max(m.Data.To, 0)}
		} else {
			continue
		}
		fromKey := "-"
		if req.from != nil {
			fromKey = strconv.FormatInt(*req.from, 10)
		}
		key := req.session + "\x00" + req.block + "\x00" + fromKey + "\x00" + strconv.FormatInt(req.to, 10)
		if seen[key] {
			continue
		}
		seen[key] = true
		want = append(want, req)
	}
	if len(want) == 0 {
		return nil
	}
	// Group requests by session so multiple spans in the same agent transcript share fetched pages.
	bySess := map[string][]int{}
	for i, w := range want {
		bySess[w.session] = append(bySess[w.session], i)
	}
	results := make([]*firstWork, len(want))
	var wg sync.WaitGroup
	gate := make(chan struct{}, 8)
	for sess, idxs := range bySess {
		wg.Go(func() {
			gate <- struct{}{}
			defer func() { <-gate }()
			// Cached block pages for this session: sorted by line, deduped by At.
			type pageCache struct {
				start, end int64
				blocks     []api.Block
			}
			var pages []pageCache
			fetchAfter := func(at int64) (pageCache, bool) {
				for _, p := range pages {
					if at >= p.start && at < p.end {
						return p, true
					}
				}
				body := map[string]any{"channel_id": sess, "next": strconv.FormatInt(max(0, at-1), 10), "direction": "after", "_data": map[string]any{"blocks": true}}
				var p firstPage
				raw, code := ask("POST", "/v1/internal/block.list", body)
				if code != http.StatusOK || json.Unmarshal(raw, &p) != nil {
					return pageCache{}, false
				}
				pc := pageCache{start: p.XData.Start, end: p.XData.End, blocks: p.XData.Blocks}
				pages = append(pages, pc)
				return pc, true
			}
			for _, idx := range idxs {
				w := want[idx]
				var collected []api.Block
				if w.from != nil {
					seenAt := map[string]bool{}
					cur := *w.from
					for hop := 0; hop < 4; hop++ {
						pc, ok := fetchAfter(cur)
						if !ok {
							break
						}
						for _, b := range pc.blocks {
							if !seenAt[b.At] {
								seenAt[b.At] = true
								collected = append(collected, b)
							}
						}
						if pc.end <= cur {
							break
						}
						if w.to > 0 && pc.end >= w.to {
							break
						}
						if w.to == 0 && w.steps > 0 {
							calls := 0
							for _, b := range collected {
								if b.Kind == api.BlockKindTool && line(b.At) >= *w.from {
									calls++
								}
							}
							if calls >= w.steps {
								break
							}
						}
						if w.to == 0 && w.steps == 0 {
							break
						}
						cur = pc.end
					}
				} else {
					body := map[string]any{"channel_id": sess, "next": strconv.FormatInt(line(w.block)+1, 10), "direction": "before", "_data": map[string]any{"blocks": true}}
					var p firstPage
					raw, code := ask("POST", "/v1/internal/block.list", body)
					if code != http.StatusOK || json.Unmarshal(raw, &p) != nil {
						continue
					}
					collected = p.XData.Blocks
				}
				bs := briefSpan(collected, w.block, w.from, w.to, w.steps)
				if bs == nil {
					bs = []api.Block{}
				}
				results[idx] = &firstWork{
					Session: w.session,
					Block:   w.block,
					From:    w.from,
					To:      w.to,
					Brief:   true,
					Blocks:  bs,
				}
			}
		})
	}
	wg.Wait()
	out := make([]firstWork, 0, len(results))
	for _, r := range results {
		if r != nil {
			out = append(out, *r)
		}
	}
	return out
}
