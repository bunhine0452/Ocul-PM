---
schema_version: 1
type: bug
slug: "tray-stop-spin-when-no-session"
status: done
difficulty: medium
created_at: "2026-07-30T17:33:51+09:00"
session_id: "mcp-20260730-173351"
agent:
  id: "claude-code"
  version: "Opus 5 (1M)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/tray.rs"
    op: update
related: []
tags:
  - "tray"
  - "menubar"
  - "session"
  - "v2.3.1"
  - "mcp-tool"
---
[x] 활성 세션이 없는데 메뉴바 아이콘이 계속 도는 문제 수정

## 발생 원인

트레이(`TrayState.active`)는 활성 세션 집합을 **`oculpm-session-started` / `oculpm-session-ended` 이벤트만으로** 유지했다. 애니메이션 루프는 `active_count() == 0` 일 때만 멈추므로, `ended` 이벤트가 한 번이라도 유실되면 실제 활성 세션이 0 이어도 아이콘이 영원히 돈다.

`ended` 는 세션 액터가 스스로 `finalize_active` 를 거칠 때만 나온다. 유실되는 경로:

- `OculpmManager::on_project_closed` — `ProjectEntry` 를 map 에서 제거만 하고 액터를 finalize 하지 않는다 (주석은 "`session.shutdown()` 을 명시적으로 호출한다"고 적혀 있으나 실제 코드에는 없음).
- `shutdown_all_blocking` — 종료 시 projects map 을 clear 만 한다.

증거: 이 저장소의 `.oculpm/index/*/sessions.json` 자체가 이 흔적을 남기고 있다. `20260720` 하루에만 `ended_reason: crash_recovered` 가 19건이고, `20260720-025` 는 열흘째 `ended_at: null` 인 유령 세션으로 남아 있다. 즉 앱이 세션을 finalize 하지 않고 종료되는 일이 상시로 벌어진다.

## 해결 방법

이벤트를 1차 신호로 두되, **애니메이션이 도는 동안에는 세션 액터의 실제 상태를 주기적으로 재확인**하도록 `tray.rs` 에 `reconcile_active` 를 추가했다.

- 활성 키(`"{project_id}:{session_id}"`)에서 project_id 를 모아 프로젝트별로 `OculpmManager::get_current_session` 조회.
- `Some(session)` → 그 키 하나만 유지 (프로젝트당 활성 세션은 최대 1개). `None`(유휴) 또는 `Err`(액터·프로젝트 소멸) → 해당 프로젝트 키를 전부 제거.
- 액터가 무거운 작업 중일 수 있으므로 `RECONCILE_TIMEOUT`(2초)을 두고, 시간초과는 "모름"으로 취급해 기존 키를 유지한다 — 섣부른 정지 방지.
- 조회 중 새로 시작된 세션(스냅샷에 없던 키)은 지우지 않는다.

호출 지점 두 곳:

1. 애니메이션 루프에서 `RECONCILE_EVERY`(30프레임 ≈ 4.8초)마다. `ended` 를 통째로 놓쳐도 최대 5초 안에 멈춘다. `i == 0` 은 방금 온 `started` 이벤트라 건너뛴다.
2. 팝오버를 열 때. 팝오버는 디스크의 `sessions.json` 을 직접 읽어 "지금 활성 세션 없음"을 표시하므로, 아이콘과 어긋나 보이면 사용자가 둘 다 못 믿는다. 활성이 0 이 되면 루프가 다음 tick(160ms)에 스스로 멈춘다.

`std::sync::Mutex` 가드는 await 전에 반드시 떨어지도록 스냅샷을 clone 해서 쓴다 (tokio::spawn 의 Send 요건).

## 남은 한계

세션이 액터 기준으로는 여전히 Active 인 경우 — 즉 에이전트가 멈췄지만 `session.inactivity_timeout_minutes`(기본 60) 가 아직 안 지난 구간 — 에는 이 수정으로 멈추지 않는다. 그 구간은 SSOT 상 실제로 "활성 세션"이므로 아이콘이 도는 게 맞다. 훅 브리지가 설치된 프로젝트는 에이전트 종료 시 `agent_exit` 로 즉시 finalize 된다. 유령 세션을 근본에서 없애려면 `on_project_closed` / `shutdown_all_blocking` 에서 세션을 finalize 해야 하는데, 종료 콜백이 동기 컨텍스트라 별도 작업으로 분리한다.

## 검증

- `cargo build` / `cargo test` — 401 + 26 통과, 신규 `project_id_parses_from_active_key` 포함 tray 4건 통과.
- `cargo clippy --lib` — tray.rs 경고 0.
- `pnpm typecheck` / `pnpm test`(208) / `pnpm lint` / `pnpm build` 전부 exit 0. 커맨드 시그니처 무변경이라 `bindings.ts` diff 없음.