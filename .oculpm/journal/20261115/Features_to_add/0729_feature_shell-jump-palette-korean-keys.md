---
schema_version: 1
type: feature
slug: "shell-jump-palette-korean-keys"
status: done
difficulty: high
created_at: "2026-11-15T07:29:15+09:00"
session_id: "20261115-002"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fc65c300-f34c-447e-bf85-89b83f36c178"
language: "ko"
verified_by_user: false
files_touched:
  - path: "e2e/scenario.mjs"
    op: update
  - path: "src/__tests__/choseong.test.ts"
    op: create
  - path: "src/__tests__/convenience_keys.test.tsx"
    op: update
  - path: "src/__tests__/global_shortcuts_modal.test.tsx"
    op: create
  - path: "src/__tests__/jump_waiting.test.ts"
    op: create
  - path: "src/__tests__/kbd_korean.test.ts"
    op: create
  - path: "src/__tests__/palette_v2.test.tsx"
    op: create
  - path: "src/__tests__/platform_keys.test.ts"
    op: update
  - path: "src/__tests__/project_attention.test.tsx"
    op: update
  - path: "src/__tests__/project_color.test.tsx"
    op: update
  - path: "src/__tests__/project_keys.test.tsx"
    op: update
  - path: "src/__tests__/project_row.test.tsx"
    op: create
  - path: "src/__tests__/shell_jump.test.tsx"
    op: create
  - path: "src/__tests__/shell_v4.test.tsx"
    op: update
  - path: "src/__tests__/start_settings.test.tsx"
    op: create
  - path: "src/__tests__/start_window.test.tsx"
    op: update
  - path: "src/__tests__/start_window_v2.test.tsx"
    op: create
  - path: "src/__tests__/topbar_fit.test.ts"
    op: update
  - path: "src/__tests__/topbar_v2.test.tsx"
    op: create
  - path: "src/__tests__/window_switcher.test.tsx"
    op: update
  - path: "src/components/CommandPalette.tsx"
    op: update
  - path: "src/components/Toolbar.tsx"
    op: update
  - path: "src/components/palette.css"
    op: create
  - path: "src/features/shell/ProjectRow.tsx"
    op: create
  - path: "src/features/shell/ProjectSwitcher.tsx"
    op: update
  - path: "src/features/shell/ShellV2.tsx"
    op: update
  - path: "src/features/shell/TopBar.tsx"
    op: update
  - path: "src/features/shell/WindowSwitcher.tsx"
    op: update
  - path: "src/features/shell/jumpWaiting.ts"
    op: create
  - path: "src/features/shell/projectKeys.ts"
    op: update
  - path: "src/features/shell/projectRow.css"
    op: create
  - path: "src/features/shell/useNavBadges.ts"
    op: update
  - path: "src/features/shell/useTopbarFit.ts"
    op: update
  - path: "src/features/start/StartSettings.tsx"
    op: create
  - path: "src/features/start/StartWindow.tsx"
    op: update
  - path: "src/features/start/start.css"
    op: update
  - path: "src/features/start/useRecentProjects.ts"
    op: update
  - path: "src/features/terminal/TermsChip.tsx"
    op: delete
  - path: "src/features/terminal/focusRequest.ts"
    op: update
  - path: "src/hooks/useGlobalShortcuts.ts"
    op: update
  - path: "src/hooks/useNavGestures.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/lib/choseong.ts"
    op: create
  - path: "src/lib/kbd.ts"
    op: update
  - path: "src/lib/shortcutRegistry.ts"
    op: update
  - path: "src/lib/workdayLabel.ts"
    op: create
  - path: "src/styles/screens-overflow.css"
    op: update
  - path: "src/styles/shell.css"
    op: update
  - path: "src/windows/AppWindow.tsx"
    op: update
  - path: "src/windows/ProjectWindow.tsx"
    op: update
related: []
tags:
  - "셸"
  - "shell"
  - "keyboard"
  - "quality-round"
  - "mcp-tool"
---
[x] 셸: ⌘J 내 차례 · ⌘K 동작 · 두벌식 키를 넣었다

## 추가 기능

업그레이드 라운드 레인 「셸과 이동」(계획 quality-round-20261115).

- **⌘J 내 차례(NV-01)**: 기다리는 세션으로 한 키 — 가장 오래 기다린 것부터, 다시 누르면 다음, 없으면 안 본 끝남(오류 먼저). 이 창에 없으면 기다림이 있는 다른 프로젝트 창을 앞으로. Orca 에서 아직 열린 요청(#12577)이다. 오늘의 「터미널에서 보기」 · 알림 착지 · ⌘J 가 같은 길(`focusRequest.onTermFocusRequested`).
- **모달 위 전역 키 · 두벌식(NV-02)**: 팔레트 · 확인 창이 떠 있으면 ⌘1~5 · ⌘, 가 뒤 화면을 바꾸지 않는다. 맥에서 입력칸 · 터미널의 ⌃ 는 단축키가 아니다(⌃K 줄 끝까지 지우기가 팔레트를 열던 것). 두벌식이면 j · k · v 가 ㅓ · ㅏ · ㅍ 로 와서 안 먹던 것 — `readChord` 가 code 로 라틴 글자를 찾는다.
- **⌘K 를 「무엇을」까지(NV-03)**: 터미널 세션(기다림 먼저) · 동작(단축키 전체 · 폴더 열기 · 편집기에서 열기 · 창 정리 · 프로젝트 색) · 초성 검색(ㅇㅈ → 작업 일지) · 일지 찾는 중엔 「일지 찾는 중」. 입력 밑의 잘린 포커스 링(2px 민트 막대) 걷음.
- **프로젝트 줄 한 벌(NV-04)**: ⌘O · ⌥Tab · 시작 창 · ⌘K 가 같은 `ProjectRow`(점 · 이름 · 칩 하나). ⌘O 가 열린 동안 목록이 새로 오면 거르기 글자가 지워지던 결함 고침. **⌥⌘1~9 는 최근 순 고정이고 지금 프로젝트에는 번호가 없다**(기다림에 따라 번호가 자리를 바꾸고 지금 프로젝트가 한 칸을 먹던 것).
- **윗줄(NV-05)**: 화면마다 접히는 단계가 같고 열린 ⋯ 가 내용 변화로 닫히지 않는다.
- **시작 창(NV-06)**: 같은 팔레트 · 설정(언어 · 밝기) · 첫 포커스 · 거르기. 「모름」 과 「없음」 을 구분.

## 동작 흐름

`kbd.readChord` 가 맥 갈래에서 `keyOf(e)` 로 비라틴 자판을 라틴 글자로 바꾸고, `isModalOpen()` 이면 전역 단축키는 ⌘K(닫기)와 Esc 만 듣는다. 팔레트의 점수는 접두 > 단어 시작 > 부분 > 초성(`lib/choseong.ts`), 같으면 최근 순.

## 검증

- 레인 게이트: vitest 118 files passed · typecheck · lint · build exit 0. 리뷰 둘(major 2 + 15 소견) 반영.
- 합류 뒤: `pnpm test` 1652 passed — 시작 창 설정이 앱 칸으로 옮긴 언어를 싣게 합류 이음에서 고쳤다(start_settings). 설치본에서 눈으로 보지는 않았다.

## 메모

- 손버릇이 바뀌는 것: ⌥⌘ 번호(최근 순 · 지금 창 제외), 프로젝트 줄의 경로는 이름이 겹칠 때만 보인다(경로는 title · 거르기에 남음).
- ⌘K 에서 다른 창의 세션을 고르면 그 창만 앞으로 온다 — 창을 건너는 세션 초점은 다음 라운드.