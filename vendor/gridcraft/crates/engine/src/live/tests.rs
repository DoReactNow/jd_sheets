//! JD Sheets W-302: replaying live steps gives the same workbook (the risk Phase 3 rests on).
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use serde_json::json;

use super::*;
use crate::command_specs;

/// A session with a small table on two sheets, the selection on B2:D6.
fn seeded() -> Session {
    let mut s = Session::new();
    s.new_workbook();
    s.execute("range.setValues", json!({"range": "A1:D6", "values": [
        ["Item", "Qty", "Price", "Total"],
        ["Tea", 3, 10, "=B2*C2"],
        ["Coffee", 1, 25, "=B3*C3"],
        ["Sugar", 7, 2, "=B4*C4"],
        ["Milk", 2, 12, "=B5*C5"],
        ["Sum", "=SUM(B2:B5)", "", "=SUM(D2:D5)"]
    ]})).unwrap();
    s.execute("home.insertSheet", json!({})).unwrap();
    s.execute("range.setValues", json!({"range": "A1:B2", "values": [["x", 1], ["y", "=Sheet1!D6"]]})).unwrap();
    s.execute("sheet.activate", json!({"sheet": 0})).unwrap();
    s.execute("selection.set", json!({"range": "B2:D6"})).unwrap();
    s
}

/// A second session holding the same workbook, as the server or another person would.
fn replica_of(a: &Session) -> Session {
    let mut b = Session::new();
    let wb = (*a.active().unwrap().wb).clone();
    b.add_document(crate::DocState::from_saved(wb, None, "Book".into(), Trust::Local));
    b
}

fn same(a: &Session, b: &Session) -> bool {
    let wa = a.active().unwrap().wb.clone();
    let wb = b.active().unwrap().wb.clone();
    wb.set_active_sheet(wa.active_sheet());
    *wa == *wb
}

/// The step as the other side receives it: through JSON, as over the WebSocket.
fn over_the_wire(step: &LiveStep) -> LiveStep {
    serde_json::from_str(&serde_json::to_string(step).unwrap()).unwrap()
}

/// Runs `commands` on A (capturing), applies the captured steps to B, compares.
fn replays(commands: &[(&str, serde_json::Value)]) -> std::result::Result<(), String> {
    let mut a = seeded();
    let mut b = replica_of(&a);
    a.start_live();
    for (id, params) in commands {
        a.execute(id, params.clone()).map_err(|e| format!("{id} failed on A: {e}"))?;
    }
    for step in a.take_live_steps() {
        let step = over_the_wire(&step);
        apply(&mut b, &step).map_err(|e| format!("{} failed on B: {e:?}", step.id))?;
    }
    if same(&a, &b) { Ok(()) } else { Err("workbooks differ".into()) }
}

#[test]
fn typing_formulas_and_formats_replay_exactly() {
    let cases: Vec<Vec<(&str, serde_json::Value)>> = vec![
        vec![("cell.set", json!({"cell": "E2", "input": "=D2*1.18"}))],
        vec![("selection.set", json!({"range": "B2"})), ("cell.set", json!({"input": "9"}))],
        vec![("home.bold", json!({})), ("home.italic", json!({}))],
        vec![("selection.set", json!({"range": "A1:D1"})), ("home.fillColor", json!({"color": "#FFEE00"}))],
        vec![("range.setValues", json!({"range": "F1:F3", "values": [[1], [2], [3]]}))],
        vec![("review.newComment", json!({"cell": "C3", "text": "Check", "author": "Asha"}))],
        vec![("home.insertSheet", json!({})), ("cell.set", json!({"cell": "A1", "input": "new"}))],
    ];
    for case in cases {
        assert_eq!(replays(&case), Ok(()), "{case:?}");
    }
}

#[test]
fn copy_cut_and_paste_replay_with_the_carried_cells() {
    let copy_paste = vec![
        ("selection.set", json!({"range": "A2:D3"})),
        ("edit.copy", json!({})),
        ("selection.set", json!({"range": "A10"})),
        ("edit.paste", json!({})),
    ];
    assert_eq!(replays(&copy_paste), Ok(()));
    let cut_paste = vec![
        ("selection.set", json!({"range": "A4:D4"})),
        ("edit.cut", json!({})),
        ("selection.set", json!({"range": "F8"})),
        ("edit.paste", json!({})),
    ];
    assert_eq!(replays(&cut_paste), Ok(()));
}

#[test]
fn view_changes_are_never_captured() {
    let mut a = seeded();
    a.start_live();
    a.execute("selection.set", json!({"range": "C4"})).unwrap();
    a.execute("sheet.activate", json!({"sheet": 1})).unwrap();
    assert!(a.take_live_steps().is_empty());
}

#[test]
fn applied_steps_are_not_captured_again() {
    let mut a = seeded();
    let mut b = replica_of(&a);
    a.start_live();
    b.start_live();
    a.execute("cell.set", json!({"cell": "A9", "input": "x"})).unwrap();
    for step in a.take_live_steps() {
        apply(&mut b, &step).unwrap();
    }
    assert!(b.take_live_steps().is_empty());
}

#[test]
fn a_step_on_a_deleted_sheet_is_refused() {
    let mut a = seeded();
    let mut b = replica_of(&a);
    a.start_live();
    a.execute("sheet.activate", json!({"sheet": 1})).unwrap();
    a.execute("cell.set", json!({"cell": "C1", "input": "late"})).unwrap();
    let steps = a.take_live_steps();
    b.execute("sheet.activate", json!({"sheet": 1})).unwrap();
    b.execute("home.deleteSheet", json!({})).unwrap();
    assert!(matches!(apply(&mut b, &steps[0]), Err(ApplyError::SheetGone)));
}

/// Commands that need the outside world (files, scripts, the network, the system) are out of scope.
const SKIP: &[&str] = &["edit.undo", "edit.redo", "file.", "automate.", "macro.", "python.", "data.getData", "data.refresh", "help.", "links.", "spelling", "review.addToDictionary", "insert.picture", "insert.onlinePicture"];

/// Every command with no parameters on the seeded workbook: when it changes the workbook, its
/// replay must give the same workbook. Prints the ones that don't, so they can be sent as changed
/// cells instead.
#[test]
fn every_command_replays_exactly() {
    let mut differ = Vec::new();
    let mut checked = 0;
    for spec in command_specs() {
        if SKIP.iter().any(|p| spec.id.starts_with(p)) || is_view_only(spec.id) {
            continue;
        }
        let mut a = seeded();
        let mut b = replica_of(&a);
        a.start_live();
        if a.execute(spec.id, json!({})).is_err() {
            continue;
        }
        let steps = a.take_live_steps();
        if steps.is_empty() {
            continue;
        }
        checked += 1;
        let applied = steps.iter().all(|step| apply(&mut b, &over_the_wire(step)).is_ok());
        if !applied || !same(&a, &b) {
            differ.push(spec.id);
        }
    }
    println!("checked {checked} changing commands; not exact: {differ:?}");
    assert!(checked > 40, "only {checked} commands changed the workbook");
    assert!(differ.is_empty(), "not exact on replay: {differ:?}");
}


/// A, B: two people editing; every step goes to the other, as through the server.
fn exchange(from: &mut Session, to: &mut Session) {
    for step in from.take_live_steps() {
        apply(to, &over_the_wire(&step)).unwrap();
    }
}

fn text(s: &Session, a1: &str) -> String {
    let wb = s.active().unwrap().wb.clone();
    crate::display::cell_text(&wb, &wb.sheets[0], gridcraft_core::CellRef::parse(a1).unwrap())
}

#[test]
fn undo_reverses_only_your_own_changes_for_everyone() {
    let mut a = seeded();
    let mut b = replica_of(&a);
    a.start_live();
    b.start_live();
    a.execute("cell.set", json!({"cell": "A9", "input": "mine"})).unwrap();
    exchange(&mut a, &mut b);
    b.execute("cell.set", json!({"cell": "B9", "input": "theirs"})).unwrap();
    exchange(&mut b, &mut a);
    // A's undo removes A's edit only, on both sides.
    a.execute("edit.undo", json!({})).unwrap();
    exchange(&mut a, &mut b);
    assert_eq!((text(&a, "A9"), text(&a, "B9")), (String::new(), "theirs".to_string()));
    assert!(same(&a, &b));
    // Redo brings it back.
    a.execute("edit.redo", json!({})).unwrap();
    exchange(&mut a, &mut b);
    assert_eq!(text(&b, "A9"), "mine");
    assert!(same(&a, &b));
}

#[test]
fn undo_leaves_a_cell_someone_else_changed_since() {
    let mut a = seeded();
    let mut b = replica_of(&a);
    a.start_live();
    b.start_live();
    a.execute("cell.set", json!({"cell": "A9", "input": "mine"})).unwrap();
    exchange(&mut a, &mut b);
    b.execute("cell.set", json!({"cell": "A9", "input": "theirs now"})).unwrap();
    exchange(&mut b, &mut a);
    let _ = a.execute("edit.undo", json!({}));
    exchange(&mut a, &mut b);
    assert_eq!(text(&a, "A9"), "theirs now");
    assert!(same(&a, &b));
}

#[test]
fn undo_of_a_structural_change_says_it_cannot() {
    let mut a = seeded();
    a.start_live();
    a.execute("home.insertSheet", json!({})).unwrap();
    let refused = a.execute("edit.undo", json!({}));
    assert!(matches!(refused, Err(crate::EngineError::Other(ref m)) if m == CANT_UNDO), "{refused:?}");
}

#[test]
fn pasted_formulas_still_calculate_after_the_wire() {
    let commands = vec![
        ("selection.set", json!({"range": "D2:D3"})),
        ("edit.copy", json!({})),
        ("selection.set", json!({"range": "D20"})),
        ("edit.paste", json!({})),
        ("cell.set", json!({"cell": "B20", "input": "5"})),
        ("cell.set", json!({"cell": "C20", "input": "4"})),
    ];
    assert_eq!(replays(&commands), Ok(()));
}
