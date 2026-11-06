# Phase 4 Results

The measured results of hardening. **This is a stub**, filled in during Phase 4 with real numbers. Each section names the scenarios it proves.

## Load test (`P4-LOAD-01` to `-03`)

*Targets to agree with the owner first (TQ-10): number of staff, peak concurrent editors, editors per workbook, largest expected workbook.*

| Measure | Target | Result |
|:---|:---|:---|
| Command delivery to other editors (p95, 20 editors in one workbook, Decision 56) | ≤ 300 ms | **9 ms** (median 3 ms, max 12 ms; 3,800 deliveries; Phase 3 W-310, `services/collab/tests/live.rs`, owner's Mac, release build, storage faked in memory: the real store adds one database write per change). Repeat on the VPS in Phase 4. |
| Open a 10 MiB workbook | | |
| Save a 50 MiB workbook | | |
| Rust service memory with N open workbooks | | |
| App response time (p95) under peak load | | |

## Security (`P4-SEC-01` to `-05`)

| Check | Result |
|:---|:---|
| Security headers and CSP | |
| `npm audit` / `cargo audit` | 2026-11-06. `npm audit --omit=dev`: 0 findings (CI fails on high). Development-only packages: 8 moderate (minimatch, in tooling only). `cargo audit` (collab, 261 crates): tokio RUSTSEC-2026-0386 fixed by updating to 1.54.1. Four `zip` 3.x advisories (RUSTSEC-2026-0367, -0368, -0369, -0429) are all in `ZipArchive::extract`/`ZipStreamReader::extract`, which neither we nor our GridCraft call (workbooks are read in memory, never extracted to disk); ignored with this reason in `services/collab/.cargo/audit.toml`. Upgrade to zip 9 after go-live. |
| Internal endpoints unreachable from outside | |
| Open ports | JD Sheets publishes no ports; Traefik (shared, 80/443) is the only way in (Decision 62; checked in CI). Server-wide: SSH 22 with password login and Hermes agent 32768 are open; no firewall. **Open risk, owner's choice to fix after go-live (Decision 63).** |
| Secrets handling | |

## Backup and restore (`P4-BACKUP-01` to `-03`)

| Drill | Date | Time to restore | Notes |
|:---|:---|:---|:---|

## Drills (`P4-DRILL-01`, `-02`)

| Drill | Result | Runbook updated |
|:---|:---|:---|
| Database down | | |
| Collab service down | | |
| Worker down | | |
| Disk full | | |
| Super Admin recovery command | | |
| IP rules recovery command | | |

## Owner acceptance (`P4-ACCEPT-01`)

| Date | From office network | From outside | Notes |
|:---|:---|:---|:---|
