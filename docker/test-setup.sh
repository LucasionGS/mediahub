#!/bin/bash

##############################################
# MediaHub setup test developed by Lucasion #
##############################################

# Runs inside the test containers: a full setup, a second run to check it's idempotent, then uninstall.
# Containers have no systemd, so the steps that enable services are expected to be skipped.

# The bash -c checks expand their own variables, so single quotes are intended
# shellcheck disable=SC2016
FAILURES=0

# Report one check
check() {
  local LABEL="$1"
  shift
  if "$@" > /dev/null 2>&1; then
    echo -e "\033[0;32mPASS\033[0m $LABEL"
  else
    echo -e "\033[0;31mFAIL\033[0m $LABEL"
    FAILURES=$((FAILURES + 1))
  fi
}

echo "##### First run #####"
./setup.sh --yes || { echo "setup.sh failed with code $?"; exit 1; }

check "hub binary installed" test -x /opt/mediahub/mediahub
check "hub runs as the hub user" bash -c '/opt/mediahub/mediahub --version 2>/dev/null; [[ -r /opt/mediahub/resources/app.asar ]]' 
check "input helper bundled" test -x /opt/mediahub/resources/mediahub-input
check "mediahub link" test -L /usr/local/bin/mediahub
check "session script" test -x /usr/local/bin/mediahub-session
check "chrome-sandbox is setuid root" bash -c '[[ "$(stat -c "%U %a" /opt/mediahub/chrome-sandbox)" == "root 4755" ]]'
check "uinput udev rule" test -f /etc/udev/rules.d/99-mediahub-uinput.rules
check "uinput module conf" grep -qx uinput /etc/modules-load.d/mediahub.conf
check "user in input group" bash -c 'getent group input | grep -qw hub'
check "polkit rule for hub" sudo grep -q '"hub"' /etc/polkit-1/rules.d/50-mediahub.rules
check "greetd logs in hub" grep -q 'user = "hub"' /etc/greetd/config.toml
check "greetd runs the session" grep -q mediahub-session /etc/greetd/config.toml
check "session.conf written" grep -q 'MEDIAHUB_COMPANION_PORT="8420"' "$HOME/.mediahub/session.conf"
check "session script syntax" bash -n /usr/local/bin/mediahub-session
check "input helper runs" bash -c '/opt/mediahub/resources/mediahub-input version | grep -q .'

echo "##### Second run (idempotent) #####"
./setup.sh --yes > /tmp/second-run.log 2>&1 || { tail -30 /tmp/second-run.log; echo "second run failed"; exit 1; }
check "still one udev rule" bash -c '[[ "$(ls /etc/udev/rules.d/ | grep -c mediahub)" == 1 ]]'
check "greetd backup not overwritten by our own config" bash -c '! grep -q MediaHub /etc/greetd/config.toml.bak 2>/dev/null'

echo "##### Uninstall #####"
./setup.sh uninstall --yes || { echo "uninstall failed"; exit 1; }
check "install dir removed" test ! -e /opt/mediahub
check "links removed" test ! -e /usr/local/bin/mediahub
check "rules removed" sudo test ! -e /etc/polkit-1/rules.d/50-mediahub.rules
check "data removed" test ! -e "$HOME/.mediahub"
check "greetd config no longer MediaHub's" bash -c '! grep -q MediaHub /etc/greetd/config.toml 2>/dev/null'

echo
if (( FAILURES > 0 )); then
  echo "$FAILURES check(s) failed."
  exit 1
fi
echo "All checks passed."
