---
schema_version: 1
type: feature
slug: restore-windows-after-update
status: done
difficulty: medium
created_at: 2026-09-01T18:34:50+09:00
session_id: manual-20260901-183450
agent:
  id: claude-code
  version: Opus 5 (1M context)
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/src/commands/window.rs
    op: update
  - path: src-tauri/src/db/settings.rs
    op: update
  - path: src-tauri/src/lib.rs
    op: update
  - path: src/api/window.ts
    op: create
  - path: src/lib/updater.ts
    op: update
  - path: src/windows/TabbedWindow.tsx
    op: update
  - path: src/lib/bindings.ts
    op: update
  - path: src/__tests__/update_banner.test.tsx
    op: update
  - path: scripts/check-bindings-imports.mjs
    op: update
related:
  - 20260825/Features_to_add/1130_feature_pty-host-survive-restart.md
  - 20260812/Features_to_add/2032_feature_chrome-style-tabs.md
tags:
  - updater
  - windows
  - tabs
  - session-restore
---

[x] 업데이트로 껐으면 업데이트가 되돌린다 — 창·탭 세션 복원

## 추가 기능

업데이트 재시작은 **사용자가 고른 중단이 아니다.** 그런데 지금까지는 새 버전이
시작 탭 하나만 문 창 하나로 떴고, 창 셋에 프로젝트를 벌려 놓고 일하던 사람이
그 배치를 손으로 다시 만들어야 했다. 껐으면 되돌리는 책임은 우리에게 있다.

- **스냅숏** — 재시작 직전 `save_window_session` 이 지금의 창·탭 구성을 설정
  키 `window_session` 에 JSON 으로 남긴다. 창별 탭 순서(`None` = 시작 탭) ·
  활성 탭 **인덱스** · 떼어낸 터미널 창 · 마지막 포커스 창.
- **복원** — 새 프로세스의 setup 이 그 키를 보고 창을 되살린다. 키는 **읽는
  즉시 지운다** — 복원은 한 번뿐이다.
- **저장 시점은 업데이트뿐이다.** 사용자가 직접 끈 앱은 다음에도 시작 탭
  하나로 뜬다 (예측 가능한 동작을 바꾸지 않는다).
- **터미널 창도 셸째** 돌아온다 — PTY 호스트가 별개 프로세스라 재시작을 넘어
  살아 있고(2026-08-25), sid 가 프로젝트 접두사라 새 창의 xterm 이 그대로
  attach 한다.

## 동작 흐름

**탭 id 는 안 싣는다.** 다음 실행의 id 는 새로 발급되므로 저장해 봐야 아무것도
가리키지 못한다. 활성 탭은 그래서 인덱스로 적는다.

**창 라벨은 그대로 되살린다.** `tauri-plugin-window-state` 가 위치·크기를
**라벨로** 기억하므로, `win-3` 을 `win-3` 으로 다시 띄우면 창이 있던 자리에
그대로 뜬다. 새 라벨을 발급하면 탭은 살아 돌아와도 창이 화면 한가운데로
모인다. 그래서 `restore_window` 는 `next_window` 도 되살린 번호 뒤로 민다 —
안 그러면 뒤에 열리는 창이 방금 되살린 라벨과 부딪힌다.

**첫 창은 이미 떠 있다.** `tauri.conf.json` 이 만든 `main` 이 스냅숏의
`main`(없으면 맨 앞 창)을 이어받고, 나머지만 새로 띄운다. 새로 만들면 빈 창이
하나 남는다.

**`sanitize_session` 이 순수 함수로 거른다** — 그 사이 지워진 프로젝트(안 거르면
`#12` 짜리 유령 탭이 뜬다)와 중복(I1: 프로젝트당 탭 하나, 전역 유일). 활성이던
탭이 걸러졌으면 첫 탭으로 떨어지고, 탭이 하나도 안 남은 창은 통째로 버린다.

**프런트의 첫 조회와 경주한다.** 복원은 DB 를 기다리므로 비동기인데, 그 사이
`main` 의 웹뷰는 이미 `get_window_tabs` 를 부르고 있다. 첫 조회가 복원보다
빠르면 뒤이은 `WindowTabsChanged` 를 아무도 못 듣고 창이 시작 탭 하나로 남는다
— `TabbedWindow` 가 **리스너를 단 뒤 한 번 더** 읽게 해서 그 틈을 닫았다.

## 검증

`cargo test`(창 모듈 48건 · 전체 그린) · `cargo clippy --all-targets -D warnings` ·
`cargo fmt` · `pnpm typecheck` · `pnpm test`(136 파일 1665건) · `pnpm lint`(3게이트) ·
`pnpm build` 전부 exit 0 을 직접 확인.

새 테스트 — Rust 6건: 스냅숏이 순서와 활성 **인덱스**를 적는가 · JSON 왕복 ·
라벨 유지 + `next_window` 전진 · 지워진 프로젝트 탈락(+활성 폴백) · 같은
프로젝트가 두 창에 있으면 한 곳만(+사라진 창을 포커스로 남기지 않음) · 전부
낡은 스냅숏은 아무것도 복원하지 않음. 프런트 2건: 재시작 전에 저장이 **먼저**
불리는가(`invocationCallOrder`) · 저장이 실패해도 재시작을 막지 않는가.

## 메모

- **미검증 (실기기 육안 필요)**: 진짜 업데이트 왕복. 로컬에서는 서명된 새
  릴리스가 있어야 재현되므로 단위 테스트까지만 확인했다. 다음 릴리스 직후
  창 둘 이상 + 터미널 분리 창을 띄워 놓고 확인할 것.
- `windowApi`(`src/api/window.ts`) 를 새로 만들었다 — 탭 스트립 쪽은 아직
  `bindings.ts` 를 직접 쓰지만(allowlist), 새 코드는 래퍼를 지난다.
