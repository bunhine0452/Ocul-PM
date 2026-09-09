---
schema_version: 1
type: refactor
slug: "read-width-tokens-and-page-dedup"
status: done
difficulty: low
created_at: "2026-09-10T00:33:38+09:00"
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
  - path: "src/styles/screens.css"
    op: update
  - path: "src/features/skills/skills.css"
    op: update
  - path: "src/features/oculpm/JournalScreenV2.tsx"
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
[x] 읽기 열 2단 — 다섯이 아니라 일곱이었고, 일지가 `.page` 를 손으로 베껴 두고 있었다

## 동기

`{#layout-widths}` 의 앞 절반(읽기 열 토큰화)과, 항목이 곁다리로 적어 둔 `.journal-wrap` 중복.

## 실측이 항목을 두 번 뒤집었다

**읽기 열은 5종이 아니라 7종이었다.** 항목은 「AI 760 · 일지 820 · 논의 860 · 플래너 880 · 검색 880」이라 했는데, 빠진 넷이 있었다 — `.sk-hooks`(720) · `.disc-doc-prose`(780) · `.cfg-main`(780) · `.sk-article`(820). 그리고 항목이 "일지 820" 이라 부른 `.journal-col` 은 가운데 정렬이 아닌 **목록** 열이라, 실제 820 짜리 산문 열은 `.sk-article` 이다.

**패널은 264·284·288·320 이 아니라 244·264·268·288 이었고, 끌리는 건 하나가 아니라 둘이다.** `.acp-panel` 244 · `.code-sidebar` 264 · `.pln-hover` 268 · `.disc-list` 288. 드래그는 플래너(`PlanRailDock`)뿐이라 했는데 코드 화면(`CodeScreenV2` 의 `onResizerPointerDown`)도 끌린다. 이 절반은 손대지 않았다 — 아래 "남은 것".

## 변경 요약

두 단을 가르는 것은 폭이 아니라 **무엇을 읽는가**다:

- `--read-narrow: 760px` — 한 줄씩 따라 읽는 산문. `--fs-4` 기준 한 줄 90~100자로 이미 편안함의 위끝이다.
- `--read-wide: 880px` — 표제·항목이 시선을 잡아 주는 구조 있는 문서·목록. 880 을 산문에 주면 눈이 다음 줄 머리를 잃는다.

**값이 정확히 맞는 다섯 자리만 옮겼다 — 시각 변화 0.** `.ai-thread-inner` · `.composer` · `.sk-shop` → narrow, `.pln-doc` · `.search-results` → wide. `.composer` 는 스레드와 같은 열이어야 하는 자리라(1px 어긋나면 말풍선과 입력이 다른 문서처럼 보인다) 사유를 코드에 적었다.

남은 여섯(720 · 780 · 780 · 820 · 820 · 860)은 접으면 20~120px 씩 움직인다. 눈으로 보고 정할 일이라 래칫으로 동결했다 — `{#ramp-space}` 와 같은 형태의 이월이다.

**`.journal-wrap` 이 `.page` 를 베끼고 있었다.** `padding: var(--space-8) 28px 60px; max-width: 1180px; margin: 0 auto; width: 100%` 네 줄이 글자까지 같았다. 값이 같아 보이는 동안은 아무도 모르지만 `.page` 를 고치는 순간 일지만 안 따라온다. `className="page journal-wrap"` 으로 합치고 flex 세 줄만 남겼다 — `.page` 는 자손·수정자 규칙이 하나도 없어 픽셀 단위로 동일하다.

진입 애니메이션은 옮기지 않았다. `fade-in` 은 `.journal-col` 에 붙어 있는데, 루트로 올리면 **날짜 레일까지 함께 떠오른다** — 지금은 안 떠오른다. 정의 자리의 규약(`.page` 루트에 붙인다)과 어긋나 보이지만 그건 시각 변화라 눈으로 볼 일이다.

## 검증

래칫도 음성 테스트했다 — 940px 짜리 읽기 열을 심으니 8곳으로 늘며 이름과 값을 전부 뱉었고, 되돌리니 통과했다. 처음 상한을 6으로 적었을 때 래칫이 8을 세어 `.pm-sheet`(1080)·`.ctx-page`(1040)를 내가 빠뜨린 걸 잡아냈다 — 값 목록으로 예외를 적는 대신 "읽기 열은 700~1000px" 이라는 **경계**로 고쳤다.

4게이트 각각 exit 0: typecheck · lint(경고 9, 기준선) · test 196파일/2570(2568 + 새 계약 2) · build.

## 남은 것 (항목은 아직 열려 있다)

패널 폭 절반은 미착수다. 네 값(244·264·268·288)에 최빈값이 없고, 둘은 드래그 기본값이라 접으면 레이아웃이 움직인다. "드래그 규약 통일"(논의 목록·ACP 패널도 끌리게)은 일관성 수정이 아니라 **기능 추가**라 이 라운드의 범위 밖으로 본다.