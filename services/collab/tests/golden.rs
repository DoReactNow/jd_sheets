//! Golden workbooks (golden/README.md, X-UPSTREAM-03, P0-VAL-01): files written by the pinned
//! GridCraft must open with the expected values, and survive a save and reopen.
//! GOLDEN_WRITE=1 regenerates the .xlsx files from their specs.
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use jd_collab::config::Limits;
use jd_collab::engine::{build_from_commands, display_text, open_xlsx, to_xlsx};
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
struct Spec {
    #[serde(default)]
    generate: Option<Generate>,
    commands: Vec<(String, Value)>,
    expect: BTreeMap<String, String>,
}

/// A grid of numbers: the cell in row r, column c holds r × c.
#[derive(Deserialize)]
struct Generate {
    rows: u32,
    columns: u32,
}

fn golden_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../golden")
}

fn column_name(mut index: u32) -> String {
    let mut name = String::new();
    while index > 0 {
        let rem = (index - 1) % 26;
        name.insert(0, char::from(b'A' + rem as u8));
        index = (index - 1) / 26;
    }
    name
}

fn commands_of(spec: &Spec) -> Vec<(String, Value)> {
    let mut commands = spec.commands.clone();
    if let Some(grid) = &spec.generate {
        for r in 1..=grid.rows {
            for c in 1..=grid.columns {
                let cell = format!("{}{r}", column_name(c));
                commands.push((
                    "cell.set".into(),
                    serde_json::json!({ "cell": cell, "input": (r * c).to_string() }),
                ));
            }
        }
    }
    commands
}

fn specs() -> Vec<(String, Spec)> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(golden_dir()) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().is_some_and(|e| e == "json") {
            let name = path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            let text = std::fs::read_to_string(&path).unwrap_or_default();
            match serde_json::from_str::<Spec>(&text) {
                Ok(spec) => out.push((name, spec)),
                Err(error) => out.push((
                    format!("{name} (unparsable: {error})"),
                    Spec {
                        generate: None,
                        commands: vec![],
                        expect: BTreeMap::from([("!".into(), "unparsable spec".into())]),
                    },
                )),
            }
        }
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

fn check(name: &str, bytes: &[u8], expect: &BTreeMap<String, String>, problems: &mut Vec<String>) {
    let workbook = match open_xlsx(bytes, &Limits::default()) {
        Ok(workbook) => workbook,
        Err(error) => return problems.push(format!("{name}: does not open ({error})")),
    };
    for (at, want) in expect {
        let Some((sheet, cell)) = at.rsplit_once('!') else {
            problems.push(format!("{name}: bad address {at}"));
            continue;
        };
        let got = display_text(&workbook, sheet, cell);
        if got.as_deref() != Some(want.as_str()) {
            problems.push(format!("{name} {at}: expected {want:?}, got {got:?}"));
        }
    }
}

#[test]
fn golden_workbooks_open_with_their_values_and_survive_a_round_trip() {
    let specs = specs();
    assert!(specs.len() >= 6, "golden specs missing");
    let write = std::env::var("GOLDEN_WRITE").is_ok_and(|v| v == "1");
    let mut problems = Vec::new();
    for (name, spec) in &specs {
        let file: PathBuf = golden_dir().join(format!("{name}.xlsx"));
        if write {
            match build_from_commands(&commands_of(spec)) {
                Ok(bytes) => {
                    if let Err(error) = std::fs::write(&file, bytes) {
                        problems.push(format!("{name}: cannot write: {error}"));
                    }
                }
                Err(error) => problems.push(format!("{name}: command failed: {error}")),
            }
        }
        let Ok(bytes) = std::fs::read(Path::new(&file)) else {
            problems.push(format!("{name}: {name}.xlsx is missing (run with GOLDEN_WRITE=1)"));
            continue;
        };
        check(name, &bytes, &spec.expect, &mut problems);
        // Round trip: open, save with today's GridCraft, reopen.
        match open_xlsx(&bytes, &Limits::default()).and_then(|wb| to_xlsx(&wb)) {
            Ok(saved) => check(&format!("{name} (after save)"), &saved, &spec.expect, &mut problems),
            Err(error) => problems.push(format!("{name}: does not save ({error})")),
        }
    }
    assert_eq!(problems, Vec::<String>::new());
}
