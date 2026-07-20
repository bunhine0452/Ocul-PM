---
schema_version: 1
type: feature
slug: "menubar-tray-implementation"
status: done
difficulty: high
created_at: "2026-07-20T21:58:38+09:00"
session_id: "mcp-20260720-215838"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/tray.rs"
    op: create
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/capabilities/default.json"
    op: update
  - path: "src/features/tray/TrayApp.tsx"
    op: create
  - path: "src/features/tray/TrayPopover.tsx"
    op: create
  - path: "src/features/tray/tray.css"
    op: create
  - path: "src/main.tsx"
    op: update
  - path: "src/features/shell/ShellV2.tsx"
    op: update
  - path: "src/features/settings/SettingsPanel.tsx"
    op: update
  - path: "src/__tests__/tray_popover.test.tsx"
    op: create
  - path: "src/lib/bindings.ts"
    op: update
related: []
tags:
  - "menubar"
  - "tray"
  - "v2.3.0"
  - "PR-MB"
  - "mcp-tool"
---
[x] v2.3.0 메뉴바 상주 구현 — 트레이 3상태 아이콘 + 팝오버 + 상주 모드 (PR-MB0~4)

## 추가 기능

마스터플랜(docs/menubar/00-master-plan.md) PR-MB0~4 를 한 라운드에 구현.

- **트레이 아이콘 (D1)** — `tray.rs` 신규. 번들 에셋 없이 **런타임 RGBA 로 동심원 로고를 그린다** (44px, 검정+알파 템플릿 → 라이트/다크 자동). 3상태: 유휴 정적 / 세션 활성 펄스(프레임 10장 사전 렌더, 140ms 교체, **세션 0 이면 태스크 스스로 정지** — 유휴 전력 0) / 정직성 경고 시 우상단 주의 점(팝오버 열람 시 해제). 세션 신호는 `oculpm-session-started/ended` 앱 이벤트 구독 — 훅 브리지의 정밀 신호 재사용, 폴링 없음.
- **팝오버 (D2·D3)** — 무장식 344×484 창(label `tray`)을 숨김 생성해 재사용, 트레이 클릭 좌표 기준 배치(모니터 클램프), 포커스 이탈·Esc 시 hide. `main.tsx` 의 `?tray=1` 분기가 **경량 진입점**(WorkspaceProvider 미마운트 — localStorage 충돌 회피, 테마만 SettingsProvider 공유). 데이터는 show 신호(`tray-popover-shown`)를 받아 기존 커맨드 4종(listProjects·oculpmGetStatus·oculpmListSessions·oculpmListJournalEntries·planList)으로 집계 — **신규 백엔드 집계 커맨드 0개**.
- **팝오버 구성 (D5)** — 프로젝트 스위처(전체/개별) → 활성 세션(에이전트·경과·프로젝트) → 오늘 한 줄(일지·변경 파일·⚠파싱경고) → 최근 일지 4건 → 활성 플랜 진행률 → 스탠드업 복사(결정적 폴백)/Today/설정. 빈 상태는 "오늘 아직 기록 없음 · 마지막 활동 시각". 모든 행은 `tray_open_main` 딥링크 — `TrayNavigate` 이벤트를 ShellV2 가 받아 프로젝트 전환+`journalOpenEntry` 핸드오프.
- **상주 모드 (D4)** — 전부 옵인: `tray.show_icon`(기본 on)·`tray.keep_running`·`tray.hide_dock` 3키. CloseRequested 가로채기(설정 off 면 현행과 완전 동일), Dock 숨김은 ActivationPolicy::Accessory↔Regular 왕복, 트레이 우클릭 메뉴 열기/종료 상시. 설정 모양 탭에 토글 3종 + `tray_apply_settings` 즉시 반영. window-state 플러그인은 tray 창 denylist.

함정 1건: 이벤트 이름은 tauri-specta 가 bindings.ts 에 내보내는 kebab 이름("oculpm-session-started")과 일치해야 한다 — Rust 쪽 raw listen 이라 오타 시 조용히 죽는 지점, 주석으로 고정.

## 동작 흐름

에이전트 세션 시작(훅) → 이벤트 → 트레이 펄스 시작. 아이콘 클릭 → 팝오버 배치·표시 → 열릴 때만 데이터 집계. 행 클릭 → 트레이 창 hide + 메인 창 focus + TrayNavigate → 해당 화면/일지. 창 닫기(옵인 시) → hide + (옵션) Dock 제거, 종료는 트레이 메뉴.

## 검증

cargo test 전체 exit 0(tray 신규 3 — 템플릿 흑백·주의점·펄스 프레임 차분), vitest 202(tray_popover 신규 4 — 집계 렌더·딥링크 인자·빈 상태·Esc), typecheck·lint·build 그린. **실기기 확인(아이콘 표시·클릭 좌표·상주 왕복)은 #v230-release 로 잔여** — 클릭 좌표 실측용 tracing 로그 심어둠.