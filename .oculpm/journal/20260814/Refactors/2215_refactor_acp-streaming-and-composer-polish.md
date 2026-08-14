---
schema_version: 1
type: refactor
slug: "acp-streaming-and-composer-polish"
status: done
difficulty: medium
created_at: "2026-08-14T22:15:32+09:00"
session_id: "mcp-20260814-221532"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/styles/agent.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related: []
tags:
  - "acp"
  - "performance"
  - "design"
  - "css"
  - "mcp-tool"
---
[x] 스트리밍 렉 제거 + 컴포저 재설계 — 경계선 없애고 노브 5개를 칩 1개로

## 동기

사용자 지적 두 가지. ① 스트리밍이 "렉 걸리듯" 끊겨 나온다. ② 디자인이 아직 아마추어 같다 — 채팅 창과 입력창 사이 경계선을 없애고 Claude Desktop 을 보고 다시 만들어 달라.

## 스트리밍이 끊겨 보인 이유

토큰 하나마다 `setTurns` 를 불렀다. 그러면 스레드 전체가 다시 그려지고, **누적된 전체 텍스트의 마크다운이 매번 재파싱된다.** 대화가 길수록 심해져 타자가 뚝뚝 끊긴다. 프로바이더 채팅은 이미 같은 이유로 스로틀 + 행 memo 를 쓰고 있었는데, ACP 화면에는 둘 다 없었다.

- **청크 합치기**: 들어온 글자를 ref 버퍼에 모아 45ms 마다 한 번의 상태 갱신으로 반영. 텍스트가 아닌 사건(툴콜·승인·종료)은 **먼저 버퍼를 비우고** 적용한다 — 안 그러면 카드가 문장 앞으로 튄다.
- **행 memo**: `TurnRow` 를 `memo` 로 분리. 리듀서가 바뀐 턴만 새 객체로 만들기 때문에 기본 얕은 비교로 충분하다.

## 컴포저 재설계

**버그도 하나 있었다**: `.composer-input` 은 래퍼 클래스인데 textarea 에 직접 걸어 놨다. 그래서 입력창 스타일이 하나도 안 먹고 있었다 — 스크린샷의 날것 같은 입력 상자가 그 결과다. 래퍼로 감쌌다.

- **경계선 제거**: `.ai-compose` 의 `border-top` 을 없앴다. 구분선은 "여기서부터 다른 영역"이라 선언하는데 실제로는 같은 대화의 연속이다. 층은 입력 카드의 반경(20px)과 그림자로만 만든다.
- **포커스 링**: accent 3px 링은 입력창을 경고처럼 보이게 한다. 테두리만 또렷하게, 링은 뺐다.
- **노브 5개 → 칩 1개**: `MODE Manual MODEL Sonnet EFFORT Xhigh FAST MODE Off AGENT Default` 가 컴포저 바닥을 계기판처럼 만들었다. Claude Desktop 처럼 **평소엔 모델 이름 하나만** 보이고 누르면 전부 펼치는 메뉴로 합쳤다(그룹 헤더 + 체크). 선택지는 여전히 어댑터가 준 그대로다.
- 하단 줄 재배치: 왼쪽에 첨부·새 대화, 오른쪽에 사용량·설정 칩·전송.

## 검증

typecheck 0 · 프런트 756건 · lint 0 · build 0 · 백엔드 569 유닛 + 통합 6건(직렬). `plugin_json` 실패는 v2.9.0 릴리스가 남긴 기존 드리프트.

**픽셀은 여전히 미확인** — 렌더 결과는 사람 눈이 필요하다. 스트리밍 부드러움도 실제 스트림에서 체감 확인이 필요하다(스로틀 값 45ms 는 프로바이더 채팅과 같은 문턱을 따랐다).