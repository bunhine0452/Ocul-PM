---
schema_version: 1
type: feature
slug: nav-registry-shortcuts
status: done
difficulty: medium
created_at: "2026-07-06T21:31:00+09:00"
session_id: "20260706-m01"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - path: src/lib/navRegistry.ts
    op: create
  - path: src/components/Sidebar.tsx
    op: update
  - path: src/components/CommandPalette.tsx
    op: update
  - path: src/hooks/useGlobalShortcuts.ts
    op: update
  - path: src/features/shell/ShellV2.tsx
    op: update
  - path: src/styles/shell.css
    op: update
  - path: src/__tests__/nav_registry.test.ts
    op: create
related: []
tags: ["v2-release", "U1", "keyboard", "command-palette", "navigation"]
---

[x] U1 내비 단일 소스 navRegistry — 팔레트 누락 3화면 해소 + ⌘번호·사이드바 순서 일치 + ⌘P

## 추가 기능

- `src/lib/navRegistry.ts` 신설 — 11개 화면(main 6 + tools 5)의 id/라벨/별칭/아이콘/그룹 단일 배열. 사이드바·커맨드 팔레트·⌘번호 단축키가 전부 여기서 파생되므로 "팔레트에 화면 누락"(기존: 문제 해결·회고·문서 3개 빠짐), "⌘번호와 사이드바 표시 순서 불일치"(기존: ⌘3=diff 인데 3번째 표시 항목은 문제 해결) 드리프트가 구조적으로 재발 불가.
- ⌘1~⌘9·⌘0 = 사이드바 표시 순서 자동 부여 (⌘0=10번째 터미널). 11번째(AI 패널)는 번호 없음 — ⌘\ 오버레이가 보조 통로.
- ⌘P 프로젝트 전환 구현 — 사이드바 팝오버가 광고만 하던 죽은 힌트를 실동작으로. `NAV_BUS` CustomEvent(기존 OCULPM_BUS 패턴)로 useGlobalShortcuts→Sidebar 팝오버 오픈, 접힘 상태면 ShellV2 가 hover-reveal 로 먼저 띄움. 팔레트에도 "프로젝트 전환" 액션 추가.
- 사이드바 hover 시 ⌘번호 힌트 표시(`.nav-kbd`, 상시 노출은 소음이라 hover 한정), 미사용 badge 칩 렌더 제거.

## 동작 흐름

⌘K 팔레트 "이동" 그룹 = NAV_ENTRIES.map (11개 전부, 번호 라벨 자동) → 선택 시 setUiV2View. ⌘번호 keydown → navViewForKey(배열 인덱스) → uiV2Nav. ⌘P → NAV_BUS 이벤트 → Sidebar setSwitcherOpen(true) (+ShellV2 hover-reveal).

## 검증

- 신규 `src/__tests__/nav_registry.test.ts` 5케이스: id 유일성, main6+tools5, ⌘번호=배열 순서(⌘3=discussion 회귀 고정), ai 번호 없음, 비번호 키 폴스루.
- 게이트: typecheck ✓ / vitest 17파일 129 ✓ / lint ✓ / build ✓.
