---
schema_version: 1
type: feature
slug: "trace-result-peek"
status: done
difficulty: medium
created_at: "2026-08-16T02:10:44+09:00"
session_id: "mcp-20260816-021044"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/chat/tracePreview.ts"
    op: create
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/styles/agent.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/trace_preview.test.ts"
    op: create
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags:
  - "acp"
  - "claude-code"
  - "ui"
  - "ux"
  - "mcp-tool"
---
[x] 도구 카드에 결과 미리보기 — "무엇을 시켰다" 스무 줄에서 "무엇이 나왔다"로

## 추가 기능

Claude Code 대화의 도구 호출이 끝나면 한 줄로 접혀서, 도구를 스무 번 쓴 턴이
**똑같이 생긴 스무 줄**이 됐다 — 무엇이 나왔는지는 하나씩 펼쳐야 알 수 있었고,
그래서 아무도 안 펼쳤다 (사용자 레퍼런스 비교로 확인). 반대로 전문을 다 펼치면
수백 줄짜리 출력이 답변을 화면 밖으로 밀어낸다.

그 사이를 골랐다: **접힌 카드가 결과의 머리를 항상 보여 준다.**

## 동작 흐름

- `tracePreview.ts` — 머리 N 줄·800자 상한으로 떼어 오는 순수 함수. CSS
  max-height 로 자르지 않는 이유: 잘린 뒤에도 DOM 에 만 줄이 남아 스트리밍 중
  레이아웃이 무겁고, "몇 줄 더 있는지"를 화면이 말해 줄 수 없다. 글자 상한에
  걸리면 **줄 경계**에서 자른다(반 줄 금지). minified 번들·base64 같은 "한 줄
  10만 자" 출력 방어 포함.
- 미리보기는 IN 두 줄 + OUT 네 줄, 펼친 본문과 같은 짜임. **IN 은 명령을 실행한
  단계(`execute`)에서만** — 읽기·편집은 경로가 이미 줄에 있어 중복이다.
- 접힌 줄 오른쪽에 `+N줄` — 펼칠 가치를 판단할 유일한 근거.
- 상태 글자는 **말할 것이 있을 때만**(진행 중·실패). "완료" 스무 번은 정보가
  아니라 벽지다. 보조기기에는 `.trace-sr` 로 늘 남는다.
- 실패한 단계는 왼쪽 빨간 막대 + 페이드 해제 — 실패 사유가 흐려지면 안 된다.
- 미리보기 클릭 = 펼치기. 단 글자를 끌어 고른 뒤의 클릭은 무시(복사 보호).
- 화살표를 오른쪽 끝 열로 정렬 — 제목 길이 따라 들쭉날쭉하던 것.
- `TraceRow` memo — 스트리밍 중 재렌더 격리.

## 검증

typecheck / lint / test(77파일 901개, 신규 peekLines 7개) / build 전부 exit 0.
실제 스타일시트(tokens+index.css)를 물린 정적 하네스를 헤드리스 Chrome 으로
라이트·다크 렌더해 눈으로 확인 — 페이드·빨간 실패 막대·+N줄·진행 중 펄스 모두
의도대로. 실제 앱 확인은 남아 있다.