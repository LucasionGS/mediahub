package evdev

import (
	"encoding/binary"
	"io"
	"testing"
	"time"
)

// inputEvent encodes one struct input_event as the kernel writes it.
func inputEvent(typ, code uint16, value int32) []byte {
	ev := make([]byte, eventSize)
	binary.LittleEndian.PutUint16(ev[16:], typ)
	binary.LittleEndian.PutUint16(ev[18:], code)
	binary.LittleEndian.PutUint32(ev[20:], uint32(value))
	return ev
}

// feed runs the watcher's reader over the given events and returns what it reported.
func feed(t *testing.T, kind DeviceKind, events ...[]byte) []Event {
	t.Helper()
	w := NewWatcher()
	r, wr := io.Pipe()
	done := make(chan struct{})
	go func() {
		w.read(Device{Name: "test", Event: "event99", Kind: kind}, r)
		close(done)
	}()
	for _, ev := range events {
		wr.Write(ev)
	}
	wr.Close()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("reader didn't finish")
	}
	var got []Event
	for len(w.Events) > 0 {
		got = append(got, <-w.Events)
	}
	return got
}

func TestShiftEscapeOpensQuickMenu(t *testing.T) {
	got := feed(t, Keyboard,
		inputEvent(evKey, keyLeftShift, 1),
		inputEvent(evKey, keyEsc, 1),
		inputEvent(evKey, keyEsc, 2), // Key repeat must not fire again
		inputEvent(evKey, keyEsc, 0),
		inputEvent(evKey, keyLeftShift, 0),
	)
	if len(got) != 1 || got[0].Kind != QuickMenu {
		t.Fatalf("expected one quick-menu event, got %+v", got)
	}
}

func TestRightShiftWorksToo(t *testing.T) {
	got := feed(t, Keyboard, inputEvent(evKey, keyRightShift, 1), inputEvent(evKey, keyEsc, 1))
	if len(got) != 1 || got[0].Kind != QuickMenu {
		t.Fatalf("expected one quick-menu event, got %+v", got)
	}
}

func TestPlainEscapeIsIgnored(t *testing.T) {
	got := feed(t, Keyboard,
		inputEvent(evKey, keyLeftShift, 1),
		inputEvent(evKey, keyLeftShift, 0),
		inputEvent(evKey, keyEsc, 1),
		inputEvent(evKey, keyEsc, 0),
	)
	if len(got) != 0 {
		t.Fatalf("expected nothing, got %+v", got)
	}
}

func TestGuideButtonOnController(t *testing.T) {
	got := feed(t, Controller, inputEvent(evKey, btnMode, 1), inputEvent(evKey, btnMode, 0), inputEvent(evKey, keyEsc, 1))
	if len(got) != 2 || got[0].Kind != Guide || !got[0].Down || got[1].Down {
		t.Fatalf("expected guide down and up, got %+v", got)
	}
}
