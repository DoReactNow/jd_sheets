//! P0-ARCH-04: only src/engine/ names GridCraft's crates (Decision 6, rule 9).
use std::path::{Path, PathBuf};

fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            rust_files(&path, out);
        } else if path.extension().is_some_and(|e| e == "rs") {
            out.push(path);
        }
    }
}

#[test]
fn only_the_engine_module_uses_gridcraft() {
    let src = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src");
    let engine = src.join("engine");
    let mut files = Vec::new();
    rust_files(&src, &mut files);
    assert!(files.len() > 5);
    let offenders: Vec<String> = files
        .iter()
        .filter(|file| !file.starts_with(&engine))
        .filter(|file| std::fs::read_to_string(file).unwrap_or_default().contains("gridcraft_"))
        .map(|file| file.display().to_string())
        .collect();
    assert_eq!(offenders, Vec::<String>::new());
}
