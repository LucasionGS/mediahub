// Package reaper runs an app the way Steam does, so gamescope can tell which appid its windows belong to.
//
// Gamescope walks up the process tree of every window looking for a process named exactly "reaper" whose command
// line contains "SteamLaunch AppId=<id> --". Every gamescope version understands this, unlike the newer cgroup
// lookup. The reaper is also a child subreaper: apps that fork and exit (launcher scripts, Firefox) stay below it,
// so it lives exactly as long as the app does.
package reaper

import (
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"syscall"
)

const prSetChildSubreaper = 36

// Run starts the command after "--" in args and waits for it and everything it started.
// Returns the command's exit code.
//
// Example:
// reaper SteamLaunch AppId=10001 -- firefox --kiosk https://example.com
func Run(args []string) int {
	split := -1
	for i, arg := range args {
		if arg == "--" {
			split = i
			break
		}
	}
	if split == -1 || split == len(args)-1 {
		fmt.Fprintln(os.Stderr, "Usage: reaper SteamLaunch AppId=<id> -- <command> [args...]")
		return 2
	}

	if _, _, errno := syscall.RawSyscall(syscall.SYS_PRCTL, prSetChildSubreaper, 1, 0); errno != 0 {
		fmt.Fprintf(os.Stderr, "reaper: could not become a subreaper: %v\n", errno)
	}

	cmd := exec.Command(args[split+1], args[split+2:]...)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "reaper: could not start %s: %v\n", args[split+1], err)
		return 127
	}

	// Pass stop requests on to the app
	signals := make(chan os.Signal, 4)
	signal.Notify(signals, syscall.SIGTERM, syscall.SIGINT, syscall.SIGHUP)
	go func() {
		for sig := range signals {
			cmd.Process.Signal(sig)
		}
	}()

	// Reap the app and anything that was reparented to us, until nothing is left
	code := 0
	for {
		var status syscall.WaitStatus
		pid, err := syscall.Wait4(-1, &status, 0, nil)
		if err == syscall.EINTR {
			continue
		}
		if err != nil {
			break // ECHILD: no children left
		}
		if pid == cmd.Process.Pid {
			code = status.ExitStatus()
			if status.Signaled() {
				code = 128 + int(status.Signal())
			}
		}
	}
	return code
}
