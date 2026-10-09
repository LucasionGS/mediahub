// Package evdev watches game controllers for their Guide/PS button and keyboards for the quick menu shortcut
// (Shift+Escape). Both have to work while another app has focus, so they're read straight from /dev/input.
package evdev

import (
	"encoding/binary"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	evKey         = 0x01
	btnMode       = 0x13c // Guide / PS button on most pads
	keyHomepage   = 0xac  // Some Xbox pads over Bluetooth report Guide as this
	keyEsc        = 1
	keyLeftShift  = 42
	keyRightShift = 54
	eventSize     = 24 // struct input_event on 64-bit Linux
)

// EventKind says what an Event is about.
type EventKind string

const (
	// Guide is a press or release of a controller's Guide button.
	Guide EventKind = "guide"
	// QuickMenu is the Shift+Escape keyboard shortcut.
	QuickMenu EventKind = "quick-menu"
)

// Event is something the hub needs to know about.
type Event struct {
	Kind   EventKind
	Down   bool // Guide only; QuickMenu is sent once per press
	Device string
}

// DeviceKind is how a device is read.
type DeviceKind int

const (
	Controller DeviceKind = iota
	Keyboard
)

// Device is one input device from /proc/bus/input/devices.
type Device struct {
	Name    string
	Event   string // e.g. "event5"
	Handler []string
	Kind    DeviceKind
}

var eventRe = regexp.MustCompile(`event\d+`)

// ListDevices returns controllers (devices with a joystick handler) and keyboards (devices with a kbd handler).
// MediaHub's own virtual devices are left out.
func ListDevices() ([]Device, error) {
	data, err := os.ReadFile("/proc/bus/input/devices")
	if err != nil {
		return nil, err
	}
	var devices []Device
	for _, block := range strings.Split(string(data), "\n\n") {
		var dev Device
		for _, line := range strings.Split(block, "\n") {
			// Example:
			// N: Name="Xbox Wireless Controller"
			// H: Handlers=event21 js0
			if strings.HasPrefix(line, "N: Name=") {
				dev.Name = strings.Trim(strings.TrimPrefix(line, "N: Name="), `"`)
			} else if strings.HasPrefix(line, "H: Handlers=") {
				dev.Handler = strings.Fields(strings.TrimPrefix(line, "H: Handlers="))
				dev.Event = eventRe.FindString(line)
			}
		}
		if dev.Event == "" || strings.HasPrefix(dev.Name, "MediaHub Remote") {
			continue
		}
		isController, isKeyboard := false, false
		for _, h := range dev.Handler {
			if strings.HasPrefix(h, "js") {
				isController = true
			} else if h == "kbd" {
				isKeyboard = true
			}
		}
		if isController {
			dev.Kind = Controller
			devices = append(devices, dev)
		} else if isKeyboard {
			dev.Kind = Keyboard
			devices = append(devices, dev)
		}
	}
	return devices, nil
}

// Watcher reads every connected controller and keyboard. It rescans for hotplugged devices every two seconds.
type Watcher struct {
	Events  chan Event
	Changed chan []string // Names of connected controllers, sent when the set changes

	mu          sync.Mutex
	open        map[string]*os.File
	controllers map[string]string // event node -> name
}

// NewWatcher creates a watcher. Call Run to start it.
func NewWatcher() *Watcher {
	return &Watcher{
		Events:      make(chan Event, 16),
		Changed:     make(chan []string, 4),
		open:        map[string]*os.File{},
		controllers: map[string]string{},
	}
}

// Run scans for devices forever.
func (w *Watcher) Run() {
	for {
		w.scan()
		time.Sleep(2 * time.Second)
	}
}

func (w *Watcher) scan() {
	devices, err := ListDevices()
	if err != nil {
		return
	}
	changed := false
	w.mu.Lock()
	for _, dev := range devices {
		if _, ok := w.open[dev.Event]; ok {
			continue
		}
		f, err := os.Open(filepath.Join("/dev/input", dev.Event))
		if err != nil {
			continue // No permission yet (udev may still be applying ACLs), retry next scan
		}
		w.open[dev.Event] = f
		if dev.Kind == Controller {
			w.controllers[dev.Event] = dev.Name
			changed = true
		}
		go w.read(dev, f)
	}
	w.mu.Unlock()
	if changed {
		w.sendChanged()
	}
}

func (w *Watcher) read(dev Device, f io.ReadCloser) {
	buf := make([]byte, eventSize*32)
	shift := map[uint16]bool{}
	for {
		n, err := f.Read(buf)
		if err != nil {
			break
		}
		for i := 0; i+eventSize <= n; i += eventSize {
			typ := binary.LittleEndian.Uint16(buf[i+16:])
			code := binary.LittleEndian.Uint16(buf[i+18:])
			value := int32(binary.LittleEndian.Uint32(buf[i+20:]))
			if typ != evKey || value == 2 {
				continue // value 2 = key repeat
			}
			if dev.Kind == Controller {
				if code == btnMode || code == keyHomepage {
					w.Events <- Event{Kind: Guide, Down: value == 1, Device: dev.Name}
				}
				continue
			}
			switch code {
			case keyLeftShift, keyRightShift:
				shift[code] = value == 1
			case keyEsc:
				if value == 1 && (shift[keyLeftShift] || shift[keyRightShift]) {
					w.Events <- Event{Kind: QuickMenu, Down: true, Device: dev.Name}
				}
			}
		}
	}
	f.Close()
	w.mu.Lock()
	delete(w.open, dev.Event)
	_, wasController := w.controllers[dev.Event]
	delete(w.controllers, dev.Event)
	w.mu.Unlock()
	if wasController {
		w.sendChanged()
	}
}

func (w *Watcher) sendChanged() {
	w.mu.Lock()
	names := make([]string, 0, len(w.controllers))
	for _, name := range w.controllers {
		names = append(names, name)
	}
	w.mu.Unlock()
	select {
	case w.Changed <- names:
	default:
	}
}
