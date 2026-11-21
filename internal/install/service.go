package install

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/kumoSleeping/iridium/internal/config"
	"github.com/kumoSleeping/iridium/internal/launchd"
)

// Service is what Install left of unit on this system, for iridium status.
type Service struct {
	File    string // its unit file, plist or task file; "" none
	Command string // the command it runs, as written there; "" not read
	State   string // the system's word for it (active, running, Ready...); "" not known
}

// unitFile is where Install writes unit on this system.
func unitFile(unit string) string {
	home, _ := os.UserHomeDir()
	switch runtime.GOOS {
	case "darwin":
		return launchd.File(launchd.Dir(home), unit)
	case "windows":
		return filepath.Join(config.Default().StatePath(), unit+"-task.xml")
	}
	dir := filepath.Join(home, ".config", "systemd", "user")
	if d := os.Getenv("XDG_CONFIG_HOME"); d != "" {
		dir = filepath.Join(d, "systemd", "user")
	}
	return filepath.Join(dir, unit+".service")
}

// Look is unit's service as Install made it, if it did.
func Look(unit string) Service {
	var s Service
	f := unitFile(unit)
	b, err := os.ReadFile(f)
	if err != nil {
		return s
	}
	s.File = f
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	switch runtime.GOOS {
	case "darwin":
		s.State = launchd.State(ctx, launchd.Domain(ctx), unit)
		if s.State == "" {
			s.State = "not loaded"
		}
	case "windows":
		if out, err := exec.CommandContext(ctx, "schtasks", "/Query", "/TN", unit, "/FO", "LIST").Output(); err == nil {
			for l := range strings.Lines(string(out)) {
				if k, v, ok := strings.Cut(l, ":"); ok && strings.TrimSpace(k) == "Status" {
					s.State = strings.TrimSpace(v)
				}
			}
		}
	default:
		out, _ := exec.CommandContext(ctx, "systemctl", "--user", "is-active", unit+".service").Output()
		s.State = strings.TrimSpace(string(out))
		for l := range strings.Lines(string(b)) {
			if v, ok := strings.CutPrefix(strings.TrimSpace(l), "ExecStart="); ok {
				s.Command = v
			}
		}
	}
	return s
}

// Uninstall stops unit and takes it away; the binary, the config and the state stay.
func Uninstall(unit string, out func(string, ...any)) error {
	f := unitFile(unit)
	if _, err := os.Stat(f); err != nil {
		return fmt.Errorf("no service %s here (%s)", unit, f)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	switch runtime.GOOS {
	case "darwin":
		launchd.Unload(ctx, launchd.Run, launchd.Domain(ctx), unit)
	case "windows":
		_ = exec.CommandContext(ctx, "schtasks", "/End", "/TN", unit).Run()
		if err := exec.CommandContext(ctx, "schtasks", "/Delete", "/TN", unit, "/F").Run(); err != nil {
			return fmt.Errorf("schtasks /Delete: %w", err)
		}
	default:
		if err := exec.CommandContext(ctx, "systemctl", "--user", "disable", "--now", unit+".service").Run(); err != nil {
			return fmt.Errorf("systemctl --user disable --now %s.service: %w", unit, err)
		}
	}
	if err := os.Remove(f); err != nil {
		return err
	}
	if runtime.GOOS == "linux" {
		_ = exec.CommandContext(ctx, "systemctl", "--user", "daemon-reload").Run()
	}
	out("已停止并去掉 %s（%s）；程序、配置和状态都留着。", unit, f)
	return nil
}
