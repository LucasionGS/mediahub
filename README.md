# MediaHub

A PS5-style home screen for the media server under your TV. It boots straight into gamescope, you drive it with a controller (or your phone), and every app opens fullscreen. Press the Guide button to hop back out, just like on a console.

![The MediaHub home screen](docs/screenshots/home.png)
<sup>The home screen. Whichever tile you're on paints the background with its colours.</sup>

## Key Features

- **Console-style home screen**: A row of big app tiles, a background that follows the focused app, menu sounds, and the familiar "A to start, Y for options" controls.
- **Apps and web apps**: Put installed apps on the home screen, or any website as its own fullscreen web app. YouTube gets its proper TV interface. Netflix and Disney+ open in Chromium, since they need DRM.
- **Instant switching**: Apps keep running in the background. Tap the Guide/PS button for the quick menu, where you can switch apps, close them, change the volume or turn things off. Hold it to jump straight home.
- **Your phone is the remote**: Scan the QR code under Settings → Phone remote (or open the hub's address) on your phone for a D-pad remote, a laptop-style trackpad, and your phone's own keyboard for typing on the TV. No more pecking out passwords with a controller.
- **Open links on the TV**: Paste a link on your phone and it opens on the TV. YouTube links go straight into the TV app, a bit like casting.
- **Manage everything from the couch**: Add apps from the TV with the controller, or from your phone, where you can also rename them, change their links and upload your own tile art and backgrounds.
- **Bluetooth controllers and headphones**: Settings → Bluetooth finds what's nearby in pairing mode. Pick it and you're done; keyboards get a code to type, and devices that show a code ask you to check it first. Paired devices reconnect by themselves, and controllers show their battery.
- **Display settings on the TV**: Pick the output, resolution, refresh rate, HDR and VRR under Settings → Display, using what your TV says it supports. New settings come with a "Keep these display settings?" countdown, so if the TV goes black you just wait 20 seconds and it switches back. Menus too small (or too big) from the couch? Settings → Interface → Menu size.
- **Wi-Fi from the sofa**: Settings → Network lists the Wi-Fi networks around you. Pick one and type the password with the on-screen keyboard (or a real keyboard, if you have one handy). Machines without Wi-Fi simply don't show it.
- **Updates itself**: When there's a new version, an Update button pops up next to settings. Press it and the hub downloads, builds and installs the update in the background, with a progress bar under Settings → Updates, then asks to restart. You can pick which branch it follows there too.
- **Set up in one go**: `setup.sh` installs everything, asks a few questions about your TV, and makes the machine boot into MediaHub. It works on Arch and Debian/Ubuntu.

![The quick menu over a running app](docs/screenshots/quick-menu.png)
<sup>The quick menu, opened over YouTube with a tap on the Guide button.</sup>

![Adding installed apps](docs/screenshots/add-apps.png)
<sup>Adding apps from the TV. Web apps have their own tab, and anything else can be added from your phone.</sup>

![The phone companion](docs/screenshots/companion.png)
<sup>The phone companion: remote, trackpad and the app manager.</sup>

## Setting up the TV box

You need a machine running **Arch Linux**, **Debian 13** or **Ubuntu 24.04+**, plugged into the TV, with a user account that can use `sudo`. Then, as that user:

```bash
git clone https://github.com/LucasionGS/mediahub.git
cd mediahub
./setup.sh
```

The script walks you through it and asks before every change it makes:

1. It installs gamescope, greetd, PipeWire and the build tools. On Debian it enables `trixie-backports` (contrib), where gamescope lives. Ubuntu 24.04 doesn't package gamescope at all, so there it builds gamescope from source into `/opt/gamescope` (along with the few newer libraries it needs, so your system's own copies stay untouched).
2. It builds MediaHub and installs it to `/opt/mediahub`, owned by your user so the hub can update itself later.
3. It sets up controller access and the phone remote's virtual mouse and keyboard.
4. It asks which TV output, resolution and refresh rate to use, and whether to turn on VRR and HDR. You can change these later under Settings → Display too.
5. It picks the phone companion's port and opens it in ufw or firewalld.
6. If the machine has Wi-Fi but no NetworkManager, it offers to install NetworkManager just for Wi-Fi. Your wired network setup isn't touched.
7. If the machine has a Bluetooth adapter, it offers to install and start BlueZ, plus PipeWire's Bluetooth support for headphones.
8. It makes the machine log into MediaHub automatically at boot, through greetd.
9. It lets the hub shut down, restart, sleep and change Wi-Fi without a password prompt.

Run `./setup.sh` again any time to change your answers; it remembers the previous ones. Other commands:

- `./setup.sh update` pulls the latest version, rebuilds and reinstalls. Usually you won't need it: the hub updates itself from Settings → Updates. Now and then an update changes system settings too, and the hub then asks you to run `./setup.sh` once.
- `./setup.sh uninstall` removes MediaHub and puts your old greetd config back.
- `--yes` answers yes to everything, for unattended runs.

### Pairing your phone

Open **Settings → Phone remote** on the TV. It shows an address like `http://192.168.1.20:8420` and a 6-digit code. Open the address on your phone and enter the code. That phone stays paired until you unpair it in the same place.

## Controls

| Controller | Keyboard | What it does |
|---|---|---|
| D-pad / left stick | Arrow keys | Move around |
| A / Cross | Enter | Start or select |
| B / Circle | Escape | Back |
| Y / Triangle | O | Options for the focused app |
| LB / RB | Q / E | Switch tabs |
| Guide / PS (tap) | Shift+Escape (works inside apps too), F1 | Open or close the quick menu |
| Guide / PS (hold) | | Go home |

In web apps the D-pad and A/B buttons act as arrow keys, Enter and Escape, which TV-style sites like YouTube expect. Turn that off per app on your phone if a site has its own controller support.

## Technical details

<details>
<summary>How it works, and how to work on it</summary>

**Stack:** Electron + React + Vite + SCSS (Electron Forge, Node 24), plus a small Go helper (`native/input`) for evdev and uinput, which Node can't drive itself.

**Gamescope integration:** gamescope runs in Steam mode (`-e --xwayland-count 2`). The hub runs on the first Xwayland (`:0`) as appid 769, and apps run on the second.
- Every app is launched under a `reaper SteamLaunch AppId=<ID> --` parent process, the way Steam does it, which every gamescope version uses to work out a window's appid. The reaper is the Go helper started through a symlink.
- Each app also gets its own systemd scope (`app-steam-app<ID>-<n>.scope`), which the hub uses to stop the whole app. Set `MEDIAHUB_NO_SCOPE=1` on machines without a systemd user session.
- Switching apps means writing `GAMESCOPECTRL_BASELAYER_APPID` on the root window, with 769 always last so gamescope falls back to the hub.
- The quick menu is a second window with `STEAM_OVERLAY`. It's shown and hidden through `STEAM_INPUT_FOCUS` and its opacity.

**Data:** everything lives in `~/.mediahub`, or `$MEDIAHUB_DATA` when set:
- `apps.json` and `settings.json`;
- `artwork/` for tile art and backgrounds;
- `profiles/`, one browser profile per web app;
- `logs/`, holding each app's output from its last run, `session.log` and `update.log`;
- `session.conf`, the settings `setup.sh` and Settings → Display write. The session script reads it again every time it starts gamescope. New display settings are on trial until kept: `session.conf.trial` marks them, `session.conf.previous` holds the old ones, and the session puts those back when a start never got kept.

**Install layout and updates:** `/opt/mediahub` belongs to the hub's user, so updating needs no root.
- Each build lives in `versions/<date>-<commit>/` with a `build-info.json`, and `current` points at the one in use. `/usr/local/bin/mediahub` and `mediahub-session` link through it. The previous version stays for going back.
- `chrome-sandbox` must be setuid root on Ubuntu 24.04+. `setup.sh` installs one, owned by root, at `/opt/mediahub/chrome-sandbox`, and every version links to it.
- The hub checks the branch from Settings → Updates (default `master`) every 6 hours with `git ls-remote`, and lists what's new through GitHub's API. Set `MEDIAHUB_UPDATE_REPOSITORY` to follow a fork.
- Updating clones that branch fresh into `~/.cache/mediahub/update` and runs its own `setup.sh install-update`, which builds it at low priority and switches `current` in one rename. The new version runs after the restart.
- When an update needs root (a new `chrome-sandbox`, or a higher `SETUP_REVISION` in `setup.sh` for changed packages or system rules), it stops and asks for `./setup.sh` instead. Bump `SETUP_REVISION` whenever a change needs that.

**Development:**

```bash
npm install
npm run build:input   # the Go helper (needs Go)
npm start             # standalone mode, in a normal window on your desktop
gamescope -e --xwayland-count 2 -W 1920 -H 1080 -w 1920 -h 1080 -- npm start   # inside a nested gamescope
```

Standalone mode skips all gamescope calls, so you can work on the UI on a normal desktop. `npm run typecheck` and `npm run lint` check the code.

**Testing setup.sh:** `docker/` has Arch and Debian images that run a full setup, a second idempotent run and an uninstall:

```bash
docker build -f docker/Dockerfile.debian -t mediahub-test-debian . && docker run --rm mediahub-test-debian
```

**Known limitations:**
- Controller input isn't exclusive yet, so the app under the quick menu also sees D-pad presses.
- The phone keyboard types with a US layout, so letters like æ, ø and å don't come through.
- The companion runs over plain HTTP on your LAN, so it can't be installed as a PWA or used as a share target.

</details>
