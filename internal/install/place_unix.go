//go:build !windows

package install

import (
	"os"
	"path/filepath"
)

const exeName = "iridium"

// swap puts the new binary tmp in dst's place.
func swap(tmp, dst string) error { return os.Rename(tmp, dst) }

func link(dst, bin string) error {
	if bin == "" {
		return nil
	}
	ir := filepath.Join(bin, "ir")
	if fi, err := os.Lstat(ir); err == nil && fi.Mode()&os.ModeSymlink == 0 {
		return nil
	}
	if err := os.MkdirAll(bin, 0o755); err != nil {
		return err
	}
	tmp := ir + ".new"
	os.Remove(tmp)
	if err := os.Symlink(dst, tmp); err != nil {
		return err
	}
	return os.Rename(tmp, ir)
}
