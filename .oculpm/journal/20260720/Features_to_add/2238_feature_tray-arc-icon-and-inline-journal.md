---
schema_version: 1
type: feature
slug: "tray-arc-icon-and-inline-journal"
status: done
difficulty: medium
created_at: "2026-07-20T22:38:06+09:00"
session_id: "mcp-20260720-223806"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/tray.rs"
    op: update
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
  - "design"
  - "mcp-tool"
---
[x] 트레이 브랜드 아크 아이콘 + 팝오버 안 일지 읽기

## 추가 기능

실기기 피드백 2건: 아이콘 고급화 + 일지를 상단바에서 바로 읽기.

1. **브랜드 아크 아이콘** — 밋밋한 완전 동심원을 랜딩 로고 `#arc-motif` 의 트레이판으로 재작: 끊긴 호 3개(링별 틈 각도·크기 상이) + 중심점. 2×2 슈퍼샘플링으로 22pt 에서 가장자리 또렷. 활성 애니메이션은 반경 펄스 대신 **호의 회전**(링별 반대 방향, 위상 1.0 = 정확히 한 바퀴라 루프 심리스, 12프레임×160ms ≈ 1.9초/회전). 함정: 렌더 구조체 이름 `Arc` 가 `std::sync::Arc` 와 충돌 → `Ring` 으로.
2. **팝오버 안 일지 읽기** — 일지 행 클릭이 앱 딥링크 대신 팝오버 내 상세 패널을 연다: `oculpm_get_journal_entry` 로 본문 조회, **마크다운 라이트 렌더**(헤딩·불릿·코드펜스·굵게·인라인 코드만 — 본 앱의 풀 마크다운 스택을 트레이 번들에 안 끌어오는 의도적 축소). "앱에서 열기 ↗"는 상세 패널의 선택지로 이동. 팝오버 재오픈 시 상세 초기화.

## 검증

cargo test exit 0(아이콘 테스트 3 그대로 유효), vitest 204(상세 패널 테스트로 교체 — 본문 렌더·getEntry 인자·딥링크 이동·뒤로), typecheck·lint·build 그린. 아이콘 시각 품질은 실기기 확인(#v230-release).