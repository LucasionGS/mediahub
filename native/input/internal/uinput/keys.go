package uinput

// Key codes from linux/input-event-codes.h.
const (
	KeyEsc        = 1
	KeyBackspace  = 14
	KeyTab        = 15
	KeyEnter      = 28
	KeyLeftShift  = 42
	KeySpace      = 57
	KeyHome       = 102
	KeyUp         = 103
	KeyPageUp     = 104
	KeyLeft       = 105
	KeyRight      = 106
	KeyEnd        = 107
	KeyDown       = 108
	KeyPageDown   = 109
	KeyDelete     = 111
	KeyMute       = 113
	KeyVolumeDown = 114
	KeyVolumeUp   = 115
	KeyNextSong   = 163
	KeyPlayPause  = 164
	KeyPrevSong   = 165
	KeyStopCD     = 166
)

// Named keys the hub can send.
var Keys = map[string]uint16{
	"up":         KeyUp,
	"down":       KeyDown,
	"left":       KeyLeft,
	"right":      KeyRight,
	"enter":      KeyEnter,
	"escape":     KeyEsc,
	"backspace":  KeyBackspace,
	"tab":        KeyTab,
	"space":      KeySpace,
	"home":       KeyHome,
	"end":        KeyEnd,
	"pageup":     KeyPageUp,
	"pagedown":   KeyPageDown,
	"delete":     KeyDelete,
	"playpause":  KeyPlayPause,
	"next":       KeyNextSong,
	"previous":   KeyPrevSong,
	"stop":       KeyStopCD,
	"volumeup":   KeyVolumeUp,
	"volumedown": KeyVolumeDown,
	"mute":       KeyMute,
}

type charKey struct {
	code  uint16
	shift bool
}

// US layout, which is gamescope's default keymap.
var chars = map[rune]charKey{}

func init() {
	rows := []struct {
		plain, shifted string
		codes          []uint16
	}{
		{"1234567890-=", "!@#$%^&*()_+", []uint16{2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13}},
		{"qwertyuiop[]", "QWERTYUIOP{}", []uint16{16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27}},
		{"asdfghjkl;'`", "ASDFGHJKL:\"~", []uint16{30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41}},
		{"\\zxcvbnm,./", "|ZXCVBNM<>?", []uint16{43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53}},
	}
	for _, row := range rows {
		plain := []rune(row.plain)
		shifted := []rune(row.shifted)
		for i, code := range row.codes {
			chars[plain[i]] = charKey{code, false}
			chars[shifted[i]] = charKey{code, true}
		}
	}
	chars[' '] = charKey{KeySpace, false}
	chars['\n'] = charKey{KeyEnter, false}
	chars['\t'] = charKey{KeyTab, false}
}

// Type types text on the US layout. Characters that aren't on it are skipped and returned.
func (d *Device) Type(text string) (skipped []rune, err error) {
	for _, r := range text {
		key, ok := chars[r]
		if !ok {
			skipped = append(skipped, r)
			continue
		}
		if err := d.Tap(key.code, key.shift); err != nil {
			return skipped, err
		}
	}
	return skipped, nil
}
