//! Engine adapter tests: P0-VAL-01..07, P0-VAL-09 (golden files are checked in tests/golden.rs).
use std::io::{Cursor, Write};

use gridcraft_engine::Session;
use gridcraft_engine::io::save_bytes;
use serde_json::json;

use super::*;

fn limits() -> Limits {
    Limits::default()
}

/// A workbook made by GridCraft itself, with values and a formula.
fn sample_bytes() -> Vec<u8> {
    let mut session = Session::new();
    let _ = session.execute("file.new", json!({}));
    for (cell, input) in [("A1", "10"), ("A2", "20"), ("A3", "=SUM(A1:A2)"), ("B1", "Budget")] {
        let _ = session.execute("cell.set", json!({ "cell": cell, "input": input }));
    }
    let Some(doc) = session.active() else { return Vec::new() };
    save_bytes(&doc.wb, BOOK_NAME).unwrap_or_default()
}

fn zip_with(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut buffer = Cursor::new(Vec::new());
    {
        let mut writer = zip::ZipWriter::new(&mut buffer);
        for (name, data) in entries {
            let options = zip::write::SimpleFileOptions::default();
            if writer.start_file(*name, options).is_err() || writer.write_all(data).is_err() {
                return Vec::new();
            }
        }
        if writer.finish().is_err() {
            return Vec::new();
        }
    }
    buffer.into_inner()
}

#[test]
fn opens_a_workbook_made_by_gridcraft_with_its_values() -> Result<(), EngineFailure> {
    let workbook = open_xlsx(&sample_bytes(), &limits())?;
    assert_eq!(summarize(&workbook).sheets, vec!["Sheet1".to_string()]);
    assert_eq!(display_text(&workbook, "Sheet1", "A3").as_deref(), Some("30"));
    assert_eq!(display_text(&workbook, "Sheet1", "B1").as_deref(), Some("Budget"));
    assert_eq!(display_text(&workbook, "Nope", "A1"), None);
    Ok(())
}

#[test]
fn the_blank_workbook_opens_with_one_empty_sheet() -> Result<(), EngineFailure> {
    let workbook = open_xlsx(&blank_workbook()?, &limits())?;
    assert_eq!(summarize(&workbook).sheets.len(), 1);
    assert_eq!(
        display_text(&workbook, &summarize(&workbook).sheets[0], "A1").as_deref(),
        Some("")
    );
    Ok(())
}

#[test]
fn refuses_a_file_that_is_not_a_zip() {
    assert_eq!(
        open_xlsx(b"hello, not a workbook", &limits()).err(),
        Some(EngineFailure::Unreadable)
    );
    assert_eq!(open_xlsx(b"", &limits()).err(), Some(EngineFailure::Unreadable));
}

#[test]
fn refuses_a_zip_that_is_not_a_workbook() {
    let bytes = zip_with(&[("readme.txt", b"just a zip")]);
    assert_eq!(open_xlsx(&bytes, &limits()).err(), Some(EngineFailure::Unreadable));
}

#[test]
fn refuses_a_truncated_workbook() {
    let bytes = sample_bytes();
    let truncated = &bytes[..bytes.len() / 2];
    assert_eq!(open_xlsx(truncated, &limits()).err(), Some(EngineFailure::Unreadable));
}

#[test]
fn refuses_a_workbook_over_the_size_limit_before_reading_it() {
    let small = Limits {
        workbook_max_bytes: 100,
        ..Limits::default()
    };
    assert_eq!(open_xlsx(&sample_bytes(), &small).err(), Some(EngineFailure::TooLarge));
}

#[test]
fn refuses_a_password_protected_workbook() {
    let encrypted = gridcraft_xlsx::testing::encrypt_workbook(&sample_bytes(), "secret");
    assert_eq!(
        open_xlsx(&encrypted, &limits()).err(),
        Some(EngineFailure::PasswordProtected)
    );
}

#[test]
fn refuses_an_archive_that_declares_too_much_data() {
    // 2 MB of zeros compresses to almost nothing; the guard reads the declared size.
    let zeros = vec![0u8; 2 * 1024 * 1024];
    let bytes = zip_with(&[("[Content_Types].xml", b"<Types/>"), ("xl/workbook.xml", &zeros)]);
    let tight = Limits {
        max_uncompressed_bytes: 1024 * 1024,
        ..Limits::default()
    };
    assert_eq!(open_xlsx(&bytes, &tight).err(), Some(EngineFailure::Unreadable));
}

#[test]
fn refuses_an_archive_with_too_many_entries() {
    let names: Vec<String> = (0..30).map(|i| format!("x/{i}.xml")).collect();
    let entries: Vec<(&str, &[u8])> = names.iter().map(|n| (n.as_str(), b"<x/>" as &[u8])).collect();
    let tight = Limits {
        max_archive_entries: 10,
        ..Limits::default()
    };
    assert_eq!(
        open_xlsx(&zip_with(&entries), &tight).err(),
        Some(EngineFailure::Unreadable)
    );
}
