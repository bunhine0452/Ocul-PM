---
schema_version: 1
type: feature
slug: pr-ui4-diff-screen
status: done
difficulty: medium
created_at: "2026-06-01T00:33:54+09:00"
updated_at: "2026-06-01T00:33:54+09:00"
session_id: "20260601-m01"
agent:
  id: claude-code
  version: "opus-4.8"
language: ko
verified_by_user: false
files_touched:
  - path: src/features/diff/DiffScreenV2.tsx
    op: create
    bytes_added: 9800
    bytes_removed: 0
  - path: src/__tests__/diff_v2.test.tsx
    op: create
    bytes_added: 6200
    bytes_removed: 0
  - path: src/features/shell/ShellV2.tsx
    op: update
    bytes_added: 400
    bytes_removed: 200
  - path: src/styles/screens.css
    op: update
    bytes_added: 2600
    bytes_removed: 0
  - path: src/components/Icons.tsx
    op: update
    bytes_added: 250
    bytes_removed: 0
  - path: scripts/check-no-localstorage.mjs
    op: update
    bytes_added: 300
    bytes_removed: 0
  - path: docs/Lite-update/Fianl_UI_update_before1.0/05-implementation-checklist.md
    op: update
    bytes_added: 1800
    bytes_removed: 900
related:
  - "../../20260531/Features_to_add/2258_feature_pr-ui3-journal-timeline.md"
tags: ["ui-v2", "final-ui-update", "pr-ui4", "diff", "localdiffview-reuse"]
---

## 추가 기능

Final UI Update 라운드 **PR-UI 4 — 변경 diff 전용 화면**. flag-on 일 때 ShellV2 가 변경 diff 화면에 목업의 2-pane `.diff-screen` (좌측 변경 파일 목록 + 우측 diff 본문)을 마운트. flag-off 의 레거시 `LocalDiffView` 는 무변경.

- `DiffScreenV2.tsx` — 기존 diff 파이프라인을 *무변경* 으로 흡수: 파일 목록 = `WorkspaceContext.recentChanges`, 본문 = `commands.computeDiff`, 파싱 = `LocalDiffView.tsx` 의 export 된 순수 함수(`classifyDiffLines`/`groupIntoHunks`/`pairDiffLines`) 그대로 import. 통합/분할 토글(`diffMode` 영속), "검토 완료"(`diffReadPaths` + 체크마크), 외부 에디터(`openInEditor` + Settings `externalEditorCommand`), `diffActivePath` one-shot pre-select(PR-UI 3 핸드오프 소비).
- screens.css 에 목업 .diff-screen/.diff-files/.dfile/.diff-main/.diff-bar/.diff-code/.dl/.hunk-head/.diff-foot 포팅.
- ShellV2 diff 라우팅 연결 (projectRoot 전달).
- 문서 손상 정리: PR-UI 3 docs 커밋 때 §0.9/§0.10 영역에 들어간 `... wait`/`(EOF 로 끝)`/중복 Phase A 헤더/중복 journal-card 줄 제거 + §0.10 정상 작성.

## 동작 흐름

- recentChanges → 좌측 파일 목록(.dfile, A/M/D 배지). 클릭 → setSelected → computeDiff → 우측 본문.
- diffActivePath(journal card 핸드오프) 가 있으면 mount 1회 소비 후 clear.
- 본문 렌더 후 markRecentChangeRead 로 읽음 처리 (LocalDiffView 와 동일 의미론).
- 통합 = 단일 거터 + .dl, 분할 = .dl.split (pairDiffLines 로 좌/우 페어링).

## 검증

- `pnpm typecheck` 0, `pnpm test` **83 passed | 3 todo** (PR-UI 3 의 75 → +8 diff_v2: 파일목록/본문파싱/빈상태/토글/검토완료/snapshot없음/핸드오프/a11y), `pnpm lint` 0, `pnpm build` 0.
- 토큰 격리 유지: 메인 번들 녹색 `#12a06b` 0개 + diff 클래스(.diff-screen/.dfile/.diff-code) 0개 → 전부 ShellV2 청크.
- **LocalDiffView.tsx 0 diff lines** (순수 함수만 import, 컴포넌트 무변경) → Lite-W6 PR6.x safety-net 회귀 테스트 계속 green.
- src-tauri 무변경.

## 메모

- 새 결정 → §0.10 (파서 재사용 무변경 / 단일 파일 컴포넌트 / diffActivePath one-shot / openInEditor / 테스트 타이밍).
- diff_v2 는 jsdom 콜드 스타트 타이밍으로 body 대기에 timeout 3000ms 적용.
- 다음 PR-UI 5 (도구 4 화면 일괄): SearchScreen / TerminalScreen / AiPanelScreen / PlannerScreen + AiOverlay thread 공유. 여기서 ui_v2 모달 패턴 정립 시 Journal ⌘N(보류분)도 연결 검토.
