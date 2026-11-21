package desktop

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"time"
)

// Record is what one iridium process here runs, kept on disk for iridium status: the window, or
// serve with its joins. One file each (<config dir>/Iridium/run/<pid>.json), gone when it ends;
// one whose process is gone is taken as ended.
type Record struct {
	Kind   string            `json:"kind"`             // "runtime", "window" or "serve"
	Server string            `json:"server,omitempty"` // the runtime's: this computer's Iridium's state
	PID   int               `json:"pid"`
	Since time.Time         `json:"since"`
	Joins map[string]string `json:"joins"` // each Iridium joined: what it said last
}

func runDir() (string, error) {
	p, err := configPath()
	if err != nil {
		return "", err
	}
	return filepath.Join(filepath.Dir(p), "run"), nil
}

// save writes the record with the joins' states (under the Joins' lock).
func (r *Record) save(joins map[string]string) {
	if r.PID == 0 {
		r.PID, r.Since = os.Getpid(), time.Now()
	}
	r.Joins = map[string]string{}
	for k, v := range joins {
		r.Joins[k] = v
	}
	d, err := runDir()
	if err != nil || os.MkdirAll(d, 0o700) != nil {
		return
	}
	b, _ := json.Marshal(r)
	p := filepath.Join(d, strconv.Itoa(r.PID)+".json")
	if os.WriteFile(p+".tmp", b, 0o600) == nil {
		_ = os.Rename(p+".tmp", p)
	}
}

func (r *Record) remove() {
	if d, err := runDir(); err == nil && r.PID != 0 {
		_ = os.Remove(filepath.Join(d, strconv.Itoa(r.PID)+".json"))
	}
}

// Running are the records of the iridium processes here that run, oldest first; those of ended
// ones are removed.
func Running() []Record {
	d, err := runDir()
	if err != nil {
		return nil
	}
	ents, _ := os.ReadDir(d)
	var out []Record
	for _, e := range ents {
		p := filepath.Join(d, e.Name())
		var r Record
		b, err := os.ReadFile(p)
		if err != nil || json.Unmarshal(b, &r) != nil || r.PID == 0 {
			continue
		}
		if !alive(r.PID) {
			_ = os.Remove(p)
			continue
		}
		out = append(out, r)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Since.Before(out[j].Since) })
	return out
}
