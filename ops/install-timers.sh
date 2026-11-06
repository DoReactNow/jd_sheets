#!/usr/bin/env bash
# Installs the systemd timers (W-410): the nightly backup at 02:30 India time and the health
# check every 5 minutes. Both run the scripts of the deployed version (/opt/jdsheets/current).
source "$(dirname "$0")/lib.sh"
require_root

unit() { printf '%s\n' "$2" >"/etc/systemd/system/$1"; }
unit jdsheets-backup.service "[Unit]
Description=JD Sheets nightly encrypted backup
[Service]
Type=oneshot
ExecStart=$JD_DIR/current/ops/backup.sh"
unit jdsheets-backup.timer "[Unit]
Description=JD Sheets nightly backup, 02:30 India time
[Timer]
OnCalendar=*-*-* 02:30:00 Asia/Kolkata
Persistent=true
[Install]
WantedBy=timers.target"
unit jdsheets-watch.service "[Unit]
Description=JD Sheets health check
[Service]
Type=oneshot
ExecStart=$JD_DIR/current/ops/watch.sh"
unit jdsheets-watch.timer "[Unit]
Description=JD Sheets health check every 5 minutes
[Timer]
OnBootSec=3min
OnUnitActiveSec=5min
[Install]
WantedBy=timers.target"
systemctl daemon-reload
systemctl enable --now jdsheets-backup.timer jdsheets-watch.timer
systemctl list-timers 'jdsheets-*' --no-pager
ok "timers on"
