//! `journal_write` — 규격에 맞는 일지가 나오는지, 무엇을 가리는지.

use crate::oculpm::frontmatter::parse_frontmatter_and_body;
use crate::oculpm::mcp::tools::*;
use tempfile::TempDir;

#[test]
fn journal_write_produces_spec_valid_entry() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    std::fs::create_dir_all(root.join(".oculpm")).unwrap();
    let args = serde_json::json!({
        "type": "bug",
        "slug": "Fix Cache!!",
        "title": "캐시 무효화 수정",
        "body_markdown": "## 발생 원인\n\n키 불일치.\n\n## 해결 방법\n\n정규화.\n\n## 검증\n\ncargo test 그린",
        "files_touched": [{ "path": "src/cache.rs", "op": "update" }],
        "agent_version": "Opus 4.8"
    });
    let out = call_tool(root, "journal_write", &args).unwrap();
    let rel = out["path"].as_str().unwrap();
    assert!(rel.contains("/Bugs/"), "{rel}");
    assert!(
        rel.ends_with("_bug_fix-cache.md"),
        "slug 는 kebab 강제: {rel}"
    );

    let raw = std::fs::read_to_string(root.join(rel)).unwrap();
    let (parsed, body) = parse_frontmatter_and_body(&raw);
    let fm = parsed.parsed.expect("frontmatter parses");
    assert!(
        parsed.parse_warnings.is_empty(),
        "파서 경고 0 이 계약: {:?}",
        parsed.parse_warnings
    );
    assert_eq!(fm.agent.id, "claude-code");
    assert_eq!(fm.agent.version.as_deref(), Some("Opus 4.8"));
    assert!(!fm.verified_by_user);
    assert!(fm.tags.iter().any(|t| t == "mcp-tool"));
    // No sessions.json (app not running) → synthetic fallback stands.
    assert!(fm.session_id.starts_with("mcp-"));
    assert!(body.trim_start().starts_with("[x] 캐시 무효화 수정"));
}

/// 터미널 분할 회귀 — 일지가 **어느 대화**의 것인지 적을 수 있어야 한다.
/// 우리 `session_id` 는 프로젝트의 작업 시간대라 동시에 도는 대화 넷이
/// 전부 같은 값을 받는다. 대화를 가르는 것은 이 값뿐이다.
#[test]
fn journal_entries_carry_the_conversation_that_wrote_them() {
    assert_eq!(claude_session_or_none(None), None);
    assert_eq!(claude_session_or_none(Some(String::new())), None);
    assert_eq!(claude_session_or_none(Some("   ".to_string())), None);
    assert_eq!(
        claude_session_or_none(Some(" cb342a36-cd70-496a-a17b-ae516eb30c04 ".to_string()))
            .as_deref(),
        Some("cb342a36-cd70-496a-a17b-ae516eb30c04")
    );
}

/// Dogfooding follow-up (2026-08-20) — when the app *is* running, the
/// watcher's live session is on disk and the entry must adopt it. A
/// synthetic `mcp-…` id can never join against a real session, which is
/// what left `matched` / `jaccard_index` dead.
/// `related` 는 AGENTS.md 가 요구하는 인자인데 도구가 안 받아 늘 비어 있었다.
/// 접두 `.oculpm/journal/` 은 벗겨 저장하고, 없는 참조·낯선 kind 는 거부 대신
/// 경고로 돌려준다. `language` 는 프로젝트 설정을 따른다.
#[test]
fn journal_write_records_related_and_project_language() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    std::fs::create_dir_all(root.join(".oculpm/journal/20260522/Bugs")).unwrap();
    std::fs::write(
        root.join(".oculpm/journal/20260522/Bugs/2050_bug_x.md"),
        "---\nschema_version: 1\n---\n[x] x\n",
    )
    .unwrap();
    let mut cfg = OculpmConfig::default_for_new_project();
    cfg.agents.template_language = "en".to_string();
    cfg.save(&root.join(".oculpm/config.toml")).unwrap();
    let args = serde_json::json!({
        "type": "chore",
        "slug": "link-test",
        "title": "links",
        "body_markdown": "body\n\n## Verification\n\nok",
        "related": [
            { "ref": ".oculpm/journal/20260522/Bugs/2050_bug_x.md", "kind": "followup" },
            { "ref": "20260101/Chores/0000_chore_missing.md", "kind": "weird" }
        ]
    });
    let out = call_tool(root, "journal_write", &args).unwrap();
    assert_eq!(out["related"], 2);
    assert_eq!(out["language"], "en");
    let warnings: Vec<String> = out["warnings"]
        .as_array()
        .unwrap()
        .iter()
        .map(|w| w.as_str().unwrap().to_string())
        .collect();
    assert_eq!(warnings.len(), 2, "{warnings:?}");
    assert!(warnings.iter().any(|w| w.contains("weird")));
    assert!(warnings.iter().any(|w| w.contains("0000_chore_missing.md")));

    let raw = std::fs::read_to_string(root.join(out["path"].as_str().unwrap())).unwrap();
    let (parsed, _) = parse_frontmatter_and_body(&raw);
    let fm = parsed.parsed.expect("frontmatter parses");
    assert_eq!(fm.language, "en");
    assert_eq!(fm.related.len(), 2);
    assert_eq!(
        fm.related[0].ref_path, "20260522/Bugs/2050_bug_x.md",
        "접두는 벗긴다"
    );
    assert_eq!(fm.related[1].kind, "followup", "낯선 kind 는 followup 으로");
}

#[test]
fn journal_write_adopts_the_live_watcher_session() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    std::fs::create_dir_all(root.join(".oculpm")).unwrap();

    // Stage a sessions.json the way the watcher would, opened an hour ago.
    let cfg = load_config(root);
    let resolver = resolver_of(&cfg);
    let now = Utc::now();
    let workday = resolver.workday_of(now);
    let started = (now - chrono::Duration::hours(1))
        .with_timezone(&resolver.tz)
        .to_rfc3339_opts(SecondsFormat::Secs, false);
    let index_dir = resolver.index_dir(root, &workday);
    std::fs::create_dir_all(&index_dir).unwrap();
    std::fs::write(
        index_dir.join("sessions.json"),
        serde_json::json!({
            "schema_version": 1,
            "sessions": [{
                "id": format!("{workday}-002"),
                "started_at": started,
                "ended_at": null,
                "ended_reason": null,
                "active_window_ms": 0,
                "file_event_count": 0,
                "files_unique": 0,
                "git_head_at_start": null,
                "git_head_at_end": null,
                "agent_label_guess": "claude-code",
                "linked_journal_entries": []
            }]
        })
        .to_string(),
    )
    .unwrap();

    let out = call_tool(
        root,
        "journal_write",
        &serde_json::json!({
            "type": "bug",
            "slug": "live-session",
            "title": "라이브 세션 채택",
            "body_markdown": "## 발생 원인\n\nx\n\n## 해결 방법\n\ny\n\n## 검증\n\nz",
        }),
    )
    .unwrap();

    assert_eq!(
        out["session_id"].as_str().unwrap(),
        format!("{workday}-002")
    );
    let raw = std::fs::read_to_string(root.join(out["path"].as_str().unwrap())).unwrap();
    let fm = parse_frontmatter_and_body(&raw).0.parsed.unwrap();
    assert_eq!(fm.session_id, format!("{workday}-002"));
}

/// An explicit `session_id` argument still wins over the disk lookup —
/// callers that know better must not be overridden.
#[test]
fn journal_write_explicit_session_id_beats_disk_lookup() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    std::fs::create_dir_all(root.join(".oculpm")).unwrap();
    let cfg = load_config(root);
    let resolver = resolver_of(&cfg);
    let workday = resolver.workday_of(Utc::now());
    let index_dir = resolver.index_dir(root, &workday);
    std::fs::create_dir_all(&index_dir).unwrap();
    std::fs::write(
        index_dir.join("sessions.json"),
        serde_json::json!({
            "schema_version": 1,
            "sessions": [{
                "id": format!("{workday}-002"),
                "started_at": (Utc::now() - chrono::Duration::hours(1))
                    .with_timezone(&resolver.tz)
                    .to_rfc3339_opts(SecondsFormat::Secs, false),
                "ended_at": null, "ended_reason": null,
                "active_window_ms": 0, "file_event_count": 0, "files_unique": 0,
                "git_head_at_start": null, "git_head_at_end": null,
                "agent_label_guess": null, "linked_journal_entries": []
            }]
        })
        .to_string(),
    )
    .unwrap();

    let out = call_tool(
        root,
        "journal_write",
        &serde_json::json!({
            "type": "chore",
            "slug": "explicit-sid",
            "title": "명시 세션",
            "body_markdown": "본문\n\n## 검증\n\nok",
            "session_id": "caller-knows-best",
        }),
    )
    .unwrap();
    assert_eq!(out["session_id"].as_str().unwrap(), "caller-knows-best");
}

#[test]
fn journal_write_rejects_forbidden_paths_and_redacts_body() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    std::fs::create_dir_all(root.join(".oculpm")).unwrap();
    std::fs::write(
        root.join(".oculpm/config.toml"),
        "schema_version = 1\n[workday]\ntimezone = \"Asia/Seoul\"\nday_starts_at = \"00:00\"\n[session]\ninactivity_timeout_minutes = 30\nauto_close_on_workday_boundary = true\nauto_close_on_app_quit = true\ncrash_recovery_grace_minutes = 5\n[git]\njournal_committed = true\nforbid_journal_for_paths = [\".env\"]\nauto_redact_patterns = [\"sk-[A-Za-z0-9]+\"]\n[watcher]\nignore = []\nrespect_gitignore = true\ndebounce_ms = 500\nbatch_max_events = 200\n[agents]\nactive = []\nauto_detect_on_open = false\nauto_sync_adapters = false\n",
    )
    .unwrap();

    let forbidden = serde_json::json!({
        "type": "chore", "slug": "x", "title": "t", "body_markdown": "b",
        "files_touched": [{ "path": ".env" }]
    });
    let err = call_tool(root, "journal_write", &forbidden).unwrap_err();
    assert!(err.contains(".env"));

    let secret = serde_json::json!({
        "type": "chore", "slug": "secret-test", "title": "t",
        "body_markdown": "키는 sk-abcdef123 이다\n\n## 검증\n없음"
    });
    let out = call_tool(root, "journal_write", &secret).unwrap();
    let raw = std::fs::read_to_string(root.join(out["path"].as_str().unwrap())).unwrap();
    assert!(!raw.contains("sk-abcdef123"), "redact 적용: {raw}");
}
