---
schema_version: 1
type: feature
slug: lock-handoff-newest-instance-wins
status: done
difficulty: high
created_at: "2026-08-23T23:43:00+09:00"
session_id: "manual-20260823-234300"
agent:
  id: claude-code
  version: claude-opus-5
language: ko
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/lock.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager.rs"
    op: update
  - path: "src-tauri/src/oculpm/supervisor.rs"
    op: update
  - path: "src-tauri/src/oculpm/spec.rs"
    op: update
  - path: "src-tauri/src/commands/oculpm.rs"
    op: update
  - path: "src-tauri/src/commands/window.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/tests/lite_w6_safety_net.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/contexts/WorkspaceContext.tsx"
    op: update
  - path: "src/windows/ProjectTab.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related:
  - ref: "20260823/Bugs/2058_bug_watcher-dies-silently-no-live-refresh.md"
    kind: followup
tags: [lock, watcher, multi-instance, dogfooding]
---

[x] 락 인계 — 가장 최근에 연 인스턴스가 주인이 된다

## 추가 기능

앞선 수정([[watcher-dies-silently]] 일지)으로 감시는 스스로 되살아나게 됐지만,
**락을 남이 쥐고 있으면 되살릴 것도 없다**는 틈이 남았다. 실제로 겪은 모습:
설치본을 띄워 둔 채 개발 빌드를 돌리면 개발 빌드가 11개 프로젝트 전부
`lock held by another instance (pid 2270)` 로 물러났고, 저쪽 앱을 손으로 끄는 것
말고는 방법이 없었다. **먼저 뜬 인스턴스가 영원히 이기는** 구조였다.

이제 규칙은 **"가장 최근에 연 인스턴스가 주인"** 이다. 예측 가능하고, 사용자가
방금 연 창이 곧 보고 있는 창이라는 직관과 맞는다.

## 동작 흐름

- **`AcquirePolicy`** (`lock.rs`) — `Polite`(살아 있는 소유자에게 양보) ·
  `TakeOver`(가져온다). **가져오기는 앱이 새로 뜰 때만** 쓴다
  (`start_background_watchers`)와 사용자가 명시적으로 누를 때
  (`oculpm_watcher_take_over`). 재시도 경로가 이걸 쓰면 두 인스턴스가 60초마다
  서로를 쫓아내며 무한히 주고받는다 — 그래서 감독관은 언제나 양보한다.
- **쫓겨난 쪽이 스스로 물러난다** — 하트비트 태스크가 5초마다(쓰기는 30초마다)
  락 파일의 pid 를 읽어 소유권을 확인한다. 남의 pid 면 `evicted` 를 세우고
  공용 `Notify` 를 깨운다 → 감독관이 즉시 깨어나 `yield_evicted_locks()` 로
  그 프로젝트의 감시를 접고 읽기 전용으로 내려간다. 이중 감시 창이 ~5초로 준다.
- **남의 락 파일을 지우지 않는다** (`owns_file_on_disk`) — 인계당한 가드가
  `release`/`Drop` 에서 파일을 지우면 **살아 있는 새 주인의 락이 사라져** 두
  인스턴스가 동시에 주인이 된다. 좀비 락을 회수당한 뒤에도 같은 함정이 있었던
  기존 버그다.
- **사용자에게 말한다** — 새 이벤트 `OculpmWatchYielded` → 토스트 "다른 ocul-pm
  창이 이 프로젝트를 가져갔습니다 / 저쪽을 닫으면 자동으로 돌아옵니다", 그리고
  **「이 창에서 감시하기」** 버튼으로 되가져올 수 있다. 감시를 못 켠 창의
  기존 토스트에도 같은 버튼을 달았다.
- 락 경합 에러 문구에 **소유자 실행 경로**를 싣는다(`ps -o comm=`) — pid 만으로는
  설치본인지 개발 빌드인지 알 수 없었다.
- 감독관의 재무장 실패 경고는 **프로젝트당 한 번만** 크게 남긴다. 저쪽이
  살아 있는 동안 매분 11줄씩 쌓으면 로그를 못 읽는다.

## 검증

- 신규 Rust 테스트 6건: `TakeOver` 가 살아 있는 소유자의 락을 가져오고 `Polite`
  는 물러난다 · 하트비트가 남의 pid 를 인계로 판정하고 **파일 없음/깨짐은
  인계로 보지 않는다** · 인계당한 가드가 새 주인의 락 파일을 지우지 않는다 ·
  매니저 수준 `TakeOver` 로 감시 시작 · `yield_evicted_locks` no-op.
- `cargo test` 785 통과 · `pnpm test` 1266 통과(109 파일) · `typecheck` / `lint` /
  `build` 전부 exit 0.

## 메모

- 되찾기는 자동이다: 가져간 인스턴스가 종료하면 락 파일이 사라지고, 남은 쪽
  감독관이 다음 틱(≤60초)에 회수해 감시를 재개한다.
- **구버전과 섞이면 인계가 불완전하다.** 구버전 소유자는 소유권 확인 코드가
  없어 인계를 눈치채지 못하고, 30초 뒤 하트비트가 자기 pid 로 파일을 덮어써
  주도권이 오간다. 양쪽 다 이 빌드 이상이어야 규칙대로 동작한다 — 그전까지는
  구버전 앱을 끄는 게 확실하다.
