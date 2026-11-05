# Operations Runbook: JD Sheets

How to run JD Sheets in production on the Hostinger VPS. **This is a stub.** It is completed and proven in Phase 4 (every procedure is tried at least once before go-live). Sections marked *(Phase 4)* are placeholders.

## Production at a glance

| Item | Value |
|:---|:---|
| Server | Hostinger KVM VPS *(plan: Q-07)* |
| Address | `https://<domain>` *(Q-05)* |
| Containers | `caddy`, `app`, `worker`, `collab`, `db` (Docker Compose, `docker/docker-compose.prod.yml`) |
| Data | Docker volumes: Postgres data, workbook files (`/data/workbooks`) |
| Secrets | `.env.production` on the server only (root and the app user) |
| Backups | nightly, encrypted, off-server *(target: Q-06)* |

## First setup *(Phase 4)*

1. VPS: Ubuntu LTS, updates, a non-root user, SSH keys only, password login off.
2. Hostinger firewall: 80 and 443 from anywhere (Caddy applies the IP allowlist), 22 only from the owner's IPs.
3. Docker Engine and Compose.
4. Clone the repository with submodules; create `.env.production` from the example.
5. DNS for the domain pointing to the VPS; Caddy gets certificates automatically.
6. `docker compose -f docker/docker-compose.prod.yml up -d --build`.
7. Migrations, `db:sync-rbac`, private seed (first Super Admin and bootstrap IP rules). Remove the seed password from `.env.production` afterwards.
8. Sign in as the Super Admin from an office network; check the Network access page; check diagnostics.

## Everyday *(Phase 4)*

- Deploy a new version: pull, `editor:build` inside the image build, migrations run first, then the new containers.
- Roll back: start the previous image tags; migrations are backward compatible (Decision 30).
- Check health: Diagnostics page, `docker compose ps`, container logs.
- GridCraft updates arrive as pull requests from the weekly upstream job; merge only when green.

## Recovery commands

| Situation | Command (inside the `app` container) |
|:---|:---|
| The only Super Admin is locked out or forgot the password | `npm run admin:reset-super-admin -- --email <name>@jdfusion.in` (asks for the password on the terminal) |
| Network rules lock everyone out | `npm run admin:reset-ip-rules -- --cidr <office CIDR>` |
| The edge allowlist is wrong | edit `EDGE_ALLOWED_CIDRS` in `.env.production`, restart `caddy` |

## When things go wrong *(Phase 4)*

| Symptom | First checks |
|:---|:---|
| "Temporarily unavailable" when opening or saving | `collab` container health and logs |
| Nobody can reach the site | Caddy logs, `EDGE_ALLOWED_CIDRS`, DNS, certificate |
| Sign-up codes do not arrive | worker logs for `mail.sendOtp`, Google SMTP app password, Gmail daily limit |
| Disk filling up | version pruning and trash purge jobs, backup leftovers |

## Backups and restore *(Phase 4)*

Nightly: Postgres dump + workbook files, encrypted, sent off-server; failure alerts. Restore drill steps and timings recorded in `hardening_results.md`.

## Repository *(Phase 0, W-016)*

Branch protection on `main`: pull requests only, CI required. *(Details once the GitHub repository exists, Q-02.)*
