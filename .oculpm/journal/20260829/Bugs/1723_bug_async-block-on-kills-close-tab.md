---
schema_version: 1
type: bug
slug: async-block-on-kills-close-tab
status: done
created_at: 2026-08-29T17:23:00+09:00
session_id: manual-20260829-172300
agent:
  id: claude-code
  version: claude-opus-5[1m]
language: ko
verified_by_user: false
difficulty: high
files_touched:
  - path: src-tauri/src/commands/terminal.rs
    op: update
  - path: src-tauri/src/commands/window.rs
    op: update
  - path: src-tauri/src/tray.rs
    op: update
  - path: src-tauri/src/lib.rs
    op: update
related:
  - 20260829/Bugs/1641_bug_ghost-window-cannot-be-closed.md
  - 20260829/Bugs/1538_bug_close-is-not-focus-aware.md
tags: [windows, tabs, terminal, tokio, panic, silent-failure, root-cause]
---

[x] 탭을 닫는 커맨드가 `block_on` 으로 패닉해, 창을 닫기도 전에 죽어 있었다

## 발생 원인

사용자 보고(3번째): "드래그하여 분리된 창이 × 를 눌러도 ⌘W 를 눌러도 안 닫힌다.
빨간 닫기 버튼만 먹힌다."

앞선 두 라운드는 **증상 주변**을 고쳤다 (포커스 우선권 · 실패 토스트 · 유령 창
회복). 원인 경로는 "유령 창 가설" 로 남아 있었다 — 웹뷰는 살아 있는데 레지스트리가
모르는 창. 그 **상태**의 진단은 맞았고, 이번에 **어떻게 그 상태가 되는지**가 잡혔다.

`close_tab` 은 `#[tauri::command] pub async fn` 이다. Tauri 는 async 커맨드를
`async_runtime::spawn` 으로 띄우므로 **tokio 워커 스레드 위**에서 돈다. 그 안에서
탭 닫기는 이 순서로 진행한다:

1. `remove_tab` — 레지스트리에서 탭을 빼고, 창이 비면 **창 항목까지 지운다**
2. `release_project` → `PtyState::kill_with_prefix` → `blocking_kill` →
   **`tauri::async_runtime::block_on`**
3. `win.close()` — 창을 닫는다

2번에서 끝난다. 런타임 위에서 `block_on` 을 부르면 tokio 는 패닉한다 —
*"Cannot start a runtime from within a runtime."* 패닉은 커맨드 태스크를 통째로
죽이고, 그래서 **3번이 영영 실행되지 않는다.** 남는 상태가 정확히 유령 창이다:
탭도 창도 레지스트리에서 사라졌는데 웹뷰는 살아 있다. 그 뒤로는 × 가 "모르는 탭",
⌘W 가 `active_tab_of == None` 이라 둘 다 아무 일도 하지 않고, 앱 코드를 거치지
않는 OS 빨간 버튼만 통한다.

로그에 흔적이 없던 것도 같은 이유다. 커맨드 태스크의 패닉은 아무도 잡지 않고,
번들 앱의 stderr 는 어디에도 안 남는다. 프런트의 프라미스는 **영영 안 풀리므로**
어제 넣은 실패 토스트조차 뜰 수 없었다 (`Err` 가 아니라 무응답이다).

회귀 시점은 `blocking_kill` 이 들어온 PTY 호스트 전환(3a75a1a, 2026-08-25)이다.
그 전의 `kill_with_prefix` 는 뮤텍스만 만지는 동기 함수라 패닉할 일이 없었다.

**같은 뿌리로 이미 죽어 있던 것 하나 더.** `tray::notify_journal_added` 도
`block_on` 을 쓰는데, 이 콜백은 이벤트를 emit 한 스레드 — 즉 워처의 async 태스크 —
에서 그대로 돈다. 사용자 로그(`oculpm.log.2026-08-29`)에 증거가 그대로 있다:
세션 첫 일지 직후 `[FLOW] handle_event panicked` 한 줄, 그리고 **그 뒤로는 영영
없다.** 패닉이 emit 이 쥐고 있던 리스너 뮤텍스를 오염시켜(`try_lock` → `Err`)
Rust 쪽 이벤트 리스너가 전부 조용히 죽기 때문이다 — 트레이 알림도 활동 표시도
그 순간부터 오지 않는다. 웹뷰 배달은 별개라 화면만 멀쩡해 보였다.

## 해결 방법

**`block_on` 은 런타임 밖에서만.** 부르는 자리에 따라 갈래를 나눴다.

- `commands/terminal.rs` — kill 배관을 `kill_ptys_with_prefix`(async, 커맨드용)와
  `kill_ptys_with_prefix_blocking`/`kill_ptys_except_blocking`(동기, 창 이벤트 훅
  전용)으로 분리. 동기판이 기다리는 이유는 그대로다: 마지막 창 닫힘 직후 앱이
  종료될 수 있어 spawn 은 종료와 경주한다.
- `commands/window.rs` — `release_project` 를 async 로(=`close_tab` 이 `await`),
  창 이벤트 훅은 `release_project_blocking`. 공통 판정은 `releasable()` 로 뺐다.
- `tray.rs` — `notify_journal_added` 가 아무것도 기다리지 않는다. 설정·프로젝트
  조회를 태스크로 넘겨 emit 스레드에서 `block_on` 이 사라졌다.
- 안전망 둘. ① `blocking_kill` 은 런타임 위인지 확인하고(`Handle::try_current`)
  그렇다면 패닉 대신 크게 남기고 spawn 한다. ② `install_panic_logger` — 패닉을
  tracing 으로 끌어낸다. 이 부류의 사고가 **다음엔 로그 한 줄로 갈리도록**.

## 검증

- `cargo test` · `pnpm typecheck` · `pnpm test` · `pnpm lint` · `pnpm build` 전부 exit 0.
- 신규 Rust 2건 — 런타임 위 `block_on` 이 실제로 패닉하는지(이 갈래가 존재하는
  전제), 그 조건을 `inside_async_runtime()` 이 알아보는지.
- 사용자 로그로 기전 확증: `[FLOW] emitting OculpmJournalAdded` 0.2ms 뒤에
  `handle_event panicked`, 그리고 세션당 정확히 한 번(그 뒤 리스너 뮤텍스 오염).

## 메모

앞선 두 일지의 배제 목록은 전부 옳았다 — 레지스트리 산술·커맨드 등록·라벨 판정·
capability·프런트 배선 어디에도 문제가 없었다. 놓친 것은 "**커맨드가 끝까지
돌았는가**" 라는 질문 자체였다. 반환값이 없는 실패(무응답)는 `Err` 를 보는
어떤 계측에도 안 걸린다 — 이제 패닉 로거가 그 자리를 메운다.

`tray::handle_last_window_closed` 의 `block_on` 은 남겨 뒀다. 창 이벤트 훅(메인
스레드)에서만 불려 안전하고, 그 자리는 기다려야 옳다.
