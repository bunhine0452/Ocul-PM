---
schema_version: 1
type: feature
slug: "marketplace-and-exclusivity-ux"
status: done
difficulty: medium
created_at: "2026-07-31T04:15:05+09:00"
session_id: "mcp-20260731-041505"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: ".claude-plugin/marketplace.json"
    op: create
  - path: "scripts/build-sidecar.mjs"
    op: update
  - path: "src-tauri/tests/plugin_manifest.rs"
    op: update
  - path: "src-tauri/src/commands/mcp.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/features/settings/OculpmSettings.tsx"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "docs/claude-integration/06-plugin-contract.md"
    op: create
  - path: "plugin/oculpm/README.md"
    op: update
related: []
tags:
  - "marketplace"
  - "plugin"
  - "settings"
  - "plugin-round"
  - "mcp-tool"
---
[x] 마켓플레이스 구성 + 플러그인 감지 택일 UX + 계약 문서 (A3 코드 표면)

## 추가 기능

plugin-round A3 의 코드·문서 표면 (제출·발사 글은 사용자 액션으로 잔여):

1. **레포 루트 `.claude-plugin/marketplace.json`** — `/plugin marketplace add bunhine0452/Ocul-PM` → `/plugin install oculpm@oculpm` 진입점. source 는 서브디렉터리 상대경로(`./plugin/oculpm`), 버전은 build-sidecar 가 앱 버전으로 자동 스탬프 + 매니페스트 테스트가 plugin.json 과의 동기를 강제. `claude plugin validate` 통과.
2. **플러그인 설치 감지** (`claude_plugin_status`) — `~/.claude/plugins/**` 를 깊이 6·2,000항목 상한으로 훑어 이름이 oculpm 인 `.claude-plugin/plugin.json` 탐색 (레이아웃이 CLI 버전별로 달라 이름 기준·오탐 없음 우선).
3. **설정 연동 택일 UX** — MCP 섹션 위에 플러그인 블록(설치 상태 배지·설치 명령 복사): 설치 감지 시 "프로젝트별 훅 토글·MCP 등록을 함께 켜면 이중 적재+도구 2벌" 경고 — 검증 라운드에서 지적된 훅+MCP 양쪽 중복을 UI 로 차단.
4. **계약 문서** `docs/claude-integration/06-plugin-contract.md` — 구성별 "읽는 것/쓰는 것/절대 하지 않는 것" 표(ECC memory-persistence 관행) + **버전 스큐 매트릭스**(플러그인·앱·템플릿 3자 조합별 동작과 근거 — 다운그레이드 가드·자동발견 계약 연결). 플러그인 README 에 마켓플레이스 설치 절차 + git-source add 제약 명시.

## 동작 흐름

푸시 즉시 공개 레포에서 마켓플레이스 add/install 가능(무발표 소프트 공개) → 사용자가 발사 글·claude-plugins-community 제출 시점 결정.

## 검증

- 매니페스트 테스트 7종 그린(marketplace 스키마·버전 동기 신규), `claude plugin validate` 통과, cargo 전체 FAILED 0, typecheck/lint/vitest 339/build 그린.
- 실기기: 설정 연동 탭에서 플러그인 배지·복사 버튼·(설치 시) 택일 경고 표시 확인 필요 — A0d 잔여에 동승.