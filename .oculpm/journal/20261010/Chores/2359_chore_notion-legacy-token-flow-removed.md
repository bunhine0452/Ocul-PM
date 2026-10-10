---
schema_version: 1
type: chore
slug: "notion-legacy-token-flow-removed"
status: done
difficulty: low
created_at: "2026-10-10T23:59:28+09:00"
session_id: "20261010-004"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "8ea7b9ae-c829-4853-a394-c185809e360d"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/notion.rs"
    op: update
  - path: "src-tauri/src/commands/notion.rs"
    op: update
  - path: "landing/api/notion/oauth/callback.ts"
    op: update
  - path: "landing/api/notion/oauth/start.ts"
    op: update
related:
  - ref: "20261007/Bugs/1056_bug_notion-oauth-code-relay.md"
    kind: "followup"
tags:
  - "security"
  - "notion"
  - "external-review"
  - "mcp-tool"
---
[x] Notion 옛 ?token= OAuth 흐름 제거 — 앱 Token 갈래 · 랜딩 서버 교환

## 작업 요약
v3.8.0 에서 Notion OAuth 를 code 중계로 바꾸며 남긴 하위 호환 두 갈래를 지웠다. 그 뒤 3.9.0 · 3.10.0 · 3.10.1 · 3.11.0 · 3.12.0 다섯 릴리스가 나갔다.
- 앱: `OAuthCallback::Token` 을 지웠다. 변형이 `Code` 하나만 남아 enum 을 없앴고, `parse_oauth_callback` 은 (code, state) 를 돌려준다. `?token=` 콜백은 이제 None 이다.
- 랜딩: `callback.ts` 의 서버 교환과 `?token=` 리다이렉트를 지웠다. 교환을 안 하니 client secret env 검사도 같이 지웠다. 옛 앱 거절은 callback 이 아니라 `start` 에 두었다 — `flow=code` 가 없으면 400 과 「앱을 업데이트해 주세요」를 돌려준다. 사용자가 Notion 승인 화면까지 갔다가 실패하는 것보다 시작에서 막는 편이 낫다.
- 병렬 레인(Sonnet 5.5)이 구현하고 오케스트레이터가 검토·합류했다. PR #83.

## 검증
- cargo test notion 7건 통과, 랜딩 TS `tsc --noEmit` 오류 없음. PR #83 CI 3잡 success.
- 랜딩 배포 뒤 실측(2026-10-10): flow 없는 start 는 400 과 업데이트 안내, `flow=code` 는 302 로 api.notion.com authorize, callback 은 302 로 `127.0.0.1:<port>/oculpm/notion?code=…`.
- 실제 Notion 계정 왕복은 미확인 — improvement-round-2026-09-14 #eyes-security 로 넘겼다.