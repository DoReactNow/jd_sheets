#!/usr/bin/env bash
# Connects the backups to Google Drive (W-410), once. rclone may only see the files it creates
# (scope drive.file). The approval happens in the owner's own browser on their Mac:
#   1. this script prints a line starting with: rclone authorize "drive" ...
#   2. run that line on the Mac (brew install rclone first), approve in the browser,
#   3. paste the long code it prints back here.
source "$(dirname "$0")/lib.sh"
require_root
mkdir -p "$JD_ETC"
chmod 700 "$JD_ETC"
docker run --rm -it -v "$JD_ETC:/config/rclone" rclone/rclone:1.71.2 \
  config create gdrive drive scope=drive.file config_is_local=false
chmod 600 "$JD_ETC/rclone.conf"
docker run --rm -v "$JD_ETC:/config/rclone" rclone/rclone:1.71.2 mkdir "gdrive:JD Sheets backups"
ok "Google Drive connected; backups go to the folder 'JD Sheets backups'"
