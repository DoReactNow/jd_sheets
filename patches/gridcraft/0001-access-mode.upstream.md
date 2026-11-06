# Upstream pull request for patch 0001 (Decision 53)

The owner opens this on https://github.com/storytold/gridcraft (or asks Claude to open it from
`DoReactNow`), then replaces `Upstream: pending …` in the patch's first line with the link.

**Title:** gridcraft-web: access modes for host pages (`?mode=view|comment|edit`) and `gridcraft:saveNow`

**Body:**

Pages that embed GridCraft with `?host=parent` sometimes show a workbook to people who may only
read it, or only comment on it. This adds an access mode to the host bridge:

- `?mode=view|comment|edit` on load, and `gridcraft:mode { mode }` from the parent at any time.
- **View:** any change to the workbook is put back after the frame that made it, with a short
  notice; Save hands nothing to the parent (exports such as PDF still do).
- **Comment:** only the user's own notes and comments are kept (the author from `?author=`), plus
  their replies added to someone else's thread.
- **Edit** (the default) behaves exactly as today.
- What a person only looks at (active sheet, zoom, scroll, page view) is never put back.
- `gridcraft:saveNow`: save as File › Save would, for parents that autosave.

The rule is applied in `apps/gridcraft-web` after each frame, so it holds whatever path made the
change (typing, paste, ribbon, menus, keyboard shortcuts, undo, dialogs) without touching the
engine or the UI crate. Tests: `apps/gridcraft-web/src/access/tests.rs` (`cargo test -p gridcraft-web`).

A possible follow-up, if you prefer it: greying out the ribbon's editing commands in view and
comment mode would need a small public hook in `gridcraft-ui-egui`; happy to send that separately.
