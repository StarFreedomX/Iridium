//go:build windows

package desktop

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	kernel32              = windows.NewLazySystemDLL("kernel32.dll")
	getConsoleProcessList = kernel32.NewProc("GetConsoleProcessList")
	freeConsole           = kernel32.NewProc("FreeConsole")
)

// hideConsole: iridium.exe is a console program (its CLI prints), so opened from Explorer it gets
// a console window of its own; the app lets it go. One it shares (started from a terminal) stays.
func hideConsole() {
	var pids [2]uint32
	n, _, _ := getConsoleProcessList.Call(uintptr(unsafe.Pointer(&pids[0])), 2)
	if n == 1 {
		freeConsole.Call()
	}
}
