# GridCraft patches

Changes JD Sheets needs from GridCraft before upstream has them (Decision 8). The submodule in
`vendor/gridcraft` is never edited; `npm run editor:build` applies these to a copy.

## Rules

- Name: `NNNN-short-name.patch` (applied in number order), made with `git diff` from the GridCraft
  repository root at the pinned tag.
- First line of the patch header: `Upstream: <link to the pull request on storytold/gridcraft>`.
- As small as possible; only in `apps/gridcraft-web` (or, if unavoidable, public entry points of
  the UI crate).
- Tests for the behaviour live in this repository.
- When upstream merges the change, delete the patch in the pull request that bumps the submodule.
- A patch that stops applying fails the build with its name; the weekly upstream job then opens an
  issue instead of bumping.

## Current patches

None yet. Planned: `0001-access-mode` (Phase 2), `0002-command-messages` (Phase 3).
