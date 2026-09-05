//! 병렬 쓰기 회귀 — 두 세션이 같은 플랜을 동시에 고쳐도 한쪽 변경이 사라지지
//! 않는다 (플랜 `v3-record-integrity`, 「플래너 병렬 쓰기」 Phase).
//!
//! 이 저장소가 실제로 겪은 사고의 자리다. `session-shim-cli` 가 넣은 선택
//! 인자 `base_hash` 는 실효가 없었다 — 사고를 내는 호출은 정확히 그 인자를
//! 주지 않는 호출이었기 때문이다. 여기서 무는 것은 넷:
//!
//! 1. 같은 `base_hash` 로 두 번 오면 **둘째가 진다**
//! 2. 진짜 동시성에서 **아무 전이도 유실되지 않는다**
//! 3. `plan_status` 가 준 해시로 갱신이 **성공한다** (CAS 가 실제로 가능해졌나)
//! 4. `base_hash` 를 빠뜨리면 오류가 **다음 행동을 지시한다**
//!
//! 단위 테스트(`tools::tests::a2a::a_stale_base_hash_refuses_to_overwrite`)는
//! 순차 CAS 한 갈래만 본다. 이 파일은 락과 임계구역 — 즉 프로세스/스레드가
//! 겹쳤을 때의 행동 — 을 본다.

use std::path::Path;
use std::sync::Arc;

use ocul_pm_lib::oculpm::mcp::tools::call_tool;
use serde_json::json;

const PLAN_ID: &str = "parallel";

/// 항목 `n` 개짜리 활성 플랜.
fn seed(root: &Path, items: usize) {
    let dir = root.join(".oculpm/planner");
    std::fs::create_dir_all(&dir).unwrap();
    let mut md = format!(
        "---\noculpm_plan: v1\nid: {PLAN_ID}\ntitle: \"병렬\"\nstatus: active\n\
         created: 2026-09-05\nupdated: 2026-09-05\nowner: claude-code\n---\n\n## Phase 1 {{#p1}}\n"
    );
    for i in 0..items {
        md.push_str(&format!("- [ ] 항목 {i} {{#it-{i}}}\n"));
    }
    md.push_str(
        "\n<!-- oculpm:plan-log begin v1 -->\n| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |\n\
         |---|---|---|---|---|---|\n<!-- oculpm:plan-log end -->\n",
    );
    std::fs::write(dir.join(format!("{PLAN_ID}.md")), md).unwrap();
}

fn plan_path(root: &Path) -> std::path::PathBuf {
    root.join(".oculpm/planner").join(format!("{PLAN_ID}.md"))
}

/// 도구가 발급하는 자리에서 해시를 얻는다 — 테스트가 파일을 따로 해싱하면
/// 발급/대조가 어긋나는 회귀를 못 본다.
fn current_hash(root: &Path) -> String {
    let out = call_tool(root, "plan_status", &json!({ "plan_id": PLAN_ID })).unwrap();
    out["plans"][0]["hash"].as_str().unwrap().to_string()
}

fn update(root: &Path, item: &str, hash: &str) -> Result<serde_json::Value, String> {
    call_tool(
        root,
        "plan_update",
        &json!({
            "plan_id": PLAN_ID, "item_id": item, "status": "done",
            "base_hash": hash, "agent_id": format!("session-{item}")
        }),
    )
}

/// **`plan_status` 가 준 해시로 첫 갱신이 통과한다** (`{#plan-status-hash}`).
///
/// 이것이 되기 전에는 `base_hash` 의 유일한 출처가 직전 `plan_update` 응답이라
/// 세션의 **첫** 갱신은 CAS 를 쓸 방법 자체가 없었다 — 그리고 첫 갱신이 가장
/// 흔한 경우다.
#[test]
fn the_hash_plan_status_hands_out_is_the_one_plan_update_accepts() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    seed(root, 2);

    let hash = current_hash(root);
    let out = update(root, "it-0", &hash).expect("plan_status 가 준 해시가 거부됐다");
    assert_eq!(out["to"], "done");
    // 응답이 다음 CAS 의 재료를 그대로 이어 준다 — 왕복 없이 연속 갱신.
    let next = out["hash"].as_str().unwrap();
    assert_ne!(next, hash, "쓰고 나면 해시가 바뀐다");
    update(root, "it-1", next).expect("직전 응답의 해시가 거부됐다");

    let md = std::fs::read_to_string(plan_path(root)).unwrap();
    assert!(md.contains("- [x] 항목 0"), "{md}");
    assert!(md.contains("- [x] 항목 1"), "{md}");
}

/// **같은 base_hash 로 두 번 오면 둘째가 진다** — 그리고 아무것도 안 쓴다.
#[test]
fn the_second_writer_with_a_stale_hash_loses_and_writes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    seed(root, 2);

    // 두 세션이 같은 순간에 같은 내용을 읽었다.
    let shared = current_hash(root);
    update(root, "it-0", &shared).unwrap();
    let after_first = std::fs::read_to_string(plan_path(root)).unwrap();

    let err = update(root, "it-1", &shared).expect_err("옛 해시는 거부되어야 한다");
    assert!(
        err.starts_with("write-conflict:"),
        "CLI exit 5 를 가를 표지가 없다: {err}"
    );
    // 재시도 절차를 오류가 **직접** 말한다 (현재 hash + 다음 행동).
    let fresh = current_hash(root);
    assert!(err.contains(&fresh), "현재 hash 를 안 알려줬다: {err}");
    assert!(
        err.contains("plan_status"),
        "다음 행동을 안 알려줬다: {err}"
    );

    assert_eq!(
        std::fs::read_to_string(plan_path(root)).unwrap(),
        after_first,
        "거부된 호출이 파일을 건드렸다"
    );

    // 새 해시로는 통과하고, 첫 세션의 전이도 그대로 남아 있다.
    update(root, "it-1", &fresh).unwrap();
    let md = std::fs::read_to_string(plan_path(root)).unwrap();
    assert!(
        md.contains("- [x] 항목 0") && md.contains("- [x] 항목 1"),
        "{md}"
    );
}

/// **`base_hash` 누락은 다음 행동을 지시한다** (`{#cas-required}`).
///
/// 하위호환을 깬 자리라 오류가 곧 마이그레이션 경로다 — 낡은 호출자(옛
/// 프롬프트 사본을 읽는 에이전트)가 이 문장만 보고 스스로 복구해야 한다.
#[test]
fn a_missing_base_hash_is_refused_with_the_recovery_recipe() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    seed(root, 1);
    let before = std::fs::read_to_string(plan_path(root)).unwrap();

    let err = call_tool(
        root,
        "plan_update",
        &json!({ "plan_id": PLAN_ID, "item_id": "it-0", "status": "done" }),
    )
    .expect_err("base_hash 없이 통과했다 — 안전장치가 선택으로 돌아갔다");

    assert!(err.contains("base_hash"), "{err}");
    assert!(err.contains("plan_status"), "무엇을 하라는지 없다: {err}");
    // 쓰기 충돌이 아니다 — CLI exit 5 의 뜻("그 사이 남이 고쳤다")을 흐리면 안 된다.
    assert!(!err.starts_with("write-conflict:"), "{err}");
    assert_eq!(std::fs::read_to_string(plan_path(root)).unwrap(), before);

    // 스키마도 같은 말을 해야 한다 — 도구 목록만 보는 호출자가 대부분이다.
    let defs = ocul_pm_lib::oculpm::mcp::tools::tool_definitions();
    let plan_update = defs
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["name"] == "plan_update")
        .unwrap();
    let required: Vec<&str> = plan_update["inputSchema"]["required"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    assert!(required.contains(&"base_hash"), "{plan_update}");
}

/// **진짜 동시성 — 아무 전이도 섞이거나 사라지지 않는다** (`{#cross-process-lock}`
/// · `{#cas-toctou}`).
///
/// 스레드 여덟이 각자 다른 항목을 동시에 완료 처리한다. 락이 없거나 해시 대조와
/// 쓰기 사이가 열려 있으면, 둘이 같은 내용을 읽고 둘 다 쓴 뒤 나중 쪽이 앞의
/// 전이를 덮는다 — 그 결과가 "글리프는 그대로인데 아무도 실패하지 않았다" 다.
/// 그래서 여기서는 **성공 횟수가 아니라 파일 내용**을 센다.
#[test]
fn concurrent_updates_neither_interleave_nor_vanish() {
    const AGENTS: usize = 8;

    let dir = tempfile::tempdir().unwrap();
    let root = Arc::new(dir.path().to_path_buf());
    seed(&root, AGENTS);

    let barrier = Arc::new(std::sync::Barrier::new(AGENTS));
    let handles: Vec<_> = (0..AGENTS)
        .map(|i| {
            let root = root.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                let item = format!("it-{i}");
                barrier.wait();
                // 정직한 호출자 — 충돌하면 다시 읽고 다시 쓴다. 이 재시도가
                // CAS 프로토콜의 나머지 반이다.
                for attempt in 0..40 {
                    let hash = current_hash(&root);
                    match update(&root, &item, &hash) {
                        Ok(_) => return,
                        Err(e) => {
                            assert!(e.starts_with("write-conflict:"), "충돌이 아닌 실패: {e}");
                            std::thread::sleep(std::time::Duration::from_millis(2 * attempt));
                        }
                    }
                }
                panic!("{item}: 40번 재시도해도 못 썼다");
            })
        })
        .collect();
    for h in handles {
        h.join().unwrap();
    }

    let md = std::fs::read_to_string(plan_path(&root)).unwrap();
    // ① 모든 전이가 살아 있다 — 하나라도 덮였으면 `[ ]` 로 남는다.
    for i in 0..AGENTS {
        assert!(
            md.contains(&format!("- [x] 항목 {i} ")),
            "항목 {i} 유실:\n{md}"
        );
    }
    // ② plan-log 도 마찬가지 — 행 하나가 사라지는 것이 사고의 원래 모습이었다.
    for i in 0..AGENTS {
        assert!(
            md.contains(&format!("| #it-{i} | session-it-{i} |")),
            "plan-log 행 {i} 유실:\n{md}"
        );
    }
    // ③ 파일이 여전히 규격대로 읽힌다 (동시 쓰기가 반쪽 파일을 남기지 않았다).
    let status = call_tool(&root, "plan_status", &json!({ "view": "full" })).unwrap();
    assert!(status.get("warnings").is_none(), "{status}");
    assert_eq!(status["plans"][0]["progress"]["done"], AGENTS);
    // ④ 문지기는 자기 뒤를 치운다 — 락 파일이 남으면 다음 세션이 기다린다.
    assert!(
        !root
            .join(".oculpm/planner")
            .join(format!(".{PLAN_ID}.md.lock"))
            .exists(),
        "락 파일이 남았다"
    );
}

/// **다른 프로세스가 쥐고 있으면 쓰지 않는다** (`{#cross-process-lock}`).
///
/// 인프로세스 뮤텍스(`OculpmManager::plan_write_lock`)로는 못 막는 조합이
/// 실제 사고 현장이다 — 앱·CLI·에이전트가 띄운 MCP 서버는 서로 다른
/// 프로세스다. 락 파일이 유일한 크로스프로세스 신물이므로, 남이 만들어 둔
/// 락 파일을 존중하는지로 그 성질을 확인한다.
#[test]
fn a_lock_held_by_someone_else_blocks_the_write_loudly() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    seed(root, 1);
    let hash = current_hash(root);
    let before = std::fs::read_to_string(plan_path(root)).unwrap();

    // 다른 프로세스가 임계구역에 들어가 있는 상태.
    let lock = root
        .join(".oculpm/planner")
        .join(format!(".{PLAN_ID}.md.lock"));
    std::fs::write(&lock, br#"{"pid":999999,"at":"2099-01-01T00:00:00Z"}"#).unwrap();

    let err = update(root, "it-0", &hash).expect_err("락을 무시하고 썼다");
    assert!(
        err.starts_with("write-conflict:"),
        "락 실패가 조용한 성공도, 정체불명 오류도 아니어야 한다: {err}"
    );
    assert_eq!(
        std::fs::read_to_string(plan_path(root)).unwrap(),
        before,
        "못 잡은 락으로 파일을 건드렸다"
    );

    // 그 프로세스가 나가면 다시 통과한다.
    std::fs::remove_file(&lock).unwrap();
    update(root, "it-0", &hash).unwrap();
}
