# Operations Runbook: JD Sheets

How to run JD Sheets in production on the Hostinger VPS. Every procedure here is tried at least once before go-live (Phase 4, W-411); the scripts live in `ops/` and ship to the server in the `ops` image. The server scripts are also exercised on every build by `scripts/stack-check.sh` in CI.

## Production at a glance

| Item | Value |
|:---|:---|
| Server | Hostinger KVM 2, `82.29.165.21`, shared with n8n and the CRM (Decisions 59, 60) |
| Address | `https://sheets.jdfusion.in` |
| Containers | `caddy`, `app`, `worker`, `collab`, `db` (Docker Compose, `docker/docker-compose.prod.yml`) |
| Data | Docker volumes: Postgres data, workbook files (`/data/workbooks`) |
| Secrets | `.env.production` on the server only (root and the app user) |
| Backups | nightly, encrypted, Google Drive of the operations account, plus 7 days on the VPS (Decision 61) |

## Server check (W-401, read-only)

Paste into Hostinger's browser terminal. It changes nothing; it only prints what is on the server.

```bash
echo "== system"; hostname; . /etc/os-release; echo "$PRETTY_NAME"; uptime; nproc; free -h; df -h /
echo "== containers"; docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}'
echo "== compose folders"; docker ps -q | xargs -r docker inspect -f '{{.Name}} {{index .Config.Labels "com.docker.compose.project.working_dir"}}'
echo "== proxies"; for c in $(docker ps --format '{{.Names}} {{.Image}}' | grep -Ei 'traefik|nginx|caddy|haproxy' | cut -d' ' -f1); do echo "$c: $(docker inspect -f '{{.Config.Image}} {{json .Args}}' "$c" | cut -c1-600)"; done
echo "== networks"; docker network ls
echo "== listening"; ss -tlnp | grep -E ':(22|80|443|5432|5678)\b'
echo "== firewall"; ufw status 2>/dev/null | head -20
echo "== ssh"; grep -hE '^\s*(PasswordAuthentication|PermitRootLogin|PubkeyAuthentication)' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null; ls -l /root/.ssh/authorized_keys 2>/dev/null
echo "== gmail 465"; timeout 5 bash -c '</dev/tcp/smtp.gmail.com/465' && echo reachable || echo blocked
echo "== docker"; docker --version; docker compose version
```

## First setup (W-410)

Everything runs as root in Hostinger's browser terminal. Secrets are typed there, never sent anywhere else (Decision 60). `<tag>` is the commit whose images GitHub built (Actions → Images, green).

1. **Snapshot** (recommended): Hostinger panel → VPS → Snapshots → Create.
2. **Get the server files** (images come from GitHub's registry with the server's existing login):
   ```bash
   mkdir -p /opt/jdsheets/releases/<tag> && docker run --rm ghcr.io/doreactnow/jd_sheets/ops:<tag> | tar -x -C /opt/jdsheets/releases/<tag>
   ```
   If the download is refused, log in once with a GitHub token that can only read packages: `docker login ghcr.io -u DoReactNow`.
3. **Settings and secrets:** `/opt/jdsheets/releases/<tag>/ops/setup.sh`. It asks for the web address, the Gmail address and its app password, the alert address, the first Super Admin's email, the office addresses and the backup passphrase. Everything else (database password, secrets) is generated on the server. Files: `/opt/jdsheets/.env.production` and `/etc/jdsheets/backup.pass`, root only.
4. **First deploy:** `/opt/jdsheets/releases/<tag>/ops/deploy.sh <tag>`. Traefik sees the new site and gets the HTTPS certificate within a minute.
5. **Roles, office networks, first Super Admin:** `/opt/jdsheets/current/ops/admin.sh first-run` (asks for the Super Admin's password; it is never stored in a file).
6. **Google Drive for backups:** `/opt/jdsheets/current/ops/connect-drive.sh`. It prints a line starting with `rclone authorize "drive"`. On the Mac: `brew install rclone`, run that line, approve in the browser as the backup Gmail account, and paste the code it prints back into the server terminal.
7. **Timers:** `/opt/jdsheets/current/ops/install-timers.sh` (backup 02:30 India time, health check every 5 minutes). Then a first backup now: `/opt/jdsheets/current/ops/backup.sh`. It shows up in Google Drive, folder "JD Sheets backups".
8. Sign in at `https://sheets.jdfusion.in` as the Super Admin; check the Network access page and Diagnostics.

Server-wide SSH and firewall hardening comes after go-live (Decision 63).

## Everyday

| Task | Command (as root) |
|:---|:---|
| Deploy a new version | `/opt/jdsheets/current/ops/deploy.sh <tag>`: backup, migrations, then the new containers; if they do not turn healthy, the previous version is started again |
| Roll back | `/opt/jdsheets/current/ops/rollback.sh` (the previous version), or `rollback.sh <tag>` |
| What is running | `cat /opt/jdsheets/state/deployed-tag`; `docker compose -p jdsheets ps` |
| Logs | `docker logs --tail 100 jdsheets-app-1` (also `-worker-1`, `-collab-1`, `-db-1`, `-caddy-1`); rotated at 10 MB × 5 |
| Health check now | `/opt/jdsheets/current/ops/watch.sh` |
| Timers | `systemctl list-timers 'jdsheets-*'`; `journalctl -u jdsheets-backup --since today` |

GridCraft is our own copy (Decision 55); there are no automatic updates. A fix from GridCraft's releases is copied in by hand only when needed, with a test.

## Recovery commands

| Situation | Command (as root on the server) |
|:---|:---|
| The only Super Admin is locked out or forgot the password | `/opt/jdsheets/current/ops/admin.sh reset-super-admin <name>@jdfusion.in` (asks for the password) |
| Network rules lock everyone out (for example the office address changed) | A Super Admin can sign in from anywhere and fix it on the Network access page (Decision 57). Last resort: `/opt/jdsheets/current/ops/admin.sh reset-ip-rules <address>/32` |
| The edge allowlist | Open in production (Decision 57); the app's network rules are the wall |

## When things go wrong

Alert emails come from the health check: one when a problem starts, one when it clears.

| Symptom | First checks |
|:---|:---|
| "Temporarily unavailable" when opening or saving | `collab` container health and logs |
| Nobody can reach the site | Caddy logs, `EDGE_ALLOWED_CIDRS`, DNS, certificate |
| Sign-up codes do not arrive | worker logs for `mail.sendOtp`, Google SMTP app password, Gmail daily limit |
| Disk filling up | version pruning and trash purge jobs, backup leftovers |

## Backups and restore

- **Nightly at 02:30 India time** (`jdsheets-backup.timer`): a database dump and the workbook files in one file, encrypted with the backup passphrase (GnuPG, AES-256). Kept 7 days in `/opt/jdsheets/backups` and 30 days in Google Drive, folder "JD Sheets backups". A failure emails an alert; the health check also alerts when the last good backup is over 26 hours old.
- Every deploy first makes a local backup.
- **Restore** (replaces everything; asks you to type RESTORE):
  - from Google Drive, newest: `/opt/jdsheets/current/ops/restore.sh --from-drive`
  - a named one: `restore.sh --from-drive jdsheets-20261107-210000.tar.gpg`, or a local file: `restore.sh /opt/jdsheets/backups/<file>`
- **On a fresh machine:** `setup.sh` (type the same backup passphrase), `deploy.sh <tag>`, `connect-drive.sh`, then `restore.sh --from-drive`.
- **Without the passphrase the backups cannot be opened.** Keep it in the password manager and on paper.

Drill timings: `hardening_results.md`.

## Repository *(Phase 0, W-016)*

Branch protection on `main`: pull requests only, CI required. *(Details once the GitHub repository exists, Q-02.)*
