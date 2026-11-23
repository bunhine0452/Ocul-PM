//! MCP 없는 에이전트용 셸 CLI 안내(`plugin/oculpm/skills/help` · `docs/claude-integration/07-other-agents.md`)가
//! 실제 앱과 맞는지 (love-round-20261123 L7 #cli-path-for-non-mcp-agents).
//!
//! 안내가 말하는 동사가 앱 실행 파일이 CLI 로 받는 낱말이 아니면, 에이전트가 그 줄을 치는 순간
//! **앱 창이 뜬다**(모르는 낱말은 GUI 로 흘러간다 — `main.rs`). 실행 파일 이름도 같다.

use std::path::PathBuf;

fn read(rel: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join(rel);
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{rel}: {e}"))
}

const DOCS: &[&str] = &[
    "plugin/oculpm/skills/help/SKILL.md",
    "docs/claude-integration/07-other-agents.md",
];

#[test]
fn every_cli_verb_the_docs_show_is_one_the_app_takes() {
    for rel in DOCS {
        let text = read(rel);
        let mut seen = 0;
        // `… <동사> '{…}'` · `$OCUL <동사>` 모양에서 동사를 줍는다.
        for marker in ["… ", "$OCUL "] {
            for (at, _) in text.match_indices(marker) {
                let verb: String = text[at + marker.len()..]
                    .chars()
                    .take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
                    .collect();
                if verb.is_empty() || verb.starts_with('-') {
                    continue;
                }
                assert!(
                    ocul_pm_lib::oculpm::agent_cli::is_cli_verb(&verb),
                    "{rel}: `{verb}` 는 앱이 CLI 로 받지 않는다 — 그 줄은 앱 창을 띄운다"
                );
                seen += 1;
            }
        }
        assert!(seen >= 3, "{rel}: CLI 예시가 {seen}개뿐");
        for verb in ["tools", "plan_status", "journal_write"] {
            assert!(text.contains(verb), "{rel}: {verb} 예시가 없다");
        }
    }
}

#[test]
fn the_executable_paths_name_the_real_binary() {
    let conf: serde_json::Value = serde_json::from_str(&read("src-tauri/tauri.conf.json")).unwrap();
    let product = conf["productName"].as_str().unwrap();
    let bin = env!("CARGO_PKG_NAME");
    for rel in DOCS {
        let text = read(rel);
        for path in [
            format!("/Applications/{product}.app/Contents/MacOS/{bin}"),
            format!(r"%LOCALAPPDATA%\{product}\{bin}.exe"),
            format!("/usr/bin/{bin}"),
        ] {
            assert!(text.contains(&path), "{rel}: {path} 가 없다");
        }
    }
}
