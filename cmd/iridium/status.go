package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/kumoSleeping/iridium/internal/config"
	"github.com/kumoSleeping/iridium/internal/desktop"
	"github.com/kumoSleeping/iridium/internal/install"
	"github.com/kumoSleeping/iridium/internal/version"
)

// statusCmd is ir status: the version, then what runs here: ir's service and its runtime, this
// computer's Iridium (does it answer, where), the window, and each join with its last word.
func statusCmd(args []string) int {
	fs := flag.NewFlagSet("status", flag.ExitOnError)
	path := fs.String("config", config.DefaultPath(), "this computer's Iridium's config file")
	unit := fs.String("unit", "iridium", "the service's name")
	fs.Parse(args)
	printStatus(*path, *unit)
	return 0
}

func printStatus(path, unit string) {
	fmt.Println("iridium", version.Version)
	if s := install.Look(unit); s.File != "" {
		line := fmt.Sprintf("服务    %s  %s", orNone(s.State), s.File)
		if s.Command != "" {
			line += "\n        " + s.Command
		}
		fmt.Println(line)
	} else {
		fmt.Println("服务    未注册（ir start）")
	}
	rt, running := desktop.RuntimeRecord()
	if running {
		fmt.Printf("ir      运行中（pid %d，%s 起）\n", rt.PID, rt.Since.Format("01-02 15:04"))
	} else {
		fmt.Println("ir      未运行")
	}
	cfg, err := config.Load(path)
	switch {
	case err != nil:
		fmt.Printf("服务器  配置读不了：%v\n", err)
	case !desktop.ServerOn():
		fmt.Println("服务器  已关闭（ir server on）")
	default:
		addr := "http://" + cfg.Listen
		if h, p, err := net.SplitHostPort(cfg.Listen); err == nil && (h == "" || h == "0.0.0.0" || h == "::") {
			addr = "http://" + net.JoinHostPort("127.0.0.1", p)
		}
		state := "未运行"
		if answers(addr) {
			state = "运行中"
		} else if running && rt.Server != "" {
			state = rt.Server
		}
		line := fmt.Sprintf("服务器  %s  %s", state, addr)
		if cfg.Public.Origin != "" {
			line += "  公网 " + cfg.Public.Origin
		}
		fmt.Println(line)
	}
	window := false
	for _, r := range desktop.Running() {
		if r.Kind == "window" {
			window = true
		}
		for _, a := range sortedKeys(r.Joins) {
			what := ""
			if r.Kind == "serve" {
				what = fmt.Sprintf("（ir serve，pid %d）", r.PID)
			}
			fmt.Printf("接入    %s  %s%s\n", a, orNone(r.Joins[a]), what)
		}
	}
	if !running {
		for _, a := range desktop.Joined() {
			fmt.Printf("接入    %s  —（ir 未运行）\n", a)
		}
	}
	if window {
		fmt.Println("窗口    打开")
	} else {
		fmt.Println("窗口    未打开")
	}
}

// uninstallCmd is `iridium uninstall`: the service install made, stopped and taken away.
func uninstallCmd(args []string) int {
	fs := flag.NewFlagSet("uninstall", flag.ExitOnError)
	unit := fs.String("unit", "iridium", "the service's name")
	fs.Parse(args)
	if err := install.Uninstall(*unit, func(f string, a ...any) { fmt.Printf(f+"\n", a...) }); err != nil {
		fmt.Fprintf(os.Stderr, "iridium uninstall: %v\n", err)
		return 1
	}
	return 0
}

// answers: does an Iridium answer at address (its /_ir/health)?
func answers(address string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, address+"/_ir/health", nil)
	if err != nil {
		return false
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return false
	}
	defer res.Body.Close()
	// On loopback with a public address on, the page answers bad_host: still it runs.
	var h struct {
		OK   bool   `json:"ok"`
		Code string `json:"code"`
	}
	_ = json.NewDecoder(res.Body).Decode(&h)
	return h.OK || h.Code == "bad_host"
}

func orNone(s string) string {
	if strings.TrimSpace(s) == "" {
		return "—"
	}
	return s
}

func sortedKeys(m map[string]string) []string {
	var k []string
	for a := range m {
		k = append(k, a)
	}
	sort.Strings(k)
	return k
}
