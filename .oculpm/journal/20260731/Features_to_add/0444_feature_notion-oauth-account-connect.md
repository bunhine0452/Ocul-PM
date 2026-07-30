---
schema_version: 1
type: feature
slug: "notion-oauth-account-connect"
status: done
difficulty: medium
created_at: "2026-07-31T04:44:25+09:00"
session_id: "mcp-20260731-044425"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/notion.rs"
    op: update
  - path: "src-tauri/src/commands/notion.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "landing/api/notion/oauth/start.ts"
    op: create
  - path: "landing/api/notion/oauth/callback.ts"
    op: create
  - path: "src/features/settings/SettingsPanel.tsx"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
related: []
tags:
  - "notion"
  - "oauth"
  - "settings"
  - "plugin-round"
  - "mcp-tool"
---
[x] Notion 계정 연결(OAuth) — 브라우저 승인 한 번으로 토큰 연동 (notion-oauth)

## 추가 기능

plugin-round {#notion-oauth}. internal token 수동 발급의 마찰을 "Notion 계정으로 연결" 버튼 하나로:

1. **앱** (`notion_oauth_start`): 루프백(127.0.0.1 임시 포트) 리스너 + blake3 nonce → 브라우저로 `oculpm.com/api/notion/oauth/start?port&state` → 콜백 대기(3분 상한, state 불일치 요청은 토큰 폐기 후 계속 대기 — 로컬 CSRF 방어) → 기존 `verify_token` 검증 후 **기존 키체인 키(`notion_api_key`)에 저장** — 이후 내보내기·상태 UI 는 무변경으로 동작.
2. **서버리스** (`landing/api/notion/oauth/{start,callback}.ts`): client id/secret 은 Vercel env 에만 존재(데스크톱에 시크릿 불가 원칙). start 는 Notion authorize 로 302(루프백 좌표는 state 에 base64url 왕복 — 서버 무상태), callback 은 code→token 교환 후 127.0.0.1 로 302. **토큰을 저장하지 않는다** — 교환·전달만. 입력 검증(port 범위·state hex 형식).
3. **설정 UI**: Notion 섹션 상단 "Notion 계정으로 연결" 버튼 + internal token 직접 입력은 폴백 유지.

## 동작 흐름

버튼 → 브라우저 승인(페이지 선택 포함) → 서버 교환 → 루프백 수신 → 검증·키체인 → "연결됨: 워크스페이스명" 토스트.

## 검증

- Rust 신규 테스트: 콜백 파싱(쿼리/메서드 거부/퍼센트 디코딩)·nonce 유일성/형식. cargo 전체 FAILED 0 · typecheck/lint/vitest 339/build 그린.
- E2E 는 배포 선행 조건 있음 — 잔여(사용자): ① notion.so/my-integrations 에서 **Public** integration 생성(redirect URI `https://oculpm.com/api/notion/oauth/callback`), ② Vercel env `NOTION_OAUTH_CLIENT_ID`/`NOTION_OAUTH_CLIENT_SECRET` 설정 + landing 재배포.

## 메모

로컬-퍼스트 원칙의 유일한 서버 예외 지점 — 교환 함수는 데이터 무접촉임을 코드 주석·계약 문서에 명시 예정(06 문서 후속 갱신 대상). 토큰이 루프백 리다이렉트 쿼리로 전달되는 것은 기기 내 통신(127.0.0.1)이라 수용.