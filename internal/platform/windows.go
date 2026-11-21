//go:build windows

package platform

import (
	"errors"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Windows has no SIGTERM. A process that takes stop requests (NotifyStop) waits on an event named
// after its pid, which AskStop sets: what SIGTERM is for a holder and its supervisor elsewhere.

func stopEvent(pid int) *uint16 {
	p, _ := windows.UTF16PtrFromString(fmt.Sprintf(`Local\iridium-stop-%d`, pid))
	return p
}

// NotifyStop sends syscall.SIGTERM on c each time AskStop is called for this process, and
// os.Interrupt for Ctrl+C or Ctrl+Break at its console. Like signal.Notify it never blocks.
func NotifyStop(c chan<- os.Signal) {
	signal.Notify(c, os.Interrupt)
	// An event left by a gone process of the same pid is taken over (ERROR_ALREADY_EXISTS).
	ev, _ := windows.CreateEvent(nil, 0, 0, stopEvent(os.Getpid()))
	if ev == 0 {
		return
	}
	go func() {
		for {
			if r, err := windows.WaitForSingleObject(ev, windows.INFINITE); err != nil || r != windows.WAIT_OBJECT_0 {
				return
			}
			select {
			case c <- syscall.SIGTERM:
			default:
			}
		}
	}()
}

// AskStop asks process pid to end, as SIGTERM would. A process that is gone is no error.
func AskStop(pid int) error {
	h, err := windows.OpenEvent(windows.EVENT_MODIFY_STATE, false, stopEvent(pid))
	if err != nil {
		if !Alive(pid) {
			return nil
		}
		return fmt.Errorf("process %d takes no stop requests: %w", pid, err)
	}
	defer windows.CloseHandle(h)
	return windows.SetEvent(h)
}

// Alive says whether process pid runs.
func Alive(pid int) bool {
	if pid <= 0 {
		return false
	}
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		// Access denied: it is there, someone else's.
		return errors.Is(err, windows.ERROR_ACCESS_DENIED)
	}
	defer windows.CloseHandle(h)
	var code uint32
	if windows.GetExitCodeProcess(h, &code) != nil {
		return false
	}
	return code == 259 // STILL_ACTIVE
}

// TerminatePID ends process pid at once with code.
func TerminatePID(pid int, code uint32) error {
	h, err := windows.OpenProcess(windows.PROCESS_TERMINATE, false, uint32(pid))
	if err != nil {
		if !Alive(pid) {
			return nil
		}
		return err
	}
	defer windows.CloseHandle(h)
	return windows.TerminateProcess(h, code)
}

// Job is a Windows job object: what a process group (and a session's leader) is elsewhere, the
// processes a stop or a kill reaches, children and theirs included.
type Job struct{ h windows.Handle }

func jobName(name string) *uint16 {
	if name == "" {
		return nil
	}
	p, _ := windows.UTF16PtrFromString(`Local\iridium-job-` + name)
	return p
}

// NewJob makes a job, named when name is not "" (so OpenJob finds it from another process).
// killOnClose: its processes end with its last handle, the process that made it ending.
func NewJob(name string, killOnClose bool) (*Job, error) {
	h, err := windows.CreateJobObject(nil, jobName(name))
	if err != nil {
		return nil, err
	}
	if killOnClose {
		info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
		info.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
		if _, err := windows.SetInformationJobObject(h, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info))); err != nil {
			windows.CloseHandle(h)
			return nil, err
		}
	}
	return &Job{h: h}, nil
}

var procOpenJobObject = windows.NewLazySystemDLL("kernel32.dll").NewProc("OpenJobObjectW")

// OpenJob is the job NewJob named name, from another process.
func OpenJob(name string) (*Job, error) {
	const access = 0x1F001F // JOB_OBJECT_ALL_ACCESS
	r, _, err := procOpenJobObject.Call(access, 0, uintptr(unsafe.Pointer(jobName(name))))
	if r == 0 {
		return nil, err
	}
	return &Job{h: windows.Handle(r)}, nil
}

// Add puts process pid in the job. Its children started after this are in it too.
func (j *Job) Add(pid int) error {
	p, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(pid))
	if err != nil {
		return err
	}
	defer windows.CloseHandle(p)
	return windows.AssignProcessToJobObject(j.h, p)
}

// Active is how many processes of the job still run.
func (j *Job) Active() int {
	var info struct {
		TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime int64
		TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses    uint32
	}
	if err := windows.QueryInformationJobObject(j.h, windows.JobObjectBasicAccountingInformation, uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info)), nil); err != nil {
		return 0
	}
	return int(info.ActiveProcesses)
}

// Kill ends every process of the job at once.
func (j *Job) Kill(code uint32) error { return windows.TerminateJobObject(j.h, code) }

func (j *Job) Close() error { return windows.CloseHandle(j.h) }
