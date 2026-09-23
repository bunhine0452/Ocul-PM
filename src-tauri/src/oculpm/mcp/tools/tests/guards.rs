//! 비추적·심링크·모르는 도구 — **아무것도 만들지 않고** 거절하는지.

use crate::oculpm::mcp::tools::*;
use tempfile::TempDir;

/// project_init — A0b 의 유일한 예외. confirm 게이트·심볼릭 링크 거부·
/// idempotence(추적 중이면 무변경)를 계약으로 잠근다.
#[test]
fn project_init_gates_and_scaffolds() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();

    // 1) confirm 누락/false → 거부, 아무것도 안 만든다.
    assert!(call_tool(root, "project_init", &json!({})).is_err());
    assert!(call_tool(root, "project_init", &json!({"confirm": false})).is_err());
    assert!(!root.join(".oculpm").exists());

    // 2) confirm=true → 스캐폴드 생성 (config·schema-version·gitignore 블록·
    //    AGENTS.md 어댑터·마스터 템플릿).
    let out = call_tool(root, "project_init", &json!({"confirm": true})).unwrap();
    assert_eq!(out["initialized"], json!(true));
    assert!(root.join(".oculpm/config.toml").exists());
    assert!(root.join(".oculpm/.schema-version").exists());
    assert!(root.join(".oculpm/agents/_template.md").exists());
    assert!(root.join("AGENTS.md").exists());
    assert!(std::fs::read_to_string(root.join(".gitignore"))
        .unwrap()
        .contains("oculpm"));

    // 3) 초기화 직후 다른 도구가 실제로 동작한다 (플러그인-온리 그린필드 흐름).
    let journal = call_tool(
        root,
        "journal_write",
        &json!({"type": "chore", "slug": "first", "title": "첫 기록", "body_markdown": "## 검증\n- ok"}),
    );
    assert!(journal.is_ok(), "{journal:?}");

    // 4) 재호출 → initialized=false (ensure 경로).
    let again = call_tool(root, "project_init", &json!({"confirm": true})).unwrap();
    assert_eq!(again["initialized"], json!(false));
}

/// 부분 실패 수렴 — `.oculpm/` 디렉터리만 있고 나머지가 없는 반쪽 상태에서
/// 재호출하면 누락분(config·gitignore 보호·AGENTS.md)이 채워져야 한다.
/// (전면 스킵이면 훅 인박스가 gitignore 보호 없이 커밋될 수 있다.)
#[test]
fn project_init_converges_half_initialized_state() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    std::fs::create_dir(root.join(".oculpm")).unwrap();

    let out = call_tool(root, "project_init", &json!({"confirm": true})).unwrap();
    assert_eq!(out["initialized"], json!(false));
    assert!(root.join(".oculpm/config.toml").exists());
    assert!(root.join("AGENTS.md").exists());
    assert!(std::fs::read_to_string(root.join(".gitignore"))
        .unwrap()
        .contains("oculpm"));
}

/// **실제 홈 폴더**에는 `.oculpm` 을 깔지 않는다 — `--root` 를 홈으로 잘못 고정한
/// 설정 사고가 `~/.gitignore`·`~/AGENTS.md` 오염으로 번지지 않게. 예전 가드는 `HOME`
/// 환경변수와 비교해 **Windows 에서는 꺼져 있었다** (크로스플랫폼 L-INTEG).
/// 러너 한정 — 가드가 회귀하면 이 테스트가 진짜 홈에 쓰므로 개발 기기에서는 돌리지
/// 않는다 (macOS·Linux 판정은 `paths::tool_config` 의 순수 테스트가 문다).
#[cfg(windows)]
#[test]
fn project_init_refuses_the_real_home_directory() {
    let home = crate::oculpm::paths::home_dir().expect("home");
    let existed = home.join(".oculpm").exists();
    let err = call_tool(&home, "project_init", &json!({"confirm": true})).unwrap_err();
    assert!(err.contains("home directory"), "{err}");
    assert_eq!(
        home.join(".oculpm").exists(),
        existed,
        "홈에 아무것도 만들지 않는다"
    );
}

#[test]
fn project_init_rejects_symlinked_oculpm() {
    let tmp = TempDir::new().unwrap();
    let outside = TempDir::new().unwrap();
    if !crate::test_links::dir(outside.path(), &tmp.path().join(".oculpm")) {
        return;
    }
    let err = call_tool(tmp.path(), "project_init", &json!({"confirm": true})).unwrap_err();
    assert!(err.contains("symlink"));
}

/// A0b — 비추적 프로젝트 가드: `.oculpm/` 없는 루트에서는 세 도구 모두
/// 명시적 에러를 내고 아무것도 만들지 않는다 (user 스코프 플러그인 배포의
/// 폭발 반경 차단 — 조용한 create_dir_all 금지 계약).
#[test]
fn tools_refuse_untracked_project_and_create_nothing() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    for (tool, args) in [
        (
            "journal_write",
            serde_json::json!({ "type": "chore", "slug": "x", "title": "t", "body_markdown": "b" }),
        ),
        ("plan_status", serde_json::json!({})),
        (
            "plan_update",
            serde_json::json!({ "plan_id": "p", "item_id": "i", "status": "done" }),
        ),
        (
            "plan_create",
            serde_json::json!({ "plan_id": "p", "title": "t", "phases": [{ "title": "Phase 1" }] }),
        ),
    ] {
        let err = call_tool(root, tool, &args).unwrap_err();
        assert!(err.contains("추적 대상이 아닙니다"), "{tool}: {err}");
    }
    assert!(!root.join(".oculpm").exists(), ".oculpm 이 생기면 안 된다");
}

/// A0b — `.oculpm` 이 심볼릭 링크면 가드가 거부하고 링크 대상에 아무것도
/// 쓰지 않는다 (악의적 저장소의 프로젝트 밖 쓰기 탈출 차단).
#[test]
fn tools_refuse_symlinked_oculpm() {
    let dir = TempDir::new().unwrap();
    let target = TempDir::new().unwrap();
    if !crate::test_links::dir(target.path(), &dir.path().join(".oculpm")) {
        return;
    }

    let args = serde_json::json!({
        "type": "chore", "slug": "x", "title": "t", "body_markdown": "b"
    });
    let err = call_tool(dir.path(), "journal_write", &args).unwrap_err();
    assert!(err.contains("symlink"), "{err}");
    assert_eq!(
        std::fs::read_dir(target.path()).unwrap().count(),
        0,
        "링크 대상 디렉터리는 비어 있어야 한다"
    );
}

#[test]
fn unknown_tool_and_missing_args_error_cleanly() {
    let dir = TempDir::new().unwrap();
    std::fs::create_dir_all(dir.path().join(".oculpm")).unwrap();
    assert!(call_tool(dir.path(), "nope", &serde_json::json!({})).is_err());
    let err = call_tool(dir.path(), "journal_write", &serde_json::json!({})).unwrap_err();
    assert!(err.contains("'type'"));
}
