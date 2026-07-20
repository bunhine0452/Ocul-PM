---
schema_version: 1
type: feature
slug: "tray-journal-notifications"
status: done
difficulty: low
created_at: "2026-07-20T22:50:29+09:00"
session_id: "mcp-20260720-225029"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/tray.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/capabilities/default.json"
    op: update
  - path: "src/features/tray/TrayPopover.tsx"
    op: update
  - path: "src/features/settings/SettingsPanel.tsx"
    op: update
related: []
tags:
  - "menubar"
  - "tray"
  - "v2.3.0"
  - "notification"
  - "mcp-tool"
---
[x] 새 일지 macOS 알림 (옵인) — journal-added 구독 + 폭주 스로틀

## 추가 기능

에이전트가 일지를 남기는 순간 macOS 네이티브 알림 — `tauri-plugin-notification` 등록 후 트레이 모듈이 `oculpm-journal-added` 이벤트를 구독해 "{프로젝트} — 새 일지 / [타입] 제목 · 에이전트" 를 띄운다. 부수로 일지 상세 메타·행 툴팁에 모델명(agent.version) 표시 추가.

- **옵인** (`tray.notify_journal`, 기본 off) — 알림은 소음이므로. 토글은 팝오버 "상단바 설정"과 앱 설정 모양 탭 양쪽.
- **폭주 방어** — git 백필·재인덱싱이 일지 수백 건을 한 번에 쏟을 수 있어, 10초 슬라이딩 창에 3건 초과분은 조용히 버린다.
- 이벤트 구독·설정 조회·프로젝트명 해석 전부 기존 경로 재사용 — 신규 커맨드 0.

## 동작 흐름

일지 생성(에이전트 자필/MCP/초안) → watcher 인덱싱 → OculpmJournalAdded emit → 트레이 리스너: 옵인 확인 → 스로틀 → 알림. 첫 알림 시 macOS 권한 프롬프트가 뜰 수 있다.

## 검증

cargo test 전체 exit 0, vitest 204·typecheck·lint·build 그린. 실제 알림 발화·권한 프롬프트는 실기기 확인(#v230-release)에 포함.