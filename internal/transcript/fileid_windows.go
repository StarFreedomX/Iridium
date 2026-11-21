//go:build windows

package transcript

import (
	"os"

	"golang.org/x/sys/windows"
)

// fileID tells a file from another put in its place: its file index on its volume.
func fileID(path string, _ os.FileInfo) uint64 {
	f, err := os.Open(path)
	if err != nil {
		return 0
	}
	defer f.Close()
	var info windows.ByHandleFileInformation
	if windows.GetFileInformationByHandle(windows.Handle(f.Fd()), &info) != nil {
		return 0
	}
	return uint64(info.FileIndexHigh)<<32 | uint64(info.FileIndexLow)
}
