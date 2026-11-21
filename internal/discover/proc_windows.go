//go:build windows

package discover

import (
	"errors"
	"strings"
	"sync"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// defaultProcs is the system's processes: a Toolhelp snapshot, and each process's PEB.
func defaultProcs() Procs { return WinProcs{} }

// WinProcs is Windows's processes: a Toolhelp snapshot for the list and each one's parent,
// GetProcessTimes for its start, its token for its owner, and its PEB (read from its memory, as
// Process Explorer does) for its command line, folder and environment. A field that cannot be
// read is empty. Open files are not listed.
type WinProcs struct{}

// The snapshot is taken once a second at most: Stat asks it for every process of a scan.
var snap struct {
	sync.Mutex
	at      time.Time
	parents map[int]int
}

func parents() (map[int]int, error) {
	snap.Lock()
	defer snap.Unlock()
	if snap.parents != nil && time.Since(snap.at) < time.Second {
		return snap.parents, nil
	}
	h, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil, err
	}
	defer windows.CloseHandle(h)
	m := map[int]int{}
	var e windows.ProcessEntry32
	e.Size = uint32(unsafe.Sizeof(e))
	for err = windows.Process32First(h, &e); err == nil; err = windows.Process32Next(h, &e) {
		m[int(e.ProcessID)] = int(e.ParentProcessID)
	}
	snap.at, snap.parents = time.Now(), m
	return m, nil
}

func (WinProcs) PIDs() ([]int, error) {
	m, err := parents()
	if err != nil {
		return nil, err
	}
	out := make([]int, 0, len(m))
	for pid := range m {
		if pid > 4 { // 0 idle, 4 System
			out = append(out, pid)
		}
	}
	return out, nil
}

// thisUser is this process's user.
var thisUser = sync.OnceValue(func() *windows.SID {
	u, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return nil
	}
	sid, err := u.User.Sid.Copy()
	if err != nil {
		return nil
	}
	return sid
})

// Stat: Start is the creation time in 100 ns since 1601, UID -1 for this user's processes (what
// os.Getuid is here) and -2 for another's. ProcStart "*": what Claude records here is not known,
// so any start it records matches.
func (WinProcs) Stat(pid int) (Stat, error) {
	m, err := parents()
	if err != nil {
		return Stat{}, err
	}
	ppid, ok := m[pid]
	if !ok {
		return Stat{}, errors.New("no such process")
	}
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return Stat{}, err
	}
	defer windows.CloseHandle(h)
	var created, exited, kernel, user windows.Filetime
	if err := windows.GetProcessTimes(h, &created, &exited, &kernel, &user); err != nil {
		return Stat{}, err
	}
	s := Stat{
		PPid:      ppid,
		Start:     uint64(created.HighDateTime)<<32 | uint64(created.LowDateTime),
		Started:   time.Unix(0, created.Nanoseconds()),
		UID:       -2,
		ProcStart: "*",
	}
	var tok windows.Token
	if windows.OpenProcessToken(h, windows.TOKEN_QUERY, &tok) == nil {
		if u, err := tok.GetTokenUser(); err == nil && thisUser() != nil && u.User.Sid.Equals(thisUser()) {
			s.UID = -1
		}
		tok.Close()
	}
	return s, nil
}

func (WinProcs) Exe(pid int) string {
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return ""
	}
	defer windows.CloseHandle(h)
	buf := make([]uint16, windows.MAX_LONG_PATH)
	n := uint32(len(buf))
	if windows.QueryFullProcessImageName(h, 0, &buf[0], &n) != nil {
		return ""
	}
	return windows.UTF16ToString(buf[:n])
}

func (WinProcs) Cmdline(pid int) []string {
	p, ok := readParams(pid)
	if !ok {
		return nil
	}
	defer p.close()
	line := p.str(p.u.CommandLine)
	if line == "" {
		return nil
	}
	argv, err := windows.DecomposeCommandLine(line)
	if err != nil {
		return strings.Fields(line)
	}
	return argv
}

func (WinProcs) Cwd(pid int) string {
	p, ok := readParams(pid)
	if !ok {
		return ""
	}
	defer p.close()
	d := p.str(p.u.CurDir)
	if len(d) > 3 { // C:\ keeps its backslash
		d = strings.TrimSuffix(d, `\`)
	}
	return d
}

func (WinProcs) Environ(pid int) []string {
	p, ok := readParams(pid)
	if !ok {
		return nil
	}
	defer p.close()
	if p.u.Environment == 0 || p.u.EnvironmentSize == 0 || p.u.EnvironmentSize > 4<<20 {
		return nil
	}
	b := make([]uint16, p.u.EnvironmentSize/2)
	if !p.read(p.u.Environment, unsafe.Pointer(&b[0]), uintptr(len(b))*2) {
		return nil
	}
	var out []string
	for len(b) > 0 {
		i := 0
		for i < len(b) && b[i] != 0 {
			i++
		}
		if i == 0 {
			break
		}
		kv := windows.UTF16ToString(b[:i])
		if !strings.HasPrefix(kv, "=") { // =C:=C:\..., the shell's per-drive folders
			out = append(out, kv)
		}
		if i == len(b) {
			break
		}
		b = b[i+1:]
	}
	return out
}

func (WinProcs) Files(int) []string { return nil }

// The 64-bit layouts of what is read from another process, every pointer a uintptr: an address
// there, which the garbage collector must not take for one here.
type unicodeString struct {
	Length, MaximumLength uint16
	Buffer                uintptr
}

type driveCurdir struct {
	Flags, Length uint16
	TimeStamp     uint32
	DosPath       struct {
		Length, MaximumLength uint16
		Buffer                uintptr
	}
}

type userParams struct {
	MaximumLength, Length, Flags, DebugFlags uint32
	ConsoleHandle                            uintptr
	ConsoleFlags                             uint32
	StdIn, StdOut, StdErr                    uintptr
	CurDir                                   unicodeString
	CurDirHandle                             uintptr
	DllPath, ImagePathName, CommandLine      unicodeString
	Environment                              uintptr

	StartingX, StartingY, CountX, CountY, CountCharsX, CountCharsY, FillAttribute uint32

	WindowFlags, ShowWindowFlags                     uint32
	WindowTitle, DesktopInfo, ShellInfo, RuntimeData unicodeString
	CurrentDirectories                               [32]driveCurdir

	EnvironmentSize, EnvironmentVersion uintptr
}

// The mirrors lay out as x/sys's own: a compile error otherwise.
var (
	_ = [1]struct{}{}[unsafe.Sizeof(basicInfo{})-unsafe.Sizeof(windows.PROCESS_BASIC_INFORMATION{})]
	_ = [1]struct{}{}[unsafe.Offsetof(basicInfo{}.PebBaseAddress)-unsafe.Offsetof(windows.PROCESS_BASIC_INFORMATION{}.PebBaseAddress)]
	_ = [1]struct{}{}[unsafe.Offsetof(userParams{}.EnvironmentSize)-unsafe.Offsetof(windows.RTL_USER_PROCESS_PARAMETERS{}.EnvironmentSize)]
	_ = [1]struct{}{}[unsafe.Offsetof(userParams{}.CommandLine)-unsafe.Offsetof(windows.RTL_USER_PROCESS_PARAMETERS{}.CommandLine)]
	_ = [1]struct{}{}[unsafe.Offsetof(userParams{}.CurDir)-unsafe.Offsetof(windows.RTL_USER_PROCESS_PARAMETERS{}.CurrentDirectory)]
)

var pebParams = unsafe.Offsetof(windows.PEB{}.ProcessParameters)

type params struct {
	h windows.Handle
	u userParams
}

func (p *params) read(addr uintptr, to unsafe.Pointer, n uintptr) bool {
	var got uintptr
	return windows.ReadProcessMemory(p.h, addr, (*byte)(to), n, &got) == nil && got == n
}

func (p *params) str(s unicodeString) string {
	if s.Buffer == 0 || s.Length == 0 {
		return ""
	}
	b := make([]uint16, s.Length/2)
	if !p.read(s.Buffer, unsafe.Pointer(&b[0]), uintptr(s.Length)) {
		return ""
	}
	return windows.UTF16ToString(b)
}

// readParams reads pid's RTL_USER_PROCESS_PARAMETERS; not for a 32-bit process, whose layout is
// another.
func readParams(pid int) (*params, bool) {
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_INFORMATION|windows.PROCESS_VM_READ, false, uint32(pid))
	if err != nil {
		return nil, false
	}
	p := &params{h: h}
	if !p.load() {
		p.close()
		return nil, false
	}
	return p, true
}

func (p *params) close() { windows.CloseHandle(p.h) }

// basicInfo is PROCESS_BASIC_INFORMATION, its PEB's address a uintptr.
type basicInfo struct {
	ExitStatus       uintptr
	PebBaseAddress   uintptr
	AffinityMask     uintptr
	BasePriority     uintptr
	UniqueProcessId  uintptr
	InheritedFromPID uintptr
}

func (p *params) load() bool {
	var wow bool
	if windows.IsWow64Process(p.h, &wow) != nil || wow {
		return false
	}
	var pbi basicInfo
	if windows.NtQueryInformationProcess(p.h, windows.ProcessBasicInformation, unsafe.Pointer(&pbi), uint32(unsafe.Sizeof(pbi)), nil) != nil {
		return false
	}
	peb := pbi.PebBaseAddress
	if peb == 0 {
		return false
	}
	var at uintptr
	if !p.read(peb+pebParams, unsafe.Pointer(&at), unsafe.Sizeof(at)) || at == 0 {
		return false
	}
	return p.read(at, unsafe.Pointer(&p.u), unsafe.Sizeof(p.u))
}
