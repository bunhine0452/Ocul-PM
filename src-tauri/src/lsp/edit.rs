//! `WorkspaceEdit` 적용 — **이 모듈이 위치 변환의 유일한 지점이다.**
//!
//! PR-LSP0~1 은 위치를 프런트(JS, UTF-16)에 맡겨 변환을 아예 없앴다. 이름
//! 바꾸기는 열려 있지 않은 파일까지 고치므로 Rust 에서 편집을 적용해야 하고,
//! 그러려면 UTF-16 `(line, character)` 를 UTF-8 바이트 오프셋으로 옮겨야 한다.
//! 변환이 필요한 곳을 하나로 모아 테스트로 잠그는 것이 이 파일의 존재 이유다
//! (설계 SSOT `docs/lsp/00-master-plan.md` §이름 바꾸기).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde_json::Value;

use super::registry::uri_to_path;

/// 한 파일 안의 편집 하나. 위치는 LSP 원본 그대로(0-based, UTF-16).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextEdit {
    pub start_line: u32,
    pub start_character: u32,
    pub end_line: u32,
    pub end_character: u32,
    pub new_text: String,
}

/// UTF-16 코드 유닛 기준 `(line, character)` → **바이트** 오프셋.
///
/// `character` 가 줄 길이를 넘으면 줄 끝으로 접는다 — 서버가 줄 끝을
/// `character: u32::MAX` 로 표현하는 경우가 실제로 있다(전체 줄 치환).
/// `line` 이 문서를 넘으면 `None`: 그건 접어서 될 일이 아니라 **오래된 편집**
/// 이고, 조용히 문서 끝에 붙이면 엉뚱한 곳을 덮어쓴다.
pub fn byte_offset_of(text: &str, line: u32, character: u32) -> Option<usize> {
    let mut offset = 0usize;
    let mut remaining_lines = line;

    // 줄 경계는 `\n` 하나로 센다. CRLF 파일의 `\r` 은 그 줄의 마지막 문자로
    // 남으므로 아래 열 스캔이 자연히 처리한다 (LSP 도 같은 셈법이다).
    for l in text.split_inclusive('\n') {
        if remaining_lines == 0 {
            // 이 줄 안에서 UTF-16 코드 유닛을 세어 바이트로 옮긴다.
            let mut units = 0u32;
            for (byte_idx, ch) in l.char_indices() {
                if units >= character {
                    return Some(offset + byte_idx);
                }
                // 줄바꿈을 넘어서 세지 않는다 — character 가 과대해도 줄 끝에서 멈춘다.
                if ch == '\n' {
                    return Some(offset + byte_idx);
                }
                units += ch.len_utf16() as u32;
            }
            // 줄 끝(개행 없는 마지막 줄 포함).
            return Some(offset + l.len());
        }
        remaining_lines -= 1;
        offset += l.len();
    }

    // 문서가 개행으로 끝나면 그 뒤의 빈 줄이 유효한 위치다.
    if remaining_lines == 0 && text.ends_with('\n') {
        return Some(text.len());
    }
    None
}

/// 편집들을 적용한 새 문자열.
///
/// **시작 위치 내림차순으로 적용한다** — 앞에서부터 하면 첫 치환이 뒤쪽 오프셋을
/// 전부 어긋나게 만든다. 겹치는 편집은 거부한다(서버가 보낼 일은 없지만 오면
/// 결과가 조용히 망가진다).
pub fn apply_text_edits(text: &str, edits: &[TextEdit]) -> Result<String, String> {
    // (start, end, new_text) 로 풀어 둔다 — 이후 비교가 전부 바이트 오프셋이다.
    let mut resolved: Vec<(usize, usize, &str)> = Vec::with_capacity(edits.len());
    for e in edits {
        let start = byte_offset_of(text, e.start_line, e.start_character)
            .ok_or_else(|| format!("편집 위치가 파일 밖입니다 ({}행)", e.start_line + 1))?;
        let end = byte_offset_of(text, e.end_line, e.end_character)
            .ok_or_else(|| format!("편집 위치가 파일 밖입니다 ({}행)", e.end_line + 1))?;
        if end < start {
            return Err("편집 범위의 끝이 시작보다 앞입니다".to_string());
        }
        resolved.push((start, end, e.new_text.as_str()));
    }

    resolved.sort_by_key(|(start, _, _)| *start);
    for pair in resolved.windows(2) {
        // 앞 편집의 끝이 뒤 편집의 시작을 넘으면 겹친다. 맞닿는 것(end == start)은
        // 허용 — 인접한 두 치환은 정상이다.
        if pair[0].1 > pair[1].0 {
            return Err("서버가 겹치는 편집을 보냈습니다 — 적용하지 않았습니다".to_string());
        }
    }

    let mut out = text.to_string();
    for (start, end, new_text) in resolved.into_iter().rev() {
        out.replace_range(start..end, new_text);
    }
    Ok(out)
}

/// `WorkspaceEdit` → 파일별 편집 목록.
///
/// 두 모양으로 온다:
///   - `changes: { <uri>: TextEdit[] }`               (구형·단순)
///   - `documentChanges: [{ textDocument, edits }]`   (버전 인지)
///
/// 프로젝트 **밖** URI 는 버리지 않고 **오류**다. 의존성 소스를 고치는 일은
/// 없어야 하고, 조용히 건너뛰면 이름이 반쪽만 바뀐 채 컴파일이 깨진다.
pub fn workspace_edit_from_json(
    edit: &Value,
    project_root: &Path,
) -> Result<BTreeMap<PathBuf, Vec<TextEdit>>, String> {
    let mut out: BTreeMap<PathBuf, Vec<TextEdit>> = BTreeMap::new();

    if let Some(changes) = edit.get("changes").and_then(Value::as_object) {
        for (uri, edits) in changes {
            let path = resolve_edit_uri(uri, project_root)?;
            out.entry(path).or_default().extend(text_edits_from_json(edits));
        }
    }

    if let Some(doc_changes) = edit.get("documentChanges").and_then(Value::as_array) {
        for change in doc_changes {
            // create/rename/delete 파일 연산은 지원하지 않는다 — 이름 바꾸기가
            // 파일을 만들거나 지우면 그건 다른 종류의 작업이다.
            if change.get("kind").is_some() {
                return Err("파일 생성·삭제를 포함한 편집은 지원하지 않습니다".to_string());
            }
            let Some(uri) = change
                .get("textDocument")
                .and_then(|d| d.get("uri"))
                .and_then(Value::as_str)
            else {
                continue;
            };
            let path = resolve_edit_uri(uri, project_root)?;
            if let Some(edits) = change.get("edits") {
                out.entry(path).or_default().extend(text_edits_from_json(edits));
            }
        }
    }

    out.retain(|_, edits| !edits.is_empty());
    Ok(out)
}

fn resolve_edit_uri(uri: &str, project_root: &Path) -> Result<PathBuf, String> {
    let path = uri_to_path(uri).ok_or_else(|| format!("읽을 수 없는 경로입니다: {uri}"))?;
    if !path.starts_with(project_root) {
        return Err(format!(
            "프로젝트 밖 파일을 고치려 했습니다: {}",
            path.display()
        ));
    }
    Ok(path)
}

/// `textDocument/formatting` 의 응답 → 편집 목록.
///
/// 이름 바꾸기의 `WorkspaceEdit` 과 달리 **한 파일에 대한 배열**이 그대로 온다
/// (파일이 하나뿐이므로 URI 가 없다). `null` 은 "고칠 것 없음" 이다.
pub fn text_edits_from_result(result: &Value) -> Vec<TextEdit> {
    text_edits_from_json(result)
}

fn text_edits_from_json(edits: &Value) -> Vec<TextEdit> {
    edits
        .as_array()
        .map(|a| a.iter().filter_map(text_edit_from_json).collect())
        .unwrap_or_default()
}

fn text_edit_from_json(e: &Value) -> Option<TextEdit> {
    let range = e.get("range")?;
    let start = range.get("start")?;
    let end = range.get("end")?;
    Some(TextEdit {
        start_line: start.get("line")?.as_u64()? as u32,
        start_character: start.get("character")?.as_u64()? as u32,
        end_line: end.get("line")?.as_u64()? as u32,
        end_character: end.get("character")?.as_u64()? as u32,
        new_text: e.get("newText").and_then(Value::as_str).unwrap_or("").to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn edit(sl: u32, sc: u32, el: u32, ec: u32, new_text: &str) -> TextEdit {
        TextEdit {
            start_line: sl,
            start_character: sc,
            end_line: el,
            end_character: ec,
            new_text: new_text.to_string(),
        }
    }

    // ── 위치 변환 ───────────────────────────────────────────────────────────

    #[test]
    fn byte_offset_walks_lines_and_columns() {
        let text = "fn main() {\n    let x = 1;\n}\n";
        assert_eq!(byte_offset_of(text, 0, 0), Some(0));
        assert_eq!(byte_offset_of(text, 0, 3), Some(3)); // "fn " 다음
        assert_eq!(byte_offset_of(text, 1, 4), Some(16)); // 둘째 줄 "let"
        assert_eq!(&text[16..19], "let");
        assert_eq!(byte_offset_of(text, 2, 0), Some(27));
    }

    /// **이 파일이 존재하는 이유.** 한글은 UTF-16 1유닛이지만 UTF-8 3바이트다 —
    /// 유닛을 바이트로 착각하면 한글이 든 줄의 편집이 전부 어긋난다.
    #[test]
    fn hangul_counts_as_one_utf16_unit_but_three_bytes() {
        let text = "let s = \"안녕\";\n";
        // "안녕" 뒤 = UTF-16 으로 11번째 유닛 (l,e,t,' ',s,' ','=',' ','"',안,녕)
        let at = byte_offset_of(text, 0, 11).unwrap();
        assert_eq!(&text[at..], "\";\n");
        // 바이트로 세었다면 11 이 나와 "안" 한가운데를 가리켰을 것이다.
        assert_ne!(at, 11);
        assert_eq!(at, 15);
    }

    /// 이모지는 UTF-16 서로게이트 쌍(2유닛) · UTF-8 4바이트다.
    #[test]
    fn astral_characters_take_two_utf16_units() {
        let text = "let a = \"🚀\";\n";
        // "🚀" 는 2유닛이므로 그 뒤는 9+2 = 11유닛째.
        let at = byte_offset_of(text, 0, 11).unwrap();
        assert_eq!(&text[at..], "\";\n");
    }

    #[test]
    fn character_beyond_line_end_clamps_to_the_line_not_the_next() {
        // 서버가 줄 전체 치환을 character: u32::MAX 로 표현하는 경우가 있다.
        let text = "ab\ncd\n";
        let at = byte_offset_of(text, 0, u32::MAX).unwrap();
        assert_eq!(at, 2, "줄 끝(개행 앞)에서 멈춰야 한다");
        assert_eq!(&text[at..], "\ncd\n");
    }

    #[test]
    fn crlf_keeps_the_carriage_return_inside_the_line() {
        let text = "ab\r\ncd\r\n";
        // 첫 줄 끝 = `\r` 앞이 아니라 `\r` 을 포함한 자리 전까지 셀 수 있어야 한다.
        assert_eq!(byte_offset_of(text, 0, 2), Some(2));
        assert_eq!(byte_offset_of(text, 1, 0), Some(4));
        assert_eq!(&text[4..6], "cd");
    }

    #[test]
    fn line_past_the_document_is_none_not_clamped() {
        // 오래된 편집을 문서 끝에 조용히 붙이면 엉뚱한 곳을 덮어쓴다.
        let text = "a\nb\n";
        assert_eq!(byte_offset_of(text, 2, 0), Some(4)); // 개행 뒤 빈 줄은 유효
        assert_eq!(byte_offset_of(text, 3, 0), None);
        assert_eq!(byte_offset_of("no newline", 1, 0), None);
    }

    // ── 편집 적용 ───────────────────────────────────────────────────────────

    #[test]
    fn applies_multiple_edits_without_shifting_each_other() {
        let text = "let foo = foo + foo;\n";
        // 세 곳을 동시에 — 앞에서부터 적용하면 뒤쪽 오프셋이 어긋난다.
        let edits = [
            edit(0, 4, 0, 7, "bar"),
            edit(0, 10, 0, 13, "bar"),
            edit(0, 16, 0, 19, "bar"),
        ];
        assert_eq!(apply_text_edits(text, &edits).unwrap(), "let bar = bar + bar;\n");
    }

    /// 길이가 다른 치환이 섞여도 어긋나지 않는다 (짧아지고 길어지는 경우).
    #[test]
    fn handles_edits_of_differing_lengths() {
        let text = "aa bb cc\n";
        let edits = [edit(0, 0, 0, 2, "LONGER"), edit(0, 6, 0, 8, "x")];
        assert_eq!(apply_text_edits(text, &edits).unwrap(), "LONGER bb x\n");
    }

    #[test]
    fn applies_edits_across_multiple_lines() {
        let text = "one\ntwo\nthree\n";
        let edits = [edit(0, 0, 0, 3, "1"), edit(2, 0, 2, 5, "3")];
        assert_eq!(apply_text_edits(text, &edits).unwrap(), "1\ntwo\n3\n");
    }

    /// 여러 줄에 걸친 한 편집 (범위 치환).
    #[test]
    fn applies_a_range_spanning_lines() {
        let text = "a\nb\nc\n";
        let edits = [edit(0, 1, 2, 0, "-")];
        assert_eq!(apply_text_edits(text, &edits).unwrap(), "a-c\n");
    }

    #[test]
    fn rejects_overlapping_edits_instead_of_corrupting() {
        let text = "abcdef\n";
        let edits = [edit(0, 0, 0, 4, "X"), edit(0, 2, 0, 6, "Y")];
        let err = apply_text_edits(text, &edits).unwrap_err();
        assert!(err.contains("겹치"), "{err}");
    }

    #[test]
    fn adjacent_edits_are_allowed() {
        // 맞닿는 것(end == start)은 겹치는 게 아니다.
        let text = "abcd\n";
        let edits = [edit(0, 0, 0, 2, "X"), edit(0, 2, 0, 4, "Y")];
        assert_eq!(apply_text_edits(text, &edits).unwrap(), "XY\n");
    }

    #[test]
    fn rejects_edits_pointing_outside_the_file() {
        let text = "a\n";
        let err = apply_text_edits(text, &[edit(9, 0, 9, 1, "x")]).unwrap_err();
        assert!(err.contains("파일 밖"), "{err}");
    }

    #[test]
    fn empty_edit_list_returns_the_text_unchanged() {
        assert_eq!(apply_text_edits("abc", &[]).unwrap(), "abc");
    }

    // ── WorkspaceEdit 파싱 ──────────────────────────────────────────────────

    fn root() -> &'static Path {
        Path::new("/w/ai-pm")
    }

    fn range(sl: u32, sc: u32, el: u32, ec: u32) -> Value {
        json!({ "start": { "line": sl, "character": sc }, "end": { "line": el, "character": ec } })
    }

    #[test]
    fn reads_both_workspace_edit_shapes() {
        let changes = json!({ "changes": {
            "file:///w/ai-pm/src/a.rs": [{ "range": range(0, 0, 0, 3), "newText": "bar" }],
        }});
        let doc_changes = json!({ "documentChanges": [{
            "textDocument": { "uri": "file:///w/ai-pm/src/a.rs", "version": 3 },
            "edits": [{ "range": range(0, 0, 0, 3), "newText": "bar" }],
        }]});
        for e in [changes, doc_changes] {
            let got = workspace_edit_from_json(&e, root()).unwrap();
            assert_eq!(got.len(), 1);
            let edits = got.get(&PathBuf::from("/w/ai-pm/src/a.rs")).unwrap();
            assert_eq!(edits.len(), 1);
            assert_eq!(edits[0].new_text, "bar");
        }
    }

    #[test]
    fn groups_edits_by_file() {
        let e = json!({ "changes": {
            "file:///w/ai-pm/src/a.rs": [
                { "range": range(0, 0, 0, 3), "newText": "x" },
                { "range": range(1, 0, 1, 3), "newText": "x" },
            ],
            "file:///w/ai-pm/src/b.rs": [{ "range": range(0, 0, 0, 3), "newText": "x" }],
        }});
        let got = workspace_edit_from_json(&e, root()).unwrap();
        assert_eq!(got.len(), 2);
        assert_eq!(got[&PathBuf::from("/w/ai-pm/src/a.rs")].len(), 2);
        assert_eq!(got[&PathBuf::from("/w/ai-pm/src/b.rs")].len(), 1);
    }

    /// 프로젝트 밖은 **버리지 않고 오류** — 조용히 건너뛰면 이름이 반쪽만 바뀐다.
    #[test]
    fn refuses_to_touch_files_outside_the_project() {
        let e = json!({ "changes": {
            "file:///w/ai-pm/src/a.rs": [{ "range": range(0, 0, 0, 1), "newText": "x" }],
            "file:///Users/x/.cargo/registry/dep.rs": [{ "range": range(0, 0, 0, 1), "newText": "x" }],
        }});
        let err = workspace_edit_from_json(&e, root()).unwrap_err();
        assert!(err.contains("프로젝트 밖"), "{err}");
    }

    #[test]
    fn refuses_file_create_rename_delete_operations() {
        let e = json!({ "documentChanges": [{ "kind": "rename", "oldUri": "file:///w/ai-pm/a.rs", "newUri": "file:///w/ai-pm/b.rs" }]});
        let err = workspace_edit_from_json(&e, root()).unwrap_err();
        assert!(err.contains("파일 생성·삭제"), "{err}");
    }

    #[test]
    fn empty_edit_yields_no_files() {
        assert!(workspace_edit_from_json(&json!({}), root()).unwrap().is_empty());
        assert!(workspace_edit_from_json(&json!(null), root()).unwrap().is_empty());
        // 편집이 0건인 파일은 목록에 남기지 않는다.
        let e = json!({ "changes": { "file:///w/ai-pm/a.rs": [] }});
        assert!(workspace_edit_from_json(&e, root()).unwrap().is_empty());
    }
}
