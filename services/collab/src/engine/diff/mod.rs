//! What changed between two versions of a workbook, for saves by a Commenter before live
//! collaboration (project_data.md 5.5, P2-ROLE-03..05). Both versions first go once through
//! GridCraft's writer and reader, so differences in file layout (say a file Excel wrote against
//! one GridCraft wrote) never count as changes. What a person only looks at (the active sheet,
//! zoom, scroll position, view mode) is not a change either.
use std::sync::Arc;

use gridcraft_model::{Comment, Workbook};
use serde::Serialize;

use super::{EngineFailure, open_any, to_xlsx};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DiffKind {
    /// Nothing but what a person looks at changed.
    None,
    /// Only comments and notes changed, and only in ways the author may make.
    CommentsOnly,
    /// Comments changed, and one of them belongs to someone else (changed or deleted).
    ForeignComment,
    /// Content changed: cells, formats, sheets, names or anything else.
    Other,
}

/// Rewrites a workbook through GridCraft once, as described above.
fn canonical(workbook: &Workbook) -> Result<Workbook, EngineFailure> {
    open_any("Book.xlsx", &to_xlsx(workbook)?)
}

/// `new` with `base`'s view settings and identities, and (when `with_comments`) its comments,
/// so that comparing the result with `base` compares content only. None when the sheet lists
/// differ in length (that is a content change).
fn aligned(base: &Workbook, new: &Workbook, with_comments: bool) -> Option<Workbook> {
    if base.sheets.len() != new.sheets.len() {
        return None;
    }
    let mut out = new.clone();
    out.active_sheet = base.active_sheet.clone();
    out.view = base.view;
    for (sheet, from) in out.sheets.iter_mut().zip(&base.sheets) {
        let sheet = Arc::make_mut(sheet);
        sheet.file_id = from.file_id;
        sheet.zoom = from.zoom;
        sheet.view_active = from.view_active;
        sheet.view_top_left = from.view_top_left;
        sheet.view = from.view;
        if with_comments {
            sheet.comments = from.comments.clone();
        }
    }
    Some(out)
}

/// May `author` turn `before` into `after`? Their own comments, any way; someone else's only by
/// adding replies of their own at the end.
fn allowed_change(before: &Comment, after: Option<&Comment>, author: &str) -> bool {
    if before.author == author {
        return true;
    }
    let Some(after) = after else { return false };
    let mut same_head = after.clone();
    same_head.replies.truncate(before.replies.len());
    same_head.dates.truncate(before.dates.len());
    same_head == *before
        && after.replies.len() >= before.replies.len()
        && after.replies[before.replies.len()..]
            .iter()
            .all(|(who, _)| who == author)
}

/// The kind of change from `base` to `new` for a save by `author` (their display name, which
/// the editor writes as the author of their comments).
pub fn diff_kind(base: &Workbook, new: &Workbook, author: &str) -> Result<DiffKind, EngineFailure> {
    let base = canonical(base)?;
    let new = canonical(new)?;
    let Some(content) = aligned(&base, &new, true) else {
        return Ok(DiffKind::Other);
    };
    if content != base {
        return Ok(DiffKind::Other);
    }
    let Some(viewless) = aligned(&base, &new, false) else {
        return Ok(DiffKind::Other);
    };
    if viewless == base {
        return Ok(DiffKind::None);
    }
    for (before_sheet, after_sheet) in base.sheets.iter().zip(&viewless.sheets) {
        for (cell, before) in &before_sheet.comments {
            let after = after_sheet.comments.get(cell);
            if after != Some(before) && !allowed_change(before, after, author) {
                return Ok(DiffKind::ForeignComment);
            }
        }
    }
    Ok(DiffKind::CommentsOnly)
}

#[cfg(test)]
mod tests;
