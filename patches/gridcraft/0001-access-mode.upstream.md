# Upstream pull request for patch 0001 (Decision 53)

Opened 2026-11-06 from `DoReactNow`: https://github.com/storytold/gridcraft/pull/3463

Upstream `main` had already moved the host bridge onto `craft-web-host` (storytold/craft-libs), so
the pull request is a port, not this exact patch:

- **Included:** the access gate (`src/access.rs`, with the same 6 tests) and `?mode=` on load. In
  view mode a workbook is never handed to the host.
- **Not included:** `gridcraft:mode` (change the mode while open) and `gridcraft:saveNow`. Both
  need new message variants in `craft-web-host`, so they start in `storytold/craft-libs`. They are
  offered as a follow-up.
- **Also offered as a follow-up:** greying out the ribbon's editing commands (Decision 54).

Our patch stays on v0.16.1 until a GridCraft release includes the change. Then we bump the
submodule and drop what upstream covers (the mode and save-now messages may remain as a smaller
patch).
