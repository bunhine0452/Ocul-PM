---
schema_version: 1
type: refactor
slug: "sweep-legacy-before-features"
status: done
difficulty: medium
created_at: "2026-10-29T21:08:47+09:00"
session_id: "20261029-015"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/src/commands/plan.rs"
    op: update
  - path: "src-tauri/src/oculpm/planner/lifecycle.rs"
    op: update
  - path: "src-tauri/src/oculpm/planner/migrate.rs"
    op: delete
  - path: "src-tauri/src/db/planning.rs"
    op: update
  - path: "src-tauri/src/db/mod.rs"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/styles/screens-overflow.css"
    op: update
  - path: "src/styles/primitives.css"
    op: update
  - path: "src/lib/settings.ts"
    op: update
  - path: "src/components/Toolbar.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "package.json"
    op: update
  - path: "tsconfig.json"
    op: update
related: []
tags:
  - "refactor"
  - "cleanup"
  - "ui"
  - "mcp-tool"
---
[x] 기능 전에 걷기 — 안 쓰는 명령·모듈·CSS·키

## 동기

사용자(10-29): 「기능을 추가하기 전에, 레거시 코드나 프로젝트에 필요없는 코드를 걷어내고 시작하자.」 계획 ocul-next-20261029 의 「걷기」 단계. 4.0 에서 화면을 걷었지만 그 화면만 쓰던 명령·모듈·CSS·설정·사전 키와 `src/legacy` 제외 목록이 남아 있었다.

## 변경 요약

- 백엔드(커밋 559dd2a0): 화면이 안 부르는 Tauri 명령 13개(계획 편집 · 옛 목표 · 설정 초기화 · 훅 설치)와 그것만 쓰던 코드 — migrate.rs, lifecycle 의 완료·잠금 문지기(open_leaves 만 남김), 옛 goals 읽기, 채팅 시절 타입 셋, 짝 없는 함수들. crate zip. bindings.ts −125줄.
- 프런트(커밋 dad847e2): main.tsx 에서 닿지 않는 모듈 21개(+전용 테스트 6), 걷은 화면의 CSS 규칙 139개와 묘비 주석 90개(screens.css 626 → 309줄, screens-overflow.css 186 → 20줄), 툴바 「베타」 알약, 설정 필드 셋, 사전 키 40개(오류 코드 18 포함), src/legacy 흔적(tsconfig · vitest · 린트 · 크기 정책), npm marked.
- 판정 도구: import 그래프(@/ · 상대 경로), 명령 이름 ↔ commands.camel/문자열, 주석 뺀 pub 항목 참조 수, CSS 클래스 ↔ TS(코드가 조립하는 `"is-" + x` 접두는 살려 둠). 대조로 컴파일러 경고와 테스트를 같이 봤다.

## 검증

- cargo test --locked 1133 passed / 0 failed · cargo clippy --all-targets -D warnings 0 · cargo fmt --check 0
- pnpm typecheck 0 · pnpm test 71 files / 890 passed · pnpm lint 0 · pnpm build 0(핵심 선택자 12개 확인)

## 메모

틀렸던 판정 하나: lib/transport/event.ts 를 「닿지 않음」으로 지웠는데 vite 별칭(@tauri-apps/api/event → 셤)으로 쓰이는 파일이라 빌드가 잡았다. 되돌렸다. import 그래프만으로는 번들러 별칭을 못 본다.