# Phase 4 Results

The measured results of hardening. **This is a stub**, filled in during Phase 4 with real numbers. Each section names the scenarios it proves.

## Load test (`P4-LOAD-01` to `-03`)

*Targets to agree with the owner first (TQ-10): number of staff, peak concurrent editors, editors per workbook, largest expected workbook.*

| Measure | Target | Result |
|:---|:---|:---|
| Command delivery to other editors (p95, 10 editors in one workbook) | ≤ 300 ms | |
| Open a 10 MiB workbook | | |
| Save a 50 MiB workbook | | |
| Rust service memory with N open workbooks | | |
| App response time (p95) under peak load | | |

## Security (`P4-SEC-01` to `-05`)

| Check | Result |
|:---|:---|
| Security headers and CSP | |
| `npm audit` / `cargo audit` | |
| Internal endpoints unreachable from outside | |
| Open ports | |
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
