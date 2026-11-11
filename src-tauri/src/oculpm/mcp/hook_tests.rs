use super::*;

/// 오늘 날짜의 버그 일지 — `src/a.ts` 를 고쳤고 검증 칸의 확인 명령이 `pnpm test`.
fn tracked_with_bug(root: &Path) {
    let day = chrono::Local::now().format("%Y%m%d").to_string();
    let dir = root.join(".oculpm/journal").join(&day).join("Bugs");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("0900_bug_x.md"),
        "---\nschema_version: 1\ntype: bug\nslug: \"x\"\nstatus: done\n\
         created_at: \"2026-11-02T10:00:00+09:00\"\nsession_id: \"20261102-001\"\n\
         agent:\n  id: \"claude-code\"\nlanguage: \"ko\"\nverified_by_user: false\n\
         files_touched:\n  - path: \"src/a.ts\"\n    op: update\n---\n\
         [x] 윗줄: 이름이 겹쳤다\n\n## 검증\n- `pnpm test`: 993 passed\n",
    )
    .unwrap();
}

fn payload(root: &Path, tool_input: Value, sid: &str) -> String {
    serde_json::json!({
        "session_id": sid,
        "hook_event_name": "PreToolUse",
        "cwd": root.to_string_lossy(),
        "tool_name": "Edit",
        "tool_input": tool_input,
    })
    .to_string()
}

#[test]
fn pre_tool_use_warns_once_per_file_from_the_stdin_payload() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    tracked_with_bug(r);
    // 절대 경로 (Windows 면 역슬래시 — JSON 이스케이프는 serde 가 푼다).
    let abs = r.join("src").join("a.ts");
    let p = payload(
        r,
        serde_json::json!({ "file_path": abs.to_string_lossy() }),
        "s-1",
    );
    let out = pre_tool_use(&p, "").expect("최근 버그를 고친 파일이면 경고");
    let v: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["hookSpecificOutput"]["hookEventName"], "PreToolUse");
    let ctx = v["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .unwrap();
    assert!(
        ctx.contains("src/a.ts") && ctx.contains("pnpm test"),
        "{ctx}"
    );
    assert!(
        v["hookSpecificOutput"].get("permissionDecision").is_none(),
        "막지 않는다"
    );
    // 같은 대화 같은 파일은 한 번만 — 마커는 세션 id 로.
    assert_eq!(pre_tool_use(&p, ""), None);
    assert!(r.join(".oculpm/hooks/.refix-s-1").is_file());
}

#[test]
fn notebook_path_and_project_dir_env_are_honoured() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    tracked_with_bug(r);
    // cwd 가 엉뚱해도 CLAUDE_PROJECT_DIR 가 이긴다. 상대 경로도 받는다.
    let p = serde_json::json!({
        "session_id": "s-2",
        "cwd": "/nowhere",
        "tool_input": { "notebook_path": "src/a.ts" },
    })
    .to_string();
    assert!(pre_tool_use(&p, &r.to_string_lossy()).is_some());
}

#[test]
fn every_failure_is_silent() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    let p = |input: Value| payload(r, input, "s-3");
    // 추적 안 된 프로젝트.
    assert_eq!(
        pre_tool_use(&p(serde_json::json!({ "file_path": "src/a.ts" })), ""),
        None
    );
    tracked_with_bug(r);
    // 깨진 JSON · 파일 경로 없음 · 버그 일지가 없는 파일 · 프로젝트 밖.
    assert_eq!(pre_tool_use("{not json", ""), None);
    assert_eq!(pre_tool_use("", ""), None);
    assert_eq!(pre_tool_use(&p(serde_json::json!({})), ""), None);
    assert_eq!(
        pre_tool_use(&p(serde_json::json!({ "file_path": "src/b.ts" })), ""),
        None
    );
    assert_eq!(
        pre_tool_use(&p(serde_json::json!({ "file_path": "../a.ts" })), ""),
        None
    );
}

#[test]
fn odd_session_ids_leave_no_marker() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    tracked_with_bug(r);
    let p = payload(r, serde_json::json!({ "file_path": "src/a.ts" }), "../evil");
    assert!(pre_tool_use(&p, "").is_some());
    // 이름으로 못 쓰는 id 면 표시를 남기지 않아 매번 경고한다 (refix 와 같은 규칙).
    assert!(pre_tool_use(&p, "").is_some());
}

#[cfg(unix)]
#[test]
fn a_planted_link_silences_the_hook() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    tracked_with_bug(r);
    let outside = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(outside.path(), r.join(".oculpm/hooks")).unwrap();
    let p = payload(r, serde_json::json!({ "file_path": "src/a.ts" }), "s-4");
    assert_eq!(pre_tool_use(&p, ""), None);
}
