---
schema_version: 1
type: bug
slug: watcher-dies-silently-no-live-refresh
status: done
difficulty: high
created_at: "2026-08-23T20:58:00+09:00"
session_id: "manual-20260823-205800"
agent:
  id: claude-code
  version: claude-opus-5
language: ko
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/supervisor.rs"
    op: create
  - path: "src-tauri/src/oculpm/watcher.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager.rs"
    op: update
  - path: "src-tauri/src/oculpm/mod.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/windows/ProjectTab.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related: []
tags: [watcher, live-refresh, dogfooding, lock]
---

[x] AI 가 일지·플래너를 고쳐도 앱이 안 바뀌던 것 — 감시가 조용히 죽고 되살아나지 않았다

## 발생 원인

사용자 증상: "AI 가 작업일지·플래너 파일을 바꿔도 바로 안 보이고, 우클릭 →
새로고침을 해야 보인다." 새로고침이 통하는 건 **화면이 마운트할 때 다시
조회하기 때문**이고, 워처는 그때도 여전히 죽어 있다 — 그래서 증상이 계속됐다.

프런트 배선(`useJournalEvents` / `useOculpmDataEvents`)과 백엔드 emit 은 멀쩡했다.
문제는 그 이벤트를 만드는 워처였고, **조용히 멈추는 길이 두 갈래** 있었다.

1. **읽기 전용으로 시작.** 앱을 두 개 띄우면(설치본 + 개발 빌드) 나중에 뜬
   쪽이 `.oculpm/.lock` 을 못 잡는다. 락은 `init_project` 에서 **한 번만** 잡고,
   `watcher_start` 는 `entry.lock.is_none()` 이면 즉시 에러 — 저쪽 인스턴스가
   진작 끝나도 이 프로세스는 끝날 때까지 **모든 프로젝트**의 실시간 갱신을 잃었다.
   재시도도, 사용자에게 보이는 신호도 없었다 (로그 한 줄이 전부).
2. **처리 루프의 죽음.** `handle_event` 가 이벤트 하나에서 패닉하면 태스크가
   끝나는데, `debouncer` 필드는 그대로 `Some` 이라 상태는 "Running" 이고
   `watcher_start` 는 "이미 돌고 있음" no-op 을 돌려준다. 앱 재시작 말고는
   되살릴 길이 없었다. 종료 로그마저 `"receive loop exited (stop() called)"` 로
   정상 종료라고 단정해 이 경우를 은폐했다.

실측 확인 (oculpm.log 2026-08-23):
- `03:40 UTC` 두 번째 인스턴스가 뜨며 **11개 프로젝트 전부** `watcher 시작 실패
  … lock held by another instance`.
- 첫 인스턴스(pid 2270)는 락이 건강했는데도 project 2 의 fs 이벤트가
  `02:47 UTC` 이후 완전히 끊겼다 (다른 프로젝트는 `11:32 UTC` 까지 정상).
- 라이브 재현: 일지 파일에 실제 내용 변경을 넣어도 `[FLOW] journal fs event
  detected` 가 **한 줄도** 안 찍혔다. `sample` 로 보면 notify 스레드 11쌍은
  전부 살아 있었다 → OS 워치가 아니라 **처리 루프**가 죽은 것.

## 해결 방법

- **패닉 격리** (`watcher.rs`) — `handle_event` 를 `catch_unwind` 로 감싼다.
  이벤트 하나의 패닉이 그 프로젝트의 실시간 갱신을 통째로 앗아가지 않는다.
  종료 로그도 "stop() 이거나 워커 사망" 으로 정직하게 고쳤다.
- **생존 판정** (`watcher.rs`) — `is_alive()`(태스크가 안 끝났는가) ·
  `events_seen()` · `abort()`(응답 없는 워처를 **기다리지 않고** 끊기).
- **`watcher_start` 가 실제로 되살린다** (`manager.rs`) —
  ① 락이 없으면 **다시 잡아 본다** (저쪽이 끝났으면 회수해서 감시 시작),
  ② 워처가 있어도 죽었으면 no-op 대신 끊고 재무장.
- **감독관** (`supervisor.rs`, 신규) — 1분마다 프로젝트별로 확인하고 되살린다.
  태스크 생존만으로는 "살아 있는데 이벤트가 안 오는" 경우를 못 잡으므로
  **프로브**를 쓴다: `.oculpm/index/.watchdog` 를 매 틱 건드리고, 다음 틱에
  `events_seen_total` 이 안 움직였으면 먹통으로 판정. 이 경로는 워처의
  self-suppress 대상이라 부수효과가 없지만 카운터는 **억제 판정 전에** 오르므로
  "처리 루프가 이벤트를 받는가" 를 그 자체로 증명한다. 조용한 프로젝트도
  프로브 덕분에 매 틱 카운터가 올라 "조용함" 과 "먹통" 이 구분된다.
- **더 이상 조용히 실패하지 않는다** (`ProjectTab.tsx`) — 워처 시작 실패 시
  토스트로 알린다 (`watcher.offline`). 감독관이 재시도하므로 문구는 "복구 중".

## 검증

- 신규 Rust 테스트 10건: 감독관 판정(`is_deaf` 4경우) · 프로브(새 프로젝트에서
  디렉터리 생성 / 쓸 수 없을 때 실패 보고 / self-suppress 경로 계약) ·
  매니저(락 회수 후 감시 시작 / 살아 있으면 no-op / 응답 없는 워처 끊고 재무장).
- `cargo test` 755 통과 · `pnpm test` 1235 통과(106 파일) · `pnpm typecheck` /
  `lint` / `build` 전부 exit 0.
- 원인 규명은 실측으로: 라이브 파일 변경 → 로그 무반응 재현, `sample` 로 notify
  스레드 생존 확인, 로그 타임라인으로 두 실패 경로 분리.

## 메모

- 이미 먹통이 된 프로세스는 **이 빌드로 갱신하기 전까지** 그대로다 — 당장
  되살리려면 앱을 다시 켜야 한다. 다음 버전부터는 감독관이 1분 안에 복구한다.
- 프로브는 프로젝트당 1분에 파일 하나(`.oculpm/index/.watchdog`, gitignore 대상)
  쓰기다. 인덱스 영역이라 추적·세션·검색 어디에도 자국을 남기지 않는다.
- **패닉의 원인 자체는 아직 모른다.** 이제는 패닉이 나도 루프가 살고
  `[FLOW] handle_event panicked` 가 경로와 함께 남으므로, 다음 재현 때 잡는다.
