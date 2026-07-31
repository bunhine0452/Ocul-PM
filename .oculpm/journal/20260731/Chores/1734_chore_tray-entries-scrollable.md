---
schema_version: 1
type: chore
slug: "tray-entries-scrollable"
status: done
difficulty: verylow
created_at: "2026-07-31T17:34:28+09:00"
session_id: "mcp-20260731-173428"
agent:
  id: "claude-code"
  version: "Opus 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/tray/TrayPopover.tsx"
    op: update
  - path: "src/features/tray/tray.css"
    op: update
  - path: "src/__tests__/tray_popover.test.tsx"
    op: update
related: []
tags:
  - "tray"
  - "ui"
  - "dogfooding"
  - "mcp-tool"
---
[x] 메뉴바 팝오버 일지 목록 — 4행 상한 해제 + 세로 스크롤

## 변경 요약

메뉴바 팝오버(트레이)의 "최근 일지" 목록이 `slice(0, 4)` 로 4행에서 잘려, 5번째부터는 아예 DOM 에 렌더되지 않았다. 실기기 피드백 — "6개 정도 보이고 위아래로 스크롤해서 거슬러 올라가고 싶다".

- 렌더 상한을 `ENTRY_LIST_MAX = 50` 상수로 올렸다. 전체(수백 건)를 얹지 않기 위한 상한이고, 실제로 **보이는** 행 수는 팝오버(368×508) 안에서 남는 높이가 결정한다 — 플랜 2줄 기준 약 6행 + 다음 행 일부가 걸쳐 보여 스크롤 가능함이 드러난다.
- `.tp-entries` 를 스크롤 소유자로 명시: `min-height: 0` (없으면 flex 항목이 콘텐츠 높이만큼 부풀어 푸터를 카드 밖으로 밀어낸다), `overscroll-behavior: contain` (목록 끝에서 문서 고무줄 바운스로 번지는 것 차단), 기존 `.scrollbar-thin` 유틸로 얇은 스크롤바.
- 세션이 많아 목록 영역이 좁아지면 보이는 행 수가 자동으로 줄어든다 — 고정 높이를 박지 않아 푸터가 잘리지 않는다.

## 동작 흐름

집계(`oculpmListJournalEntries(project, null, null)`)는 원래부터 전체 일지를 돌려주고 있었다 — 백엔드 변경 없음. 프런트 상한만 풀었다.

## 검증

- `pnpm typecheck` / `pnpm lint` / `pnpm build` 전부 exit 0.
- `pnpm test` 346 tests / 41 files 통과. 트레이 스펙에 회귀 테스트 1건 추가 — 12건을 넣고 6번째(`일지 5`)·12번째(`일지 11`) 행이 렌더되는지, 그리고 스크롤 소유자가 `.tp-entries` 하나인지 확인.