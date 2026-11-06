# Golden workbooks

Upgrade tests (Decision 24, X-UPSTREAM-03). Each `<name>.json` lists GridCraft commands and the
values cells must show. `<name>.xlsx` was written by the **pinned** GridCraft from those commands
and is committed, so a newer GridCraft must still open it and show the same values.

- Check: `npm run rust:test` (services/collab/tests/golden.rs) — open each `.xlsx`, compare,
  save, reopen, compare again.
- Regenerate (only when a spec changes, never to make a failing upgrade pass):
  `GOLDEN_WRITE=1 npm run rust:test`.

All content is made up for testing. Never put real company data here.
