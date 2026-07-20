---
schema_version: 1
type: feature
slug: "tray-live-refresh-next-item-plan-detail"
status: done
difficulty: medium
created_at: "2026-07-20T22:55:31+09:00"
session_id: "mcp-20260720-225531"
agent:
  id: "claude-code"
  version: "Fable 5"
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
  - "menubar"
  - "tray"
  - "v2.3.0"
  - "mcp-tool"
---
[x] 트레이 일지 실시간 갱신 + 플랜 다음 할 일 + 팝오버 안 플랜 상세

## 추가 기능

트레이 제안 목록에서 사용자가 고른 1·3 + 플랜 열람 요청.

1. **일지 실시간 갱신** — `oculpm-journal-added` 이벤트를 1.2초 트레일링 디바운스로 구독해 팝오버 데이터를 재조회. 팝오버가 숨어 있어도 갱신해 둬 다음 오픈이 신선하다. 백필 폭주는 디바운스가 흡수.
2. **플랜 "다음 할 일" 1줄** — 활성 플랜(표시 상한 2)을 `plan_get` 으로 항목까지 당겨, 진행중 우선(없으면 첫 todo) 항목 제목을 "다음: …" 으로 진행률 아래 표시.
3. **팝오버 안 플랜 상세** — 플랜 행 클릭이 일지 상세와 같은 패턴의 상세 패널을 연다: 제목·진행 바·전 항목 글리프 목록(✓ done · ◐ 진행중 · ○ todo · ! blocked · ›/× muted). "앱에서 열기 ↗"는 상세의 선택지.

## 검증

vitest 205 (트레이 7 — 다음 할 일·플랜 상세 왕복 신규), typecheck·lint·build 그린. cargo 무변경 (프런트만).