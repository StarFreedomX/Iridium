//go:build !darwin && !windows

package discover

// defaultProcs is the system's processes: /proc.
func defaultProcs() Procs { return ProcFS{} }
