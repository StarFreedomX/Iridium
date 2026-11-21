//go:build !windows

package transcript

import (
	"os"
	"syscall"
)

// fileID tells a file from another put in its place: its inode.
func fileID(_ string, st os.FileInfo) uint64 {
	if s, ok := st.Sys().(*syscall.Stat_t); ok {
		return uint64(s.Ino)
	}
	return 0
}
