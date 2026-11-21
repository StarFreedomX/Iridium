//go:build windows

package install

import (
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"

	"golang.org/x/sys/windows/registry"
)

const exeName = "iridium.exe"

// swap puts the new binary tmp in dst's place. A running dst cannot be replaced, only renamed:
// it is moved aside (an update removes it later, as it does its own).
func swap(tmp, dst string) error {
	err := os.Rename(tmp, dst)
	if err == nil {
		return nil
	}
	old := dst + ".old." + strconv.FormatInt(time.Now().UnixNano(), 10)
	if rerr := os.Rename(dst, old); rerr != nil {
		return err
	}
	if err := os.Rename(tmp, dst); err != nil {
		_ = os.Rename(old, dst)
		return err
	}
	return nil
}

// link writes bin\ir.cmd, which runs dst as ir (a link needs rights a user rarely has), and puts
// bin on the user's Path, for terminals opened from now on and the agents.
func link(dst, bin string) error {
	if bin == "" {
		return nil
	}
	if err := os.MkdirAll(bin, 0o755); err != nil {
		return err
	}
	cmd := "@\"" + dst + "\" ir %*\r\n"
	if err := os.WriteFile(filepath.Join(bin, "ir.cmd"), []byte(cmd), 0o755); err != nil {
		return err
	}
	return addUserPath(bin)
}

// addUserPath puts dir on HKCU\Environment's Path once.
func addUserPath(dir string) error {
	k, err := registry.OpenKey(registry.CURRENT_USER, "Environment", registry.QUERY_VALUE|registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()
	cur, typ, err := k.GetStringValue("Path")
	if err != nil && !errors.Is(err, registry.ErrNotExist) {
		return err
	}
	parts := filepath.SplitList(cur)
	if slices.ContainsFunc(parts, func(p string) bool { return strings.EqualFold(filepath.Clean(p), filepath.Clean(dir)) }) {
		return nil
	}
	parts = append(parts, dir)
	v := strings.Join(slices.DeleteFunc(parts, func(p string) bool { return p == "" }), ";")
	if typ == registry.EXPAND_SZ {
		return k.SetExpandStringValue("Path", v)
	}
	return k.SetStringValue("Path", v)
}
