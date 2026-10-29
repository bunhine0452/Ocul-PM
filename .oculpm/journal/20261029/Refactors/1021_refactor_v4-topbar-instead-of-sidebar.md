---
schema_version: 1
type: refactor
slug: "v4-topbar-instead-of-sidebar"
status: done
difficulty: high
created_at: "2026-10-29T10:21:44+09:00"
session_id: "20261029-004"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "1988da80-1607-4657-878d-b0a97d938c26"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/shell/TopBar.tsx"
    op: create
  - path: "src/components/Sidebar.tsx"
    op: delete
  - path: "src/components/toolbarSlot.ts"
    op: create
  - path: "src/components/Toolbar.tsx"
    op: update
  - path: "src/features/shell/ShellV2.tsx"
    op: update
  - path: "src/styles/shell.css"
    op: update
  - path: "src/features/oculpm/JournalScreenV2.tsx"
    op: update
  - path: "src/features/today/todayModel.ts"
    op: update
  - path: "src/features/diff/changeList.ts"
    op: update
  - path: "src-tauri/tauri.conf.json"
    op: update
  - path: "vite.config.ts"
    op: update
  - path: "src/__tests__/screens_agree.test.ts"
    op: create
related:
  - ref: "20261029/Refactors/0326_refactor_v4-integrate-lanes-release-prep.md"
    kind: "followup"
tags:
  - "v4"
  - "ui"
  - "shell"
  - "simplify"
  - "mcp-tool"
---
[x] 사이드바를 걷고 윗줄 한 줄로 — 목록 칸 옆에 사이드바가 또 서던 두 겹, 그리고 화면끼리 엇갈리던 말 둘

## 동기

사용자: 「모든 UI 가 심플해졌어? 제대로 확인해봐」, 이어서 「사이드바에 사이드바가 만들어지는 UI 는 심플하지 않아」.

먼저 PR #115 의 E2E 산출물에 실린 실제 앱 화면을 봤다. 빈 프로젝트에 일지 한 건뿐이라 하루 수십 건을 쓰는 사용자의 화면은 판단할 수 없었다. 그래서 Vite 와 `@tauri-apps/api/mocks` 의 mockIPC 를 쓰는 하네스(커밋하지 않음)를 만들었다. 백엔드 응답은 이 저장소의 실제 일지 48건과 계획 4개로 꾸몄다.

찍어 보니 작업 일지 · 계획 · 변경 세 화면이 모두 왼쪽에 칸을 두 개 세웠다.

| 화면 | 왼쪽 칸 |
|---|---|
| 작업 일지 | 내비 212px + 목록 400px |
| 계획 | 내비 + 목록 260px |
| 변경 | 내비 + 파일 목록 |

같은 하네스에서 다른 문제도 보였다.

- 오늘 화면 툴바에 단축키 안내가 늘 떠 있었다.
- 「다음」 카드가 완료 조건 문단을 10줄 가까이 그대로 보여 줬다.
- 화면끼리 엇갈리는 말 둘:
  - 오늘 화면이 「확인할 것 없음」 옆에 「증거 0건 · 0%」를 띄웠다.
  - 변경 화면이 일지 파일 자신을 「이 변경을 남긴 일지가 없어요」로 잡았다.

## 변경 요약

- **셸.** 사이드바를 걷고 윗줄 하나(`TopBar`)를 둔다: 프로젝트 ▾ · 탭 넷 · [화면 동작] · 찾기 ⌘K · 설정 톱니.
  - 화면의 `<Toolbar>` 는 셸 안에서 제목을 버리고, 동작만 윗줄 자리로 포털한다(`toolbarSlot`). 그래서 줄이 두 겹이 되지 않는다.
  - macOS 신호등은 `trafficLightPosition {16, 20}` 으로 놓는다(설정 파일과 새 창 빌더 둘 다).
- **작업 일지.** 검색칸과 종류 필터를 목록 칸 머리로 옮겼다. 「N건 · 전체 M건 중」은 거를 때만 보인다.
- **오늘.**
  - 날짜를 요약 줄로 옮겼다.
  - 단축키 안내를 목록 끝 한 줄로 내렸다.
  - 「다음」의 완료 조건은 두 줄까지만 보인다.
  - 「바깥 심판 증거」를 「증거 있음」으로 바꿨다.
  - 증거 비율의 분모를 결함·기능·리팩토링만으로 맞췄다. 확인할 것 · 백엔드 `JournalScore` 와 같은 기준이다.
- **변경.**
  - `.oculpm/` 을 변경 목록에서 뺐다. 기록 자신이고, 작업 일지 화면이 보여 준다.
  - 긴 파일 이름을 말줄임한다.
- **설정.** 쪽 머리에 제목을 달고 가운데로 정렬했다.
- **쌓임.** 콘텐츠의 쌓임 맥락을 닫았다(`z-index: 0`). 일지 날짜 머리가 프로젝트 목록을 덮던 것을 고쳤다.
- **dev 서버.** Vite 이벤트 셤이 `event.cjs` 를 브라우저로 보내 앱이 첫 줄에서 멈추던 것을 고쳤다. 별도 커밋이고, 10-24 Vite 8 이전 때 생긴 회귀다.
- **나머지.** E2E 선택자, 테스트, CHANGELOG v4.0.0, 랜딩 ko/en, 위키, CLAUDE.md 를 윗줄 사실로 맞췄다.

## 검증

- `pnpm typecheck` exit 0
- `pnpm test` → `Test Files 73 passed (73) · Tests 885 passed (885)` (새 `screens_agree.test.ts` 4건 포함)
- `pnpm lint` 6 게이트 ✓
- `pnpm build` ✓
- `cargo fmt --check` ✓ · `cargo clippy --all-targets --locked -- -D warnings` ✓
- `cargo test --locked --no-fail-fast` → 36 suites ok, 1146 passed, 0 failed
- 문서를 읽는 Rust 스위트 5개 재실행 ok
- 하네스 스크린샷: 1360·960px, 밝게/어둡게, ko/en, 프로젝트 목록 · ⌘K 팔레트 · 시작 창.
- 설치본에서 신호등의 실제 위치는 아직 보지 못했다. tao 의 inset 수식을 읽고 정한 값이라 눈으로 확인할 몫이 남아 있다.