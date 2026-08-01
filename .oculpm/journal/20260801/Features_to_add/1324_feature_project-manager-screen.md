---
schema_version: 1
type: feature
slug: "project-manager-screen"
status: done
difficulty: medium
created_at: "2026-08-01T13:24:25+09:00"
session_id: "mcp-20260801-132425"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/projects/ProjectManager.tsx"
    op: create
  - path: "src/features/projects/managerModel.ts"
    op: create
  - path: "src/features/projects/projects.css"
    op: create
  - path: "src/__tests__/project_manager.test.tsx"
    op: create
  - path: "src/features/onboarding/StartScreen.tsx"
    op: update
  - path: "src/features/onboarding/home/chrome.tsx"
    op: update
  - path: "src/features/onboarding/home/rows.tsx"
    op: update
  - path: "src/App.tsx"
    op: update
  - path: "src/__tests__/start_screen.test.tsx"
    op: update
related: []
tags:
  - "ui"
  - "start-screen"
  - "project-crud"
  - "a11y"
  - "mcp-tool"
---
[x] 프로젝트 관리 화면 — 전체 목록 평면 + 일괄 제거

## 추가 기능

메인 화면(콕핏)에서 전체 프로젝트를 추가·이름 변경·제거할 수 있는 **전용 관리 화면**을 만들었다.

기존에도 CRUD 자체는 있었지만 흩어져 있었다 — 행 hover 의 ✎/🗑, ⌘E/⌘⌫, 상단 레일의 "프로젝트 추가". 문제는 메인 화면이 "어디서 이어서 일하지?" 에 답하느라 **위계**를 만든다는 것이다: 최근 것은 사령탑/판으로 크게, 2주 이상 조용한 곳은 '색인'으로 접힌다. 일하러 올 때는 옳지만 **정리하러 올 때는 정확히 반대**가 필요하다 — 접힌 것도 보이고, 같은 눈높이로 나열되고, 여러 개를 한 번에 고를 수 있어야 한다.

- `features/projects/ProjectManager.tsx` — 시트형 페이지(z-80). 체크박스 · 프로젝트(마크/이름/경로) · 마지막 활동 · 기록 · 작업(열기·이름 변경·제거) 5열 표. `role="dialog"` 라 메인 화면의 전역 키(타입어헤드·⌘E·⌘⌫)가 자동으로 내려앉는다.
- `features/projects/managerModel.ts` — 순수 필터·정렬. 검색 매칭은 메인 화면과 **같은** `homeMatch.bestScore` 를 쓴다(두 화면이 같은 질의에 다른 결과를 내면 그 자체가 버그). 동률은 항상 이름으로 깨서 열 때마다 줄이 흔들리지 않게 했다.
- **일괄 제거** — 이 화면에만 있는 새 능력. 단건 다이얼로그로는 표현할 수 없다.
- 진입로 3곳 + 단축키: 상단 레일 `프로젝트 관리` 칩, `모든 프로젝트` 섹션 헤더의 `관리`, 명령 행(프로젝트 0개면 숨김), **⌘⇧M**. ⌘M 은 macOS 창 최소화라 피했다.

## 동작 흐름

1. **단건 이름 변경/제거는 재구현하지 않는다.** App 이 이미 가진 다이얼로그를 props 콜백으로 그대로 부른다 — 제거 옵션(`.oculpm` / `AGENTS.md`)이 두 벌로 갈라지면 한쪽만 고쳐지는 날이 온다. 대신 `App.tsx` 의 `Dialog` 에 `data-app-dialog` 를 달고 z 를 50→110 으로 올려 관리 시트 위에 뜨게 했다. 관리 화면의 Esc 핸들러는 이 속성을 보고 물러난다 — 없으면 이름 변경 중 누른 Esc 가 다이얼로그와 관리 화면을 **동시에** 닫는다.
2. **파괴적 작업은 2단.** 선택 → 확인(대상 이름 명시 + 디스크 옵션 2개, 기본 꺼짐) → 실행. 확인 문구는 3곳까지 이름을 그대로 적고 넘으면 "외 N곳".
3. 일괄 삭제는 **직렬**로 돈다 — 프로젝트마다 SQLite 쓰기 + (옵션 시) 디스크 삭제라 병렬은 락 경합만 늘고 실패 항목을 이름으로 되돌려주기 어렵다. 부분 실패는 `role="alert"` 로 이름과 함께 노출한다.
4. 선택 카운트는 `projects` 와 교집합으로 파생한다. 단건 다이얼로그로 지운 id 가 선택에 남아 있으면 "2곳 선택됨" 이라 해 놓고 1곳만 지우는 거짓 카운트가 된다 — 테스트로 고정.
5. `StartScreenProps.onProjectsChanged` 추가(→ App 의 `refreshProjects`). 일괄 제거처럼 화면 **안에서** 목록을 바꾼 경우에만 쓴다.

정렬은 열 머리 버튼 + `aria-sort` 로, '전체 선택' 은 `indeterminate` 프로퍼티로 3상태를 표현했다.

## 검증

- `pnpm typecheck` / `pnpm lint` / `pnpm build` 전부 exit 0.
- `pnpm test` 600건 전부 통과 (49 파일). 신규 `src/__tests__/project_manager.test.tsx` 18건 포함 — 위임(단건은 IPC 미발생)·2단 확인·디스크 옵션 전달·부분 실패 alert·선택 pruning·aria-sort·Esc 2단, axe 3상태(목록/확인/빈 상태) 위반 0.