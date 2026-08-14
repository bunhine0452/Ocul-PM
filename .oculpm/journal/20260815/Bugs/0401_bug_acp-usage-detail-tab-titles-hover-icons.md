---
schema_version: 1
type: bug
slug: "acp-usage-detail-tab-titles-hover-icons"
status: done
difficulty: medium
created_at: "2026-08-15T04:01:13+09:00"
session_id: "mcp-20260815-040113"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/acp/session.rs"
    op: update
  - path: "src-tauri/src/acp/process.rs"
    op: update
  - path: "src-tauri/src/commands/acp.rs"
    op: update
  - path: "src/features/chat/AcpUsageMeter.tsx"
    op: update
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/styles/agent.css"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related: []
tags:
  - "acp"
  - "usage"
  - "ux"
  - "bug"
  - "css"
  - "mcp-tool"
---
[x] 사용량 기여도 대목 복원 · 탭이 "제목 없는 대화"로 남던 것 · 호버 아이콘 반투명·확인 단계

## 기여도 대목은 **뜯지 않고** 그대로 건다

`/usage` 는 한도 세 줄 뒤에 "무엇이 사용량에 기여했나"를 덧붙인다 — 컨텍스트 길이 경고, 스킬·플러그인·MCP 서버별 %. 우리는 한도 줄만 파싱하고 나머지를 버리고 있었다.

표로 파싱하지 **않기로** 했다. 항목이 계속 늘고(스킬·플러그인·MCP 는 최근에 생겼다) 문구도 CLI 판올림마다 바뀐다 — 뜯어 두면 다음 판에 조용히 빈칸이 되고, 그 사실은 아무도 모른다. 대신 머리글 아래를 통째로 원문 보존해 `white-space: pre-wrap` 으로 건다. 공백 정렬까지 살려야 오른쪽 % 열이 줄을 맞춘다.

`replace_limits` 가 둘 다 못 읽었을 때만 물러나도록 고쳤다 — 한쪽만 실패했는데 통째로 갈아 끼우면 멀쩡한 값이 지워진다. 알림(`usage_update`)에는 이 대목이 없으므로 갖고 있던 것을 유지한다.

## 탭이 영영 "제목 없는 대화"였던 이유

제목을 `session_info_update` 알림에서만 받고 있었다. 그 알림은 에이전트가 제목을 **붙이는 순간** 한 번 온다 — 지난 대화를 열면 이미 붙어 있으므로 다시 오지 않는다. 그래서 목록에는 "VS Code 확장 기능 개발 가능성"이 보이는데 탭은 제목이 없었다.

`session/list` 는 어댑터가 들고 있는 완성된 제목을 언제든 준다. 목록 조회를 패널 열림 조건에서 떼어 세션이 붙을 때마다 돌리고, 그 제목으로 탭을 메운다. 두 가지를 같이 지켰다:

- **이름표가 이긴다** — 사용자가 붙인 이름은 백필이 덮지 않는다.
- **"모른다"가 "안다"를 이기지 않는다** — `rememberTab` 이 `null` 로 기존 제목을 덮던 것을 막았다.

목록 조회는 이제 사용자가 시킨 것이 아니라 우리가 도는 것이므로 **실패해도 조용하다**. 안 그러면 아무 것도 안 했는데 대화창에 빨간 줄이 뜬다.

## 호버 아이콘

반투명이었다. `.acp-session-actions` 가 줄 **위에 겹쳐** 뜨는데 배경이 없어 제목 글자가 아이콘 사이로 새어 나왔다 — X 가 글자와 겹쳐 읽혔다. 줄 색(기본/호버·활성)과 같은 불투명 배경을 깔고 왼쪽만 14px 페이드해서 잘린 제목이 아이콘 밑으로 자연스럽게 사라지게 했다.

삭제 확인 단계도 뺐다. 목록에서 X 는 "지운다"는 뜻이고, 한 번 더 묻는 것은 지우려는 사람에게만 부담이다.

## 검증

typecheck 0 · 프런트 802 · lint 0 · build 0 · 백엔드 577 유닛(기여도 파싱 2건 추가) + 전 스위트.

**미확인**: 기여도 대목이 실제 `/usage` 응답에 어떤 모양으로 오는지는 눌러 봐야 안다 — 원문 보존이라 어떤 모양이든 보이기는 하지만, 줄바꿈이 없는 한 덩어리로 오면 읽기 나쁠 수 있다.