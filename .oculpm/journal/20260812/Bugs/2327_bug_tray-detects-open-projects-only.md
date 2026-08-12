---
schema_version: 1
type: bug
slug: tray-detects-open-projects-only
status: done
created_at: 2026-08-12T23:27:26+09:00
session_id: "manual-20260812-232726"
agent:
  id: claude-code
  version: claude-opus-5[1m]
language: ko
verified_by_user: false
difficulty: medium
files_touched:
  - path: src-tauri/src/commands/window.rs
    op: update
  - path: src-tauri/src/lib.rs
    op: update
related:
  - .oculpm/journal/20260812/Refactors/2244_refactor_tray-static-icon-and-motion.md
tags: [tray, watcher, sessions, lifecycle]
---

[x] 상단바가 탭을 연 프로젝트만 감지하던 문제 — watcher 를 탭 수명에서 떼어냈다

## 발생 원인

세션은 **watcher 가 만든다**: 파일 변경 → `SessionActor::note_activity` → 세션 생성·갱신. 그런데 watcher 는 `ProjectTab` 이 마운트될 때(`oculpmWatcherStart`) 시작하고 탭이 닫힐 때(`release_project`) 멈췄다 — 즉 **수명이 탭에 묶여 있었다.**

그래서 탭을 열지 않은 프로젝트에서는 에이전트가 아무리 일해도:

- 일지 파일은 디스크에 쌓이지만
- 인덱싱되지 않고
- 세션이 **생성조차** 되지 않아

상단바에 아무것도 뜨지 않았다. 여러 프로젝트를 오가며 작업할 때 "하나만 감지" 하던 이유가 이것이다.

이건 단순한 표시 버그가 아니라 **제품 약속과 어긋나는 지점**이었다 — "외부 코딩 에이전트가 한 일을 기록한다" 는 앱이, 그 프로젝트를 창에 띄워 둔 동안만 기록하고 있었다.

## 해결 방법

감시 범위를 "열린 탭" 에서 **"추적 중인 모든 프로젝트"** 로 바꿨다 (사용자 결정 — 비용 항목을 제시하고 고름).

`start_background_watchers` 를 앱 setup 에서 1회 띄운다:

- DB 의 전체 프로젝트를 순회하며 `init_project` → `watcher_start`
- **순차 + 400ms 간격.** N 개의 init(디스크 쓰기 포함)과 인덱싱이 동시에 터지면 콜드 스타트가 눈에 띄게 느려지고 macOS 폴더 권한 프롬프트가 한꺼번에 쏟아진다
- 폴더가 사라진 프로젝트는 조용히 건너뛴다 (사용자가 옮겼을 뿐, 에러 로그로 채울 일이 아니다)
- 실패는 프로젝트 단위로 삼킨다 — 하나가 안 열린다고 나머지 감시를 포기할 이유가 없다

짝이 되는 변경: `release_project` 에서 `watcher_stop` 을 뺐다. 감시 수명이 앱 프로세스에 묶인 지금, 탭을 닫을 때 멈추면 **그 프로젝트가 상단바에서 다시 사라진다.** 이제 탭 종료는 PTY 만 정리하고, 종료 시 일괄 정리는 기존 `shutdown_all_blocking` 이 그대로 맡는다.

## 검증

`pnpm typecheck` · `pnpm test`(738) · `pnpm lint` · `pnpm build` · `cargo test`(12스위트 0실패) 전부 exit 0.

**자동 검증의 한계가 큰 변경이다** — 백그라운드 감시는 Tauri 런타임 + 실제 파일시스템이 있어야 관찰된다. 아래 실기기 확인이 사실상의 게이트다.

## 메모

- **실기기 확인 필수**: ① 탭을 하나도 안 연 프로젝트에서 에이전트를 돌렸을 때 상단바에 세션이 뜨는지 ② 프로젝트 9개에서 콜드 스타트가 체감상 느려지지 않는지 ③ 시작 직후 macOS 권한 프롬프트가 쏟아지지 않는지 ④ 탭을 닫아도 그 프로젝트가 상단바에 남는지.
- 되돌릴 여지: 부하가 문제가 되면 "최근 14일 활동" 으로 범위를 좁히는 선택지가 있다 (이번에 같이 검토했고, 사용자가 전부를 골랐다).
- `init_project` 는 AGENTS.md 를 동기화하므로 **시작 시 디스크 쓰기가 발생**한다. 사용자가 이 비용을 알고 선택했다.
