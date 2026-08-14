---
schema_version: 1
type: feature
slug: "acp-attachments-mentions-new-session"
status: done
difficulty: medium
created_at: "2026-08-14T21:36:00+09:00"
session_id: "mcp-20260814-213600"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/acp.rs"
    op: update
  - path: "src-tauri/src/acp/process.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/tests/acp_handshake.rs"
    op: update
  - path: "src/features/chat/acpMention.ts"
    op: create
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/__tests__/acp_mention.test.ts"
    op: create
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
related: []
tags:
  - "acp"
  - "attachment"
  - "mention"
  - "session"
  - "react"
  - "mcp-tool"
---
[x] 파일 첨부·@멘션·새 대화 — Rewind 는 프로토콜에 없어 제외

## 추가 기능

Claude Code 확장 메뉴 대비 남아 있던 항목 중 프로토콜로 가능한 것들: **파일 첨부** · **`@` 멘션** · **대화 비우기**. 커맨드 3개(`acp_pick_files` / `acp_list_files` / `acp_new_session`)와 `acp_prompt` 의 `attachments` 인자.

## 동작 흐름

**첨부는 내용이 아니라 링크로 보낸다.** `ContentBlock::ResourceLink` 로 `file://` URI 만 넘기고 에이전트가 자기 파일 도구로 필요한 만큼 읽게 한다 — 큰 파일을 통째로 프롬프트에 밀어 넣는 사고를 막고 토큰도 아낀다. `@` 멘션은 상대경로, 파일 대화상자는 절대경로로 오는데 ACP 는 절대경로를 요구하므로 백엔드가 프로젝트 루트 기준으로 맞춘다.

**`@` 후보는 DB 인덱스가 아니라 디스크를 직접 걷는다**(`ignore` 크레이트). 인덱싱 전이거나 방금 만든 파일도 멘션할 수 있어야 하기 때문이고, `.gitignore` 를 존중하므로 `node_modules`·`target` 이 딸려오지 않는다.

멘션 파싱은 순수 함수로 뺐다(`acpMention.ts`). "어디부터 어디까지가 멘션인가"는 눈으로 검증이 안 되고 조용히 틀린다 — `user@example.com` 을 멘션으로 오인하거나, 고른 뒤 앞 문장을 함께 지우는 식이다. `@` 는 줄 첫머리이거나 공백 뒤일 때만 멘션으로 본다.

## Rewind 는 넣지 않았다

확장의 Rewind 에 대응하는 것이 ACP 에 없다. `ForkSessionRequest` 는 `{session_id, cwd, additional_directories, mcp_servers}` 뿐 — **되감을 지점을 받지 않는다**. 세션 복제이지 되감기가 아니라서, 있는 척 흉내 내는 대신 "새 대화"만 제공한다.

## 검증

통합(`#[ignore]`, 수동): `attached_resource_links_are_read_by_the_agent` — 임시 폴더에 모델이 지어낼 수 없는 토큰(`ZQ7-marmalade-1731`)을 심은 파일을 만들고 **링크만** 첨부한 뒤, 답변에 그 토큰이 나오는지 본다. 통과(9.95초) — 즉 에이전트가 링크를 실제로 따라 읽는다. 이게 깨지면 첨부가 조용히 무의미해지는데, 화면상으론 멀쩡해 보인다.

프런트 유닛 7건 신규(멘션 파싱 — 이메일 오인 방지, 치환 시 앞 문장 보존 포함).

게이트: typecheck 0 · 프런트 **756건(61파일)** · lint 0 · build 0 · 백엔드 569 유닛 + 통합 전 스위트(ignored 7). `plugin_json` 실패는 v2.9.0 릴리스가 남긴 기존 드리프트로 본 작업과 무관.

**남은 것**: 화면에서 첨부 버튼·멘션 팝오버를 실제로 눌러 본 적은 없다(백엔드 경로는 위 통합 테스트가 증명). Account & usage 상세는 여전히 배지 수준.