//! diff-kind: P2-ROLE-03 (comments only), P2-ROLE-04 (anything else), P2-ROLE-05 (someone
//! else's comment), and view changes that are not changes.
use gridcraft_engine::Session;
use serde_json::{Value, json};

use super::*;
use crate::config::Limits;
use crate::engine::open_xlsx;

const GOLDEN: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../golden/");

fn golden(name: &str) -> Workbook {
    let bytes = std::fs::read(format!("{GOLDEN}{name}")).unwrap_or_default();
    open_xlsx(&bytes, &Limits::default()).unwrap_or_else(|_| Workbook::new())
}

/// Opens `base` in a GridCraft session, runs commands as the editor would, and returns the
/// workbook it would save.
fn edited(base: &Workbook, commands: &[(&str, Value)]) -> Workbook {
    let bytes = to_xlsx(base).unwrap_or_default();
    let mut session = Session::new();
    let _ = session.execute("file.new", json!({}));
    let path = std::env::temp_dir().join(format!("jd-diff-{}.xlsx", uuid::Uuid::new_v4()));
    let _ = std::fs::write(&path, &bytes);
    let opened = session.execute("file.open", json!({ "path": path.to_string_lossy() }));
    let _ = std::fs::remove_file(&path);
    assert!(opened.is_ok(), "file.open: {opened:?}");
    for (id, params) in commands {
        let result = session.execute(id, params.clone());
        assert!(result.is_ok(), "{id}: {result:?}");
    }
    session.active().map(|doc| (*doc.wb).clone()).unwrap_or_default()
}

fn kind(base: &Workbook, new: &Workbook, author: &str) -> DiffKind {
    diff_kind(base, new, author).unwrap_or(DiffKind::Other)
}

#[test]
fn the_same_workbook_is_no_change() {
    for name in [
        "basics.xlsx",
        "formats.xlsx",
        "formulas.xlsx",
        "sheets.xlsx",
        "comments.xlsx",
    ] {
        let base = golden(name);
        assert_eq!(kind(&base, &edited(&base, &[]), "Asha"), DiffKind::None, "{name}");
    }
}

#[test]
fn looking_around_is_no_change() {
    let base = golden("sheets.xlsx");
    let new = edited(
        &base,
        &[
            ("sheet.activate", json!({ "sheet": 1 })),
            ("selection.set", json!({ "range": "C7" })),
        ],
    );
    assert_eq!(kind(&base, &new, "Asha"), DiffKind::None);
}

#[test]
fn new_comments_notes_and_replies_are_comments_only() {
    let base = golden("comments.xlsx");
    let added = edited(
        &base,
        &[(
            "review.newComment",
            json!({ "cell": "D4", "text": "Checked", "author": "Asha" }),
        )],
    );
    assert_eq!(kind(&base, &added, "Asha"), DiffKind::CommentsOnly);
    let note = edited(
        &base,
        &[(
            "review.newNote",
            json!({ "cell": "E5", "text": "Mine", "author": "Asha" }),
        )],
    );
    assert_eq!(kind(&base, &note, "Asha"), DiffKind::CommentsOnly);
    let reply = edited(
        &base,
        &[(
            "review.replyComment",
            json!({ "cell": "B2", "text": "Yes", "author": "Asha" }),
        )],
    );
    assert_eq!(kind(&base, &reply, "Asha"), DiffKind::CommentsOnly);
}

#[test]
fn content_changes_are_other() {
    let base = golden("comments.xlsx");
    let cases: Vec<(&str, Value)> = vec![
        ("cell.set", json!({ "cell": "B2", "input": "101" })),
        ("cell.set", json!({ "cell": "Z99", "input": "new" })),
        ("home.bold", json!({ "range": "B2" })),
        ("home.insertSheet", json!({})),
    ];
    for (id, params) in cases {
        let new = edited(&base, &[(id, params.clone())]);
        assert_eq!(kind(&base, &new, "Asha"), DiffKind::Other, "{id} {params}");
    }
    // A comment together with a content change is still a content change.
    let both = edited(
        &base,
        &[
            (
                "review.newComment",
                json!({ "cell": "D4", "text": "x", "author": "Asha" }),
            ),
            ("cell.set", json!({ "cell": "A1", "input": "sneaky" })),
        ],
    );
    assert_eq!(kind(&base, &both, "Asha"), DiffKind::Other);
}

#[test]
fn someone_elses_comment_cannot_be_changed_or_deleted() {
    // The golden comment on B2 is Meera's.
    let base = golden("comments.xlsx");
    let deleted = edited(&base, &[("review.deleteComment", json!({ "cell": "B2" }))]);
    assert_eq!(kind(&base, &deleted, "Asha"), DiffKind::ForeignComment);
    assert_eq!(kind(&base, &deleted, "Meera"), DiffKind::CommentsOnly);
}

#[test]
fn imports_convert_to_xlsx() {
    let limits = Limits::default();
    let csv = b"Name,Amount\nTea,10\nCoffee,=HYPERLINK(\"http://x\")\n";
    let bytes = crate::engine::convert_to_xlsx(csv, "csv", &limits).unwrap_or_default();
    let workbook = open_xlsx(&bytes, &limits).unwrap_or_else(|_| Workbook::new());
    let sheet = workbook.sheets[0].name.clone();
    assert_eq!(
        crate::engine::display_text(&workbook, &sheet, "B2").as_deref(),
        Some("10")
    );
    let tsv = crate::engine::convert_to_xlsx(b"a\tb\n1\t2\n", "TSV", &limits);
    assert!(tsv.is_ok());
    let xlsx = to_xlsx(&golden("basics.xlsx")).unwrap_or_default();
    assert!(crate::engine::convert_to_xlsx(&xlsx, "xlsx", &limits).is_ok());
    // Wrong or broken content for the extension is refused (P2-IMPORT-02).
    assert_eq!(
        crate::engine::convert_to_xlsx(&xlsx, "ods", &limits),
        Err(EngineFailure::Unreadable)
    );
    assert_eq!(
        crate::engine::convert_to_xlsx(b"\xff\xfe\x00", "csv", &limits),
        Err(EngineFailure::Unreadable)
    );
    assert_eq!(
        crate::engine::convert_to_xlsx(b"x", "xls", &limits),
        Err(EngineFailure::Unreadable)
    );
}
