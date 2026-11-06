//! Live co-editing (JD Sheets, Decisions 22, 55, 56). Every change a person makes is captured as
//! a [`LiveStep`]: the command, its parameters, and the sheet and selection it ran on, the way the
//! macro recorder keeps steps. Another session (the server's, or another person's editor) runs
//! the same step with [`apply`] and ends with the same workbook.
//!
//! A paste reads the person's own clipboard, which nobody else has, so a step that pastes carries
//! the copied cells ([`LiveClipboard`]) and [`apply`] uses them instead of the local clipboard.
//! Commands that only change what a person looks at (sheet tabs, selection, zoom, windows) are
//! never captured.

use std::sync::Arc;

use gridcraft_core::{CellRef, RangeRef};
use gridcraft_model::{Cell, Formula, Workbook};
use serde::{Deserialize, Serialize};
use serde_json::Value as Json;

use crate::{Clipboard, EngineError, Result, Selection, Session, Trust};

/// One change, as it ran.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveStep {
    /// The active sheet (index and name) just before the command ran.
    pub sheet: usize,
    pub sheet_name: String,
    /// The selection just before the command ran.
    pub selection: Selection,
    pub id: String,
    pub params: Json,
    /// The copied cells, for a step that pastes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clipboard: Option<LiveClipboard>,
}

/// The copied cells a paste uses: one sheet holding only the copied range.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveClipboard {
    pub wb: Workbook,
    pub sheet: usize,
    pub range: RangeRef,
    pub selected: RangeRef,
    pub cut: bool,
    pub text: String,
    pub areas: Vec<RangeRef>,
}

/// Why a step could not be applied.
#[derive(Debug)]
pub enum ApplyError {
    /// Its sheet is gone or was renamed (someone deleted it): the editor resyncs.
    SheetGone,
    /// The command itself refused (for example a protected sheet); the workbook is unchanged.
    Refused(String),
}

/// Capture state on a session ([`Session::live`]).
#[derive(Debug, Default)]
pub struct Capture {
    /// Steps captured since the host last took them.
    pub steps: Vec<LiveStep>,
    /// True while [`apply`] runs someone else's step: it is not captured again.
    pub applying: bool,
    /// This person's own changes, for undo (Decision 56): the cells each one changed, or `None`
    /// for a change undo can't reverse while others edit (rows, sheets, merges…).
    pub undo: Vec<Option<CellPatch>>,
    pub redo: Vec<Option<CellPatch>>,
    /// True while undo or redo runs, so its own restore step doesn't touch the stacks.
    restoring: bool,
}

/// The cells one change touched on one sheet: (cell, before, after).
#[derive(Clone, Debug, PartialEq)]
pub struct CellPatch {
    pub sheet_name: String,
    pub cells: Vec<(CellRef, Option<Cell>, Option<Cell>)>,
}

/// Shown when undo can't reverse a change while others edit.
pub const CANT_UNDO: &str = "This change can't be undone while others are editing.";

/// A formula read from JSON has no parsed form; give it one, as entering it would.
fn rehydrate(cell: &mut Cell) {
    if let Some(f) = cell.formula.as_mut()
        && f.expr.is_none()
    {
        let parsed = Formula::new(&f.text).expr;
        Arc::make_mut(f).expr = parsed;
    }
}

fn rehydrate_workbook(wb: &mut Workbook) {
    for sheet in wb.sheets.iter_mut() {
        let sheet = Arc::make_mut(sheet);
        let cells: Vec<CellRef> = sheet.cells.iter().filter(|(_, c)| c.formula.as_ref().is_some_and(|f| f.expr.is_none())).map(|(c, _)| c).collect();
        for c in cells {
            if let Some(cell) = sheet.cells.get_mut(c) {
                rehydrate(cell);
            }
        }
    }
}

/// The cells `id` changed on one sheet, when that is all it changed; `None` otherwise.
fn patch_of(before: &Workbook, after: &Workbook) -> Option<CellPatch> {
    if before.sheets.len() != after.sheets.len() || before.names != after.names {
        return None;
    }
    let mut found: Option<CellPatch> = None;
    for (b, a) in before.sheets.iter().zip(&after.sheets) {
        if Arc::ptr_eq(b, a) {
            continue;
        }
        if b.name != a.name {
            return None;
        }
        // Anything but cell content and computed values changed: not a cell edit.
        let mut b_rest = (**b).clone();
        let mut a_rest = (**a).clone();
        b_rest.cells = Default::default();
        a_rest.cells = Default::default();
        b_rest.spill = Default::default();
        a_rest.spill = Default::default();
        b_rest.spill_ranges = Default::default();
        a_rest.spill_ranges = Default::default();
        if b_rest != a_rest {
            return None;
        }
        let changed = b.cells.diff(&a.cells);
        if changed.is_empty() {
            continue;
        }
        // Formula results recalculated elsewhere are not part of the edit; only cells whose
        // content (value typed, formula text, style) changed.
        let edited: Vec<_> = changed
            .into_iter()
            .filter_map(|c| {
                let (x, y) = (b.cells.get(c), a.cells.get(c));
                let content = |cell: Option<&Cell>| {
                    cell.map(|k| {
                        (k.formula.as_ref().map(|f| f.text.clone()), if k.formula.is_some() { None } else { Some(k.value.clone()) }, k.style)
                    })
                };
                (content(x) != content(y)).then(|| (c, x.cloned(), y.cloned()))
            })
            .collect();
        if edited.is_empty() {
            continue;
        }
        if found.is_some() {
            return None; // two sheets changed: keep it simple, not undoable live
        }
        found = Some(CellPatch { sheet_name: b.name.clone(), cells: edited });
    }
    found
}

/// Commands that only change what this person looks at, never sent.
const VIEW_ONLY: &[&str] = &["selection.", "sheet.activate", "sheet.next", "sheet.previous", "window.", "view.", "ui."];

/// Commands that read the clipboard, so their step carries it.
fn reads_clipboard(id: &str) -> bool {
    id.starts_with("edit.paste") || id.contains("Paste") || id == "home.insertCopiedCells"
}

pub(crate) fn is_view_only(id: &str) -> bool {
    VIEW_ONLY.iter().any(|p| if p.ends_with('.') { id.starts_with(p) } else { id == *p })
}

/// The clipboard as a step can carry it: only the copied sheet, only the copied cells.
pub(crate) fn carry(clip: &Clipboard) -> Option<LiveClipboard> {
    let mut wb = (*clip.wb).clone();
    let source = wb.sheets.get(clip.sheet)?.clone();
    let mut sheet = (*source).clone();
    let keep = clip.range;
    let outside: Vec<_> = sheet.cells.iter().map(|(c, _)| c).filter(|c| !keep.contains(*c)).collect();
    for c in outside {
        sheet.cells.remove(c);
    }
    sheet.comments.retain(|c, _| keep.contains(*c));
    wb.sheets = vec![Arc::new(sheet)];
    Some(LiveClipboard {
        wb,
        sheet: 0,
        range: clip.range,
        selected: clip.selected,
        cut: clip.cut,
        text: clip.text.clone(),
        areas: clip.areas.clone(),
    })
}

impl Session {
    /// Starts capturing this session's changes as live steps.
    pub fn start_live(&mut self) {
        self.live = Some(Capture::default());
    }

    /// The steps captured since the last call.
    pub fn take_live_steps(&mut self) -> Vec<LiveStep> {
        self.live.as_mut().map(|c| std::mem::take(&mut c.steps)).unwrap_or_default()
    }

    /// Called by `execute` after a top-level command succeeded and changed the workbook.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn capture_live(
        &mut self,
        sheet: usize,
        sheet_name: String,
        selection: Selection,
        id: &str,
        params: Json,
        clipboard: Option<LiveClipboard>,
        before: &Workbook,
        after: &Workbook,
    ) {
        if is_view_only(id) {
            return;
        }
        if let Some(capture) = self.live.as_mut()
            && !capture.applying
        {
            capture.steps.push(LiveStep { sheet, sheet_name, selection, id: id.to_string(), params, clipboard });
            if !capture.restoring {
                capture.undo.push(patch_of(before, after));
                capture.redo.clear();
            }
        }
    }

    /// Undo or redo of this person's own change while live (Decision 56): their cells go back to
    /// what they were, where nobody has changed them since, as a step everyone receives.
    pub(crate) fn live_undo(&mut self, redo: bool) -> Result<Json> {
        let Some(capture) = self.live.as_mut() else { return Err(EngineError::Other(CANT_UNDO.into())) };
        let stack = if redo { &mut capture.redo } else { &mut capture.undo };
        let Some(entry) = stack.pop() else {
            return Err(EngineError::Disabled(if redo { "edit.redo" } else { "edit.undo" }.into(), "Nothing to undo.".into()));
        };
        let Some(patch) = entry else { return Err(EngineError::Other(CANT_UNDO.into())) };
        // Back to `before` (undo) or `after` (redo), only where the cell still holds the other.
        let wanted: Vec<Json> = {
            let doc = self.doc()?;
            let Some(sheet) = doc.wb.sheets.iter().find(|s| s.name == patch.sheet_name) else {
                return Err(EngineError::Other(CANT_UNDO.into()));
            };
            patch
                .cells
                .iter()
                .filter(|(c, b, a)| {
                    let expected = if redo { b } else { a };
                    let now = sheet.cells.get(*c);
                    let text = |x: Option<&Cell>| {
                        x.map(|k| {
                            (k.formula.as_ref().map(|f| f.text.clone()), k.style, if k.formula.is_some() { None } else { Some(k.value.clone()) })
                        })
                    };
                    text(now) == text(expected.as_ref())
                })
                .map(|(c, b, a)| serde_json::json!([c.a1(), if redo { a } else { b }]))
                .collect()
        };
        if let Some(c) = self.live.as_mut() {
            c.restoring = true;
        }
        let ran = self.execute("live.setCells", serde_json::json!({"sheet": patch.sheet_name, "cells": wanted}));
        if let Some(c) = self.live.as_mut() {
            c.restoring = false;
            let other = if redo { &mut c.undo } else { &mut c.redo };
            other.push(Some(patch));
        }
        ran
    }

    /// While live, undo and redo reverse only this person's own changes (Decision 56).
    pub(crate) fn live_intercept(&mut self, id: &str) -> Option<Result<Json>> {
        (self.live.is_some() && self.depth == 0 && matches!(id, "edit.undo" | "edit.redo")).then(|| self.live_undo(id == "edit.redo"))
    }

    /// Before a command runs: where it runs and, for a paste, the copied cells.
    pub(crate) fn live_before(
        &self,
        id: &str,
        place: Option<&(u64, usize, String, Selection)>,
    ) -> Option<(usize, String, Selection, Option<LiveClipboard>)> {
        let (_, sheet, name, selection) = place.filter(|_| self.live.is_some())?;
        Some((*sheet, name.clone(), selection.clone(), self.live_clipboard_for(id)))
    }

    /// After a command: captures it when it changed the workbook. A toggle (Bold) is sent with
    /// the state it set, so replaying it later sets that state.
    pub(crate) fn live_after(
        &mut self,
        id: &str,
        params: &Json,
        result: &Result<Json>,
        prepared: Option<(usize, String, Selection, Option<LiveClipboard>)>,
        before: Option<Arc<Workbook>>,
    ) {
        let (Some((sheet, name, selection, clip)), Ok(r), Some(before)) = (prepared, result, before) else { return };
        let Some(after) = self.active().map(|d| d.wb.clone()) else { return };
        if Arc::ptr_eq(&before, &after) {
            return;
        }
        let live_params = if params.is_object() {
            crate::record::with_toggle_state(id, crate::cmd::journal_params(params), r)
        } else {
            crate::cmd::journal_params(params)
        };
        self.capture_live(sheet, name, selection, id, live_params, clip, &before, &after);
    }

    /// The clipboard a step would carry for command `id` (only for commands that paste).
    pub(crate) fn live_clipboard_for(&self, id: &str) -> Option<LiveClipboard> {
        if self.live.is_none() || !reads_clipboard(id) {
            return None;
        }
        self.clipboard.as_ref().and_then(carry)
    }
}

/// Runs someone else's step on the active document of `s`, as it ran for them.
pub fn apply(s: &mut Session, step: &LiveStep) -> std::result::Result<Json, ApplyError> {
    {
        let doc = s.doc_mut().map_err(|e| ApplyError::Refused(e.to_string()))?;
        let same = doc.wb.sheets.get(step.sheet).is_some_and(|sh| sh.name == step.sheet_name);
        if !same {
            return Err(ApplyError::SheetGone);
        }
        doc.wb.set_active_sheet(step.sheet);
        doc.selection = step.selection.clone();
    }
    let own_clipboard = s.clipboard.take();
    if let Some(carried) = &step.clipboard {
        let doc_uid = s.doc().map(|d| d.uid).unwrap_or(0);
        let mut wb = carried.wb.clone();
        rehydrate_workbook(&mut wb);
        s.clipboard = Some(Clipboard {
            wb: Arc::new(wb),
            sheet: carried.sheet,
            range: carried.range,
            selected: carried.selected,
            cut: carried.cut,
            doc_uid,
            text: carried.text.clone(),
            areas: carried.areas.clone(),
            trust: Trust::FromFile,
        });
    }
    let was_applying = s.live.as_ref().is_some_and(|c| c.applying);
    if let Some(c) = s.live.as_mut() {
        c.applying = true;
    }
    let result = s.execute(&step.id, step.params.clone());
    if let Some(c) = s.live.as_mut() {
        c.applying = was_applying;
    }
    s.clipboard = own_clipboard;
    result.map_err(|e: EngineError| ApplyError::Refused(e.to_string()))
}

/// For a host that needs a plain result.
pub fn apply_result(s: &mut Session, step: &LiveStep) -> Result<Json> {
    apply(s, step).map_err(|e| match e {
        ApplyError::SheetGone => EngineError::Other("That sheet was deleted by someone else.".into()),
        ApplyError::Refused(why) => EngineError::Other(why),
    })
}

/// Puts the active document back to `wb` (a snapshot it had earlier), with its formula graph.
pub fn restore(s: &mut Session, wb: Arc<Workbook>) -> Result<()> {
    let d = s.doc_mut()?;
    let mut calc = gridcraft_calc::Calc::new();
    calc.rebuild(&wb);
    d.wb = wb;
    d.calc = calc;
    d.revision = d.revision.wrapping_add(1);
    Ok(())
}

/// Replaces the active document's workbook with `wb` (a resync from the server).
pub fn replace(s: &mut Session, wb: Workbook) -> Result<()> {
    let wb = Arc::new(wb);
    restore(s, wb.clone())?;
    let d = s.doc_mut()?;
    d.saved = wb;
    Ok(())
}

/// A message from the live server, as the editor receives it.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Incoming {
    /// A step the server accepted, in its order. `clientCommandId` is set for this editor's own.
    #[serde(rename_all = "camelCase")]
    Applied { seq: u64, client_command_id: Option<String>, step: Box<LiveStep> },
    /// The server refused this editor's step (a role, a deleted sheet): resync.
    #[serde(rename_all = "camelCase")]
    Rejected { client_command_id: String },
}

/// What the editor must do after a message.
#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    Ok,
    /// The editor and the server no longer agree: load the server's workbook.
    NeedResync,
}

/// The editor's side of live co-editing. Its own steps show at once; until the server confirms
/// them they are pending. When someone else's step arrives first, the editor goes back to the
/// last confirmed workbook, applies theirs, then its own again, so every editor ends in the
/// server's order.
#[derive(Debug, Default)]
pub struct Client {
    pending: std::collections::VecDeque<(String, LiveStep)>,
    /// The workbook as the server had it before the first pending step.
    base: Option<Arc<Workbook>>,
    /// The workbook at the end of the last frame.
    last: Option<Arc<Workbook>>,
    /// The last sequence number applied.
    pub seq: u64,
    prefix: String,
    counter: u64,
}

impl Client {
    /// `prefix` makes this editor's step ids unique (a random id per page).
    pub fn new(prefix: &str, seq: u64) -> Client {
        Client { prefix: prefix.to_string(), seq, ..Client::default() }
    }

    /// Steps this person made since the last call, with their ids, to send to the server.
    pub fn outgoing(&mut self, s: &mut Session) -> Vec<(String, LiveStep)> {
        let steps = s.take_live_steps();
        if steps.is_empty() {
            return Vec::new();
        }
        if self.pending.is_empty() {
            // `last` is always set by then (end_frame or resynced); the workbook now would already
            // hold these steps, so it is never a safe fallback.
            self.base = self.last.clone();
        }
        steps
            .into_iter()
            .map(|step| {
                self.counter += 1;
                let id = format!("{}-{}", self.prefix, self.counter);
                self.pending.push_back((id.clone(), step.clone()));
                (id, step)
            })
            .collect()
    }

    /// Steps not confirmed yet (shown to the person already).
    pub fn pending(&self) -> usize {
        self.pending.len()
    }

    /// Handles one message from the server.
    pub fn receive(&mut self, s: &mut Session, message: &Incoming) -> Outcome {
        match message {
            Incoming::Rejected { .. } => Outcome::NeedResync,
            Incoming::Applied { seq, client_command_id, step } => {
                if *seq <= self.seq {
                    return Outcome::Ok; // already applied (a replay after reconnecting)
                }
                self.seq = *seq;
                if let Some(id) = client_command_id
                    && self.pending.front().is_some_and(|(p, _)| p == id)
                {
                    self.pending.pop_front();
                    if self.pending.is_empty() {
                        self.base = None;
                    } else if let Some(base) = self.base.take() {
                        // The confirmed workbook moves on by this step.
                        let mut shadow = Session::new();
                        shadow.add_document(crate::DocState::from_saved((*base).clone(), None, "Book".into(), Trust::Local));
                        if apply(&mut shadow, step).is_err() {
                            return Outcome::NeedResync;
                        }
                        self.base = shadow.active().map(|d| d.wb.clone());
                    }
                    return Outcome::Ok;
                }
                if client_command_id.is_some() {
                    return Outcome::NeedResync; // our own, out of order: should not happen
                }
                if self.pending.is_empty() {
                    return if apply(s, step).is_ok() { Outcome::Ok } else { Outcome::NeedResync };
                }
                // Someone else's step came first: back to the confirmed workbook, theirs, then ours,
                // shifted through any rows or columns theirs inserted or deleted, as the server does.
                let Some(base) = self.base.clone() else { return Outcome::NeedResync };
                if restore(s, base).is_err() {
                    return Outcome::NeedResync;
                }
                let Ok((_, edits)) = apply_logged(s, step) else { return Outcome::NeedResync };
                self.base = s.active().map(|d| d.wb.clone());
                let mut shifted = std::collections::VecDeque::new();
                for (id, own) in self.pending.drain(..) {
                    let Some(own) = rebase(&own, &edits) else { return Outcome::NeedResync };
                    if apply(s, &own).is_err() {
                        return Outcome::NeedResync;
                    }
                    shifted.push_back((id, own));
                }
                self.pending = shifted;
                Outcome::Ok
            }
        }
    }

    /// After a resync (the session already holds the server's workbook): nothing pending, the
    /// server's sequence number, and that workbook as the starting point for the next change.
    pub fn resynced(&mut self, s: &Session, seq: u64) {
        self.pending.clear();
        self.base = None;
        self.last = s.active().map(|d| d.wb.clone());
        self.seq = seq;
    }

    /// Call at the end of every frame.
    pub fn end_frame(&mut self, s: &Session) {
        self.last = s.active().map(|d| d.wb.clone());
    }
}

// --- Shifting a change through others' structural edits (Decision 56) -------------------------

/// The structural edits a step made: (sheet name, edit), as formulas were adjusted for them.
pub type Edits = Vec<(String, gridcraft_formula::adjust::Edit)>;

/// Like [`apply`], also answering the structural edits the step made (rows, columns, cells).
pub fn apply_logged(s: &mut Session, step: &LiveStep) -> std::result::Result<(Json, Edits), ApplyError> {
    if let Ok(d) = s.doc_mut() {
        d.edits = Some(Vec::new());
    }
    let result = apply(s, step);
    let edits = s.doc_mut().ok().and_then(|d| d.edits.take()).unwrap_or_default();
    result.map(|r| (r, edits))
}

/// `text` (a reference or a formula without `=`) on sheet `host`, through `edits`; None when a
/// reference it needs was deleted.
fn shift_text(text: &str, host: &str, edits: &[(String, gridcraft_formula::adjust::Edit)], allow_ref_errors: bool) -> Option<String> {
    let mut e = gridcraft_formula::parse(text).ok()?;
    for (target, edit) in edits {
        e = gridcraft_formula::adjust::adjust(e, host, target, edit);
    }
    let out = gridcraft_formula::print(&e);
    (allow_ref_errors || !out.contains("#REF!")).then_some(out)
}

fn shift_cell(c: CellRef, host: &str, edits: &Edits) -> Option<CellRef> {
    shift_text(&c.a1(), host, edits, false).and_then(|t| CellRef::parse(&t))
}

fn shift_range(r: RangeRef, host: &str, edits: &Edits) -> Option<RangeRef> {
    let text = if r.start == r.end { r.start.a1() } else { r.a1() };
    let out = shift_text(&text, host, edits, false)?;
    RangeRef::parse(&out).or_else(|| CellRef::parse(&out).map(|c| RangeRef::new(c, c)))
}

/// Parameters that name cells, shifted with them.
const REF_KEYS: &[&str] = &["cell", "range", "at", "to", "target", "dest", "destination", "source", "ref", "address"];

/// `step` moved through structural edits made by others after it was sent: its selection, the
/// cells its parameters name, and references in a formula it types. None when a cell it needs
/// was deleted (the sender resyncs).
pub fn rebase(step: &LiveStep, edits: &Edits) -> Option<LiveStep> {
    if edits.is_empty() {
        return Some(step.clone());
    }
    let host = step.sheet_name.as_str();
    let mut out = step.clone();
    out.selection.active = shift_cell(step.selection.active, host, edits)?;
    out.selection.anchor = shift_cell(step.selection.anchor, host, edits).unwrap_or(out.selection.active);
    out.selection.ranges = step.selection.ranges.iter().map(|r| shift_range(*r, host, edits)).collect::<Option<Vec<_>>>()?;
    if let Some(params) = out.params.as_object_mut() {
        for key in REF_KEYS {
            if let Some(Json::String(text)) = params.get(*key)
                && (CellRef::parse(text).is_some() || RangeRef::parse(text).is_some())
            {
                let shifted = shift_text(text, host, edits, false)?;
                params.insert((*key).to_string(), Json::String(shifted));
            }
        }
        if let Some(Json::String(input)) = params.get("input")
            && let Some(formula) = input.strip_prefix('=')
            && let Some(shifted) = shift_text(formula, host, edits, true)
        {
            params.insert("input".into(), Json::String(format!("={shifted}")));
        }
    }
    Some(out)
}

// --- The server's side (Decisions 22, 56) --------------------------------------------------------

/// What a person may change live, from their token.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LiveRole {
    Editor,
    Commenter,
    Viewer,
}

/// Why the server refused a step.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Refusal {
    /// The person's role doesn't allow it (P3-ROLE-*).
    NotAllowed,
    /// A cell it needs was deleted, or it is too old to place: the sender resyncs.
    Stale,
    /// The command itself refused (a protected sheet…).
    Refused(String),
}

/// Comment commands a Commenter may send (Decision 22).
const COMMENT_COMMANDS: &[&str] = &["review.newComment", "review.newNote", "review.replyComment", "review.resolveComment", "review.deleteComment"];

/// Commands that never run on the shared workbook: files, scripts and macros.
const NEVER_LIVE: &[&str] = &["file.", "automate.", "macro.", "python.", "data.getData", "data.refresh"];

/// How many accepted steps the server remembers for shifting late ones.
const HISTORY: usize = 2000;

/// The server's live session for one workbook: the authoritative order of changes.
pub struct Server {
    pub session: Session,
    /// The last sequence number given out.
    pub seq: u64,
    /// Recent steps' structural edits, for shifting late steps: (seq, user, edits).
    history: std::collections::VecDeque<(u64, String, Edits)>,
    /// Recent client command ids per user, so a retried step applies once (P3-ORDER-03).
    seen: std::collections::HashMap<String, std::collections::VecDeque<String>>,
}

impl Server {
    /// A server session holding `wb`, continuing after sequence number `seq`.
    pub fn new(wb: Workbook, seq: u64) -> Server {
        let mut session = Session::new();
        session.add_document(crate::DocState::from_saved(wb, None, "Book".into(), Trust::FromFile));
        Server { session, seq, history: Default::default(), seen: Default::default() }
    }

    /// True when `user` already sent `client_command_id`.
    pub fn seen(&self, user: &str, client_command_id: &str) -> bool {
        self.seen.get(user).is_some_and(|ids| ids.iter().any(|i| i == client_command_id))
    }

    /// Checks, shifts and applies one step from `user` (named `author` for comments), sent after
    /// they had seen `base_seq`. On success answers the new sequence number and the step as
    /// applied (send it to everyone).
    pub fn submit(
        &mut self,
        user: &str,
        author: &str,
        role: LiveRole,
        client_command_id: &str,
        base_seq: u64,
        step: &LiveStep,
    ) -> std::result::Result<(u64, LiveStep), Refusal> {
        if NEVER_LIVE.iter().any(|p| step.id.starts_with(p)) {
            return Err(Refusal::NotAllowed);
        }
        match role {
            LiveRole::Viewer => return Err(Refusal::NotAllowed),
            LiveRole::Commenter if !COMMENT_COMMANDS.contains(&step.id.as_str()) => return Err(Refusal::NotAllowed),
            _ => {}
        }
        // Shift through others' structural edits since the sender's view.
        let oldest = self.history.front().map(|(seq, ..)| *seq).unwrap_or(self.seq.saturating_add(1));
        if base_seq < self.seq && base_seq.saturating_add(1) < oldest {
            return Err(Refusal::Stale);
        }
        let edits: Edits = self.history.iter().filter(|(seq, who, _)| *seq > base_seq && who != user).flat_map(|(_, _, e)| e.clone()).collect();
        let mut step = rebase(step, &edits).ok_or(Refusal::Stale)?;
        // The author of a comment is always the signed-in person (P3-ROLE-04).
        if step.id.starts_with("review.")
            && let Some(params) = step.params.as_object_mut()
        {
            params.insert("author".into(), Json::String(author.to_string()));
        }
        if role == LiveRole::Commenter
            && matches!(step.id.as_str(), "review.deleteComment" | "review.resolveComment")
            && !self.own_comment(&step, author)
        {
            return Err(Refusal::NotAllowed); // someone else's comment (P3-ROLE-03)
        }
        let before = self.session.active().map(|d| d.wb.clone());
        let (_, edits) = match apply_logged(&mut self.session, &step) {
            Ok(applied) => applied,
            Err(ApplyError::SheetGone) => return Err(Refusal::Stale),
            Err(ApplyError::Refused(why)) => {
                if let Some(wb) = before {
                    let _ = restore(&mut self.session, wb);
                }
                return Err(Refusal::Refused(why));
            }
        };
        self.seq += 1;
        self.history.push_back((self.seq, user.to_string(), edits));
        while self.history.len() > HISTORY {
            self.history.pop_front();
        }
        let ids = self.seen.entry(user.to_string()).or_default();
        ids.push_back(client_command_id.to_string());
        while ids.len() > 500 {
            ids.pop_front();
        }
        Ok((self.seq, step))
    }

    /// Takes a step back out (storing it failed): the workbook goes back to `wb`.
    pub fn undo_last(&mut self, wb: Arc<Workbook>) {
        let _ = restore(&mut self.session, wb);
        if let Some((seq, ..)) = self.history.back()
            && *seq == self.seq
        {
            self.history.pop_back();
        }
        self.seq = self.seq.saturating_sub(1);
    }

    /// The workbook now.
    pub fn workbook(&self) -> Option<Arc<Workbook>> {
        self.session.active().map(|d| d.wb.clone())
    }

    fn own_comment(&self, step: &LiveStep, author: &str) -> bool {
        let at = step.params.get("cell").and_then(Json::as_str).and_then(CellRef::parse).unwrap_or(step.selection.active);
        self.session
            .active()
            .and_then(|d| d.wb.sheets.iter().find(|s| s.name == step.sheet_name).cloned())
            .and_then(|sheet| sheet.comments.get(&at).map(|c| c.author == author))
            .unwrap_or(true)
    }
}

/// `live.setCells {sheet, cells: [[a1, cell | null]]}`: puts cells back exactly as given (undo
/// and redo while live). Formulas are parsed again and the workbook recalculates.
pub(crate) fn set_cells(s: &mut Session, p: &Json) -> Result<Json> {
    let name = p.get("sheet").and_then(Json::as_str).ok_or_else(|| EngineError::Other("live.setCells: missing sheet".into()))?;
    let cells = p.get("cells").and_then(Json::as_array).cloned().unwrap_or_default();
    crate::cmd::edit(s, |cx| {
        let i = cx.wb.sheets.iter().position(|sh| sh.name == name).ok_or_else(|| EngineError::Other(CANT_UNDO.into()))?;
        for entry in &cells {
            let Some(at) = entry.get(0).and_then(Json::as_str).and_then(CellRef::parse) else { continue };
            let cell: Option<Cell> = entry.get(1).cloned().and_then(|v| serde_json::from_value(v).ok());
            let sheet = cx.sheet_mut(i)?;
            match cell {
                Some(mut cell) => {
                    rehydrate(&mut cell);
                    sheet.cells.set(at, cell);
                }
                None => {
                    sheet.cells.remove(at);
                }
            }
            cx.touch(i, at);
        }
        Ok(Json::Null)
    })
}

pub(crate) fn specs() -> Vec<crate::cmd::CommandSpec> {
    vec![crate::cmd::cmd!(noundo "live.setCells", "Restore cells", [], None, "{sheet, cells: [[a1, cell | null]]}", crate::cmd::has_doc, set_cells)]
}

#[cfg(test)]
mod tests;
