#!/bin/bash

########################################
# MediaHub setup developed by Lucasion #
########################################

# Deploys MediaHub on a media server: installs dependencies, builds and installs the hub, and sets the machine up
# to boot straight into it on the TV. Run it from a clone of the repository as the user the hub should run as:
#   git clone <repo> mediahub && cd mediahub && ./setup.sh

MEDIAHUB_VERSION="0.1.0"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="/opt/mediahub"
BIN_LINK="/usr/local/bin/mediahub"
SESSION_LINK="/usr/local/bin/mediahub-session"
DATA_DIR="$HOME/.mediahub"
SESSION_CONF="$DATA_DIR/session.conf"
UDEV_RULE="/etc/udev/rules.d/99-mediahub-uinput.rules"
MODULES_CONF="/etc/modules-load.d/mediahub.conf"
POLKIT_RULE="/etc/polkit-1/rules.d/50-mediahub.rules"
GREETD_CONF="/etc/greetd/config.toml"
NVM_VERSION="v0.40.3"
OTHER_DISPLAY_MANAGERS=(gdm sddm lightdm lxdm ly)
GAMESCOPE_VERSION="3.16.31" # Built from source where the distro doesn't package gamescope (Ubuntu 24.04)
GAMESCOPE_DIR="/opt/gamescope"
GAMESCOPE_BUILD_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/mediahub/gamescope-build"

ASSUME_YES="no"
CHANGES=()

#region Output helpers

printf_green() {
  echo -e "\033[0;32m$1\033[0m"
}

printf_red() {
  echo -e "\033[0;31m$1\033[0m"
}

printf_bold() {
  echo -e "\033[1m$1\033[0m"
}

# Print a step heading
step() {
  echo
  printf_bold "==> $1"
}

# Remember a change for the summary at the end
changed() {
  CHANGES+=("$1")
  printf_green "    $1"
}

# Print an error and exit with code 1
fail() {
  printf_red "Error: $1" >&2
  exit 1
}

# Ask a yes/no question. Defaults to no and only accepts "y". --yes answers yes.
confirm() {
  local QUESTION="$1"
  if [[ "$ASSUME_YES" == "yes" ]]; then
    echo "$QUESTION [y/N]: y"
    return 0
  fi
  local ANSWER
  read -r -p "$QUESTION [y/N]: " ANSWER
  [[ "$ANSWER" == "y" || "$ANSWER" == "Y" ]]
}

# Ask for a value with a default. The answer is stored in REPLY.
ask() {
  local QUESTION="$1"
  local DEFAULT="$2"
  if [[ "$ASSUME_YES" == "yes" ]]; then
    echo "$QUESTION [$DEFAULT]: $DEFAULT"
    REPLY="$DEFAULT"
    return
  fi
  read -r -p "$QUESTION [$DEFAULT]: " REPLY
  REPLY="${REPLY:-$DEFAULT}"
}

#endregion

#region System detection

# Print "arch", "debian" or "unknown"
detect_os() {
  if [[ -f "/etc/arch-release" ]]; then
    echo "arch"
  elif [[ -f "/etc/debian_version" ]]; then
    echo "debian"
  else
    echo "unknown"
  fi
}

# Print the platform string used for builds, like linux_x64
detect_platform() {
  case "$(uname -m)" in
    x86_64) echo "linux_x64" ;;
    aarch64 | arm64) echo "linux_arm64" ;;
    *) echo "unknown" ;;
  esac
}

# Print the vendors of the GPUs in this machine (intel, amd, nvidia), one per line
detect_gpu_vendors() {
  local VENDOR
  for VENDOR in /sys/class/drm/card*/device/vendor; do
    [[ -r "$VENDOR" ]] || continue
    case "$(cat "$VENDOR")" in
      0x8086) echo "intel" ;;
      0x1002) echo "amd" ;;
      0x10de) echo "nvidia" ;;
    esac
  done | sort -u
}

# Print the Arch Vulkan driver packages gamescope needs for this machine's GPUs. Arch's gamescope doesn't pull one in.
arch_vulkan_drivers() {
  local VENDOR
  for VENDOR in $(detect_gpu_vendors); do
    case "$VENDOR" in
      intel) echo "vulkan-intel" ;;
      amd) echo "vulkan-radeon" ;;
      nvidia) [[ -d /sys/module/nvidia ]] || echo "vulkan-nouveau" ;; # The proprietary driver brings its own (nvidia-utils)
    esac
  done
}

# Whether systemd is running as init (it isn't inside most containers)
has_systemd() {
  [[ -d /run/systemd/system ]]
}

# Check that we can run at all
setup_check_system() {
  step "Checking the system"
  OS="$(detect_os)"
  PLATFORM="$(detect_platform)"
  if [[ "$OS" == "unknown" ]]; then
    fail "This system isn't supported. setup.sh works on Arch Linux and Debian/Ubuntu (it looks for /etc/arch-release or /etc/debian_version)."
  fi
  if [[ "$PLATFORM" == "unknown" ]]; then
    fail "Unsupported architecture: $(uname -m). MediaHub builds for x86_64 and arm64."
  fi
  if [[ "$EUID" -eq 0 ]]; then
    fail "Don't run setup.sh as root. Run it as the user MediaHub should run as; it uses sudo when it needs to."
  fi
  if ! command -v sudo > /dev/null; then
    fail "sudo is required. Install it and add $(whoami) to the sudoers, then run setup.sh again."
  fi
  echo "    System:   $OS ($PLATFORM)"
  echo "    Hub user: $(whoami)"
  echo "    Repo:     $REPO_DIR"
  has_systemd || printf_red "    systemd isn't running (container?). Steps that need it will be skipped."
  sudo -v || fail "sudo failed. Check that $(whoami) can use sudo."
}

#endregion

#region Settings

# Load answers from a previous run, so they become the defaults
setup_load_previous() {
  MEDIAHUB_OUTPUT=""
  MEDIAHUB_WIDTH=""
  MEDIAHUB_HEIGHT=""
  MEDIAHUB_REFRESH="60"
  MEDIAHUB_VRR="no"
  MEDIAHUB_HDR="no"
  MEDIAHUB_COMPANION_PORT="8420"
  MEDIAHUB_GAMESCOPE_ARGS=""
  if [[ -f "$SESSION_CONF" ]]; then
    # shellcheck source=/dev/null
    source "$SESSION_CONF"
    echo "    Using answers from the previous run as defaults ($SESSION_CONF)."
  fi
}

# Write the session config that mediahub-session reads
setup_write_session_conf() {
  mkdir -p "$DATA_DIR"
  cat > "$SESSION_CONF" << EOF
# MediaHub session settings, written by setup.sh. Run setup.sh again to change them.

##### Display #####
MEDIAHUB_OUTPUT="$MEDIAHUB_OUTPUT" # Connector like HDMI-A-1, empty = let gamescope pick
MEDIAHUB_WIDTH="$MEDIAHUB_WIDTH"
MEDIAHUB_HEIGHT="$MEDIAHUB_HEIGHT"
MEDIAHUB_REFRESH="$MEDIAHUB_REFRESH"
MEDIAHUB_VRR="$MEDIAHUB_VRR" # yes = adaptive sync
MEDIAHUB_HDR="$MEDIAHUB_HDR" # yes = HDR output

##### Hub #####
MEDIAHUB_COMPANION_PORT="$MEDIAHUB_COMPANION_PORT" # Phone companion port

##### Advanced #####
MEDIAHUB_GAMESCOPE_ARGS="$MEDIAHUB_GAMESCOPE_ARGS" # Extra gamescope flags
EOF
  changed "Saved session settings to $SESSION_CONF"
}

#endregion

#region Dependencies

# Print the first apt package name from the arguments that exists (handles renames like libasound2 -> libasound2t64)
apt_pick() {
  local NAME
  for NAME in "$@"; do
    if apt_has_candidate "$NAME"; then
      echo "$NAME"
      return 0
    fi
  done
  return 1
}

# Whether apt can install a package (it may be known but have no installation candidate)
apt_has_candidate() {
  apt-cache policy "$1" 2> /dev/null | grep -q "Candidate: [0-9]"
}

# Make gamescope installable: it's in backports/contrib on Debian 13 and in universe on Ubuntu 25.10+.
# Releases that don't package it (Ubuntu 24.04) build it from source instead, which sets GAMESCOPE_FROM_SOURCE.
setup_deps_debian_gamescope() {
  GAMESCOPE_FROM_SOURCE="no"
  apt_has_candidate gamescope && return
  # Built from source on an earlier run
  if [[ -n "$(gamescope_source_version)" ]]; then
    GAMESCOPE_FROM_SOURCE="yes"
    return
  fi
  local ID CODENAME
  # shellcheck source=/dev/null
  ID="$(. /etc/os-release && echo "$ID")"
  # shellcheck source=/dev/null
  CODENAME="$(. /etc/os-release && echo "$VERSION_CODENAME")"

  if [[ "$ID" == "ubuntu" ]]; then
    if ! apt-cache policy | grep -q "c=universe"; then
      confirm "gamescope is in Ubuntu's universe repository. Enable universe?" || fail "gamescope is required. Enable universe and run setup.sh again."
      sudo apt-get install -y software-properties-common > /dev/null && sudo add-apt-repository -y universe > /dev/null
    fi
  else
    local KEYRING="/usr/share/keyrings/debian-archive-keyring.pgp"
    [[ -f "$KEYRING" ]] || KEYRING="/usr/share/keyrings/debian-archive-keyring.gpg"
    confirm "gamescope is in Debian's $CODENAME-backports (contrib). Enable it?" || fail "gamescope is required. Enable $CODENAME-backports contrib and run setup.sh again."
    sudo tee /etc/apt/sources.list.d/mediahub-backports.sources > /dev/null << EOF
# Added by MediaHub's setup.sh for gamescope
Types: deb
URIs: http://deb.debian.org/debian
Suites: $CODENAME-backports
Components: main contrib
Signed-By: $KEYRING
EOF
    changed "Enabled $CODENAME-backports (main, contrib) for gamescope"
  fi
  sudo apt-get update || fail "apt-get update failed."
  apt_has_candidate gamescope && return

  echo "    gamescope isn't packaged for this release (Ubuntu only packages it from 25.10)."
  confirm "Build gamescope $GAMESCOPE_VERSION from source into $GAMESCOPE_DIR? This takes a few minutes." \
    || fail "gamescope is required. Upgrade to Debian 13 or Ubuntu 25.10+, or let setup.sh build it from source."
  GAMESCOPE_FROM_SOURCE="yes"
}

# Print the version of the gamescope built from source, or nothing when there isn't one
gamescope_source_version() {
  [[ -x "$GAMESCOPE_DIR/bin/gamescope" ]] || return 0
  "$GAMESCOPE_DIR/bin/gamescope" --version 2>&1 | grep -oE "version [0-9.]+" | cut -d" " -f2
}

# Clone a meson project at a tag, then build and install it into GAMESCOPE_DIR. Extra arguments go to meson setup.
gamescope_meson_build() {
  local NAME="$1"
  local URL="$2"
  local TAG="$3"
  shift 3
  local SRC="$GAMESCOPE_BUILD_DIR/$NAME"
  local LOG="$GAMESCOPE_BUILD_DIR/$NAME.log"
  echo "    Building $NAME $TAG..."
  rm -rf "$SRC"
  if ! { git clone -q --depth 1 --branch "$TAG" --recurse-submodules --shallow-submodules "$URL" "$SRC" \
    && meson setup "$SRC/build" "$SRC" --prefix="$GAMESCOPE_DIR" --libdir=lib --buildtype=release "$@" \
    && ninja -C "$SRC/build" \
    && sudo ninja -C "$SRC/build" install; } > "$LOG" 2>&1; then
    tail -n 20 "$LOG" >&2
    fail "Building $NAME $TAG failed. The full log is in $LOG."
  fi
}

# Build gamescope from source into GAMESCOPE_DIR, and link its binaries and Vulkan layer into /usr/local.
# Its bundled wlroots needs newer wayland, wayland-protocols, libdrm, xkbcommon and pixman than Ubuntu 24.04 has, so
# those are built into GAMESCOPE_DIR too and found through the binaries' rpath. The system's copies stay untouched.
setup_gamescope_build() {
  local INSTALLED
  INSTALLED="$(gamescope_source_version)"
  if [[ "$INSTALLED" == "$GAMESCOPE_VERSION" ]]; then
    echo "    gamescope $GAMESCOPE_VERSION is already built in $GAMESCOPE_DIR."
    return
  fi

  step "Building gamescope $GAMESCOPE_VERSION from source"
  local BUILD_DEPS=(meson ninja-build cmake pkg-config g++ glslang-tools bison hwdata xwayland
    libffi-dev libexpat1-dev libxml2-dev libpciaccess-dev libudev-dev libinput-dev libseat-dev libcap-dev libgbm-dev
    libegl-dev libgles-dev libvulkan-dev libsdl2-dev libavif-dev libdecor-0-dev libluajit-5.1-dev libeis-dev
    libpipewire-0.3-dev libstb-dev libglm-dev libx11-dev libx11-xcb-dev libxdamage-dev libxcomposite-dev
    libxcursor-dev libxrender-dev libxext-dev libxfixes-dev libxxf86vm-dev libxtst-dev libxres-dev libxmu-dev libxi-dev
    libxcb-composite0-dev libxcb-icccm4-dev libxcb-res0-dev libxcb-xfixes0-dev libxcb-ewmh-dev libxcb-render0-dev
    libxcb-xinput-dev libxcb-dri3-dev libxcb-present-dev libxcb-shm0-dev libxcb-xkb-dev)
  echo "    Installing the build dependencies..."
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${BUILD_DEPS[@]}" > /dev/null \
    || fail "apt-get failed to install gamescope's build dependencies."
  # The bundled wlroots needs meson 1.3+, which Debian 12 doesn't have
  local MESON
  MESON="$(meson --version)"
  if [[ "$(printf '%s\n' "1.3.0" "$MESON" | sort -V | head -n1)" != "1.3.0" ]]; then
    fail "Building gamescope needs meson 1.3 or newer, but this system has $MESON. Upgrade to Ubuntu 24.04 or Debian 13."
  fi

  # Start clean, so files from an older version don't linger
  sudo rm -rf "$GAMESCOPE_DIR"
  mkdir -p "$GAMESCOPE_BUILD_DIR"
  local LIB_DIR="$GAMESCOPE_DIR/lib"
  local -x PKG_CONFIG_PATH="$LIB_DIR/pkgconfig:$GAMESCOPE_DIR/share/pkgconfig"
  local -x PATH="$GAMESCOPE_DIR/bin:$PATH" # The newer wayland-scanner

  gamescope_meson_build wayland https://gitlab.freedesktop.org/wayland/wayland.git 1.24.0 \
    -Ddocumentation=false -Dtests=false -Ddtd_validation=false
  gamescope_meson_build wayland-protocols https://gitlab.freedesktop.org/wayland/wayland-protocols.git 1.47 -Dtests=false
  gamescope_meson_build libdrm https://gitlab.freedesktop.org/mesa/drm.git libdrm-2.4.129 \
    -Dtests=false -Dman-pages=disabled -Dvalgrind=disabled -Dcairo-tests=disabled
  gamescope_meson_build xkbcommon https://github.com/xkbcommon/libxkbcommon.git xkbcommon-1.8.0 \
    -Denable-docs=false -Denable-tools=false -Denable-wayland=false -Denable-x11=true \
    -Dxkb-config-root=/usr/share/X11/xkb -Dx-locale-root=/usr/share/X11/locale
  gamescope_meson_build pixman https://gitlab.freedesktop.org/pixman/pixman.git pixman-0.46.4 \
    -Dtests=disabled -Ddemos=disabled -Dgtk=disabled -Dlibpng=disabled
  gamescope_meson_build gamescope https://github.com/ValveSoftware/gamescope.git "$GAMESCOPE_VERSION" \
    -Dbenchmark=disabled -Denable_tests=false -Denable_openvr_support=false -Dpipewire=enabled \
    --force-fallback-for=wlroots,libliftoff,libdisplay-info,vkroots \
    "-Dc_link_args=-Wl,-rpath,$LIB_DIR" "-Dcpp_link_args=-Wl,-rpath,$LIB_DIR"

  # gamescope starts gamescopereaper through PATH, and the Vulkan loader doesn't look in /opt for layers
  local BIN
  for BIN in "$GAMESCOPE_DIR"/bin/gamescope*; do
    sudo ln -sfn "$BIN" /usr/local/bin/
  done
  sudo mkdir -p /usr/local/share/vulkan/implicit_layer.d
  sudo ln -sfn "$GAMESCOPE_DIR"/share/vulkan/implicit_layer.d/*.json /usr/local/share/vulkan/implicit_layer.d/

  [[ "$(gamescope_source_version)" == "$GAMESCOPE_VERSION" ]] || fail "gamescope was built but doesn't run. Check the logs in $GAMESCOPE_BUILD_DIR."
  rm -rf "$GAMESCOPE_BUILD_DIR"
  changed "Built gamescope $GAMESCOPE_VERSION from source into $GAMESCOPE_DIR"
}

# Install system packages
setup_deps_install() {
  step "Installing dependencies"
  if [[ "$OS" == "arch" ]]; then
    local PACKAGES=(gamescope greetd pipewire wireplumber pipewire-pulse git make curl go xorg-xprop libinput nss gtk3 alsa-lib noto-fonts)
    local DRIVERS
    mapfile -t DRIVERS < <(arch_vulkan_drivers)
    PACKAGES+=("${DRIVERS[@]}")
    [[ ${#DRIVERS[@]} -eq 0 && ! -d /sys/module/nvidia ]] && printf_red "    No GPU detected, so no Vulkan driver will be installed. gamescope needs one (vulkan-intel, vulkan-radeon or vulkan-nouveau)."
    echo "    Packages: ${PACKAGES[*]}"
    confirm "Install these with pacman?" || fail "Dependencies are required. Install them yourself and run setup.sh again."
    sudo pacman -S --needed --noconfirm "${PACKAGES[@]}" || fail "pacman failed to install the dependencies."
  else
    sudo apt-get update || fail "apt-get update failed."
    setup_deps_debian_gamescope
    # mesa-vulkan-drivers is gamescope's Vulkan driver for Intel, AMD and nouveau. Nothing depends on it, so it's easy to miss.
    local PACKAGES=(greetd pipewire wireplumber pipewire-pulse git make golang-go x11-utils libinput-tools curl ca-certificates fonts-noto-core libnss3 libgbm1 dbus-user-session mesa-vulkan-drivers)
    [[ "$GAMESCOPE_FROM_SOURCE" == "yes" ]] || PACKAGES=(gamescope "${PACKAGES[@]}")
    local NAME
    for NAME in "libasound2t64 libasound2" "libgtk-3-0t64 libgtk-3-0" "libatk-bridge2.0-0t64 libatk-bridge2.0-0"; do
      # shellcheck disable=SC2086
      PACKAGES+=("$(apt_pick $NAME)")
    done
    echo "    Packages: ${PACKAGES[*]}"
    confirm "Install these with apt?" || fail "Dependencies are required. Install them yourself and run setup.sh again."
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y "${PACKAGES[@]}" || fail "apt-get failed to install the dependencies."
  fi
  changed "Installed system packages"
  [[ "$GAMESCOPE_FROM_SOURCE" == "yes" ]] && setup_gamescope_build

  if confirm "Also install Chromium, for web apps that need DRM (Netflix, Disney+)?"; then
    if [[ "$OS" == "arch" ]]; then
      sudo pacman -S --needed --noconfirm chromium || printf_red "    Chromium failed to install. You can install it later."
    else
      sudo DEBIAN_FRONTEND=noninteractive apt-get install -y chromium || printf_red "    Chromium failed to install. You can install it later."
    fi
    changed "Installed Chromium"
  fi
}

# Make sure the Node major version from .nvmrc is used. Newer majors aren't safe: Electron Forge's packager
# silently stops halfway on Node 26.
setup_deps_node() {
  step "Checking Node.js"
  local WANTED
  WANTED="$(tr -d 'v \n' < "$REPO_DIR/.nvmrc")"
  local WANTED_MAJOR="${WANTED%%.*}"

  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # shellcheck source=/dev/null
  [[ -s "$NVM_DIR/nvm.sh" ]] && source "$NVM_DIR/nvm.sh"
  if command -v nvm > /dev/null; then
    nvm use "$WANTED_MAJOR" > /dev/null 2>&1
  fi

  if command -v node > /dev/null && [[ "$(node --version | tr -d 'v' | cut -d. -f1)" == "$WANTED_MAJOR" ]]; then
    echo "    Using Node $(node --version)."
    return
  fi

  local FOUND="none"
  command -v node > /dev/null && FOUND="$(node --version)"
  if ! command -v nvm > /dev/null; then
    confirm "MediaHub builds with Node $WANTED_MAJOR (found: $FOUND). Install nvm $NVM_VERSION (to ~/.nvm) and Node $WANTED?" || fail "Install Node $WANTED_MAJOR and run setup.sh again."
    curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/$NVM_VERSION/install.sh" | PROFILE=/dev/null bash || fail "Installing nvm failed."
    # shellcheck source=/dev/null
    source "$NVM_DIR/nvm.sh"
  fi
  nvm install "$WANTED" || fail "nvm failed to install Node $WANTED."
  nvm use "$WANTED" > /dev/null
  changed "Installed Node $WANTED with nvm"
}

#endregion

#region Build and install

# Build the hub and the input helper, and install them to /opt/mediahub
setup_build_install() {
  step "Building MediaHub"
  cd "$REPO_DIR" || fail "Can't open $REPO_DIR."
  npm ci || fail "npm ci failed. See the output above."
  make -C native/input build || fail "Building the input helper failed. Check that make and Go are installed."
  local ARCH="x64"
  [[ "$PLATFORM" == "linux_arm64" ]] && ARCH="arm64"
  local BUILD="$REPO_DIR/out/MediaHub-linux-$ARCH"

  # Packaging downloads Electron from GitHub, which occasionally answers with a server error, so retry a couple of times
  local ATTEMPT
  for ATTEMPT in 1 2 3; do
    npm run package && [[ -x "$BUILD/mediahub" ]] && break
    (( ATTEMPT == 3 )) && fail "Packaging MediaHub failed: no build at $BUILD. See the output above."
    printf_red "    Packaging failed (attempt $ATTEMPT of 3). Trying again in 10 seconds..."
    sleep 10
  done

  step "Installing to $INSTALL_DIR"
  sudo rm -rf "$INSTALL_DIR"
  sudo cp -r "$BUILD" "$INSTALL_DIR" || fail "Copying the build to $INSTALL_DIR failed."
  # The packager creates its output readable by the builder only; the install must be usable by everyone
  sudo chown -R root:root "$INSTALL_DIR"
  sudo chmod -R a+rX,go-w "$INSTALL_DIR"
  # Chromium's sandbox helper must be setuid root on systems that restrict user namespaces (Ubuntu 24.04+)
  sudo chown root:root "$INSTALL_DIR/chrome-sandbox"
  sudo chmod 4755 "$INSTALL_DIR/chrome-sandbox"
  sudo ln -sf "$INSTALL_DIR/mediahub" "$BIN_LINK"
  sudo install -m 755 "$REPO_DIR/session/mediahub-session" "$SESSION_LINK"
  changed "Installed MediaHub $MEDIAHUB_VERSION to $INSTALL_DIR"
}

#endregion

#region Input

# Controller access and the virtual mouse/keyboard for the phone remote
setup_input_permissions() {
  step "Setting up controller and phone remote access"
  if ! id -nG "$(whoami)" | tr ' ' '\n' | grep -qx input; then
    sudo usermod -aG input "$(whoami)" || fail "Adding $(whoami) to the input group failed."
    changed "Added $(whoami) to the input group (takes effect after logging in again)"
  fi
  sudo install -m 644 "$REPO_DIR/session/99-mediahub-uinput.rules" "$UDEV_RULE"
  echo "uinput" | sudo tee "$MODULES_CONF" > /dev/null
  sudo modprobe uinput 2> /dev/null
  if command -v udevadm > /dev/null && has_systemd; then
    sudo udevadm control --reload-rules
    sudo udevadm trigger --subsystem-match=misc --sysname-match=uinput 2> /dev/null
  fi
  changed "Installed the uinput udev rule and module loading"
}

#endregion

#region Display

# Print connected display connectors, like "HDMI-A-1"
setup_display_list_outputs() {
  local STATUS
  for STATUS in /sys/class/drm/card*-*/status; do
    [[ -f "$STATUS" ]] || continue
    if [[ "$(cat "$STATUS")" == "connected" ]]; then
      local DIR="${STATUS%/status}"
      local NAME="${DIR##*/}"
      echo "${NAME#card*-}"
    fi
  done
}

# Print the sysfs folder of a display connector, like /sys/class/drm/card1-HDMI-A-1
setup_display_dir() {
  local DIR
  for DIR in /sys/class/drm/card*-"$1"; do
    [[ -d "$DIR" ]] && echo "$DIR" && return 0
  done
  return 1
}

# Ask which display to use and how
setup_display_configure() {
  step "Configuring the display"
  local OUTPUTS
  mapfile -t OUTPUTS < <(setup_display_list_outputs)

  local DEFAULT_OUTPUT="$MEDIAHUB_OUTPUT"
  if (( ${#OUTPUTS[@]} > 0 )); then
    echo "    Connected displays:"
    local OUTPUT
    for OUTPUT in "${OUTPUTS[@]}"; do
      local MODE
      MODE="$(head -1 "$(setup_display_dir "$OUTPUT")/modes" 2> /dev/null)"
      echo "      $OUTPUT ${MODE:+(best mode $MODE)}"
      # Prefer the first HDMI port, since that's usually the TV
      [[ -z "$DEFAULT_OUTPUT" && "$OUTPUT" == HDMI* ]] && DEFAULT_OUTPUT="$OUTPUT"
    done
    [[ -z "$DEFAULT_OUTPUT" ]] && DEFAULT_OUTPUT="${OUTPUTS[0]}"
  else
    echo "    No connected displays found. Leave the output empty to let gamescope pick one at boot."
  fi
  ask "Display output (empty = automatic)" "$DEFAULT_OUTPUT"
  MEDIAHUB_OUTPUT="$REPLY"

  # Default resolution: the output's best mode, or the previous answer
  local DEFAULT_RES="${MEDIAHUB_WIDTH:+${MEDIAHUB_WIDTH}x$MEDIAHUB_HEIGHT}"
  if [[ -z "$DEFAULT_RES" && -n "$MEDIAHUB_OUTPUT" ]]; then
    DEFAULT_RES="$(head -1 "$(setup_display_dir "$MEDIAHUB_OUTPUT")/modes" 2> /dev/null)"
  fi
  while true; do
    ask "Resolution, like 1920x1080 or 3840x2160 (empty = the display's default)" "${DEFAULT_RES:-}"
    if [[ -z "$REPLY" ]]; then
      MEDIAHUB_WIDTH=""
      MEDIAHUB_HEIGHT=""
      break
    elif [[ "$REPLY" =~ ^([0-9]+)x([0-9]+)$ ]]; then
      MEDIAHUB_WIDTH="${BASH_REMATCH[1]}"
      MEDIAHUB_HEIGHT="${BASH_REMATCH[2]}"
      break
    fi
    printf_red "    \"$REPLY\" isn't a resolution. Use WIDTHxHEIGHT, like 1920x1080."
  done

  while true; do
    ask "Refresh rate in Hz" "$MEDIAHUB_REFRESH"
    [[ "$REPLY" =~ ^[0-9]+$ ]] && break
    printf_red "    \"$REPLY\" isn't a number."
  done
  MEDIAHUB_REFRESH="$REPLY"

  MEDIAHUB_VRR="no"
  confirm "Enable adaptive sync (VRR)? Only if the TV supports it." && MEDIAHUB_VRR="yes"
  MEDIAHUB_HDR="no"
  confirm "Enable HDR output? Only if the TV supports it." && MEDIAHUB_HDR="yes"
}

#endregion

#region Companion

# Pick the companion port and open the firewall for it
setup_companion_configure() {
  step "Phone companion"
  while true; do
    ask "Port for the phone companion" "$MEDIAHUB_COMPANION_PORT"
    [[ "$REPLY" =~ ^[0-9]+$ ]] && (( REPLY > 0 && REPLY < 65536 )) && break
    printf_red "    \"$REPLY\" isn't a valid port. Use a number from 1 to 65535."
  done
  MEDIAHUB_COMPANION_PORT="$REPLY"

  if command -v ufw > /dev/null && sudo ufw status 2> /dev/null | grep -q "Status: active"; then
    if confirm "ufw is active. Allow port $MEDIAHUB_COMPANION_PORT so phones can connect?"; then
      sudo ufw allow "$MEDIAHUB_COMPANION_PORT/tcp" comment "MediaHub companion" > /dev/null
      changed "Opened port $MEDIAHUB_COMPANION_PORT in ufw"
    fi
  elif command -v firewall-cmd > /dev/null && sudo firewall-cmd --state > /dev/null 2>&1; then
    if confirm "firewalld is active. Allow port $MEDIAHUB_COMPANION_PORT so phones can connect?"; then
      sudo firewall-cmd --permanent --add-port="$MEDIAHUB_COMPANION_PORT/tcp" > /dev/null && sudo firewall-cmd --reload > /dev/null
      changed "Opened port $MEDIAHUB_COMPANION_PORT in firewalld"
    fi
  fi
}

#endregion

#region Boot

# Print the user greetd's fallback greeter runs as on this distro
greetd_greeter_user() {
  if id _greetd > /dev/null 2>&1; then
    echo "_greetd"
  else
    echo "greeter"
  fi
}

# Autologin into the MediaHub session at boot through greetd
setup_boot_configure() {
  step "Booting into MediaHub"
  if ! confirm "Start MediaHub automatically on the TV at boot (greetd autologin as $(whoami))?"; then
    echo "    Skipped. You can start it from a TTY with: mediahub-session"
    return
  fi

  sudo mkdir -p "$(dirname "$GREETD_CONF")"
  if [[ -f "$GREETD_CONF" && ! -f "$GREETD_CONF.bak" ]] && ! grep -q "MediaHub" "$GREETD_CONF"; then
    sudo cp "$GREETD_CONF" "$GREETD_CONF.bak"
    changed "Backed up the existing greetd config to $GREETD_CONF.bak"
  fi
  sed -e "s/__USER__/$(whoami)/" -e "s/__GREETER_USER__/$(greetd_greeter_user)/" "$REPO_DIR/session/greetd-config.toml" | sudo tee "$GREETD_CONF" > /dev/null
  changed "Configured greetd to log $(whoami) into MediaHub"

  if ! has_systemd; then
    printf_red "    systemd isn't running, so greetd wasn't enabled."
    return
  fi
  local DM
  for DM in "${OTHER_DISPLAY_MANAGERS[@]}"; do
    if systemctl is-enabled "$DM.service" > /dev/null 2>&1; then
      if confirm "$DM is enabled and would conflict with greetd. Disable it?"; then
        sudo systemctl disable "$DM.service" > /dev/null 2>&1
        changed "Disabled $DM"
      else
        printf_red "    $DM is still enabled; greetd may not start."
      fi
    fi
  done
  # Debian's greetd unit is an alias of display-manager.service, which needs --force when another one held it
  sudo systemctl enable --force greetd.service > /dev/null 2>&1 || fail "Enabling greetd failed."
  sudo systemctl set-default graphical.target > /dev/null
  changed "Enabled greetd and the graphical target"
}

# Let the hub user power off, restart and suspend without a password
setup_power_configure() {
  step "Power actions"
  if confirm "Allow shutdown, restart and sleep from the hub without a password prompt?"; then
    sudo mkdir -p "$(dirname "$POLKIT_RULE")"
    sed "s/__USER__/$(whoami)/" "$REPO_DIR/session/mediahub-polkit.rules" | sudo tee "$POLKIT_RULE" > /dev/null
    changed "Installed the polkit rule for power actions"
  fi
}

#endregion

#region Commands

# Full interactive setup
cmd_setup() {
  printf_bold "MediaHub setup $MEDIAHUB_VERSION"
  setup_check_system
  setup_load_previous
  setup_deps_install
  setup_deps_node
  setup_build_install
  setup_input_permissions
  setup_display_configure
  setup_companion_configure
  setup_write_session_conf
  setup_boot_configure
  setup_power_configure

  step "Done!"
  local CHANGE
  for CHANGE in "${CHANGES[@]}"; do
    echo "  - $CHANGE"
  done
  local ADDRESS
  ADDRESS="$(hostname -I 2> /dev/null | awk '{print $1}')"
  echo
  printf_green "MediaHub $MEDIAHUB_VERSION is installed."
  echo "Pair your phone at http://${ADDRESS:-<this machine>}:$MEDIAHUB_COMPANION_PORT with the code under Settings → Phone remote."
  if has_systemd && confirm "Reboot now to start MediaHub?"; then
    sudo systemctl reboot
  fi
  return 0
}

# Pull the latest version, rebuild and reinstall
cmd_update() {
  setup_check_system
  step "Updating the repository"
  git -C "$REPO_DIR" pull --ff-only || fail "git pull failed. Commit or stash local changes in $REPO_DIR and try again."
  # Re-read the version, since this script itself may have changed
  MEDIAHUB_VERSION="$(grep -m1 '^MEDIAHUB_VERSION=' "$REPO_DIR/setup.sh" | cut -d'"' -f2)"
  GAMESCOPE_VERSION="$(grep -m1 '^GAMESCOPE_VERSION=' "$REPO_DIR/setup.sh" | cut -d'"' -f2)"
  # Rebuild gamescope when the pinned version changed
  [[ -n "$(gamescope_source_version)" ]] && setup_gamescope_build
  setup_deps_node
  setup_build_install
  if pgrep -u "$(whoami)" -x mediahub > /dev/null && confirm "Restart MediaHub now? Open apps will close."; then
    # The session script starts gamescope and the new hub again
    pkill -u "$(whoami)" -x mediahub
    changed "Restarted MediaHub"
  fi
  printf_green "Done! Updated to MediaHub $MEDIAHUB_VERSION."
  return 0
}

# Remove everything setup.sh installed
cmd_uninstall() {
  setup_check_system
  confirm "Remove MediaHub from this machine?" || return 0
  sudo rm -rf "$INSTALL_DIR"
  sudo rm -f "$BIN_LINK" "$SESSION_LINK" "$UDEV_RULE" "$MODULES_CONF" "$POLKIT_RULE"
  changed "Removed MediaHub and its system rules"

  if [[ -d "$GAMESCOPE_DIR" ]] && confirm "Also remove the gamescope that setup.sh built in $GAMESCOPE_DIR?"; then
    sudo find /usr/local/bin /usr/local/share/vulkan/implicit_layer.d -lname "$GAMESCOPE_DIR/*" -delete
    sudo rm -rf "$GAMESCOPE_DIR"
    changed "Removed gamescope from $GAMESCOPE_DIR"
  fi

  if [[ -f "$GREETD_CONF" ]] && grep -q "MediaHub" "$GREETD_CONF"; then
    if [[ -f "$GREETD_CONF.bak" ]]; then
      sudo mv "$GREETD_CONF.bak" "$GREETD_CONF"
      changed "Restored the previous greetd config"
    else
      sudo rm -f "$GREETD_CONF"
      changed "Removed the MediaHub greetd config"
    fi
    if has_systemd && confirm "Disable greetd too? Do this if you don't use it for anything else."; then
      sudo systemctl disable greetd.service > /dev/null 2>&1
      changed "Disabled greetd"
    fi
  fi
  if [[ -d "$DATA_DIR" ]] && confirm "Also delete your apps, artwork and settings in $DATA_DIR?"; then
    rm -rf "$DATA_DIR"
    changed "Deleted $DATA_DIR"
  fi
  printf_green "Done! MediaHub was removed."
  return 0
}

cmd_help() {
  echo "Usage: ./setup.sh <command> [--yes]"
  echo
  echo "  setup                Set this machine up to run MediaHub (default)"
  echo "  update               Pull the latest version, rebuild and reinstall"
  echo "  uninstall            Remove MediaHub and its system changes"
  echo "  version              Print the MediaHub version"
  echo "  help                 Show this help"
  echo
  echo "Options:"
  echo "  -y, --yes            Answer yes to every question and accept every default"
  return 0
}

#endregion

# Parse flags, which may come before or after the command
ARGS=()
for ARG in "$@"; do
  case "$ARG" in
    -y | --yes) ASSUME_YES="yes" ;;
    -*)
      printf_red "Unknown option: $ARG" >&2
      cmd_help >&2
      exit 2
      ;;
    *) ARGS+=("$ARG") ;;
  esac
done

case "${ARGS[0]:-setup}" in
  setup | install) cmd_setup ;;
  update) cmd_update ;;
  uninstall | remove) cmd_uninstall ;;
  version) echo "$MEDIAHUB_VERSION" ;;
  help) cmd_help ;;
  *)
    printf_red "Command not found: ${ARGS[0]}" >&2
    cmd_help >&2
    exit 2
    ;;
esac
exit "$?"
