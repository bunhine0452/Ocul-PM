---
schema_version: 1
type: bug
slug: "home-foot-jump-and-unstyled-dialog"
status: done
difficulty: medium
created_at: "2026-09-02T13:52:23+09:00"
session_id: "20260902-005"
agent:
  id: "claude-code"
  version: "Opus 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/onboarding/home.css"
    op: update
  - path: "src/features/onboarding/home/rows.tsx"
    op: update
  - path: "src/styles/primitives.css"
    op: update
  - path: "src/features/skills/skills.css"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "scripts/check-critical-css.mjs"
    op: update
related: []
tags:
  - "ui"
  - "css"
  - "start-screen"
  - "dialog"
  - "critical-css"
  - "mcp-tool"
---
[x] 메인 화면 바닥 띠가 이름 길이에 따라 튀어오르던 문제 · 탭 닫기 확인창이 뼈대만 나오던 문제

사용자 보고 2건. ① 프로젝트명이 길어지면 메인 화면 바닥 띠가 위로 튀어 오른다. ② 탭을 닫을 때 뜨는 확인창의 디자인이 깨져 있다.

## 발생 원인

**① 바닥 띠 (`.home-foot`)** — `.home-actionbar`(커서 항목의 단축키 지도)는 밴드 4 였던 시절의 면 스타일(`position: sticky` · `height: 44px` · `margin-top: 20px` · 배경/테두리)을 그대로 들고 바닥 띠의 flex 항목으로 들어와 있었다. 이 바의 폭은 커서 항목의 **이름 길이**에 따라 변하는데(`max-w-[220px]` 까지), 이름이 길어지면 한 줄에 못 들어가 wrap 되고 그 순간 띠가 통째로 64px 높아진다. `.home-wrap` 은 `grid-template-rows: auto auto minmax(0,1fr) auto` 의 고정 높이 격자라 그 높이는 프로젝트 격자에서 빼앗아 오고, 눈에는 "띠가 위로 튀어 오르는" 것으로 보인다. 초안 행도 같은 문제를 갖고 있었다 — 이름이 길면 항목이 그만큼 넓어져 뒤의 명령을 다음 줄로 밀어낸다.

**② 확인창** — `useConfirm` 이 쓰는 모달 크롬(`.sk-modal-head` / `.sk-modal-warn` / `.sk-modal-foot`)이 `features/skills/skills.css` 에만 있었다. 그 파일은 스킬 화면(lazy 청크)만 임포트하는데, 확인창은 `TabbedWindow`(창 최상위)에서 뜬다. 그래서 스킬 화면을 한 번도 안 연 창에서는 규칙이 **하나도 적용되지 않아** 제목·본문이 패널 가장자리에 붙고 버튼이 왼쪽으로 쏠렸다. ⌘/ 치트시트도 같은 처지였다 (`.sk-modal-sub` · `.keys-*` 가 `styles/screens.css`, 즉 ShellV2 청크에 갇혀 있었다).

## 해결 방법

- `.home-actionbar` 를 바닥 띠의 **자기 줄**(`flex: 1 0 100%`)로 고정하고 sticky·44px·면 스타일을 걷어냈다. 이름이 얼마나 길든 띠 높이가 변하지 않는다. `.home-foot .home-actionbar` 오버라이드는 사라져서 삭제.
- 초안 행 텍스트 칸에 `.home-drafttext` 를 붙이고 바닥 띠에서 `max-width: 200px` — 긴 이름은 말줄임된다.
- 모달 크롬 5규칙 + 치트시트 `.keys-*` 를 `styles/primitives.css`(App.css 가 전역 로드)로 이관. 치트시트 표의 좌우 여백 0 → 20px 로 모달 크롬에 맞췄다.
- `scripts/check-critical-css.mjs` 에 `.sk-modal-head/warn/foot` · `.keys-grid` 를 추가해 재발을 게이트로 막았다. 이 스크립트가 창 엔트리 청크(`TabbedWindow-*.css`)만 보고 있어 전역 공용 청크(`App-*.css`)를 못 보던 것도 함께 고쳤다 — 두 패턴 모두 존재해야 통과한다(lazy 청크는 여전히 제외).

## 검증

`pnpm typecheck` · `pnpm test`(150 파일 1871건) · `pnpm lint` · `pnpm build` 전부 exit 0. 빌드 산출물에서 이관한 선택자가 `App-*.css`(창이 정적으로 물고 있는 청크)에 있고, lazy 전용 선택자(`.whats-new-body`)는 여전히 엔트리 밖에 있음을 확인했다. **육안 확인은 미완** — 설치본이 도는 중에는 dev 빌드를 띄우지 않는 규율에 따라 다음 실행 때 확인 필요.