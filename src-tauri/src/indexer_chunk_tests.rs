//! `indexer.rs` 의 청크 테스트 — 본문 파일 래칫 때문에 옆으로 나왔다
//! (`history_tests.rs` 와 같은 모양).

use super::*;

#[test]
fn meaningful_line_count_ignores_blanks_and_punctuation() {
    assert_eq!(meaningful_line_count("}"), 0);
    assert_eq!(meaningful_line_count("}\n);\n  {"), 0);
    assert_eq!(meaningful_line_count("\n\n  \n"), 0);
    assert_eq!(meaningful_line_count("import x from 'y';"), 1);
    assert_eq!(
        meaningful_line_count("let a = 1;\nlet b = 2;\nlet c = 3;"),
        3
    );
}

#[test]
fn tiny_punctuation_only_range_below_threshold() {
    // A lone closing-brace / single-import gap is below MIN_GAP_CHUNK_LINES
    // and would be skipped at the gap sites in chunk_file.
    assert!(meaningful_line_count("}") < MIN_GAP_CHUNK_LINES);
    assert!(meaningful_line_count("import a from 'a';") < MIN_GAP_CHUNK_LINES);
    // A real 3-line block clears the bar.
    assert!(meaningful_line_count("a()\nb()\nc()") >= MIN_GAP_CHUNK_LINES);
}

/// 2026-08-30 실측 재현: 한 줄에 심볼 N개인 파일은 청크 N개가 아니라 1개다.
/// (libktx.js — 22줄·심볼 503개 → 청크 503개·104MB 이던 병리.)
#[test]
fn same_line_symbols_collapse_to_one_chunk() {
    let one_line: String = (0..40)
        .map(|i| format!("function f{i}() {{ return {i}; }}"))
        .collect::<Vec<_>>()
        .join(" ");
    let (chunks, analysis) = chunk_file(Path::new("bundle.js"), &one_line, &IndexConfig::default());
    let symbols = analysis.map(|a| a.symbols.len()).unwrap_or(0);
    assert!(
        symbols >= 40,
        "tree-sitter 가 심볼을 뽑아야 재현이 성립한다: {symbols}"
    );
    assert_eq!(
        chunks.len(),
        1,
        "같은 줄 범위는 한 번만: {:?}",
        chunks.len()
    );
}

/// 거대 심볼(수천 줄 함수)은 하나의 청크가 아니라 상한 안의 창으로 쪼개진다.
#[test]
fn giant_symbol_is_windowed_under_byte_cap() {
    let body: String = (0..3000)
        .map(|i| format!("  const v{i} = {i}; // padding line"))
        .collect::<Vec<_>>()
        .join("\n");
    let src = format!("function giant() {{\n{body}\n}}\n");
    let (chunks, _) = chunk_file(Path::new("giant.js"), &src, &IndexConfig::default());
    assert!(chunks.len() > 1);
    for c in &chunks {
        assert!(
            c.content.len() <= MAX_CHUNK_BYTES + 64,
            "청크 {}..{} 가 {}B — 상한 초과",
            c.start_line,
            c.end_line,
            c.content.len()
        );
    }
    // 창들이 본문을 빠짐없이 덮는다 (마지막 창의 끝 = 마지막 줄).
    let last = chunks.iter().map(|c| c.end_line).max().unwrap();
    assert_eq!(last as usize, src.lines().count());
}

/// 줄이 길면 창이 줄어든다 — 30줄 × 1KB 는 16KB 안에 못 들어가므로 여러 창.
#[test]
fn line_windows_shrink_to_byte_cap_without_skipping_lines() {
    let src: String = (0..30)
        .map(|i| format!("{i:03}{}", "x".repeat(1000)))
        .collect::<Vec<_>>()
        .join("\n");
    let chunks = chunk_lines_with_offset(&src, 1, &IndexConfig::default());
    assert!(chunks.len() >= 2);
    for c in &chunks {
        assert!(c.content.len() <= MAX_CHUNK_BYTES);
    }
    assert_eq!(chunks[0].start_line, 1);
    assert_eq!(chunks.last().unwrap().end_line, 30);
    // 겹침(4줄)을 빼고도 다음 창이 이전 창 안에서 시작한다 — 줄을 건너뛰지 않는다.
    for w in chunks.windows(2) {
        assert!(w[1].start_line <= w[0].end_line + 1);
    }
}

#[test]
fn minified_content_is_not_indexable() {
    let minified = format!("var a=1;{}", "b=a+1;".repeat(1000));
    assert!(minified.len() > MAX_LINE_BYTES);
    assert!(!is_indexable_content(&minified));
    assert!(is_indexable_content("fn main() {}\nfn helper() {}\n"));
}
