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

/// **우리가 실은 신원이 이긴다** (플랜 `v3-record-integrity` {#gate-beyond-cc}).
///
/// 앱 안 ACP 대화에는 우리가 발급한 토큰이 마커·원장·일지에 다 같이 실려야
/// 판정이 선다. 그런데 `CLAUDE_CODE_SESSION_ID` 는 Claude Code CLI 도 자식에게
/// 실어 주는 이름이라, 그 하나만 보던 동안은 어댑터가 우리 값을 덮어쓰면
/// 일지의 `agent.session` 이 마커와 갈라졌다.
#[test]
fn our_own_session_variable_wins_over_the_claude_one() {
    assert_eq!(
        session_id_from(
            Some("acp-20260905-abcd1234".into()),
            Some("cli-uuid".into())
        )
        .as_deref(),
        Some("acp-20260905-abcd1234"),
        "어댑터가 덮어쓴 값이 우리 신원을 이겼다"
    );
    // 터미널에서 직접 띄운 Claude Code 는 우리 이름을 모른다 — 예전 길 그대로.
    assert_eq!(
        session_id_from(None, Some("cli-uuid".into())).as_deref(),
        Some("cli-uuid")
    );
    // 빈 값은 없는 것이다. 여기서 못 내려가면 어댑터가 빈 값을 실어 주는 순간
    // 신원이 통째로 사라진다.
    assert_eq!(
        session_id_from(Some("  ".into()), Some("cli-uuid".into())).as_deref(),
        Some("cli-uuid")
    );
    assert_eq!(session_id_from(None, None), None);
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

// ─── {#related-auto} — related 를 안 준 bug/error 일지의 자동 연결 ───────────

/// 과거 결함 일지 하나를 심는다. `files_touched` 가 이 테스트들의 전부다.
fn seed_defect(
    root: &std::path::Path,
    workday: &str,
    hhmm: &str,
    slug: &str,
    file: &str,
) -> String {
    let dir = root.join(".oculpm/journal").join(workday).join("Bugs");
    std::fs::create_dir_all(&dir).unwrap();
    let name = format!("{hhmm}_bug_{slug}.md");
    std::fs::write(
        dir.join(&name),
        format!(
            "---\nschema_version: 1\ntype: bug\nslug: \"{slug}\"\nstatus: done\n\
             created_at: \"{y}-{m}-{d}T{h}:{mi}:00+09:00\"\nsession_id: \"manual-{workday}-000000\"\n\
             agent:\n  id: \"claude-code\"\nlanguage: ko\nverified_by_user: false\n\
             files_touched:\n  - path: \"{file}\"\n    op: update\nrelated: []\ntags: []\n---\n[x] {slug}\n",
            y = &workday[0..4],
            m = &workday[4..6],
            d = &workday[6..8],
            h = &hhmm[0..2],
            mi = &hhmm[2..4],
        ),
    )
    .unwrap();
    format!("{workday}/Bugs/{name}")
}

fn write_bug(root: &std::path::Path, file: &str) -> serde_json::Value {
    call_tool(
        root,
        "journal_write",
        &serde_json::json!({
            "type": "bug",
            "slug": "again",
            "title": "또 터졌다",
            "body_markdown": "## 발생 원인\n\n같은 자리.\n\n## 해결 방법\n\n고쳤다.\n\n## 검증\n\n테스트",
            "files_touched": [{ "path": file, "op": "update" }],
        }),
    )
    .unwrap()
}

/// 같은 파일에 붙은 **가장 최근** 결함 일지를 followup 으로 잇는다. 규칙을
/// 읽은 에이전트도 `related` 를 절반 넘게 빼먹는다 (727건 중 243건) — 재발은
/// 그 빈칸에서 안 보이게 된다.
#[test]
fn a_defect_entry_links_the_latest_past_defect_on_the_same_file() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    std::fs::create_dir_all(root.join(".oculpm")).unwrap();
    let old = seed_defect(root, "20260101", "0900", "old", "src/watcher.rs");
    let recent = seed_defect(root, "20260301", "1400", "recent", "src/watcher.rs");
    // 다른 파일의 결함은 후보가 아니다.
    seed_defect(root, "20260401", "1000", "elsewhere", "src/other.rs");

    let out = write_bug(root, "src/watcher.rs");
    let auto = out["auto_related"].as_array().unwrap();
    assert_eq!(auto.len(), 1, "{out}");
    assert_eq!(auto[0]["ref"].as_str().unwrap(), recent, "최신 1건만");
    assert_ne!(auto[0]["ref"].as_str().unwrap(), old);
    assert_eq!(auto[0]["kind"], "followup");
    assert_eq!(auto[0]["via"], "src/watcher.rs", "근거를 드러낸다");
    assert_eq!(out["related"], 1);

    let raw = std::fs::read_to_string(root.join(out["path"].as_str().unwrap())).unwrap();
    let (parsed, _) = parse_frontmatter_and_body(&raw);
    let fm = parsed.parsed.expect("frontmatter parses");
    assert_eq!(fm.related.len(), 1);
    assert_eq!(fm.related[0].ref_path, recent);
    assert_eq!(fm.related[0].kind, "followup");
}

/// 허브 파일은 근거가 아니다 — 이 저장소에서 `src/i18n/ko.ts` 는 일지 199건이
/// 만졌다. 그걸로 이으면 i18n 을 건드린 모든 일지가 서로에게 붙는다.
#[test]
fn hub_files_do_not_earn_an_automatic_link() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    std::fs::create_dir_all(root.join(".oculpm")).unwrap();
    seed_defect(root, "20260301", "1400", "i18n", "src/i18n/ko.ts");

    let out = write_bug(root, "src/i18n/ko.ts");
    assert!(out["auto_related"].as_array().unwrap().is_empty(), "{out}");
    assert_eq!(out["related"], 0);
}

/// 자동은 **빈칸을 채우는 것**이지 사람(에이전트)의 판단을 덮는 것이 아니다.
/// 그리고 결함이 아닌 일지는 대상이 아니다.
#[test]
fn an_explicit_related_or_a_non_defect_type_is_left_alone() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    std::fs::create_dir_all(root.join(".oculpm")).unwrap();
    let past = seed_defect(root, "20260301", "1400", "past", "src/watcher.rs");
    let other = seed_defect(root, "20260302", "1400", "other", "src/watcher.rs");

    let explicit = call_tool(
        root,
        "journal_write",
        &serde_json::json!({
            "type": "bug",
            "slug": "explicit",
            "title": "직접 이은 것",
            "body_markdown": "## 발생 원인\n\nx\n\n## 해결 방법\n\ny\n\n## 검증\n\nz",
            "files_touched": [{ "path": "src/watcher.rs", "op": "update" }],
            "related": [{ "ref": past, "kind": "duplicate" }],
        }),
    )
    .unwrap();
    assert!(explicit["auto_related"].as_array().unwrap().is_empty());
    assert_eq!(explicit["related"], 1);
    let raw = std::fs::read_to_string(root.join(explicit["path"].as_str().unwrap())).unwrap();
    let (parsed, _) = parse_frontmatter_and_body(&raw);
    let fm = parsed.parsed.unwrap();
    assert_eq!(fm.related[0].ref_path, past, "준 것이 그대로 남는다");
    assert_eq!(fm.related[0].kind, "duplicate");
    assert_ne!(fm.related[0].ref_path, other);

    let chore = call_tool(
        root,
        "journal_write",
        &serde_json::json!({
            "type": "chore",
            "slug": "chore-x",
            "title": "잡일",
            "body_markdown": "그냥 잡일",
            "files_touched": [{ "path": "src/watcher.rs", "op": "update" }],
        }),
    )
    .unwrap();
    assert!(chore["auto_related"].as_array().unwrap().is_empty());
    assert_eq!(chore["related"], 0);
}
