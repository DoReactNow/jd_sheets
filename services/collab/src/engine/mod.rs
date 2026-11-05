//! The ONLY module that uses GridCraft's crates (Decision 6, rule 9). Everything here is
//! defensive: input files are hostile, GridCraft's own code may still panic, and a panic must
//! become a refusal for that file only (P0-VAL-09).
use std::io::Cursor;
use std::panic::{AssertUnwindSafe, catch_unwind};

use gridcraft_core::CellRef;
use gridcraft_engine::display::cell_text;
use gridcraft_engine::Session;
use gridcraft_engine::io::{open_bytes, save_bytes};
use gridcraft_model::Workbook;
use gridcraft_xlsx::{Format, sniff};
use serde::Serialize;

use crate::config::Limits;

/// The name GridCraft uses to pick the format; never a user's file name.
const BOOK_NAME: &str = "Book.xlsx";

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum EngineFailure {
    #[error("the workbook is larger than the limit")]
    TooLarge,
    #[error("the file is not a readable workbook")]
    Unreadable,
    #[error("the workbook is password-protected")]
    PasswordProtected,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct WorkbookSummary {
    pub sheets: Vec<String>,
}

/// Opens bytes as an XLSX workbook, or says why it cannot.
pub fn open_xlsx(bytes: &[u8], limits: &Limits) -> Result<Workbook, EngineFailure> {
    if bytes.len() as u64 > limits.workbook_max_bytes {
        return Err(EngineFailure::TooLarge);
    }
    match sniff(bytes) {
        Format::Xlsx => {}
        Format::Encrypted => return Err(EngineFailure::PasswordProtected),
        _ => return Err(EngineFailure::Unreadable),
    }
    check_archive(bytes, limits)?;
    let opened = catch_unwind(AssertUnwindSafe(|| open_bytes(BOOK_NAME, bytes)));
    match opened {
        Ok(Ok((workbook, _warnings))) if !workbook.sheets.is_empty() => Ok(workbook),
        Ok(Ok(_)) | Ok(Err(_)) => Err(EngineFailure::Unreadable),
        Err(_) => {
            tracing::error!("GridCraft panicked while opening a workbook");
            Err(EngineFailure::Unreadable)
        }
    }
}

/// ZIP bomb and sanity guard, before GridCraft reads anything: the archive must open, hold a
/// bounded number of entries, and declare a bounded uncompressed size (P0-VAL-07).
fn check_archive(bytes: &[u8], limits: &Limits) -> Result<(), EngineFailure> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| EngineFailure::Unreadable)?;
    if archive.len() > limits.max_archive_entries {
        return Err(EngineFailure::Unreadable);
    }
    let mut total: u64 = 0;
    for index in 0..archive.len() {
        let entry = archive.by_index_raw(index).map_err(|_| EngineFailure::Unreadable)?;
        total = total.saturating_add(entry.size());
        if total > limits.max_uncompressed_bytes {
            return Err(EngineFailure::Unreadable);
        }
    }
    Ok(())
}

pub fn summarize(workbook: &Workbook) -> WorkbookSummary {
    WorkbookSummary {
        sheets: workbook.sheets.iter().map(|sheet| sheet.name.clone()).collect(),
    }
}

/// A new, empty workbook (one sheet) as XLSX bytes, written by GridCraft.
pub fn blank_workbook() -> Result<Vec<u8>, EngineFailure> {
    let written = catch_unwind(|| save_bytes(&Workbook::new(), BOOK_NAME));
    match written {
        Ok(Ok(bytes)) => Ok(bytes),
        _ => Err(EngineFailure::Unreadable),
    }
}

/// A workbook as XLSX bytes, written by GridCraft.
pub fn to_xlsx(workbook: &Workbook) -> Result<Vec<u8>, EngineFailure> {
    match catch_unwind(AssertUnwindSafe(|| save_bytes(workbook, BOOK_NAME))) {
        Ok(Ok(bytes)) => Ok(bytes),
        _ => Err(EngineFailure::Unreadable),
    }
}

/// Builds a workbook by running GridCraft commands on a new document, then writes it as XLSX.
/// Used to make golden workbooks (golden/*.json); an unknown or failing command is an error.
pub fn build_from_commands(commands: &[(String, serde_json::Value)]) -> Result<Vec<u8>, String> {
    let mut session = Session::new();
    session.execute("file.new", serde_json::json!({})).map_err(|e| format!("file.new: {e}"))?;
    for (id, params) in commands {
        session.execute(id, params.clone()).map_err(|e| format!("{id}: {e}"))?;
    }
    let doc = session.active().ok_or("no active document")?;
    to_xlsx(&doc.wb).map_err(|e| e.to_string())
}

/// The text a cell shows, by sheet name and A1 address (golden and contract tests).
pub fn display_text(workbook: &Workbook, sheet: &str, a1: &str) -> Option<String> {
    let sheet = workbook.sheets.iter().find(|candidate| candidate.name == sheet)?;
    let at = CellRef::parse(a1)?;
    Some(cell_text(workbook, sheet, at))
}

#[cfg(test)]
mod tests;
