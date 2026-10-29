---
schema_version: 1
type: feature
slug: "tour-first-run-guide"
status: done
difficulty: medium
created_at: "2026-10-29T22:23:46+09:00"
session_id: "20261029-015"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/tour/TourDialog.tsx"
    op: create
  - path: "src/features/tour/TourHost.tsx"
    op: create
  - path: "src/features/tour/tour.css"
    op: create
  - path: "src/__tests__/tour.test.tsx"
    op: create
  - path: "src/features/start/StartWindow.tsx"
    op: update
  - path: "src/features/start/start.css"
    op: update
  - path: "src/windows/AppWindow.tsx"
    op: update
  - path: "src/components/CommandPalette.tsx"
    op: update
  - path: "src/api/window.ts"
    op: update
  - path: "src/lib/projectActions.ts"
    op: update
  - path: "src/lib/settings.ts"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src-tauri/src/menu.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "scripts/check-critical-css.mjs"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
  - path: "src/__tests__/start_window.test.tsx"
    op: update
  - path: "src/__tests__/app_window.test.tsx"
    op: update
  - path: "src/__tests__/i18n_english_render.test.tsx"
    op: update
related: []
tags:
  - "tour"
  - "start"
  - "ocul-next"
  - "mcp-tool"
---
[x] 처음 쓰는 법 — 네 쪽 첫 실행 안내, 시작 창의 세 단계 칸을 걷는다

## 추가 기능

사용자 요청(10-29) 「이 앱을 어떻게 사용해야할지 튜토리얼 모달과 여러 기능 소개」와 그 답 「첫 실행 모달 + 다시 보기」에 대한 것이다.

- **네 쪽 안내** — `features/tour/TourDialog.tsx`, AppDialog 위에 선다.
  1. 하는 일 · 기록은 폴더의 마크다운이라는 것
  2. 다섯 화면과 ⌘1~5
  3. 에이전트 연결 — 설치 명령 복사, 다른 에이전트는 AGENTS.md, 폴더를 열면 생기는 파일
  4. 손에 익히기 — ⌘K · ⌃Tab · ⌥⌘1~9 · ⌘[ ] · v r · ⌘/

  ← → 로 쪽을 넘긴다. 마지막 쪽에는 건너뛰기 없이 「시작하기」만 있다. 높이는 가장 긴 쪽에 맞춰서 쪽을 넘겨도 모달이 튀지 않는다.
- **처음 한 번** — `TourHost` 가 창마다 하나 있다. 설정을 읽은 뒤 `tour_seen` 이 비었고 그 창이 앞에 있으면 연다(아니면 처음 앞에 올 때). 열 때 바로 `tour_seen=1` 을 적으므로, 업데이트 뒤 창이 여럿 되살아나도 한 창에서만 뜬다. 설정은 SQLite(`settings_*`)라 모든 창이 같이 본다.
- **다시 열기** — macOS 도움말 › 처음 쓰는 법(`menu.rs` `TourRequested`, 포커스된 창에만 emit_to)과 ⌘K 「처음 쓰는 법」. Windows·Linux 는 메뉴가 없어 ⌘K 가 유일한 길이다.
- **시작 창의 세 단계 칸을 걷음 (#tour-retire)** — 시작 창은 최근 프로젝트 한 칸이 되었다. 새 폴더를 고르면 곧바로 그 프로젝트가 된다. 기록 파일(AGENTS.md · .oculpm/)은 프로젝트 창이 열리며 만들고(이미 그랬다), 무엇을 만들었는지는 오늘의 첫 활성화 카드가 보여 준다. 걷은 것: 세 단계 칸, 「기록 켜기」, 첫 일지를 기다렸다 넘어가기, 사전 키 14개 × 2, 그 CSS. 창 엔트리 핵심 선택자 게이트는 `.start-steps` → `.tour` · `.tour-foot` 으로 바꿨다.

## 남은 것

- 맥 메뉴바의 「도움말」 자리와 설치본의 첫 실행은 눈으로 봐야 한다(#eyes-installed).

## 검증

- 하네스(앱 통째 · 시작 창)로 네 쪽을 찍었다. 헤드리스 탭은 「가려진 창」이라 열림 애니메이션이 투명도 0 에서 멈춘다. 그래서 찍을 때만 animation 을 끄고 찍었고, 쪽을 넘긴 뒤 모달 top 이 215.5px 로 같은 것을 쟀다.
- `pnpm typecheck && pnpm test && pnpm lint && pnpm build` → 테스트 파일 76개 · 테스트 912개 통과, lint exit 0, build ✓ 「핵심 선택자 13개가 모두 있습니다」. `tour.test.tsx` 4개는 처음 한 번 · 앞에 없을 때 · 다시 열기 · ← → 를 본다.
- `cargo fmt --check && cargo clippy -D warnings && cargo test --locked` → exit 0, 1146 passed.