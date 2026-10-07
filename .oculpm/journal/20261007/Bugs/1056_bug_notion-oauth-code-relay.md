---
schema_version: 1
type: bug
slug: "notion-oauth-code-relay"
status: done
difficulty: medium
created_at: "2026-10-07T10:56:40+09:00"
session_id: "20261007-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fdeb6d9e-9327-4e65-8f8a-4524621720ff"
language: "ko"
verified_by_user: false
files_touched:
  - path: "landing/api/notion/oauth/start.ts"
    op: update
  - path: "landing/api/notion/oauth/callback.ts"
    op: update
  - path: "landing/api/notion/oauth/exchange.ts"
    op: create
  - path: "src-tauri/src/notion.rs"
    op: update
  - path: "src-tauri/src/commands/notion.rs"
    op: update
related:
  - ref: "20260907/Bugs/1643_bug_char-boundary-panics-and-nonce.md"
    kind: "followup"
tags:
  - "security"
  - "notion"
  - "external-review"
  - "mcp-tool"
---
[x] Notion OAuth 토큰이 리다이렉트 URL 로 와서 브라우저 기록에 남았다 — code 중계로

## 발생 원인

외부 보안 피드백: Notion 연동이 oculpm.com 중계를 거치고 "토큰이 브라우저 기록에 남는 구조". 확인했다 — `landing/api/notion/oauth/callback.ts` 가 code 를 토큰으로 교환한 뒤 `http://127.0.0.1:<port>/oculpm/notion?token=…&state=…` 로 302 했다. 리다이렉트 목적지 URL 은 브라우저 기록(과 계정 동기화)에 그대로 남는다. 프로덕션에서 켜져 있는 흐름이다(유효한 port/state 로 start 를 부르면 Notion authorize 로 302 — 2026-10-07 확인).

## 해결 방법

- 새 앱은 start URL 에 `flow=code` 를 붙인다. start.ts 가 그 값을 state(base64url JSON `f`)에 실어 왕복시키고, callback.ts 는 그 흐름에 **교환하지 않고 code 만** 루프백으로 넘긴다.
- 새 `landing/api/notion/oauth/exchange.ts`(POST `{code}` → `{access_token}`, `Cache-Control: no-store`). 앱은 state 를 검증한 뒤 `notion::exchange_code` 로 토큰을 응답 본문으로 받고, 예전처럼 `verify_token` → 키체인. code 는 일회용이고 client secret 없이는 못 바꾸므로 기록에 남아도 쓸모가 없다.
- 하위 호환 양방향: flow 를 모르는 옛 서버는 토큰을 보내고 새 앱이 그것도 받는다(`OAuthCallback::Token`, oculpm-defer 표식). 옛 앱은 flow 를 안 붙여 서버가 예전 흐름을 탄다 — 랜딩 배포와 앱 릴리스 순서가 상관없다.

## 검증

- `parses_callback_and_rejects_garbage` 를 code·token·둘 다·빈 값·state 누락까지 넓혔다. Notion 7 통과, 전체 Rust 1985 통과, clippy 0, lint 통과.
- 미확인: 실제 Notion 왕복(랜딩 미배포 — `cd landing && vercel --prod` 는 사람 몫). 배포 뒤 새 앱으로 연결해 브라우저 기록에 `token=` 이 없는지 볼 것.