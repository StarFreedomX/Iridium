// Package join is `ir join <address>`: this machine as an executor of another Iridium
// (docs/exec.md). The first time it pairs (a code to match on that Iridium's page), then it keeps
// the TOKEN and runs the executor (internal/remote/executor), connecting again whenever the
// connection ends. It runs in the foreground only: the window closed, it ends, and the agents it
// started with it. On Windows it is all of Iridium there is.
package join

import (
	"bytes"
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/kumoSleeping/iridium/internal/api"
	"github.com/kumoSleeping/iridium/internal/machineid"
	"github.com/kumoSleeping/iridium/internal/remote/executor"
	"github.com/kumoSleeping/iridium/internal/remote/wire"
	"github.com/kumoSleeping/iridium/internal/version"
)

// Usage is ir join's help.
const Usage = `usage: ir join <address> [--name name] [--roots dir,…] [--shell]
  Run agents for another Iridium while this runs: pair once (a code to match on its page), then
  stay connected till it is stopped (Ctrl-C, the window closed), the agents it started with it.
  --name     this machine's name there (default: the host name, 12 characters at most)
  --roots    the directories it may read and write files under (default: the home directory)
  --shell    command lines from that Iridium run here: a person's on its page and its agents' (ir sh);
             without it only the agents start here
`

// Options are one join.
type Options struct {
	URL   string // the Iridium: https://host[:port]
	Name  string
	Roots []string
	// Shell: command lines run here, a person's on that Iridium's page and its agents' (ir sh);
	// else only the agents start here (docs/exec.md).
	Shell bool
	// Base is where joins keep their state (BaseDir): tokens/<key>, the TOKENs; <key>/, the
	// executor's own directory.
	Base   string
	Agents []wire.AgentInfo
	HTTP   *http.Client // nil: a client with timeouts
	Out    io.Writer    // what a person reads
	Logf   func(string, ...any)
	// Bot: pair as an app that is not a computer (ir pair): its name, Type and Program only.
	Bot     bool
	Type    string
	Program string
	Login   string // the login it speaks as, approved with it (ir pair); "": none
	Where   string // the Iridium as a person reads it; "": URL
	// Prog is the program that runs it: the zero value is ir join.
	Prog Program
	// Ask asks the person here about a grant from the Iridium's page; nil: its terminal (ask).
	Ask func(context.Context, string) bool
}

// Program is a program that joins: ir join (in iridium), or ir-computer (cmd/ir-computer).
type Program struct {
	Name  string // as a person types it: ir join, ir-computer
	Self  string // what it says it is in its pairing and hello, before the version: iridium
	Usage string
	// Update: connected to an Iridium of another release, it fetches that one's of itself and asks
	// to restart (ir-computer; ir join is updated with its Iridium).
	Update bool
}

// IRJoin is ir join.
var IRJoin = Program{Name: "ir join", Self: "iridium", Usage: Usage}

func (o *Options) prog() Program {
	if o.Prog.Name == "" {
		return IRJoin
	}
	return o.Prog
}

// again is the command line a person runs to pair again.
func (o *Options) again() string { return o.prog().Name + " " + o.URL }

// Main runs ir join with args (after "join").
func Main(args []string, stdout, stderr io.Writer) int { return IRJoin.Main(args, stdout, stderr) }

// Main runs p with args.
func (p Program) Main(args []string, stdout, stderr io.Writer) int {
	if slices.Contains(args, "--resident") {
		return p.leftover(args, stdout, stderr)
	}
	fs := flag.NewFlagSet(p.Name, flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	name := fs.String("name", "", "")
	roots := fs.String("roots", "", "")
	shell := fs.Bool("shell", false, "")
	base := fs.String("state", "", "") // where joins keep their state (tests)
	var pos []string
	for {
		if err := fs.Parse(args); err != nil {
			if errors.Is(err, flag.ErrHelp) {
				fmt.Fprint(stdout, p.Usage)
				return 0
			}
			fmt.Fprintf(stderr, "%s: %v\n\n%s", p.Name, err, p.Usage)
			return 2
		}
		if fs.NArg() == 0 {
			break
		}
		pos, args = append(pos, fs.Arg(0)), fs.Args()[1:]
	}
	if len(pos) != 1 {
		fmt.Fprint(stderr, p.Usage)
		return 2
	}
	u, err := Address(pos[0])
	if err != nil {
		fmt.Fprintf(stderr, "%s: %v\n", p.Name, err)
		return 2
	}
	o := Options{URL: u, Name: *name, Shell: *shell, Base: *base, Out: stdout, Prog: p}
	if o.Base == "" {
		o.Base, err = BaseDir()
	} else {
		o.Base, err = filepath.Abs(o.Base)
	}
	if err != nil {
		fmt.Fprintf(stderr, "%s: %v\n", p.Name, err)
		return 1
	}
	if *roots != "" {
		for _, r := range strings.Split(*roots, ",") {
			if r = homePath(strings.Trim(strings.TrimSpace(r), `"'`)); r != "" {
				abs, err := filepath.Abs(r)
				if err != nil {
					fmt.Fprintf(stderr, "%s: %v\n", p.Name, err)
					return 2
				}
				o.Roots = append(o.Roots, abs)
			}
		}
	}
	logger := log.New(stderr, "", log.LstdFlags)
	o.Logf = logger.Printf
	// Interrupted, or the window closed (a hang-up; on Windows its close comes as SIGTERM).
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM, syscall.SIGHUP)
	defer stop()
	if err := o.removeOld(sysRun); err != nil {
		o.logf("%s: %v", p.Name, err)
	}
	err = o.Run(ctx)
	if errors.Is(err, ErrRestart) {
		stop()
		o.say("重启")
		return reexec(selfExe(), args)
	}
	if err != nil && ctx.Err() == nil {
		fmt.Fprintf(stderr, "%s: %v\n", p.Name, err)
		return 1
	}
	return 0
}

// Address is the Iridium's base URL from what a person typed: a URL, or a host (https, http for
// a loopback one).
func Address(s string) (string, error) {
	s = strings.TrimSpace(s)
	if !strings.Contains(s, "://") {
		host := s
		if h, _, err := net.SplitHostPort(s); err == nil {
			host = h
		}
		if i := strings.IndexByte(host, '/'); i >= 0 {
			host = host[:i]
		}
		scheme := "https://"
		if ip := net.ParseIP(host); host == "localhost" || (ip != nil && ip.IsLoopback()) {
			scheme = "http://"
		}
		s = scheme + s
	}
	u, err := url.Parse(s)
	if err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil {
		return "", fmt.Errorf("not an address: %q", s)
	}
	return u.Scheme + "://" + strings.ToLower(u.Host), nil
}

// BaseDir is where joins keep their state on this system.
func BaseDir() (string, error) {
	switch runtime.GOOS {
	case "windows":
		if d := os.Getenv("LOCALAPPDATA"); d != "" {
			return filepath.Join(d, "iridium", "join"), nil
		}
	case "darwin":
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(home, "Library", "Application Support", "iridium-join"), nil
	}
	if d := os.Getenv("XDG_STATE_HOME"); d != "" {
		return filepath.Join(d, "iridium-join"), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".local", "state", "iridium-join"), nil
}

var unsafeKey = regexp.MustCompile(`[^a-z0-9.-]+`)

// key names the Iridium in file and unit names: its host and port.
func (o *Options) key() string {
	u, _ := url.Parse(o.URL)
	return strings.Trim(unsafeKey.ReplaceAllString(strings.ToLower(u.Host), "-"), "-.")
}

func (o *Options) tokenDir() string  { return filepath.Join(o.Base, "tokens") }
func (o *Options) tokenFile() string { return filepath.Join(o.tokenDir(), o.key()) }
func (o *Options) stateDir() string  { return filepath.Join(o.Base, o.key()) }

func (o *Options) say(format string, a ...any) {
	if o.Out != nil {
		fmt.Fprintf(o.Out, format+"\n", a...)
	}
}

func (o *Options) logf(format string, a ...any) {
	if o.Logf != nil {
		o.Logf(format, a...)
	}
}

func (o *Options) where() string { return cmp.Or(o.Where, o.URL) }

func (o *Options) client() *http.Client {
	if o.HTTP != nil {
		return o.HTTP
	}
	return &http.Client{Timeout: 30 * time.Second}
}

// MachineName is the default name: the host name as a terminal name may be (12 at most).
func MachineName() string {
	h, _ := os.Hostname()
	h = strings.TrimSuffix(strings.TrimSuffix(h, ".local"), ".LOCAL")
	h = regexp.MustCompile(`[^\p{L}\p{N}_-]+`).ReplaceAllString(h, "-")
	if r := []rune(h); len(r) > 12 {
		h = string(r[:12])
	}
	if h == "" {
		return "machine"
	}
	return h
}

func (o *Options) program() string { return o.prog().Self + " " + version.Version }

// Run pairs if there is no TOKEN, then runs the executor till ctx ends. A TOKEN the Iridium turns
// down is forgotten and it pairs again.
func (o *Options) Run(ctx context.Context) error {
	if o.Agents == nil {
		o.Agents = FindAgents(o.Logf)
	}
	if len(o.Roots) == 0 {
		home, err := os.UserHomeDir()
		if err != nil {
			return err
		}
		o.Roots = []string{home}
	}
	if err := os.MkdirAll(o.stateDir(), 0o700); err != nil {
		return err
	}
	// One left from when it ran at login may take a moment to end (removeOld).
	var unlock func()
	var err error
	for i := 0; ; i++ {
		if unlock, err = lock(filepath.Join(o.stateDir(), "lock")); err == nil || i == 20 {
			break
		}
		if !sleep(ctx, 500*time.Millisecond) {
			return ctx.Err()
		}
	}
	if err != nil {
		return fmt.Errorf("another %s runs here: %v", o.again(), err)
	}
	defer unlock()
	told := false
	for {
		tok, err := o.token(ctx)
		if err != nil {
			return err
		}
		rctx, rcancel := context.WithCancel(ctx)
		var restarting atomic.Bool
		var ex *executor.Executor
		ex, err = executor.New(executor.Options{
			URL: wsURL(o.URL), Token: tok, State: o.stateDir(), Roots: o.Roots, Deny: []string{o.tokenDir()},
			Agents: o.Agents, Shell: o.Shell, Program: o.program(), HTTPClient: o.HTTP, Logf: o.logf, IR: selfExe(),
			Connected: func(name string) {
				o.say("已连接 %s（%s）：关闭此窗口即断开", o.URL, name)
				if !told {
					told = true
					o.say("%s", o.grants(ex))
				}
			},
			Denied: o.denied, Ask: o.ask(),
			Replied: func(r wire.HelloReply) {
				o.newer(rctx, ex, r, func() { restarting.Store(true); rcancel() })
			},
		})
		if err != nil {
			return err
		}
		err = ex.Run(rctx)
		ex.Close()
		rcancel()
		if restarting.Load() && ctx.Err() == nil {
			return ErrRestart
		}
		if !errors.Is(err, executor.ErrRefused) {
			return err
		}
		if err := os.Remove(o.tokenFile()); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		o.say("%s 不再接受这台电脑，重新配对", o.URL)
	}
}

func wsURL(base string) string {
	if rest, ok := strings.CutPrefix(base, "http"); ok {
		return "ws" + rest + "/v1/internal/exec"
	}
	return base + "/v1/internal/exec"
}

// token is the kept TOKEN, or a new one paired for and kept.
func (o *Options) token(ctx context.Context) (string, error) {
	if b, err := os.ReadFile(o.tokenFile()); err == nil && len(bytes.TrimSpace(b)) > 0 {
		return string(bytes.TrimSpace(b)), nil
	}
	tok, err := o.pair(ctx)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(o.tokenDir(), 0o700); err != nil {
		return "", err
	}
	tmp := o.tokenFile() + ".tmp"
	if err := os.WriteFile(tmp, []byte(tok+"\n"), 0o600); err != nil {
		return "", err
	}
	if err := os.Rename(tmp, o.tokenFile()); err != nil {
		return "", err
	}
	o.say("已配对 %s", o.URL)
	return tok, nil
}

// errDenied: a person declined the pairing.
var errDenied = errors.New("配对被拒绝")

// pairWait is how long it waits between asks after the Iridium could not be reached, and between
// looks at a pending request; pairClosedWait, between asks while that Iridium takes none.
var pairWait, pairPoll, pairClosedWait = 30 * time.Second, 2 * time.Second, 5 * time.Second

// pair asks the Iridium to pair until a person allows it (the TOKEN) or declines it. While it
// takes no requests (pair_closed, or too many waiting) it asks again.
func (o *Options) pair(ctx context.Context) (string, error) {
	name := o.Name
	if name == "" {
		name = MachineName()
	}
	who := api.PairRequest{Name: name, Type: api.TypeComputer, OS: runtime.GOOS, Arch: runtime.GOARCH, Program: o.program(), Shell: &o.Shell, NoShell: !o.Shell, AgentShell: o.Shell}
	const path = "/v1/internal/pair"
	if o.Bot {
		who = api.PairRequest{Name: name, Type: o.Type, Program: o.Program}
		if o.Login != "" {
			who.Login = &api.PairLogin{ID: o.Login}
		}
	} else {
		if o.Agents == nil {
			o.Agents = FindAgents(o.Logf)
		}
		// Its home and computer, as its hello will say them: with agents, its home is its scope
		// there unless the person gives another; on that Iridium's own computer, it carries none.
		who.Home, _ = os.UserHomeDir()
		who.MachineID = machineid.Hash()
		for _, a := range o.Agents {
			who.Agents = append(who.Agents, api.ExecAgent{Agent: a.Agent, Version: a.Version})
		}
	}
	closed := false
	for {
		var p api.Pairing
		code, refusal, err := o.call(ctx, http.MethodPost, path, who, &p)
		if err == nil && code == http.StatusForbidden && (refusal.Code == "pair_closed" || refusal.Code == "too_many_pending") {
			if !closed {
				o.say("%s 没开配对：在那边的应用管理里打开配对；等待中", o.where())
				closed = true
			}
			if !sleep(ctx, pairClosedWait) {
				return "", ctx.Err()
			}
			continue
		}
		closed = false
		if err == nil && code == http.StatusUnprocessableEntity && refusal.Code == "bad_name" {
			return "", fmt.Errorf("名字 %q 不能用（%s）：用 --name 换一个", name, refusal.NameError)
		}
		if err == nil && code != http.StatusOK {
			err = fmt.Errorf("HTTP %d %s", code, refusal.Message)
		} else if err == nil && p.Code == "" {
			err = errors.New("no code in the answer")
		}
		if err != nil {
			if ctx.Err() != nil {
				return "", ctx.Err()
			}
			o.say("无法配对 %s：%v，%d 秒后重试", o.where(), err, int(pairWait/time.Second))
			if !sleep(ctx, pairWait) {
				return "", ctx.Err()
			}
			continue
		}
		o.say("配对码 %s：在 %s 的网页上核对后允许", p.Code, o.where())
	poll:
		for {
			if !sleep(ctx, pairPoll) {
				return "", ctx.Err()
			}
			var st api.PairState
			code, _, err := o.call(ctx, http.MethodGet, path+"/"+url.PathEscape(p.Request), nil, &st)
			switch {
			case err != nil || (code != http.StatusOK && code != http.StatusUnprocessableEntity):
				continue // as pending
			case code == http.StatusUnprocessableEntity || st.Status == "expired":
				o.say("配对码已过期，重新申请")
				break poll
			case st.Status == "allowed" && st.Token != "":
				return st.Token, nil
			case st.Status == "denied":
				return "", errDenied
			}
		}
	}
}

// call sends a JSON request to the Iridium: the status, the refusal if not 200, and the body read
// into out.
func (o *Options) call(ctx context.Context, method, path string, body, out any) (int, api.Error, error) {
	var refusal api.Error
	var r io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return 0, refusal, err
		}
		r = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, o.URL+path, r)
	if err != nil {
		return 0, refusal, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := o.client().Do(req)
	if err != nil {
		return 0, refusal, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if resp.StatusCode == http.StatusOK && out != nil {
		if err := json.Unmarshal(raw, out); err != nil {
			return resp.StatusCode, refusal, err
		}
	}
	if resp.StatusCode != http.StatusOK {
		_ = json.Unmarshal(raw, &refusal)
	}
	return resp.StatusCode, refusal, nil
}

func sleep(ctx context.Context, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
		return true
	}
}

// selfExe is this program, which is ir by that name: the ir its agents get (executor.Options.IR).
func selfExe() string {
	p, err := os.Executable()
	if err != nil {
		return ""
	}
	if r, err := filepath.EvalSymlinks(p); err == nil {
		p = r
	}
	return p
}

// homePath is p with a leading ~ as the home directory: a quoted "~/work" reaches ir join as it
// is, the shell expanding nothing inside quotes.
func homePath(p string) string {
	if p != "~" && !strings.HasPrefix(p, "~/") && !strings.HasPrefix(p, `~\`) {
		return p
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return p
	}
	return filepath.Join(home, p[1:])
}
