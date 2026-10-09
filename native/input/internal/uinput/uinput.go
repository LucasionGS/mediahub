// Package uinput creates the virtual "MediaHub Remote" mouse and keyboard that the phone companion drives.
package uinput

import (
	"encoding/binary"
	"fmt"
	"os"
	"syscall"
	"unsafe"
)

const (
	evSyn = 0x00
	evKey = 0x01
	evRel = 0x02

	relX      = 0x00
	relY      = 0x01
	relHWheel = 0x06
	relWheel  = 0x08

	BtnLeft   = 0x110
	BtnRight  = 0x111
	BtnMiddle = 0x112

	busVirtual = 0x06

	// ioctl numbers from linux/uinput.h
	uiDevCreate  = 0x5501
	uiDevDestroy = 0x5502
	uiDevSetup   = 0x405c5503 // _IOW('U', 3, struct uinput_setup), sizeof = 92
	uiSetEvBit   = 0x40045564
	uiSetKeyBit  = 0x40045565
	uiSetRelBit  = 0x40045566
)

// Device is one uinput virtual device.
type Device struct {
	f *os.File
}

func ioctl(f *os.File, req, arg uintptr) error {
	if _, _, errno := syscall.Syscall(syscall.SYS_IOCTL, f.Fd(), req, arg); errno != 0 {
		return errno
	}
	return nil
}

func create(name string, product uint16, setup func(f *os.File) error) (*Device, error) {
	f, err := os.OpenFile("/dev/uinput", os.O_WRONLY|syscall.O_NONBLOCK, 0)
	if err != nil {
		return nil, fmt.Errorf("cannot open /dev/uinput: %w. Run setup.sh to install the uinput udev rule, then log in again", err)
	}
	if err := setup(f); err != nil {
		f.Close()
		return nil, err
	}
	// struct uinput_setup { struct input_id { u16 bustype, vendor, product, version }; char name[80]; u32 ff_effects_max; }
	var s [92]byte
	binary.LittleEndian.PutUint16(s[0:], busVirtual)
	binary.LittleEndian.PutUint16(s[2:], 0x1209) // pid.codes open-source vendor id
	binary.LittleEndian.PutUint16(s[4:], product)
	binary.LittleEndian.PutUint16(s[6:], 1)
	copy(s[8:87], name)
	if err := ioctl(f, uiDevSetup, uintptr(unsafe.Pointer(&s[0]))); err != nil {
		f.Close()
		return nil, fmt.Errorf("UI_DEV_SETUP failed: %w", err)
	}
	if err := ioctl(f, uiDevCreate, 0); err != nil {
		f.Close()
		return nil, fmt.Errorf("UI_DEV_CREATE failed: %w", err)
	}
	return &Device{f: f}, nil
}

// keyboardKeys lists the keys the virtual keyboard advertises: the typing and navigation block plus media keys.
// SysRq and power/rfkill keys are left out, so the system never treats the remote as one of those devices.
func keyboardKeys() []uint16 {
	var codes []uint16
	for code := uint16(1); code <= KeyDelete; code++ {
		if code != 99 { // KEY_SYSRQ
			codes = append(codes, code)
		}
	}
	return append(codes, KeyMute, KeyVolumeDown, KeyVolumeUp, KeyNextSong, KeyPlayPause, KeyPrevSong, KeyStopCD)
}

// NewKeyboard creates a virtual keyboard that can send every key in Keys.
func NewKeyboard() (*Device, error) {
	return create("MediaHub Remote Keyboard", 0x4d48, func(f *os.File) error {
		if err := ioctl(f, uiSetEvBit, evKey); err != nil {
			return err
		}
		for _, code := range keyboardKeys() {
			if err := ioctl(f, uiSetKeyBit, uintptr(code)); err != nil {
				return err
			}
		}
		return nil
	})
}

// NewMouse creates a virtual mouse with three buttons and both scroll wheels.
func NewMouse() (*Device, error) {
	return create("MediaHub Remote Mouse", 0x4d49, func(f *os.File) error {
		for _, bit := range []uintptr{evKey, evRel} {
			if err := ioctl(f, uiSetEvBit, bit); err != nil {
				return err
			}
		}
		for _, btn := range []uintptr{BtnLeft, BtnRight, BtnMiddle} {
			if err := ioctl(f, uiSetKeyBit, btn); err != nil {
				return err
			}
		}
		for _, rel := range []uintptr{relX, relY, relWheel, relHWheel} {
			if err := ioctl(f, uiSetRelBit, rel); err != nil {
				return err
			}
		}
		return nil
	})
}

func (d *Device) emit(typ, code uint16, value int32) error {
	// struct input_event { struct timeval time; u16 type; u16 code; s32 value; }, time is filled in by the kernel
	var ev [24]byte
	binary.LittleEndian.PutUint16(ev[16:], typ)
	binary.LittleEndian.PutUint16(ev[18:], code)
	binary.LittleEndian.PutUint32(ev[20:], uint32(value))
	_, err := d.f.Write(ev[:])
	return err
}

func (d *Device) sync() error {
	return d.emit(evSyn, 0, 0)
}

// Key presses (down=true) or releases a key or mouse button.
func (d *Device) Key(code uint16, down bool) error {
	value := int32(0)
	if down {
		value = 1
	}
	if err := d.emit(evKey, code, value); err != nil {
		return err
	}
	return d.sync()
}

// Tap presses and releases a key, holding shift around it when asked.
func (d *Device) Tap(code uint16, shift bool) error {
	if shift {
		if err := d.Key(KeyLeftShift, true); err != nil {
			return err
		}
	}
	if err := d.Key(code, true); err != nil {
		return err
	}
	if err := d.Key(code, false); err != nil {
		return err
	}
	if shift {
		return d.Key(KeyLeftShift, false)
	}
	return nil
}

// Move moves the pointer by a relative amount.
func (d *Device) Move(dx, dy int32) error {
	if dx != 0 {
		if err := d.emit(evRel, relX, dx); err != nil {
			return err
		}
	}
	if dy != 0 {
		if err := d.emit(evRel, relY, dy); err != nil {
			return err
		}
	}
	return d.sync()
}

// Scroll scrolls by wheel detents. Positive dy scrolls up, positive dx scrolls right.
func (d *Device) Scroll(dx, dy int32) error {
	if dy != 0 {
		if err := d.emit(evRel, relWheel, dy); err != nil {
			return err
		}
	}
	if dx != 0 {
		if err := d.emit(evRel, relHWheel, dx); err != nil {
			return err
		}
	}
	return d.sync()
}

// Close destroys the virtual device.
func (d *Device) Close() {
	ioctl(d.f, uiDevDestroy, 0)
	d.f.Close()
}
