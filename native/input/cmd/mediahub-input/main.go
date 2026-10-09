// mediahub-input is MediaHub's input helper. It reports controller Guide button presses and the Shift+Escape
// keyboard shortcut, and drives the
// virtual "MediaHub Remote" mouse and keyboard used by the phone companion.
//
// It talks JSON lines: commands on stdin, events on stdout. When started through a symlink named "reaper" it
// launches an app instead (see internal/reaper).
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"mediahub-input/internal/evdev"
	"mediahub-input/internal/reaper"
	"mediahub-input/internal/uinput"
)

const version = "0.1.0"

// Command is one line read from stdin.
//
// Example:
// {"cmd":"move","dx":4,"dy":-2}
// {"cmd":"key","key":"enter","state":"tap"}
type Command struct {
	Cmd    string `json:"cmd"`
	DX     int32  `json:"dx"`
	DY     int32  `json:"dy"`
	Button string `json:"button"`
	Key    string `json:"key"`
	State  string `json:"state"`
	Text   string `json:"text"`
}

var (
	outMu sync.Mutex
	out   = json.NewEncoder(os.Stdout)
)

func send(event map[string]any) {
	outMu.Lock()
	defer outMu.Unlock()
	out.Encode(event)
}

func main() {
	if len(os.Args) > 1 && (os.Args[1] == "version" || os.Args[1] == "--version") {
		fmt.Println(version)
		return
	}
	// Started through a symlink named "reaper": launch an app for gamescope instead
	if filepath.Base(os.Args[0]) == "reaper" {
		os.Exit(reaper.Run(os.Args[1:]))
	}

	watcher := evdev.NewWatcher()
	go watcher.Run()
	go func() {
		for {
			select {
			case ev := <-watcher.Events:
				if ev.Kind == evdev.QuickMenu {
					send(map[string]any{"event": "shortcut", "name": "quick-menu", "device": ev.Device})
					continue
				}
				state := "up"
				if ev.Down {
					state = "down"
				}
				send(map[string]any{"event": "guide", "state": state, "device": ev.Device})
			case names := <-watcher.Changed:
				send(map[string]any{"event": "controllers", "names": names})
			}
		}
	}()

	keyboard, kbErr := uinput.NewKeyboard()
	mouse, mouseErr := uinput.NewMouse()
	if kbErr != nil || mouseErr != nil {
		err := kbErr
		if err == nil {
			err = mouseErr
		}
		send(map[string]any{"event": "remote", "available": false, "message": err.Error()})
	} else {
		send(map[string]any{"event": "remote", "available": true})
	}
	defer func() {
		if keyboard != nil {
			keyboard.Close()
		}
		if mouse != nil {
			mouse.Close()
		}
	}()

	send(map[string]any{"event": "ready", "version": version})

	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		var cmd Command
		if err := json.Unmarshal(scanner.Bytes(), &cmd); err != nil {
			send(map[string]any{"event": "error", "message": "Invalid command: " + err.Error()})
			continue
		}
		if err := handle(cmd, keyboard, mouse); err != nil {
			send(map[string]any{"event": "error", "message": err.Error()})
		}
	}
	// stdin closed: the hub quit, so the deferred cleanup removes the virtual devices
}

func handle(cmd Command, keyboard, mouse *uinput.Device) error {
	switch cmd.Cmd {
	case "move", "scroll", "button":
		if mouse == nil {
			return fmt.Errorf("the virtual mouse is not available")
		}
	case "key", "text":
		if keyboard == nil {
			return fmt.Errorf("the virtual keyboard is not available")
		}
	}

	switch cmd.Cmd {
	case "move":
		return mouse.Move(cmd.DX, cmd.DY)
	case "scroll":
		return mouse.Scroll(cmd.DX, cmd.DY)
	case "button":
		code := map[string]uint16{"left": uinput.BtnLeft, "right": uinput.BtnRight, "middle": uinput.BtnMiddle}[cmd.Button]
		if code == 0 {
			return fmt.Errorf("unknown mouse button %q, expected left, right or middle", cmd.Button)
		}
		return press(mouse, code, cmd.State)
	case "key":
		code, ok := uinput.Keys[cmd.Key]
		if !ok {
			return fmt.Errorf("unknown key %q", cmd.Key)
		}
		return press(keyboard, code, cmd.State)
	case "text":
		skipped, err := keyboard.Type(cmd.Text)
		if len(skipped) > 0 {
			send(map[string]any{"event": "error", "message": fmt.Sprintf("Can't type %q on the US keyboard layout.", string(skipped))})
		}
		return err
	default:
		return fmt.Errorf("unknown command %q", cmd.Cmd)
	}
}

func press(dev *uinput.Device, code uint16, state string) error {
	switch state {
	case "down":
		return dev.Key(code, true)
	case "up":
		return dev.Key(code, false)
	case "", "tap", "click":
		return dev.Tap(code, false)
	default:
		return fmt.Errorf("unknown state %q, expected down, up or tap", state)
	}
}
