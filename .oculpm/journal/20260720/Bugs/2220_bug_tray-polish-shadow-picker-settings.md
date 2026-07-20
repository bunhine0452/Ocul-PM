---
schema_version: 1
type: bug
slug: "tray-polish-shadow-picker-settings"
status: done
difficulty: medium
created_at: "2026-07-20T22:20:36+09:00"
session_id: "mcp-20260720-222036"
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
  - path: "src-tauri/src/tray.rs"
    op: update
  - path: "src/__tests__/tray_popover.test.tsx"
    op: update
related: []
tags:
  - "menubar"
  - "tray"
  - "v2.3.0"
  - "dogfooding"
  - "mcp-tool"
---
[x] 트레이 실기기 피드백 라운드 — 그림자 클리핑·스위처 고급화·팝오버 내 설정·⌘W 계약

## 발생 원인

실기기 1차 확인 피드백 3건 + 잠복 버그 1건.

1. **그림자가 사각 띠처럼 보임** — CSS 블러(40px)가 창의 투명 여백(12px)보다 커서 창 경계에서 잘렸다. 투명 창에서 그림자는 여백 안에 완전히 담겨야 한다.
2. **네이티브 select 가 팝오버 톤과 어긋남** — OS 기본 룩.
3. **Today/설정 버튼이 전부 앱 딥링크** — 상단바에서 끝낼 수 있는 것도 앱을 열게 했다.
4. **⌘W 잠복 버그** — keep_running off 인데도 숨겨진 트레이 팝오버 창이 "마지막 창"으로 살아 있어, 메인 창을 닫아도 앱이 종료되지 않았다 (상주 도입 전 계약 위반).

## 해결 방법

1. 그림자를 `0 5px 11px + 0 1px 4px` 로 축소, 하단 여백 14px — 클리핑 소멸.
2. 커스텀 드롭다운 — 체크 표시·프로젝트별 오늘 카운트 배지·활성 세션 라이브 점·진입 모션·외부 클릭 닫힘.
3. 푸터 재구성: Today 제거(오늘 정보는 팝오버 본문이 이미 표시), 설정 → 팝오버 안 **"상단바 설정" 패널**(토글 3종, 저장 즉시 `tray_apply_settings`) + "앱에서 전체 설정 열기" 딥링크. 팝오버 재오픈 시 메인 화면 복귀.
4. `handle_main_close_requested` — keep off 면 `app.exit(0)` 명시 호출로 기존 "창 닫기=종료" 계약 복원. ⌘W=상주 토글 의존, ⌘Q=항상 완전 종료로 의미 고정 (토글 힌트에도 명시).

## 검증

cargo test exit 0, vitest 204(트레이 6 — 스위처 선택·설정 패널 토글/딥링크 신규 2), typecheck·lint·build 그린. 그림자·드롭다운 시각 확인은 실기기 재확인(#v230-release).