---
schema_version: 1
type: feature
slug: "acp-image-paste-effort-track-mode-colors"
status: done
difficulty: high
created_at: "2026-08-15T02:46:16+09:00"
session_id: "mcp-20260815-024616"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/acp.rs"
    op: update
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/contexts/WorkspaceContext.tsx"
    op: update
  - path: "src/styles/agent.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
related: []
tags:
  - "acp"
  - "image"
  - "effort"
  - "permission-mode"
  - "ux"
  - "mcp-tool"
---
[x] 이미지 붙여넣기 · Effort 트랙에 울트라코드 칸 복원 · 모드 색과 ⇧Tab

## max 를 덮어쓴 것이 잘못이었다

지적: "max 다음에 ultracode 야, max 어디 갔어". 맞다. 앞 라운드에서 나는 `max` 의 **이름만** 울트라코드로 바꿨는데, 그러면 max 가 사라져 고를 수 없게 된다.

실제 구조는 이렇다. 어댑터의 effort 값은 `low·medium·high·xhigh·max` 다섯이고 울트라코드는 **그 목록에 없다** — 사용자 쪽 Claude Code 는 `max` **다음** 칸에 두고 "xhigh + workflows" 라 설명한다. 즉 effort 값이 아니라 키워드로 켜지는 상태다.

그래서 트랙에 칸 하나를 **덧댔다**. 고르면 effort 는 `xhigh` 로 두고 키워드를 켠다. max 는 제자리에 그대로 있다.

디자인도 요청대로 바꿨다 — 값이 **위**, 트랙이 **아래**. 눈이 "지금 무엇"을 먼저 읽고 그 다음 "어디쯤"을 본다. 나란히 놓으면 둘이 서로를 밀어낸다.

## 모드가 왜 여섯인가

**어댑터가 여섯을 준다.** VS Code 확장이 넷만 보여 주는 건 `dontAsk` 와 `bypassPermissions` 를 감춘 것이다 — 되돌릴 수 없는 일을 묻지 않고 하는 모드들이다.

우리는 여섯을 다 남기되 두 가지로 갈랐다.

- **색**: 위험이 커질수록 차가운 색에서 뜨거운 색으로. 자물쇠(회색) → 편집 허용(초록) → 계획(파랑) → 자동(보라) → 안 묻기(주황) → 전면 우회(빨강). 권한 모드는 틀리면 대가가 큰 설정이라 글자를 읽기 전에 보여야 한다.
- **⇧Tab 은 안전한 넷만 순환한다.** 키 하나를 연타하다 "전면 우회"에 착지하면 사고다. 메뉴에서는 여전히 고를 수 있다 — 명시적으로 고르는 것과 실수로 지나가는 것은 다르다. 목록 밖에 있다가 ⇧Tab 을 누르면 처음으로 돌아온다(순환에서 빠져나올 길이 없으면 갇힌다).

## 이미지 붙여넣기

`promptCapabilities.image` 가 켜져 있어 프로토콜은 원래 받는다. 파일 첨부와 달리 **내용을 실어 보낸다** — 클립보드 이미지는 디스크에 없어 링크로 줄 수가 없다. `data:` 접두사를 떼고 base64 본문만 넘긴다(접두사째 보내면 어댑터가 못 읽는다). 썸네일 자체가 버튼이고 호버하면 X 가 뜬다.

## 검증

게이트: typecheck 0 · 프런트 791건 · lint 0 · build 0 · 백엔드 575 유닛.

**미확인**: 이미지가 실제로 모델에 전달되는지는 붙여넣어 물어봐야 안다. 울트라코드 칸이 workflows 를 켜는지도 마찬가지.