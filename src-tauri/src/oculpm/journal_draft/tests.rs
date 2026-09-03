//! `journal_draft` 의 테스트. 본문에서 갈라 나왔다 (2026-09-04) — 파일 크기
//! 래칫이 이 파일을 짚었고, 경계가 가장 뚜렷한 덩어리가 여기였다.
//! 동작은 그대로다 — 옮기기만 했다.

use super::*;
use crate::oculpm::spec::{FileChangeEvent, FileOp};
use tempfile::TempDir;

fn plan(type_: &str) -> DraftPlan {
    DraftPlan {
        type_: type_.into(),
        slug: "Fix Journal Cache!!".into(),
        title: "일지 캐시 무효화 버그 수정".into(),
        difficulty: "medium".into(),
        primary: "캐시 키가 상대경로/절대경로로 갈라져 무효화가 누락됐다.".into(),
        secondary: "키를 캐시-키 형태로 정규화했다.".into(),
        verification: "cargo test 12개 그린".into(),
    }
}

#[test]
fn parse_draft_response_tolerates_fences_and_rejects_empty() {
    let text = "설명입니다\n```json\n{\"type\":\"bug\",\"title\":\"t\",\"primary\":\"p\"}\n```";
    let p = parse_draft_response(text).unwrap();
    assert_eq!(p.type_, "bug");
    // title/primary 없는 응답은 실패 → 강등 경로.
    assert!(parse_draft_response("{\"type\":\"bug\"}").is_none());
    assert!(parse_draft_response("no json at all").is_none());
}

#[test]
fn sanitize_slug_forces_ascii_kebab_with_fallback() {
    assert_eq!(
        sanitize_slug("Fix Journal Cache!!", "fb"),
        "fix-journal-cache"
    );
    assert_eq!(
        sanitize_slug("한글만있음", "claude-session-003-auto"),
        "claude-session-003-auto"
    );
    assert_eq!(sanitize_slug("  --weird__name--  ", "fb"), "weird-name");
    let long = sanitize_slug(&"a".repeat(100), "fb");
    assert!(long.len() <= 40);
}

#[test]
fn compose_body_enforces_type_headers() {
    let body = compose_body(EntryType::Bug, &plan("bug"), "메모줄", ContentLang::Unset);
    let h_cause = body.find("## 발생 원인").unwrap();
    let h_fix = body.find("## 해결 방법").unwrap();
    let h_verify = body.find("## 검증").unwrap();
    assert!(h_cause < h_fix && h_fix < h_verify, "헤더 순서 강제");
    assert!(body.contains("cargo test 12개 그린"));
    assert!(body.contains("메모줄"));

    let feature = compose_body(
        EntryType::Feature,
        &plan("feature"),
        "m",
        ContentLang::Unset,
    );
    assert!(feature.contains("## 추가 기능") && feature.contains("## 동작 흐름"));

    // 검증이 비면 정직한 플레이스홀더.
    let mut p = plan("bug");
    p.verification = String::new();
    let body = compose_body(EntryType::Bug, &p, "m", ContentLang::Unset);
    assert!(body.contains("검증 근거를 찾지 못함"));
}

#[test]
fn files_from_events_dedupes_by_last_op_and_drops_masked() {
    let ev = |sid: &str, path: &str, op: FileOp| FileChangeEvent {
        ts: "t".into(),
        session_id: sid.into(),
        op,
        path: path.into(),
        hash_before: None,
        hash_after: None,
        bytes: 1,
    };
    let events = vec![
        ev("20260720-001", "src/a.rs", FileOp::Create),
        ev("20260720-001", "src/a.rs", FileOp::Update),
        ev("20260720-002", "src/other-session.rs", FileOp::Update),
        ev(
            "20260720-001",
            "**redacted/sensitive**:abcd",
            FileOp::Update,
        ),
    ];
    let files = files_from_events(&events, "20260720-001");
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].path, "src/a.rs");
    assert!(matches!(files[0].op, FileOp::Update), "마지막 op 이 이긴다");
}

#[test]
fn self_entry_detection_only_sees_window() {
    let dir = TempDir::new().unwrap();
    let day = dir.path().join("20260720");
    std::fs::create_dir_all(day.join("Bugs")).unwrap();

    // 창 시작 전에 존재하던 파일만 있음 → false.
    std::fs::write(day.join("Bugs/0900_bug_old.md"), "x").unwrap();
    let future = SystemTime::now() + Duration::from_secs(3600);
    assert!(!self_entry_exists(&day, future));

    // 창 안(지금) 파일 → true.
    let past = SystemTime::now() - Duration::from_secs(60);
    assert!(self_entry_exists(&day, past));

    // 디렉토리 자체가 없으면 false (첫 세션).
    assert!(!self_entry_exists(&dir.path().join("29990101"), past));
}

#[test]
fn degraded_body_keeps_session_meta() {
    let session = Session {
        id: "20260720-003".into(),
        started_at: "2026-07-20T14:00:00+09:00".into(),
        ended_at: None,
        ended_reason: None,
        active_window_ms: 0,
        file_event_count: 0,
        files_unique: 0,
        git_head_at_start: None,
        git_head_at_end: None,
        agent_label_guess: None,
        agent_sessions: Vec::new(),
        linked_journal_entries: vec![],
    };
    let body = compose_degraded_body(&session, &[], "LLM 호출 실패", "메모", ContentLang::Unset);
    assert!(body.contains("20260720-003"));
    assert!(body.contains("LLM 호출 실패"));
    assert!(body.contains("## 검증"));
}

// ── 산출물 언어 (English) — 헤더는 규격, 폴백 문구는 산문 ─────────────

#[test]
fn english_fallbacks_and_headers_are_english() {
    // LLM 이 secondary/verification 을 못 채운 최악의 경우.
    let p = DraftPlan {
        type_: "bug".into(),
        slug: "s".into(),
        title: "t".into(),
        difficulty: "medium".into(),
        primary: "Root cause was a stale cache.".into(),
        secondary: String::new(),
        verification: String::new(),
    };
    let body = compose_body(EntryType::Bug, &p, "note", ContentLang::English);

    // 헤더도 산출물 언어를 따른다 — 헤더 이름으로 파싱하는 코드가 없어
    // 마이그레이션이 필요 없다는 걸 확인한 뒤 바꿨다 (compose_body 주석).
    // 이름은 프런트 `manual.bodyPlaceholder` 와 맞춘다.
    assert!(body.contains("## Root cause"), "{body}");
    assert!(body.contains("## Verification"), "{body}");
    assert!(!body.contains("## 발생 원인"), "{body}");

    // 폴백 **산문**은 영어여야 한다 — 영어 일지 한가운데 한국어 한 줄이
    // 남는 게 이 수정 전의 실제 동작이었다.
    assert!(body.contains("(auto draft — content unknown)"), "{body}");
    assert!(body.contains("Needs your review."), "{body}");
    assert!(!body.contains("자동 초안"), "{body}");
}

#[test]
fn english_degraded_body_is_english() {
    let session = Session {
        id: "s1".into(),
        started_at: "2026-08-12T00:00:00Z".into(),
        ended_at: None,
        ended_reason: None,
        active_window_ms: 0,
        file_event_count: 0,
        files_unique: 0,
        git_head_at_start: None,
        git_head_at_end: None,
        agent_label_guess: None,
        agent_sessions: Vec::new(),
        linked_journal_entries: vec![],
    };
    let body = compose_degraded_body(&session, &[], "llm failed", "note", ContentLang::English);
    assert!(body.contains("Auto-downgraded record"), "{body}");
    assert!(body.contains("Session:"), "{body}");
    assert!(body.contains("## Verification"), "{body}");
    assert!(!body.contains("자동 강등"), "{body}");
}

#[test]
fn korean_path_is_byte_identical_to_before() {
    // 이 라운드의 안전판 — 기존 사용자의 일지 모양이 바뀌면 안 된다.
    // `Unset`(설정 미지정)과 명시 `Korean` 둘 다 예전 헤더 그대로여야 한다.
    let p = plan("bug");
    for lang in [ContentLang::Unset, ContentLang::Korean] {
        let body = compose_body(EntryType::Bug, &p, "m", lang);
        assert!(body.contains("## 발생 원인"), "{lang:?}: {body}");
        assert!(body.contains("## 해결 방법"), "{lang:?}: {body}");
        assert!(body.contains("## 검증"), "{lang:?}: {body}");
        assert!(body.contains("## 메모"), "{lang:?}: {body}");
        assert!(!body.contains("Root cause"), "{lang:?}: {body}");
    }
}
