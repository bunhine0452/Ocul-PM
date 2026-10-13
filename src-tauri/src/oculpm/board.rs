//! `oculpm-mcp board <폴더>` — `/oculpm:board` 가 claude.ai 아티팩트 보드에
//! 올릴 문서를 파일로 낸다.
//!
//! 보드는 아티팩트의 db 에 플랜마다 문서 하나(`plans/<id>`)와 머리 문서
//! (`meta/board`)를 둔다. 에이전트가 `plan_status` 응답을 읽어 그 문서를
//! 손으로 다시 적으면 항목 수백 개가 대화를 지나가고, 옮겨 적다 문구가 바뀔 수
//! 있다. 그래서 문서는 여기서 만들고, 에이전트는 파일 경로만 `ArtifactData` 에
//! 넘긴다.
//!
//! 재료는 `plan_status`(view=full) 그 자체다 — 파서·잠긴 플랜 제외·**마스킹**이
//! MCP 도구와 한 벌이다. 네트워크는 쓰지 않는다. 기기 밖으로 내보내는 일은
//! 사용자가 시킨 에이전트가 한다.
//!
//! ```text
//! oculpm-mcp board --root <dir> --out <폴더>
//!   <폴더>/page.html          → 보드 페이지 (처음 발행할 때만 쓴다)
//!   <폴더>/meta.json          → meta/board
//!   <폴더>/plans/<id>.json    → plans/<id>
//!   stdout: 쓴 파일 목록(JSON) · exit 0 성공 · 2 사용법 · 1 실패
//! ```

use std::path::{Path, PathBuf};

use serde_json::{json, Value};

/// 보드 페이지 — 데이터는 담지 않는다(db 에서 읽는다). `__PROJECT__` 만 바꾼다.
const PAGE_TEMPLATE: &str = include_str!("board.html");

/// 아티팩트 db 문서 한 장의 상한은 256 KiB 다. 넘으면 끝난 항목을 빼고 싣는다.
const DOC_BUDGET: usize = 200 * 1024;

pub fn run(args: &[String]) -> i32 {
    let mut root: Option<PathBuf> = None;
    let mut out: Option<PathBuf> = None;
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--root" => root = it.next().map(PathBuf::from),
            "--out" => out = it.next().map(PathBuf::from),
            other => {
                eprintln!("oculpm-mcp board: unknown argument '{other}' (usage: board --root <dir> --out <dir>)");
                return 2;
            }
        }
    }
    let root = root
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_default();
    let Some(out) = out else {
        eprintln!("oculpm-mcp board: --out 이 필요합니다");
        return 2;
    };
    if !root.join(".oculpm").is_dir() {
        eprintln!(
            "oculpm-mcp board: ocul-pm 추적 프로젝트가 아닙니다 ({})",
            root.display()
        );
        return 1;
    }
    match export(&root, &out) {
        Ok(summary) => {
            println!("{summary}");
            0
        }
        Err(e) => {
            eprintln!("oculpm-mcp board: {e}");
            1
        }
    }
}

/// 문서를 만들어 `out` 아래에 쓰고, 쓴 것을 요약해 돌려준다.
pub fn export(root: &Path, out: &Path) -> Result<Value, String> {
    let (plans, rows) = read_all(root)?;
    let synced_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let docs = build_docs(&plans, &rows, &synced_at);

    let plans_dir = out.join("plans");
    std::fs::create_dir_all(&plans_dir).map_err(|e| format!("{}: {e}", plans_dir.display()))?;
    let mut files = Vec::new();
    for (id, doc) in &docs {
        let path = plans_dir.join(format!("{id}.json"));
        write_json(&path, doc)?;
        files.push(json!({ "collection": "plans", "doc_id": id, "file_path": path }));
    }
    let project = root
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let ids: Vec<&String> = docs.iter().map(|(id, _)| id).collect();
    let meta = json!({ "project": project, "synced_at": synced_at, "plans": ids });
    let page_path = out.join("page.html");
    std::fs::write(
        &page_path,
        PAGE_TEMPLATE.replace("__PROJECT__", &escape_html(&project)),
    )
    .map_err(|e| format!("{}: {e}", page_path.display()))?;
    let meta_path = out.join("meta.json");
    write_json(&meta_path, &meta)?;
    files.push(json!({ "collection": "meta", "doc_id": "board", "file_path": meta_path }));
    Ok(json!({
        "project": project,
        "title": format!("{project} 플랜 보드"),
        "page": page_path,
        "plans": ids,
        "files": files,
    }))
}

/// `plan_status` 를 끝까지 넘겨 읽는다 — 플랜 행과 TSV 항목 행.
fn read_all(root: &Path) -> Result<(Vec<Value>, Vec<Vec<String>>), String> {
    let mut plans = Vec::new();
    let mut rows = Vec::new();
    let mut cursor: Option<String> = None;
    loop {
        let mut args = json!({ "view": "full", "limit": 500 });
        if let Some(c) = &cursor {
            args["cursor"] = json!(c);
        }
        let page = crate::oculpm::mcp::tools::call_tool(root, "plan_status", &args)?;
        if plans.is_empty() {
            plans = page["plans"].as_array().cloned().unwrap_or_default();
        }
        let tsv = page["items_tsv"].as_str().unwrap_or_default();
        rows.extend(
            tsv.lines()
                .skip(1)
                .map(|l| l.split('\t').map(str::to_string).collect::<Vec<_>>())
                .filter(|cells| cells.len() >= 6),
        );
        match page["next_cursor"].as_str() {
            Some(c) if page["more"] == json!(true) => cursor = Some(c.to_string()),
            _ => break,
        }
    }
    Ok((plans, rows))
}

/// 플랜마다 보드 문서 하나. 항목은 TSV 열 그대로(`st` 는 디스크 글리프).
fn build_docs(plans: &[Value], rows: &[Vec<String>], synced_at: &str) -> Vec<(String, Value)> {
    plans
        .iter()
        .filter_map(|p| {
            let id = p["id"].as_str()?.to_string();
            let items: Vec<Value> = rows
                .iter()
                .filter(|r| r[0] == id)
                .map(|r| json!({ "id": r[1], "st": r[2], "phase": r[3], "title": r[4], "parent": r[5] }))
                .collect();
            let mut doc = json!({
                "title": p["title"],
                "done": p["progress"]["done"],
                "total": p["progress"]["total"],
                "synced_at": synced_at,
                "items": items,
            });
            if doc.to_string().len() > DOC_BUDGET {
                let open: Vec<Value> = items_of(&doc)
                    .into_iter()
                    .filter(|i| !matches!(i["st"].as_str(), Some("x") | Some("-")))
                    .collect();
                doc["items"] = Value::Array(open);
                doc["trimmed"] = json!(true);
            }
            Some((id, doc))
        })
        .collect()
}

fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn items_of(doc: &Value) -> Vec<Value> {
    doc["items"].as_array().cloned().unwrap_or_default()
}

fn write_json(path: &Path, v: &Value) -> Result<(), String> {
    let body = serde_json::to_vec_pretty(v).map_err(|e| e.to_string())?;
    std::fs::write(path, body).map_err(|e| format!("{}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed(root: &Path) {
        let dir = root.join(".oculpm/planner");
        std::fs::create_dir_all(&dir).unwrap();
        let key = format!("AKIA{}", "ABCDEFGHIJKLMNOP");
        std::fs::write(
            dir.join("demo.md"),
            format!(
                "---\noculpm_plan: v1\nid: demo\ntitle: \"데모\"\nstatus: active\n\
                 created: 2026-10-14\nupdated: 2026-10-14\nowner: claude-code\n---\n\n\
                 ## 단계 {{#s}}\n- [x] 끝 {{#a}}\n- [ ] 키 {key} {{#b}}\n"
            ),
        )
        .unwrap();
    }

    #[test]
    fn exports_one_doc_per_plan_with_masked_items() {
        let tmp = tempfile::tempdir().unwrap();
        seed(tmp.path());
        let out = tmp.path().join("out");
        let summary = export(tmp.path(), &out).unwrap();
        assert_eq!(summary["plans"], json!(["demo"]));

        let doc: Value =
            serde_json::from_slice(&std::fs::read(out.join("plans/demo.json")).unwrap()).unwrap();
        assert_eq!(doc["done"], 1);
        assert_eq!(doc["total"], 2);
        let items = doc["items"].as_array().unwrap();
        assert_eq!(items.len(), 2, "완료 항목까지 싣는다");
        assert_eq!(items[0]["st"], "x");
        assert_eq!(items[1]["st"], " ");
        assert_eq!(items[1]["phase"], "단계");
        assert!(
            !doc.to_string().contains("AKIA"),
            "시크릿이 가려지지 않았다: {doc}"
        );

        let meta: Value =
            serde_json::from_slice(&std::fs::read(out.join("meta.json")).unwrap()).unwrap();
        assert_eq!(meta["plans"], json!(["demo"]));

        let page = std::fs::read_to_string(out.join("page.html")).unwrap();
        let project = tmp.path().file_name().unwrap().to_string_lossy();
        assert!(page.starts_with(&format!("<title>{project} 플랜 보드</title>")));
        assert_eq!(summary["title"], format!("{project} 플랜 보드"));
    }

    #[test]
    fn an_oversized_plan_keeps_only_open_items() {
        let plans =
            vec![json!({ "id": "big", "title": "큰", "progress": { "done": 1, "total": 2 } })];
        let long = "가".repeat(DOC_BUDGET);
        let rows = vec![
            vec![
                "big".into(),
                "a".into(),
                "x".into(),
                "".into(),
                long,
                "".into(),
            ],
            vec![
                "big".into(),
                "b".into(),
                " ".into(),
                "".into(),
                "남음".into(),
                "".into(),
            ],
        ];
        let docs = build_docs(&plans, &rows, "2026-10-14T00:00:00Z");
        let doc = &docs[0].1;
        assert_eq!(doc["trimmed"], true);
        assert_eq!(doc["items"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn refuses_an_untracked_root() {
        let tmp = tempfile::tempdir().unwrap();
        let code = run(&[
            "--root".into(),
            tmp.path().to_string_lossy().into(),
            "--out".into(),
            tmp.path().join("o").to_string_lossy().into(),
        ]);
        assert_eq!(code, 1);
    }
}
