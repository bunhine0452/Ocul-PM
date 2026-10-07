//! `agents/mod.rs` 의 테스트 — 본문 파일 800줄 래칫 때문에 옆으로 나왔다
//! (`history_tests.rs` 와 같은 모양).

use super::*;
use crate::oculpm::spec::AgentsConfig;
use tempfile::TempDir;

fn config_with(active: &[&str]) -> OculpmConfig {
    let mut cfg = OculpmConfig::default_for_new_project();
    cfg.agents = AgentsConfig {
        active: active.iter().map(|s| s.to_string()).collect(),
        auto_reconcile: false,
        auto_journal_draft: false,
        rules_translate: vec![],
        template_language: "ko".into(),
    };
    cfg
}

fn setup() -> TempDir {
    let dir = tempfile::tempdir().unwrap();
    // Ensure .oculpm/ exists so ensure_master_template can write into it.
    std::fs::create_dir_all(dir.path().join(".oculpm").join("agents")).unwrap();
    dir
}

fn read(path: &Path) -> String {
    std::fs::read_to_string(path).unwrap()
}

/// v2 U4 — 어댑터 테이블 계약: id/경로 유일, 신규 5종 존재, 모든 id 가
/// config 검증(KNOWN_AGENT_IDS)에 수용됨.
#[test]
fn adapter_table_covers_v2_agents() {
    let adapters = known_adapters();
    let ids: Vec<&str> = adapters.iter().map(|a| a.id).collect();
    let unique_ids: std::collections::HashSet<&&str> = ids.iter().collect();
    assert_eq!(unique_ids.len(), ids.len(), "adapter ids must be unique");
    let paths: std::collections::HashSet<&str> = adapters.iter().map(|a| a.adapter_path).collect();
    assert_eq!(paths.len(), adapters.len(), "adapter paths must be unique");
    for id in ["windsurf", "copilot", "aider", "cline", "zed"] {
        assert!(ids.contains(&id), "missing v2 adapter {id}");
    }
    for a in adapters {
        assert!(
            crate::oculpm::config::KNOWN_AGENT_IDS.contains(&a.id),
            "{} must be accepted by config validation",
            a.id
        );
    }
}

/// v2 U4 — 신규 어댑터 sync 왕복: 활성 시 파일/블록 생성, 비활성 시 제거,
/// 2회 호출 멱등(unchanged).
#[tokio::test]
async fn v2_adapters_sync_roundtrip() {
    let dir = setup();
    let root = dir.path();
    let cfg = config_with(&["windsurf", "copilot", "aider", "cline", "zed"]);

    let first = sync_active(root, &cfg).await.unwrap();
    for id in ["windsurf", "copilot", "aider", "cline", "zed"] {
        let r = first.results.iter().find(|r| r.id == id).unwrap();
        assert_eq!(r.action, "inserted", "{id} first sync must insert");
    }
    // Overwrite 모드는 파일 자체, ManagedBlock 은 marker 를 포함해야 한다.
    assert!(root.join(".windsurf/rules/ocul-pm.md").exists());
    assert!(root.join(".clinerules/ocul-pm.md").exists());
    assert!(read(&root.join(".github/copilot-instructions.md")).contains("oculpm:begin"));
    assert!(read(&root.join("CONVENTIONS.md")).contains("agent.id 는 `aider`"));
    assert!(read(&root.join(".rules")).contains("agent.id 는 `zed`"));

    let second = sync_active(root, &cfg).await.unwrap();
    for id in ["windsurf", "copilot", "aider", "cline", "zed"] {
        let r = second.results.iter().find(|r| r.id == id).unwrap();
        assert_eq!(r.action, "unchanged", "{id} second sync must be idempotent");
    }

    // 비활성화 → Overwrite 파일 삭제 / ManagedBlock 블록 제거.
    let off = config_with(&[]);
    sync_active(root, &off).await.unwrap();
    assert!(!root.join(".windsurf/rules/ocul-pm.md").exists());
    assert!(!read(&root.join(".github/copilot-instructions.md")).contains("oculpm:begin"));
}

/// PR-PLN 2 — the Planner update protocol lives in the master so every
/// agent inherits it via `AGENTS.md`. Guard against accidental removal.
#[test]
fn master_template_carries_planner_rules() {
    assert!(
        MASTER_KO.contains("Planner 갱신"),
        "master must keep the Planner section"
    );
    assert!(
        MASTER_KO.contains("oculpm:plan-log"),
        "master must document the plan-log managed block"
    );
    assert!(
        MASTER_KO.contains(".oculpm/planner/"),
        "master must point at the planner tree"
    );
}

/// PR-DISC 5 → TK1(v6): Discussion 프로토콜 전문은 on-demand 규격서
/// (`discussion-spec.md`)로 이동했다 — 마스터는 트리거+포인터만 상시
/// 유지하고, 규격서가 managed block 문법을 계속 보유해야 한다.
#[test]
fn master_template_carries_discussion_rules() {
    assert!(
        MASTER_KO.contains("문제 해결 문서"),
        "master must keep the Discussion trigger section"
    );
    assert!(
        MASTER_KO.contains(".oculpm/discussion/"),
        "master must point at the discussion tree"
    );
    for (name, spec) in [("ko", DISCUSSION_SPEC_KO), ("en", DISCUSSION_SPEC_EN)] {
        assert!(
            spec.contains("oculpm:discussion-log"),
            "{name} spec must document the discussion-log managed block"
        );
        assert!(
            spec.contains("oculpm_discussion: v1"),
            "{name} spec frontmatter"
        );
    }
    assert!(
        embedded_template_version() >= 6,
        "template_version must be bumped to 6 for the split spec"
    );
}

/// An `@path` import inside an adapter file resolves **relative to the file
/// that contains it**, not to the project root — that is what the Claude
/// Code memory docs specify. So an adapter written into a subdirectory must
/// import `@../AGENTS.md`; a bare `@AGENTS.md` there points at e.g.
/// `.claude/AGENTS.md`, which does not exist, and the import silently
/// expands to nothing.
///
/// That was the live bug (found 2026-07-30): `.claude/CLAUDE.md` shipped a
/// bare `@AGENTS.md`, so Claude Code received only the ~565-byte stub and
/// never the rules. It fails in the worst possible direction — silently,
/// with the agent simply not knowing journals exist.
#[test]
fn adapter_agents_imports_resolve_to_the_root_agents_md() {
    for adapter in known_adapters() {
        let ctx = AgentContext {
            master_template: MASTER_KO.to_string(),
            per_agent_override: None,
        };
        let rendered = (adapter.render)(&ctx);
        let dir = Path::new(adapter.adapter_path)
            .parent()
            .unwrap_or(Path::new(""));
        let depth = dir.components().count();
        let expected = if depth == 0 {
            "AGENTS.md".to_string()
        } else {
            format!("{}AGENTS.md", "../".repeat(depth))
        };

        for line in rendered.lines() {
            let Some(import) = line.trim().strip_prefix('@') else {
                continue;
            };
            if !import.ends_with("AGENTS.md") {
                continue;
            }
            assert_eq!(
                import, expected,
                "adapter '{}' at '{}' imports '{import}' — from that directory it must be \
                 '{expected}' to reach the root AGENTS.md",
                adapter.id, adapter.adapter_path
            );
        }
    }
}

/// TK1 — 템플릿 다이어트 회귀 가드. v5 는 8,031 chars(≈2,900 tok)가 전
/// 추적 프로젝트의 전 세션에 상시 주입됐다 — 다시 자라면 그 비용이
/// 그대로 돌아온다. 언어 변형은 버전·핵심 포인터가 항상 패리티여야 한다.
///
/// 상한 이력 — 이 숫자는 **예산**이지 물리 한계가 아니다. 올릴 때는 무엇을
/// 샀는지 여기 적는다 (조용히 올리면 가드가 무의미해진다):
/// - v9 (2026-08-21): en 5,200 → 5,800. §0 "시작 전 과거를 먼저 찾는다"
///   (`journal_search`/`journal_read` 안내)를 샀다. 도구만 있고 규칙이
///   없으면 에이전트가 부르지 않아, 읽기 도구 추가의 절반은 이 문단이다.
///   ko 는 상한 그대로 두고도 들어갔다 (같은 내용에 영어가 문자를 더 쓴다).
/// - v10 (2026-09-03): en 5,800 → 6,100. §5 "여럿이 함께 일할 때 (A2A)"를
///   샀다 (도구만 있고 규칙이 없으면 아무도 안 부른다 — v9 의 교훈).
///   `git add -A` 금지도 §3(금지)에 반 줄로 붙였다.
/// - v14 (2026-10-04): v10 의 §5(A2A)를 **되돌렸다** — 기능 자체를 걷어냈다.
///   없는 도구를 부르라는 규칙은 거짓말이다. 상한은 그대로 둔다.
#[test]
fn master_templates_stay_lean_and_in_parity() {
    let ko = MASTER_KO.chars().count();
    let en = MASTER_EN.chars().count();
    assert!(
        ko <= 4_800,
        "ko 마스터 {ko} chars — 토큰 다이어트 회귀 (상한 4,800)"
    );
    assert!(en <= 6_500, "en 마스터 {en} chars — 상한 6,500 (6,320 에서 올렸다: journal-scale-round 두 절 — {{#plan-log-archive}} 의 `<plan_id>.log.md` 금지 한 절(§4 런온 90자: 이 줄이 없으면 에이전트가 앱이 만든 이력 보관함을 플랜으로 오인해 고치거나 통째로 컨텍스트에 싣는다) + {{#rollup-first}} 의 §0 롤업 한 줄 77자(주간 요약 층을 만들어 놓고 규칙이 그것을 가리키지 않으면 에이전트는 영영 안 읽는다). 다음 인상도 같은 급의 근거를 요구할 것)");
    assert_eq!(
        template_version(MASTER_KO),
        template_version(MASTER_EN),
        "ko/en 템플릿 버전은 항상 함께 bump"
    );
    for (name, t) in [("ko", MASTER_KO), ("en", MASTER_EN)] {
        assert!(t.contains("plan_create"), "{name}: MCP 쓰기 도구 안내 누락");
        assert!(
            t.contains("discussion-spec.md"),
            "{name}: §5 on-demand 포인터 누락"
        );
        // 읽기 도구는 "있다" 로 부족하고 **언제 부르는지** 가 있어야 실제로
        // 불린다 — §0 이 그 자리다.
        assert!(
            t.contains("journal_search"),
            "{name}: §0 과거 검색 안내 누락"
        );
        assert!(t.contains("journal_read"), "{name}: journal_read 안내 누락");
    }
    // wrapper 는 import 금지 — @import 를 확장하는 런타임에서 마스터가
    // 2중 주입되던 위험(v5)의 재발 방지.
    assert!(
        !CLAUDE_CODE_TPL.contains("@../AGENTS.md"),
        "claude wrapper 에 import 금지"
    );
    assert!(
        !CLAUDE_CODE_TPL.contains("@AGENTS.md"),
        "claude wrapper 에 import 금지"
    );
}

/// TK1 — 언어 변형 시드 + discussion-spec 은 앱 관리 파일(손상 시 다음
/// sync 가 복원).
#[tokio::test]
async fn sync_seeds_language_variant_and_restores_discussion_spec() {
    let dir = setup();
    let root = dir.path();
    let mut cfg = config_with(&["agents-md"]);
    cfg.agents.template_language = "en".into();
    sync_active(root, &cfg).await.unwrap();

    let master = read(&root.join(".oculpm/agents/_template.md"));
    assert!(
        master.contains("work-journal rules"),
        "en 마스터가 시드돼야 한다"
    );
    let spec_path = root.join(".oculpm/agents/discussion-spec.md");
    assert!(read(&spec_path).contains("Discussion-doc spec"));

    std::fs::write(&spec_path, "깨진 내용").unwrap();
    sync_active(root, &cfg).await.unwrap();
    assert!(
        read(&spec_path).contains("Discussion-doc spec"),
        "관리 파일은 수렴 복원"
    );
}

#[test]
fn template_version_parses_marker_and_defaults_to_one() {
    assert_eq!(template_version("<!-- template_version: 5 -->\n# x"), 5);
    assert_eq!(template_version("# no marker here\nbody"), 1);
    // The shipped master must be bumped past v1 (it carries the §7 + phase work).
    assert!(embedded_template_version() >= 2);
}

#[tokio::test]
async fn master_upgrade_detected_and_applied() {
    let dir = setup();
    let root = dir.path();
    let tpl = root.join(".oculpm").join("agents").join("_template.md");
    // Seed an OLD master (no version marker → v1).
    std::fs::write(&tpl, "<!-- schema_version: 1 -->\n# old rules\n").unwrap();

    let up = master_upgrade_available(root).expect("upgrade available");
    assert_eq!(up.from_version, 1);
    assert_eq!(up.to_version, embedded_template_version());

    upgrade_master(root).expect("upgrade");
    // Up-to-date now + previous master backed up.
    assert!(master_upgrade_available(root).is_none());
    assert!(root
        .join(".oculpm")
        .join("agents")
        .join("_template.md.bak")
        .exists());
    // The on-disk master is now the embedded one (v6 — plan_create first).
    let now = std::fs::read_to_string(&tpl).unwrap();
    assert!(now.contains("plan_create"));
    // Upgrade also (re)seeds the on-demand discussion spec.
    assert!(root.join(".oculpm/agents/discussion-spec.md").exists());
}

// ─── sync_active — six matrix cases per PR2 §3 ─────────────────────────

/// (PR2 §3 #1) active = ["cursor", "claude-code"] → overwrite file +
/// managed-block insertion. Both adapters report "inserted" the first time.
#[tokio::test]
async fn sync_writes_overwrite_and_managed_block() {
    let dir = setup();
    let cfg = config_with(&["cursor", "claude-code"]);
    let report = sync_active(dir.path(), &cfg).await.unwrap();

    let by_id: std::collections::HashMap<_, _> = report
        .results
        .into_iter()
        .map(|r| (r.id.clone(), r))
        .collect();
    assert_eq!(by_id["cursor"].action, "inserted");
    assert_eq!(by_id["claude-code"].action, "inserted");
    // Inactive adapters land as "unchanged" (no file to remove).
    assert_eq!(by_id["antigravity"].action, "unchanged");
    assert_eq!(by_id["gemini-cli"].action, "unchanged");

    let cursor_path = dir.path().join(".cursor/rules/ocul-pm.mdc");
    assert!(cursor_path.exists());
    let claude_path = dir.path().join(".claude/CLAUDE.md");
    let claude_text = read(&claude_path);
    assert!(claude_text.contains("<!-- oculpm:begin v1 -->"));
    assert!(claude_text.contains("<!-- oculpm:end -->"));
}

/// (PR2 §3 #2) Toggle cursor off → overwrite file disappears.
#[tokio::test]
async fn sync_remove_overwrite_adapter() {
    let dir = setup();
    let cfg_on = config_with(&["cursor"]);
    sync_active(dir.path(), &cfg_on).await.unwrap();
    assert!(dir.path().join(".cursor/rules/ocul-pm.mdc").exists());

    let cfg_off = config_with(&[]);
    let report = sync_active(dir.path(), &cfg_off).await.unwrap();
    let by_id: std::collections::HashMap<_, _> = report
        .results
        .into_iter()
        .map(|r| (r.id.clone(), r))
        .collect();
    assert_eq!(by_id["cursor"].action, "removed");
    assert!(!dir.path().join(".cursor/rules/ocul-pm.mdc").exists());
}

/// (PR2 §3 #3) Pre-existing CLAUDE.md with user content → managed block
/// is inserted/updated WITHOUT mutating any byte outside the markers.
#[tokio::test]
async fn sync_managed_block_preserves_user_content_byte_perfect() {
    let dir = setup();
    let claude_path = dir.path().join(".claude/CLAUDE.md");
    std::fs::create_dir_all(claude_path.parent().unwrap()).unwrap();
    let user_header = "# My Project Conventions\n\n- prefer rg over grep\n- no emojis in commits\n";
    let user_footer = "\n## After ocul-pm\n\n- nothing yet\n";
    std::fs::write(&claude_path, format!("{user_header}{user_footer}")).unwrap();

    let cfg = config_with(&["claude-code"]);
    sync_active(dir.path(), &cfg).await.unwrap();

    let text = read(&claude_path);
    assert!(text.contains(user_header), "user header lost: {text:?}");
    assert!(
        text.contains(user_footer.trim()),
        "user footer lost: {text:?}"
    );
    assert!(text.contains("<!-- oculpm:begin v1 -->"));
    assert!(text.contains("<!-- oculpm:end -->"));
}

/// (PR2 §3 #4) Edit master → next sync propagates to every active
/// adapter. Rendered output of an Overwrite adapter changes when the
/// per-agent override is replaced (acts as proxy for master changes
/// since the in-binary tpl is the same; the override path exercises
/// the same code path used by master edits when PR4 makes render
/// pull from the master).
#[tokio::test]
async fn sync_per_agent_override_propagates_to_active_adapter() {
    let dir = setup();
    let cfg = config_with(&["cursor"]);
    sync_active(dir.path(), &cfg).await.unwrap();
    let before = read(&dir.path().join(".cursor/rules/ocul-pm.mdc"));

    // Override the cursor adapter content via per-agent file.
    let per_agent_path = dir.path().join(".oculpm/agents/per-agent/cursor.md");
    std::fs::create_dir_all(per_agent_path.parent().unwrap()).unwrap();
    std::fs::write(&per_agent_path, "OVERRIDDEN cursor adapter\n").unwrap();
    let report = sync_active(dir.path(), &cfg).await.unwrap();

    let cursor_result = report.results.iter().find(|r| r.id == "cursor").unwrap();
    assert_eq!(cursor_result.action, "updated");
    let after = read(&dir.path().join(".cursor/rules/ocul-pm.mdc"));
    assert_ne!(before, after);
    assert!(after.contains("OVERRIDDEN cursor adapter"));
}

/// (PR2 §3 #5) Idempotency: same inputs twice → second call reports
/// every active adapter as "unchanged" and file mtimes don't move.
#[tokio::test]
async fn sync_is_idempotent_on_unchanged_inputs() {
    let dir = setup();
    let cfg = config_with(&["cursor", "claude-code"]);
    sync_active(dir.path(), &cfg).await.unwrap();
    let cursor_mtime_1 = std::fs::metadata(dir.path().join(".cursor/rules/ocul-pm.mdc"))
        .unwrap()
        .modified()
        .unwrap();
    let claude_mtime_1 = std::fs::metadata(dir.path().join(".claude/CLAUDE.md"))
        .unwrap()
        .modified()
        .unwrap();

    let report = sync_active(dir.path(), &cfg).await.unwrap();
    let by_id: std::collections::HashMap<_, _> = report
        .results
        .into_iter()
        .map(|r| (r.id.clone(), r))
        .collect();
    assert_eq!(by_id["cursor"].action, "unchanged");
    assert_eq!(by_id["claude-code"].action, "unchanged");

    let cursor_mtime_2 = std::fs::metadata(dir.path().join(".cursor/rules/ocul-pm.mdc"))
        .unwrap()
        .modified()
        .unwrap();
    let claude_mtime_2 = std::fs::metadata(dir.path().join(".claude/CLAUDE.md"))
        .unwrap()
        .modified()
        .unwrap();
    assert_eq!(
        cursor_mtime_1, cursor_mtime_2,
        "cursor file rewritten on no-op sync"
    );
    assert_eq!(
        claude_mtime_1, claude_mtime_2,
        "claude file rewritten on no-op sync"
    );
}

/// (PR2 §3 #6) First sync writes the master template to
/// `.oculpm/agents/_template.md`. User-editable from then on.
#[tokio::test]
async fn sync_writes_master_template_on_first_run_only() {
    let dir = setup();
    let cfg = config_with(&[]);
    sync_active(dir.path(), &cfg).await.unwrap();
    let master_path = dir.path().join(".oculpm/agents/_template.md");
    assert!(master_path.exists());

    // User edits the master.
    std::fs::write(&master_path, "USER EDITED MASTER\n").unwrap();

    // Next sync must NOT overwrite the user edit.
    sync_active(dir.path(), &cfg).await.unwrap();
    let after = read(&master_path);
    assert_eq!(after, "USER EDITED MASTER\n");
}

// ─── managed_block_write specifics (4 cases per PR2 §3) ────────────────

/// (PR2 §3 managed #1) Brand-new CLAUDE.md → block inserted, only
/// adapter content present.
#[tokio::test]
async fn managed_block_inserts_when_file_absent() {
    let dir = setup();
    let cfg = config_with(&["claude-code"]);
    sync_active(dir.path(), &cfg).await.unwrap();
    let claude_path = dir.path().join(".claude/CLAUDE.md");
    let text = read(&claude_path);
    let begin = text.find("<!-- oculpm:begin v1 -->").unwrap();
    let end = text.find("<!-- oculpm:end -->").unwrap();
    assert!(begin < end);
}

/// (PR2 §3 managed #2) Orphan marker → sync surfaces the error per
/// adapter rather than corrupting the file.
#[tokio::test]
async fn managed_block_orphan_marker_surfaces_as_error_result() {
    let dir = setup();
    let claude_path = dir.path().join(".claude/CLAUDE.md");
    std::fs::create_dir_all(claude_path.parent().unwrap()).unwrap();
    std::fs::write(&claude_path, "<!-- oculpm:begin v1 -->\n stuck \n").unwrap();

    let cfg = config_with(&["claude-code"]);
    let report = sync_active(dir.path(), &cfg).await.unwrap();
    let claude = report
        .results
        .iter()
        .find(|r| r.id == "claude-code")
        .unwrap();
    assert_eq!(claude.action, "error");
    assert!(claude
        .error
        .as_ref()
        .unwrap()
        .to_lowercase()
        .contains("managed"));
}

/// (PR2 §3 managed #3) Both markers present with identical content →
/// no rewrite, action = "unchanged".
#[tokio::test]
async fn managed_block_unchanged_when_content_matches() {
    let dir = setup();
    let cfg = config_with(&["claude-code"]);
    sync_active(dir.path(), &cfg).await.unwrap();
    let report = sync_active(dir.path(), &cfg).await.unwrap();
    let claude = report
        .results
        .iter()
        .find(|r| r.id == "claude-code")
        .unwrap();
    assert_eq!(claude.action, "unchanged");
}

/// (PR2 §3 managed #4) CRLF source file → managed block uses CRLF EOLs.
/// Re-asserts the atomic_io invariant on the adapter wiring.
#[tokio::test]
async fn managed_block_preserves_crlf_eol_from_source() {
    let dir = setup();
    let claude_path = dir.path().join(".claude/CLAUDE.md");
    std::fs::create_dir_all(claude_path.parent().unwrap()).unwrap();
    std::fs::write(&claude_path, "user line 1\r\nuser line 2\r\n").unwrap();

    let cfg = config_with(&["claude-code"]);
    sync_active(dir.path(), &cfg).await.unwrap();
    let text = read(&claude_path);
    // At least one CRLF must be present in the managed block region
    // (find the begin marker and assert CRLF follows somewhere after).
    let begin_idx = text.find("<!-- oculpm:begin v1 -->").unwrap();
    let end_idx = text.find("<!-- oculpm:end -->").unwrap();
    let block_slice = &text[begin_idx..end_idx];
    assert!(
        block_slice.contains("\r\n"),
        "EOL not preserved: {block_slice:?}"
    );
}

// ─── detect — three cases per PR2 §3 ───────────────────────────────────

/// (PR2 §3 detect #1) `.cursor/` exists without `.mdc` → Likely.
#[test]
fn detect_cursor_likely_when_only_directory_present() {
    let dir = setup();
    std::fs::create_dir_all(dir.path().join(".cursor")).unwrap();
    let result = detect(dir.path());
    let cursor = result.iter().find(|d| d.agent_id == "cursor").unwrap();
    assert_eq!(cursor.confidence, DetectConfidence::Likely);
    assert!(cursor.adjacent_marker_exists);
    assert!(!cursor.adapter_path_exists);
}

/// (PR2 §3 detect #2) `.claude/CLAUDE.md` exists → Present.
#[test]
fn detect_claude_present_when_adapter_path_exists() {
    let dir = setup();
    let path = dir.path().join(".claude/CLAUDE.md");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, "anything").unwrap();
    let result = detect(dir.path());
    let claude = result.iter().find(|d| d.agent_id == "claude-code").unwrap();
    assert_eq!(claude.confidence, DetectConfidence::Present);
    assert!(claude.adapter_path_exists);
}

/// (PR2 §3 detect #3) Nothing on disk → Unknown for every adapter.
#[test]
fn detect_unknown_when_nothing_on_disk() {
    let dir = setup();
    let result = detect(dir.path());
    assert_eq!(result.len(), known_adapters().len());
    for d in &result {
        assert_eq!(d.confidence, DetectConfidence::Unknown, "{d:?}");
    }
}

#[test]
fn a_template_newer_than_the_app_is_reported_not_ignored() {
    let dir = tempfile::tempdir().unwrap();
    let agents = dir.path().join(".oculpm").join("agents");
    std::fs::create_dir_all(&agents).unwrap();
    let ahead = embedded_template_version() + 3;

    std::fs::write(
        agents.join("_template.md"),
        format!("<!-- template_version: {ahead} -->\n본문\n"),
    )
    .unwrap();
    let seen = master_ahead_of_app(dir.path()).expect("an ahead template must be reported");
    assert_eq!(seen.from_version, ahead);
    assert_eq!(seen.to_version, embedded_template_version());
    assert!(
        master_upgrade_available(dir.path()).is_none(),
        "an ahead template is not an upgrade — the two checks must not both fire"
    );

    // 같은 버전이면 어느 쪽도 말하지 않는다.
    std::fs::write(
        agents.join("_template.md"),
        format!(
            "<!-- template_version: {} -->\n본문\n",
            embedded_template_version()
        ),
    )
    .unwrap();
    assert!(master_ahead_of_app(dir.path()).is_none());
}

/// 보안 피드백 2차 — 프로젝트를 열 때마다 도는 동기가 링크를 따라갔다.
/// 파일 링크(`AGENTS.md -> 밖`)는 대상 내용을 프로젝트로 복사했고, 폴더 링크
/// (`.claude -> 밖`)는 쓰기가 프로젝트 밖에 떨어졌다. 이제 둘 다 손대지 않고
/// 사유를 남긴다 — 밖은 한 바이트도 바뀌지 않고, 링크도 그대로다.
#[tokio::test]
async fn sync_never_writes_through_a_planted_link() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path().join("proj");
    let outside = tmp.path().join("outside");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::create_dir_all(&outside).unwrap();
    let zshrc = outside.join("zshrc");
    std::fs::write(&zshrc, "export TOKEN=s3cr3t\n").unwrap();
    if !crate::test_links::file(&zshrc, &root.join("AGENTS.md")) {
        return;
    }
    if !crate::test_links::dir(&outside, &root.join(".claude")) {
        return;
    }

    let cfg = config_with(&["agents-md", "claude-code"]);
    let report = sync_active(&root, &cfg).await.unwrap();

    for id in ["agents-md", "claude-code"] {
        let r = report.results.iter().find(|r| r.id == id).unwrap();
        assert_eq!(r.action, "error", "{id}: {r:?}");
        assert!(
            r.error
                .as_deref()
                .is_some_and(|e| e.contains("symbolic link") || e.contains("escapes")),
            "{id}: {r:?}"
        );
    }
    assert_eq!(
        std::fs::read_to_string(&zshrc).unwrap(),
        "export TOKEN=s3cr3t\n"
    );
    assert!(
        !outside.join("CLAUDE.md").exists(),
        "밖에 아무것도 생기지 않는다"
    );
    let agents_md = root.join("AGENTS.md");
    assert!(
        std::fs::symlink_metadata(&agents_md)
            .unwrap()
            .file_type()
            .is_symlink(),
        "링크를 일반 파일로 바꿔치기하지 않는다"
    );
}
