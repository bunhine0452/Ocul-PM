---
schema_version: 1
type: bug
slug: "sidebar-collapse-per-tab"
status: done
difficulty: low
created_at: "2026-08-20T22:44:00+09:00"
session_id: "manual-20260820-224415"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/contexts/WorkspaceContext.tsx"
    op: update
  - path: "src/__tests__/multi_window.test.tsx"
    op: update
related:
  - "journal/20260820/Refactors/2240_refactor_entry-detail-file-nav.md"
tags: ["ui", "shell", "sidebar", "workspace", "multi-window", "claude-code"]
---

[x] 프로젝트 탭마다 사이드바가 따로 접히던 것

## 발생 원인

사이드바 접힘(`sidebarCollapsed`)이 **프로젝트별 영속 레코드**(`aipm:workspace:v2:p<id>`) 안에 있었다. 탭 하나 = `WorkspaceProvider` 하나이고 한 번 연 탭은 계속 마운트된 채 숨기만 하므로, 탭을 옮길 때마다 그 탭이 기억하는 접힘 상태로 사이드바가 열리고 닫혔다.

키를 프로젝트별로 쪼갠 건 v2.9.0 멀티 창 때의 옳은 결정이었다(창 둘이 서로의 터미널 탭을 덮어쓰던 문제, R3). 다만 그때 **레코드 전체**가 프로젝트에 딸린 것으로 간주됐다. 화면·필터·터미널 탭은 실제로 그렇지만 사이드바 접힘은 프로젝트의 속성이 아니라 **보는 사람의 취향**이다 — 격리의 예외인데 예외로 취급되지 않았다.

## 해결 방법

접힘만 전용 전역 키로 빼냈다. 나머지 격리 규율은 그대로 둔다.

- `SIDEBAR_KEY = "aipm:ui:sidebar-collapsed:v1"` — `"1"`/`"0"` 한 글자. `persistToStorage` 는 `sidebarCollapsed` 를 프로젝트 레코드에서 구조분해로 떼어내 더 이상 쓰지 않는다.
- `loadFromStorage` 는 전역 키를 먼저 본다. 값이 없으면 그 프로젝트 레코드에 남아 있는 예전 값을 한 번 승격시키고 전역 키에 기록한다(일방향 이관, 스키마 범프 없음 — 추가 필드가 아니라 **덜 쓰는** 변경이라 과거 레코드도 그대로 읽힌다).
- 전파 두 갈래: 같은 창의 다른 탭에는 모듈 스코프 구독자 집합(`sidebarListeners`), 다른 창에는 `storage` 이벤트. `storage` 는 값을 쓴 문서 자신에게는 발화하지 않으므로 둘 다 필요하다.
- 쓰기는 디바운스 없이 즉시 — 토글은 사람 손이라 드물고, 옆 탭이 곧바로 따라와야 "탭마다 따로 논다" 는 인상이 사라진다. 같은 값이면 쓰지도 알리지도 않아 루프가 생기지 않는다.

## 검증

- `pnpm test` 1050 통과(신규 4: 탭 A 토글 → 탭 B 즉시 반영, 나중에 연 탭이 취향 승계, 프로젝트 레코드에 필드 부재 + 전역 키 존재, 예전 레코드 값 1회 승격). typecheck·lint·build 각각 exit 0.
- 첫 번째 테스트가 회귀 게이트다 — 예전 구조에서는 프로바이더 둘의 상태가 분리돼 있어 반드시 실패한다.

## 메모

분리 터미널 창(`persistScope: "terminal"`)도 프로바이더를 마운트하지만, 전역 키에서 같은 값을 읽어 쓰므로 잡음이 없다. 사이드바 hover-reveal(`hovering`)은 원래부터 셸 로컬 휘발 상태라 손대지 않았다.
