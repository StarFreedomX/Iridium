package main

import (
	"os"
	"os/exec"
	"strconv"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"

	"github.com/kumoSleeping/iridium/internal/platform"
)

// waitPID names the daemon a restarted one waits for, which holds the daemon's lock till it ends.
const waitPID = "IRIDIUM_WAIT_PID"

func init() {
	if s := os.Getenv(waitPID); s != "" {
		os.Unsetenv(waitPID)
		if pid, err := strconv.Atoi(s); err == nil {
			for end := time.Now().Add(15 * time.Second); platform.Alive(pid) && time.Now().Before(end); {
				time.Sleep(50 * time.Millisecond)
			}
		}
	}
	hideConsole()
}

// restart runs the binary on disk (the new one, after an update) with this daemon's arguments,
// on its own, and ends this one; the new one starts once this one has gone. The holders run on
// their own and keep running.
func restart() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	start := func(flags uint32) error {
		cmd := exec.Command(exe, os.Args[1:]...)
		cmd.Env = append(os.Environ(), waitPID+"="+strconv.Itoa(os.Getpid()))
		cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: flags, HideWindow: true}
		return cmd.Start()
	}
	const noWindow = 0x08000000 // CREATE_NO_WINDOW
	if err := start(noWindow | windows.CREATE_BREAKAWAY_FROM_JOB); err != nil {
		if err := start(noWindow); err != nil {
			return err
		}
	}
	os.Exit(0)
	return nil
}

var (
	kernel32                  = windows.NewLazySystemDLL("kernel32.dll")
	procGetConsoleProcessList = kernel32.NewProc("GetConsoleProcessList")
	procFreeConsole           = kernel32.NewProc("FreeConsole")
)

// hideConsole: the daemon started by the logon task gets a console window of its own; it lets
// it go (the window closes) when no one else is at that console. In a terminal it stays.
func hideConsole() {
	if len(os.Args) < 2 || os.Args[1] != "serve" {
		return
	}
	var pids [2]uint32
	n, _, _ := procGetConsoleProcessList.Call(uintptr(unsafe.Pointer(&pids[0])), 2)
	if n == 1 {
		_, _, _ = procFreeConsole.Call()
	}
}
