//! `rules.rs` 의 테스트 — 본문 파일 800줄 래칫 때문에 옆으로 나왔다
//! (`history_tests.rs` 와 같은 모양).

use super::*;
use std::fs;
use tempfile::TempDir;

fn seed(root: &Path, rel: &str, contents: &str) {
    let p = root.join(rel);
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, contents).unwrap();
}

const PATHS_RULE: &str = "---\npaths:\n  - \"src/api/**/*.ts\"\n  - \"src/components/*.tsx\"\n---\n\n# API 규칙\n\n- 입력 검증 필수\n";
const ALWAYS_RULE: &str = "# 커밋 규칙\n\n- 한국어로 쓴다\n";

// ─── 관리 블록 보호 (2026-07-20 적대 리뷰 HIGH) ─────────────────────────

const MANAGED: &str =
    "# 프로젝트 메모\n\n사용자 영역\n\n<!-- oculpm:begin v1 -->\n앱이 관리하는 규칙\n<!-- oculpm:end -->\n\n꼬리\n";

#[test]
fn save_preserves_app_managed_block_and_allows_edits_outside() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    seed(root, ".claude/CLAUDE.md", MANAGED);

    // 블록 밖 편집 → 허용.
    let outside = MANAGED.replace("사용자 영역", "사용자가 고친 영역");
    assert!(save(
        RuleScope::Project,
        root,
        root,
        ".claude/CLAUDE.md",
        &outside,
        false
    )
    .is_ok());
    assert!(std::fs::read_to_string(root.join(".claude/CLAUDE.md"))
        .unwrap()
        .contains("사용자가 고친 영역"));

    // 블록 **안** 편집 → 거부 (다음 sync 에 조용히 사라질 내용).
    let inside = outside.replace("앱이 관리하는 규칙", "내가 몰래 끼워넣은 규칙");
    let err = save(
        RuleScope::Project,
        root,
        root,
        ".claude/CLAUDE.md",
        &inside,
        false,
    )
    .unwrap_err();
    assert!(err.contains("_template.md"), "행동 가능한 안내: {err}");
    // 디스크는 불변 — 직전 성공 저장 상태 그대로.
    let on_disk = std::fs::read_to_string(root.join(".claude/CLAUDE.md")).unwrap();
    assert!(on_disk.contains("앱이 관리하는 규칙"));
    assert!(!on_disk.contains("몰래"));

    // 블록 통째 삭제 시도 → 거부.
    let dropped = "# 프로젝트 메모\n\n블록 없앰\n";
    assert!(save(
        RuleScope::Project,
        root,
        root,
        ".claude/CLAUDE.md",
        dropped,
        false
    )
    .is_err());
}

#[test]
fn save_rejects_unbalanced_marker_that_would_break_adapter_forever() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    // 신규 파일이라 보호할 블록은 없지만, 짝 안 맞는 마커 자체가 어댑터를
    // 영구 에러 상태로 만든다 — 저장 자체를 막아야 한다.
    let orphan = "# 메모\n\n<!-- oculpm:begin v1 -->\n닫히지 않음\n";
    let err = save(RuleScope::Project, root, root, "CLAUDE.md", orphan, false).unwrap_err();
    assert!(err.contains("never closed"), "{err}");
    assert!(
        !root.join("CLAUDE.md").exists(),
        "거부 시 파일을 만들지 않는다"
    );
}

// ─── 경로 검증 ──────────────────────────────────────────────────────────

#[test]
fn validate_rel_allowlist_and_traversal() {
    // ClaudeMd 슬롯.
    assert_eq!(
        validate_rel(RuleScope::Project, "CLAUDE.md"),
        Ok(RuleKind::ClaudeMd)
    );
    assert_eq!(
        validate_rel(RuleScope::Project, ".claude/CLAUDE.md"),
        Ok(RuleKind::ClaudeMd)
    );
    assert_eq!(
        validate_rel(RuleScope::Project, "CLAUDE.local.md"),
        Ok(RuleKind::ClaudeMd)
    );
    assert_eq!(
        validate_rel(RuleScope::Global, ".claude/CLAUDE.md"),
        Ok(RuleKind::ClaudeMd)
    );
    // 전역 스코프에 루트 CLAUDE.md 슬롯은 없다.
    assert!(validate_rel(RuleScope::Global, "CLAUDE.md").is_err());
    // Rule — 중첩 포함.
    assert_eq!(
        validate_rel(RuleScope::Project, ".claude/rules/api.md"),
        Ok(RuleKind::Rule)
    );
    assert_eq!(
        validate_rel(RuleScope::Project, ".claude/rules/api/validation.md"),
        Ok(RuleKind::Rule)
    );
    // 거부: 탈출·숨김·비-md·깊이 초과·기타 경로.
    for bad in [
        ".claude/rules/../escape.md",
        ".claude/rules/.hidden.md",
        ".claude/rules/a/.b/c.md",
        ".claude/rules/note.txt",
        ".claude/rules/a/b/c/d/e.md",
        ".claude/rules/",
        "src/whatever.md",
        "AGENTS.md",
    ] {
        assert!(
            validate_rel(RuleScope::Project, bad).is_err(),
            "거부돼야: {bad}"
        );
    }
    // 검증 통과해도 최종 경로는 루트 안 (이중 방어).
    let tmp = TempDir::new().unwrap();
    assert!(secure_path(RuleScope::Global, tmp.path(), ".claude/rules/ok.md").is_ok());
    assert!(secure_path(RuleScope::Global, tmp.path(), "../escape.md").is_err());
}

// ─── frontmatter 파싱 ───────────────────────────────────────────────────

#[test]
fn parse_meta_paths_list_string_and_title() {
    let (paths, title) = parse_rule_meta(PATHS_RULE);
    assert_eq!(paths, vec!["src/api/**/*.ts", "src/components/*.tsx"]);
    assert_eq!(title, "API 규칙");
    // 단일 문자열 형태도 수용.
    let (paths, _) = parse_rule_meta("---\npaths: \"docs/**\"\n---\nx");
    assert_eq!(paths, vec!["docs/**"]);
    // frontmatter 없음 = 항상 로드.
    let (paths, title) = parse_rule_meta(ALWAYS_RULE);
    assert!(paths.is_empty());
    assert_eq!(title, "커밋 규칙");
    // 깨진 YAML → 관대 (빈 paths).
    let (paths, _) = parse_rule_meta("---\n{broken\n---\nbody");
    assert!(paths.is_empty());
}

// ─── overview / CRUD ────────────────────────────────────────────────────

#[test]
fn overview_lists_slots_and_recursive_rules() {
    let proj = TempDir::new().unwrap();
    let home = TempDir::new().unwrap();
    seed(proj.path(), "CLAUDE.md", "# 프로젝트 지침\n");
    seed(proj.path(), ".claude/rules/commit.md", ALWAYS_RULE);
    seed(proj.path(), ".claude/rules/api/validation.md", PATHS_RULE);
    seed(proj.path(), ".claude/rules/note.txt", "md 아님 — 제외");
    seed(home.path(), ".claude/rules/style.md", "# 전역 스타일\n");

    let ov = overview(proj.path(), home.path(), false);
    // 고정 슬롯 4개 (프로젝트 3 + 전역 1), exists 반영.
    assert_eq!(ov.claude_md.len(), 4);
    let root_md = ov
        .claude_md
        .iter()
        .find(|e| e.rel_path == "CLAUDE.md")
        .unwrap();
    assert!(root_md.exists);
    assert_eq!(root_md.title, "프로젝트 지침");
    assert!(
        !ov.claude_md
            .iter()
            .find(|e| e.rel_path == "CLAUDE.local.md")
            .unwrap()
            .exists
    );

    let names: Vec<&str> = ov.project_rules.iter().map(|e| e.name.as_str()).collect();
    assert_eq!(
        names,
        vec!["api/validation", "commit"],
        "재귀 + 이름순: {names:?}"
    );
    let api = &ov.project_rules[0];
    assert_eq!(api.rel_path, ".claude/rules/api/validation.md");
    assert_eq!(api.paths.len(), 2);
    assert_eq!(ov.global_rules.len(), 1);
    assert_eq!(ov.global_rules[0].scope, RuleScope::Global);
}

#[test]
fn save_create_conflict_idempotent_and_delete_guard() {
    let proj = TempDir::new().unwrap();
    let root = proj.path();
    // create=true 신규 생성.
    let entry = save(
        RuleScope::Project,
        root,
        root,
        ".claude/rules/commit.md",
        ALWAYS_RULE,
        true,
    )
    .unwrap();
    assert_eq!(entry.name, "commit");
    // create=true 중복 거부.
    assert!(save(
        RuleScope::Project,
        root,
        root,
        ".claude/rules/commit.md",
        "x",
        true
    )
    .is_err());
    // 멱등 저장 — mtime 불변.
    let abs = root.join(".claude/rules/commit.md");
    let t1 = fs::metadata(&abs).unwrap().modified().unwrap();
    save(
        RuleScope::Project,
        root,
        root,
        ".claude/rules/commit.md",
        ALWAYS_RULE,
        false,
    )
    .unwrap();
    assert_eq!(
        t1,
        fs::metadata(&abs).unwrap().modified().unwrap(),
        "동일 내용 재저장이 파일을 다시 씀"
    );
    // CLAUDE.md 슬롯 생성도 save 로 (create).
    save(
        RuleScope::Project,
        root,
        root,
        "CLAUDE.md",
        "# 지침\n",
        true,
    )
    .unwrap();
    // ClaudeMd 는 삭제 불가, Rule 은 삭제 가능.
    assert!(delete(RuleScope::Project, root, "CLAUDE.md").is_err());
    delete(RuleScope::Project, root, ".claude/rules/commit.md").unwrap();
    assert!(!abs.exists());
}

// ─── Cursor 미러 ────────────────────────────────────────────────────────

#[test]
fn mirror_render_translates_paths_to_globs() {
    let rendered = render_mirror(".claude/rules/api/validation.md", PATHS_RULE);
    assert!(rendered.starts_with("---\n"));
    assert!(rendered.contains("globs: [\"src/api/**/*.ts\", \"src/components/*.tsx\"]"));
    assert!(rendered.contains("alwaysApply: false"));
    assert!(rendered.contains("<!-- oculpm:rule-mirror .claude/rules/api/validation.md -->"));
    // 원본 frontmatter 는 벗기고 본문만 남긴다.
    assert!(rendered.contains("# API 규칙"));
    assert!(!rendered.contains("paths:"));

    let rendered = render_mirror(".claude/rules/commit.md", ALWAYS_RULE);
    assert!(rendered.contains("alwaysApply: true"));
    assert!(!rendered.contains("globs:"));
    assert_eq!(
        mirror_rel_for(".claude/rules/api/validation.md"),
        ".cursor/rules/api-validation.mdc"
    );
}

#[test]
fn mirror_write_respects_foreign_files_and_is_idempotent() {
    let proj = TempDir::new().unwrap();
    let root = proj.path();
    seed(root, ".claude/rules/commit.md", ALWAYS_RULE);

    let r = write_mirror(root, ".claude/rules/commit.md", ALWAYS_RULE);
    assert_eq!(r.action, "written");
    let abs = root.join(".cursor/rules/commit.mdc");
    assert!(abs.exists());
    // 멱등.
    let r = write_mirror(root, ".claude/rules/commit.md", ALWAYS_RULE);
    assert_eq!(r.action, "unchanged");

    // 마커 없는 기존 파일 (사용자/어댑터 소유) → conflict, 원본 불변.
    seed(
        root,
        ".cursor/rules/user-own.mdc",
        "---\nglobs: [\"*\"]\n---\n사용자 파일\n",
    );
    let r = write_mirror(root, ".claude/rules/user-own.md", ALWAYS_RULE);
    assert_eq!(r.action, "conflict");
    assert!(fs::read_to_string(root.join(".cursor/rules/user-own.mdc"))
        .unwrap()
        .contains("사용자 파일"));
    // 제거도 마커 파일만.
    let r = remove_mirror(root, ".claude/rules/user-own.md");
    assert_eq!(r.action, "conflict");
    let r = remove_mirror(root, ".claude/rules/commit.md");
    assert_eq!(r.action, "removed");
    assert!(!abs.exists());
}

#[test]
fn sync_mirrors_converges_both_directions() {
    let proj = TempDir::new().unwrap();
    let root = proj.path();
    seed(root, ".claude/rules/commit.md", ALWAYS_RULE);
    seed(root, ".claude/rules/api/validation.md", PATHS_RULE);
    // 어댑터/사용자 파일 — 마커 없음, 어느 방향에서도 불변이어야 한다.
    seed(
        root,
        ".cursor/rules/ocul-pm.mdc",
        "---\nalwaysApply: true\n---\n어댑터 파일\n",
    );

    let results = sync_mirrors(root, true);
    assert_eq!(results.iter().filter(|r| r.action == "written").count(), 2);
    assert!(root.join(".cursor/rules/commit.mdc").exists());
    assert!(root.join(".cursor/rules/api-validation.mdc").exists());

    // 원본 하나 삭제 → 재동기화 시 고아 미러 제거.
    fs::remove_file(root.join(".claude/rules/commit.md")).unwrap();
    let results = sync_mirrors(root, true);
    assert!(results
        .iter()
        .any(|r| r.action == "removed" && r.source_rel.ends_with("commit.md")));
    assert!(!root.join(".cursor/rules/commit.mdc").exists());

    // 끄기 → 마커 미러 전량 제거, 어댑터 파일 보존.
    let results = sync_mirrors(root, false);
    assert!(results.iter().any(|r| r.action == "removed"));
    assert!(!root.join(".cursor/rules/api-validation.mdc").exists());
    assert!(root.join(".cursor/rules/ocul-pm.mdc").exists());
}

/// A0c ② — 평탄화가 겹치는 rename(`api/validation.md` → `api-validation.md`,
/// 둘 다 `api-validation.mdc`)이 **1패스에 수렴**해야 한다. 종전에는 낡은
/// 마커 미러가 새 쓰기를 conflict 로 막은 채 쓰기 뒤의 고아 정리에 지워져,
/// 1패스 후 미러가 사라지고 2패스에야 복구됐다.
#[test]
fn sync_mirrors_recovers_flatten_colliding_rename_in_one_pass() {
    let proj = TempDir::new().unwrap();
    let root = proj.path();
    seed(root, ".claude/rules/api/validation.md", PATHS_RULE);
    sync_mirrors(root, true);
    assert!(root.join(".cursor/rules/api-validation.mdc").exists());

    fs::rename(
        root.join(".claude/rules/api/validation.md"),
        root.join(".claude/rules/api-validation.md"),
    )
    .unwrap();
    let results = sync_mirrors(root, true);
    let mirror = fs::read_to_string(root.join(".cursor/rules/api-validation.mdc"))
        .expect("1패스 후 미러가 존재해야 한다");
    assert!(
        mirror.contains(".claude/rules/api-validation.md"),
        "마커가 새 원본을 가리켜야 한다: {results:?}"
    );
}

/// A0c ④ — `----` 수평선·`--- 제목` 텍스트를 frontmatter 로 오인해 미러
/// 본문을 유실하던 문제. 구분자는 정확히 `---` 한 줄이어야 한다.
#[test]
fn split_frontmatter_ignores_horizontal_rules() {
    // `----` 4개 대시 — frontmatter 아님, 본문 전체 보존.
    let hr = "----\n첫 단락\n----\n둘째 단락\n";
    assert_eq!(split_frontmatter(hr), (None, hr));
    // `--- 제목` — frontmatter 아님.
    let titled = "--- 구분 ---\n본문\n";
    assert_eq!(split_frontmatter(titled), (None, titled));
    // 정상 frontmatter 는 종전대로.
    let (fm, body) = split_frontmatter("---\npaths:\n  - \"a/**\"\n---\n본문\n");
    assert_eq!(fm.map(str::trim), Some("paths:\n  - \"a/**\""));
    assert_eq!(body, "본문\n");
    // 닫는 줄이 `----` 뿐이면 frontmatter 미확정 — 전체가 본문.
    let unclosed = "---\nfoo: bar\n----\n본문\n";
    assert_eq!(split_frontmatter(unclosed), (None, unclosed));
    // render_mirror 경유 — 수평선 문서의 본문이 미러에서 살아남는다.
    let rendered = render_mirror(".claude/rules/hr.md", hr);
    assert!(rendered.contains("첫 단락"), "{rendered}");
    assert!(rendered.contains("둘째 단락"), "{rendered}");
}

/// A0c ⑤ — 읽기 상한: 상한 초과 파일은 목록에서 제외되고 read 는 명시적
/// 에러를 낸다 (조용한 통째 로딩 금지).
#[test]
fn oversized_rule_is_skipped_and_read_errors() {
    let proj = TempDir::new().unwrap();
    let root = proj.path();
    let big = "x".repeat(MAX_RULE_BYTES + 1);
    seed(root, ".claude/rules/huge.md", &big);
    seed(root, ".claude/rules/ok.md", ALWAYS_RULE);

    let listed = list_scope(RuleScope::Project, root, Some(root));
    assert!(listed.iter().any(|e| e.rel_path.ends_with("ok.md")));
    assert!(
        !listed.iter().any(|e| e.rel_path.ends_with("huge.md")),
        "상한 초과 파일이 목록에 오르면 안 된다"
    );

    let err = read(RuleScope::Project, root, root, ".claude/rules/huge.md").unwrap_err();
    assert!(err.contains("read limit"), "{err}");
}

/// A0c ⑤ 후속 (리뷰 지적) — 상한 초과로 검증 불능인 대상은 "건드리지
/// 않는다": save 는 거부, 미러 쓰기/삭제는 conflict + 파일 보존.
#[test]
fn oversized_targets_are_treated_as_unverifiable() {
    let proj = TempDir::new().unwrap();
    let root = proj.path();
    let big = "x".repeat(MAX_RULE_BYTES + 1);

    // 관리 블록 가드 — 기존 파일이 상한 초과면 저장 자체를 거부.
    seed(root, ".claude/CLAUDE.md", &big);
    let err = save(
        RuleScope::Project,
        root,
        root,
        ".claude/CLAUDE.md",
        "새 내용",
        false,
    )
    .unwrap_err();
    assert!(err.contains("could not be verified"), "{err}");

    // 미러 경로 — 검증 불능 .mdc 는 쓰지도 지우지도 않고 상태는 Conflict.
    seed(root, ".claude/rules/commit.md", ALWAYS_RULE);
    seed(root, ".cursor/rules/commit.mdc", &big);
    assert_eq!(
        write_mirror(root, ".claude/rules/commit.md", ALWAYS_RULE).action,
        "conflict"
    );
    assert_eq!(
        remove_mirror(root, ".claude/rules/commit.md").action,
        "conflict"
    );
    assert!(
        root.join(".cursor/rules/commit.mdc").exists(),
        "검증 불능 파일은 보존"
    );
    assert!(matches!(
        mirror_state(root, ".claude/rules/commit.md"),
        MirrorState::Conflict
    ));
}

#[test]
fn new_rule_name_validation() {
    for good in ["commit", "api-rules", "a1_b"] {
        assert!(validate_new_rule_name(good).is_ok(), "{good}");
    }
    for bad in ["", "한글", "UPPER", "-lead", "a b", &"x".repeat(65)] {
        assert!(validate_new_rule_name(bad).is_err(), "{bad:?}");
    }
}
