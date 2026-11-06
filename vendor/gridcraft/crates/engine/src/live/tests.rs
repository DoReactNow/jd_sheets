//! JD Sheets W-302: replaying live steps gives the same workbook (the risk Phase 3 rests on).
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use serde_json::json;

use super::*;
use crate::command_specs;

/// A session with a small table on two sheets, the selection on B2:D6.
fn seeded() -> Session {
    let mut s = Session::new();
    s.new_workbook();
    s.execute(
        "range.setValues",
        json!({"range": "A1:D6", "values": [
            ["Item", "Qty", "Price", "Total"],
            ["Tea", 3, 10, "=B2*C2"],
            ["Coffee", 1, 25, "=B3*C3"],
            ["Sugar", 7, 2, "=B4*C4"],
            ["Milk", 2, 12, "=B5*C5"],
            ["Sum", "=SUM(B2:B5)", "", "=SUM(D2:D5)"]
        ]}),
    )
    .unwrap();
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
const SKIP: &[&str] = &[
    "edit.undo",
    "edit.redo",
    "file.",
    "automate.",
    "macro.",
    "python.",
    "data.getData",
    "data.refresh",
    "help.",
    "links.",
    "spelling",
    "review.addToDictionary",
    "insert.picture",
    "insert.onlinePicture",
];

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

/// A tiny deterministic random source, so failures replay exactly.
struct Lcg(u64);
impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        self.0 >> 33
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n.max(1)
    }
}

/// A random edit, as a person would make it, including rows and columns inserted and deleted.
fn random_edit(r: &mut Lcg, who: usize) -> (&'static str, serde_json::Value) {
    let cell = format!("{}{}", ["A", "B", "C", "D", "E"][r.below(5) as usize], 1 + r.below(8));
    match r.below(10) {
        0 | 1 => ("cell.set", json!({"cell": cell, "input": format!("v{who}-{}", r.below(100))})),
        2 => ("cell.set", json!({"cell": cell, "input": format!("=B2+{}", r.below(50))})),
        3 => ("selection.set", json!({"range": cell})),
        4 => ("home.bold", json!({})),
        5 => ("review.newComment", json!({"cell": cell, "text": format!("from {who}"), "author": format!("P{who}")})),
        6 => ("home.insertRows", json!({})),
        7 => ("home.deleteRows", json!({})),
        8 => ("home.insertColumns", json!({})),
        _ => ("range.setValues", json!({"range": format!("F{}", 1 + r.below(5)), "values": [[who]]})),
    }
}

/// P3-CONV-01 (engine level): editors with random edits (rows and columns included), random
/// delays and random ordering at the server all end with the server's workbook.
#[test]
fn editors_and_server_converge() {
    let mut total_resyncs = 0;
    for seed in 1..=60u64 {
        let mut r = Lcg(seed);
        let people = 2 + (seed % 7) as usize;
        let start = seeded();
        let mut server = Server::new((*start.active().unwrap().wb).clone(), 0);
        let mut editors: Vec<(Session, Client)> = (0..people)
            .map(|i| {
                let mut s = replica_of(&start);
                s.start_live();
                let mut c = Client::new(&format!("p{i}"), 0);
                c.end_frame(&s);
                (s, c)
            })
            .collect();
        let mut to_server: std::collections::VecDeque<(usize, String, u64, LiveStep)> = Default::default();
        let mut to_editor: Vec<std::collections::VecDeque<Incoming>> = vec![Default::default(); people];
        let deliver = |server: &mut Server,
                       to_editor: &mut Vec<std::collections::VecDeque<Incoming>>,
                       (who, ccid, base, step): (usize, String, u64, LiveStep)| {
            match server.submit(&format!("u{who}"), &format!("P{who}"), LiveRole::Editor, &ccid, base, &step) {
                Ok((seq, applied)) => {
                    for (i, queue) in to_editor.iter_mut().enumerate() {
                        queue.push_back(Incoming::Applied {
                            seq,
                            client_command_id: (i == who).then(|| ccid.clone()),
                            step: Box::new(applied.clone()),
                        });
                    }
                }
                Err(_) => to_editor[who].push_back(Incoming::Rejected { client_command_id: ccid }),
            }
        };
        let resync = |s: &mut Session, c: &mut Client, server: &Server, queue: &mut std::collections::VecDeque<Incoming>| {
            replace(s, (*server.workbook().unwrap()).clone()).unwrap();
            c.resynced(s, server.seq);
            queue.clear();
        };
        for _round in 0..400 {
            match r.below(3) {
                0 => {
                    let who = r.below(people as u64) as usize;
                    let (id, params) = random_edit(&mut r, who);
                    let (s, c) = &mut editors[who];
                    let _ = s.execute(id, params);
                    let base = c.seq;
                    for (ccid, step) in c.outgoing(s) {
                        to_server.push_back((who, ccid, base, over_the_wire(&step)));
                    }
                    c.end_frame(s);
                }
                1 => {
                    if let Some(sent) = to_server.pop_front() {
                        deliver(&mut server, &mut to_editor, sent);
                    }
                }
                _ => {
                    let who = r.below(people as u64) as usize;
                    if let Some(message) = to_editor[who].pop_front() {
                        let (s, c) = &mut editors[who];
                        if c.receive(s, &message) == Outcome::NeedResync {
                            total_resyncs += 1;
                            resync(s, c, &server, &mut to_editor[who]);
                            to_server.retain(|(w, ..)| *w != who);
                        }
                        c.end_frame(s);
                    }
                }
            }
        }
        while let Some(sent) = to_server.pop_front() {
            deliver(&mut server, &mut to_editor, sent);
        }
        for who in 0..people {
            let (s, c) = &mut editors[who];
            while let Some(message) = to_editor[who].pop_front() {
                if c.receive(s, &message) == Outcome::NeedResync {
                    total_resyncs += 1;
                    resync(s, c, &server, &mut to_editor[who]);
                }
            }
            assert_eq!(c.pending(), 0, "seed {seed}: editor {who} still has pending steps");
            if !same(s, &server.session) {
                let (x, y) = (s.active().unwrap().wb.clone(), server.workbook().unwrap());
                for (i, (a, b)) in x.sheets.iter().zip(&y.sheets).enumerate() {
                    for c in a.cells.diff(&b.cells).iter().take(3) {
                        println!("sheet {i} {}: editor {:?}\n   server {:?}", c.a1(), a.cells.get(*c), b.cells.get(*c));
                    }
                }
            }
            assert!(same(s, &server.session), "seed {seed}: editor {who} differs from the server");
        }
    }
    println!("{total_resyncs} resyncs in 60 runs");
}

/// P3-REBASE-01, -02, -03: different cells both stay; the same cell takes the later change; an
/// edit sent before someone inserted rows above it lands on the shifted cell, for everyone.
#[test]
fn late_steps_shift_with_rows_inserted_by_others() {
    let start = seeded();
    let mut server = Server::new((*start.active().unwrap().wb).clone(), 0);
    let step_of = |s: &mut Session, id: &str, params: serde_json::Value| {
        s.start_live();
        s.execute(id, params).unwrap();
        s.take_live_steps().pop().unwrap()
    };
    let mut a = replica_of(&start);
    let mut b = replica_of(&start);
    // A inserts two rows above row 3; B, not knowing, types into C5 (its "Sugar" row's price).
    a.execute("selection.set", json!({"range": "A3:A4"})).unwrap();
    let insert = step_of(&mut a, "home.insertRows", json!({}));
    let typed = step_of(&mut b, "cell.set", json!({"cell": "C4", "input": "99"}));
    server.submit("ua", "A", LiveRole::Editor, "a-1", 0, &insert).unwrap();
    let (_, applied) = server.submit("ub", "B", LiveRole::Editor, "b-1", 0, &typed).unwrap();
    assert_eq!(applied.params["cell"], "C6");
    let text = |server: &Server, a1: &str| {
        let wb = server.workbook().unwrap();
        crate::display::cell_text(&wb, &wb.sheets[0], gridcraft_core::CellRef::parse(a1).unwrap())
    };
    assert_eq!((text(&server, "A6"), text(&server, "C6")), ("Sugar".to_string(), "99".to_string()));
    // Same cell, sent at the same time: the later one wins (P3-REBASE-02).
    let first = step_of(&mut a, "cell.set", json!({"cell": "E1", "input": "first"}));
    let second = step_of(&mut b, "cell.set", json!({"cell": "E1", "input": "second"}));
    server.submit("ua", "A", LiveRole::Editor, "a-2", 2, &first).unwrap();
    server.submit("ub", "B", LiveRole::Editor, "b-2", 2, &second).unwrap();
    assert_eq!(text(&server, "E1"), "second");
}

#[test]
fn an_edit_in_rows_someone_deleted_is_refused() {
    let start = seeded();
    let mut server = Server::new((*start.active().unwrap().wb).clone(), 0);
    let mut a = replica_of(&start);
    let mut b = replica_of(&start);
    a.start_live();
    b.start_live();
    a.execute("selection.set", json!({"range": "A4"})).unwrap();
    a.execute("home.deleteRows", json!({})).unwrap();
    b.execute("cell.set", json!({"cell": "C4", "input": "late"})).unwrap();
    server.submit("ua", "A", LiveRole::Editor, "a-1", 0, &a.take_live_steps()[0]).unwrap();
    assert_eq!(server.submit("ub", "B", LiveRole::Editor, "b-1", 0, &b.take_live_steps()[0]), Err(Refusal::Stale));
}

/// P3-ROLE-01..05 at the server.
#[test]
fn roles_are_checked_per_step() {
    let start = seeded();
    let mut server = Server::new((*start.active().unwrap().wb).clone(), 0);
    let mut s = replica_of(&start);
    s.start_live();
    s.execute("cell.set", json!({"cell": "A9", "input": "x"})).unwrap();
    s.execute("review.newComment", json!({"cell": "B9", "text": "hi", "author": "Someone Else"})).unwrap();
    let steps = s.take_live_steps();
    // Viewers: nothing. Commenters: comments only. Editors: both.
    assert_eq!(server.submit("v", "V", LiveRole::Viewer, "v-1", 0, &steps[1]), Err(Refusal::NotAllowed));
    assert_eq!(server.submit("c", "C", LiveRole::Commenter, "c-1", 0, &steps[0]), Err(Refusal::NotAllowed));
    let (_, applied) = server.submit("c", "Chitra", LiveRole::Commenter, "c-2", 0, &steps[1]).unwrap();
    // The author is the signed-in person, whatever the step said (P3-ROLE-04).
    assert_eq!(applied.params["author"], "Chitra");
    let wb = server.workbook().unwrap();
    let comment = wb.sheets[0].comments.get(&gridcraft_core::CellRef::parse("B9").unwrap()).unwrap();
    assert_eq!(comment.author, "Chitra");
    // A Commenter cannot delete someone else's comment (P3-ROLE-03); its author can.
    let mut t = replica_of(&start);
    t.start_live();
    t.execute("review.deleteComment", json!({"cell": "B9"})).unwrap();
    let delete = t.take_live_steps();
    // (t never had the comment, so build the delete step by hand from the selection.)
    let delete = delete.into_iter().next().unwrap_or(LiveStep {
        sheet: 0,
        sheet_name: "Sheet1".into(),
        selection: Selection::default(),
        id: "review.deleteComment".into(),
        params: json!({"cell": "B9"}),
        clipboard: None,
    });
    assert_eq!(server.submit("d", "Dev", LiveRole::Commenter, "d-1", 1, &delete), Err(Refusal::NotAllowed));
    assert!(server.submit("c", "Chitra", LiveRole::Commenter, "c-3", 1, &delete).is_ok());
    // Files and scripts never run on the shared workbook.
    let file = LiveStep { id: "file.save".into(), ..delete };
    assert_eq!(server.submit("e", "E", LiveRole::Editor, "e-1", 2, &file), Err(Refusal::NotAllowed));
}
