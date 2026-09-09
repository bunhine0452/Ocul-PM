---
schema_version: 1
type: refactor
slug: "panel-width-token"
status: done
difficulty: low
created_at: "2026-09-10T01:50:45+09:00"
session_id: "20260910-001"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "7f46e6a3-e2a2-4e31-9d04-a1da677c1b6a"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/styles/tokens.css"
    op: update
  - path: "src/features/code/code.css"
    op: update
  - path: "src/features/discussion/discussion.css"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/__tests__/design_ratchets.test.ts"
    op: update
related: []
tags:
  - "design"
  - "tokens"
  - "layout"
  - "mcp-tool"
---
[x] 목차 기둥이 화면마다 미세하게 움직였다 — 그리고 내가 앞서 적은 정정이 틀렸다

## 동기

`{#layout-widths}` 의 남은 절반 — 패널 폭. 앞 커밋에서 읽기 열만 하고 열어 뒀던 항목이다.

## 내 앞선 정정이 틀렸다

이 세션 앞부분에서 나는 "패널은 264·284·288·320 이 아니라 244·264·268·288 이고, **드래그는 플래너 하나가 아니라 코드까지 둘**" 이라고 플랜 로그에 적었다. 두 번째가 틀렸다.

- `.pln-hover`(268)를 패널로 셌는데 그건 **호버 카드**다. 목록 열이 아니다.
- `code-panel-resizer` 를 사이드바 드래그로 봤는데, 열어 보니 `aria-orientation="horizontal"` 에 `panelHeight` 를 조절한다 — 아래쪽 디버그/참조 패널의 **높이**다. 사이드바 폭이 아니다.

즉 **감사가 옳았다**: 끌어서 조절되는 건 플래너 하나뿐이다. 항목 숫자를 의심하라는 규율이 이번엔 나를 향했다 — 파일을 열어 보지 않고 이름만으로 센 대가다.

정확한 실측: 좌측 목록 열은 **셋**이고 264(코드 파일트리) · 284(변경 파일목록) · 288(논의 목록)이다. 항목의 "320" 은 없고, 네 번째로 잡힌 `.acp-panel`(244)은 성격이 다르다.

## 변경 요약

세 열은 같은 일을 한다 — 경로나 제목을 담고, 넘치면 줄임표로 양보하는 목차 기둥. 폭만 24px 안에서 갈려 있어서 화면을 옮겨 다니면 기둥이 미세하게 움직였다.

`--panel-w: 284px` 하나로 모았다. 284 를 고른 이유는 셋의 **중앙값이자 이미 존재하던 값**이라 임의로 지어낸 숫자가 아니기 때문이다. 이동은 코드 +20 · 변경 0 · 논의 −4.

**`.acp-panel`(244)은 넣지 않았다.** 왼쪽 목록 열이 아니라 오른쪽에서 밀려 나오는 세션 패널이고(`border-left` + 폭 전이로 열고 닫는다) 본문을 덮는 물건이라 규격이 다르다. 사유를 토큰 정의 자리에 적었다.

## 안 한 것

"드래그 규약 통일"(논의·ACP 패널도 끌리게)은 **기능 추가**다 — 없던 상호작용과 그 폭을 저장할 자리를 만드는 일이라 일관성 라운드 밖으로 본다.

## 검증

계약 하나 — 세 열이 한 토큰을 쓴다. 4게이트 각각 exit 0: typecheck · lint(경고 9, 기준선) · test 198파일/2585 · build.

**눈으로 볼 것:** 코드 화면 파일트리가 20px 넓어지고 논의 목록이 4px 좁아진다. 세 화면을 오가며 기둥이 같은 자리에 서는지.