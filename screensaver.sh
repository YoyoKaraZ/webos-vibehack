#!/bin/sh
# Starts the screensaver from a remote key (inputhook rule). Waits a second first: the key's
# release counts as activity and would close a screensaver started on the press. Detached with
# setsid, since a job left in the background of inputhook's shell is killed with it.
if [ "$1" != "--now" ]; then
  setsid "$0" --now > /dev/null 2>&1 < /dev/null &
  exit 0
fi
sleep 1
luna-send -n 1 luna://com.webos.service.tvpower/power/turnOnScreenSaver '{}'
