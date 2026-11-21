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

// statusCmd is `iridium status`: the version, then what runs here: this computer's Iridium (does
// it answer, where), the service install made, the window, and each join with its last word.
func statusCmd(args []string) int {
	fs := flag.NewFlagSet("status", flag.ExitOnError)
	path := fs.String("config", config.DefaultPath(), "this computer's Iridium's config file")
	unit := fs.String("unit", "iridium", "the service's name")
	fs.Parse(args)
	fmt.Println("iridium", version.Version)

	cfg, err := config.Load(*path)
	if err != nil {
		fmt.Printf("服务器  配置读不了：%v\n", err)
	} else {
		addr := "http://" + cfg.Listen
		if h, p, err := net.SplitHostPort(cfg.Listen); err == nil && (h == "" || h == "0.0.0.0" || h == "::") {
			addr = "http://" + net.JoinHostPort("127.0.0.1", p)
		}
		state := "未运行"
		if answers(addr) {
			state = "运行中"
		}
		line := fmt.Sprintf("服务器  %s  %s", state, addr)
		if cfg.Public.Origin != "" {
			line += "  公网 " + cfg.Public.Origin
		}
		fmt.Println(line)
	}
	if s := install.Look(*unit); s.File != "" {
		line := fmt.Sprintf("服务    %s  %s", orNone(s.State), s.File)
		if s.Command != "" {
			line += "\n        " + s.Command
		}
		fmt.Println(line)
	} else {
		fmt.Println("服务    未安装")
	}
	window := false
	for _, r := range desktop.Running() {
		what := "serve"
		if r.Kind == "window" {
			what, window = "窗口", true
		}
		for _, a := range sortedKeys(r.Joins) {
			fmt.Printf("接入    %s  %s（%s，pid %d）\n", a, orNone(r.Joins[a]), what, r.PID)
		}
	}
	if window {
		fmt.Println("窗口    打开")
	} else {
		fmt.Println("窗口    未打开")
	}
	return 0
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
