---
schema_version: 1
type: chore
slug: "plan-three-features-round"
status: done
difficulty: medium
created_at: "2026-08-11T20:54:41+09:00"
session_id: "mcp-20260811-205441"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "docs/20260811_three-features/00-master-plan.md"
    op: create
  - path: "docs/20260811_three-features/01-multi-window.md"
    op: create
  - path: "docs/20260811_three-features/02-mobile-tailscale.md"
    op: create
  - path: "docs/20260811_three-features/03-i18n.md"
    op: create
  - path: ".oculpm/planner/three-features-round.md"
    op: create
related: []
tags:
  - "설계"
  - "멀티창"
  - "tailscale"
  - "i18n"
  - "계획"
  - "mcp-tool"
---
[x] 세 기능 라운드 설계 — 멀티 창 · Tailscale 모바일 · 영어화

## 동기

사용자가 세 기능을 요청 — ① Chrome 창처럼 프로젝트를 독립 창으로 띄우기 ② Tailscale 로 일지·플래너 모바일 연동 ③ full 영어 지원. 구현 전 코드베이스 접점을 실측하고 범위를 확정했다.

## 범위 확정 (사용자 결정)

- 창: **메인 = 런처 전용**, 프로젝트는 항상 별도 창 (`project-<id>`)
- 모바일: **읽기 전용 1차** (일지·플래너·오늘 브리핑)
- 영어화: **UI + 백엔드 사용자 노출 에러 + LLM 프롬프트**. 디스크 산출물(AGENTS.md 템플릿·일지 규격)은 제외

## 조사에서 나온 핵심 사실

**멀티 창** — 전례가 이미 있다. 트레이 팝오버가 `index.html?tray=1` 로 뜨고 `main.tsx` 가 쿼리로 진입점을 분기한다. 실제 작업은 창 생성이 아니라 전역 가정을 창 단위로 쪼개는 것:

- `capabilities/default.json` 의 `windows: ["main","tray"]` — 새 라벨은 IPC 가 전부 무음 실패. 스키마가 글롭을 지원함을 확인
- `WorkspaceContext` 의 단일 키 `aipm:workspace:v1` — 두 창이 서로를 덮어씀
- 전역 `PtyState` + 프런트 생성 8자 sid — 충돌 가능 + 창 닫을 때 미정리
- **가장 위험**: `tray.rs:498` 의 "메인 창 닫기 = `app.exit(0)`" — 런처 모델에서는 런처를 치우려다 작업 중인 프로젝트 창이 전부 죽는다
- 죽고 깨진 `open_terminal_window` 발견 — 등록·bindings 노출까지 됐는데 호출처 0이고, 호출해도 capability 누락으로 깨짐

**모바일** — HTTP 서버가 코드베이스에 전혀 없다 (axum/hyper/tiny_http 미포함, oculpm-mcp 는 stdio). 서버·인증·번들이 전부 신규. 반대로 읽기 API 는 전부 존재해서 데이터 계층은 손댈 게 없다. 이 기기에서 Tailscale 동작 실측 확인 (IP 100.x, MagicDNS, utun 인터페이스). 바인딩은 CGNAT 100.64.0.0/10 인터페이스에만 — 0.0.0.0 폴백 금지가 이 기능의 보안 핵심.

**영어화** — 고유 문자열 ~2,108개 / 133파일. `OculpmError` 가 이미 100% 영어라 타입 시스템을 통과하는 에러는 무변경이고, 커맨드 계층 애드혹 문자열 ~130곳만 대상. CSS 안 한글은 전부 주석이라 제외.

## 순서 결정

i18n 을 뼈대와 본체로 쪼개 **Phase 0 뼈대 → Phase 1 멀티 창 → Phase 2 본 추출 → Phase 3 모바일** 로 잡았다. 뼈대를 먼저 넣으면 멀티 창의 신규 UI 가 처음부터 `t()` 로 작성돼 재작업이 없고, 사용자가 실제로 원한 기능이 2,100줄 기계적 추출 뒤로 밀리지도 않는다.

회귀 방지는 `check-no-localstorage.mjs` 와 같은 구조의 한글 하드코딩 검사기를 만들되 **allowlist 를 역방향으로** 쓴다 — 133파일을 먼저 전부 등재해 통과시키고, 번역할 때마다 한 줄씩 뺀다. 진척도가 `allowlist.length` 로 측정되고 신규 파일은 처음부터 하드코딩이 불가능해진다.

## 검증

구현 전 설계 단계라 실행 게이트는 해당 없음. 실측으로 확인한 것: capability 스키마의 글롭 지원(`gen/schemas/macOS-schema.json`), Tailscale 동작 상태(`tailscale status --json`), 문자열 규모(rg 집계), `open_terminal_window` 의 미사용·미배선 상태.