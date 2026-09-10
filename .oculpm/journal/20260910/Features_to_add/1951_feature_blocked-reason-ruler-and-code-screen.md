---
schema_version: 1
type: feature
slug: "blocked-reason-ruler-and-code-screen"
status: done
difficulty: medium
created_at: "2026-09-10T19:51:30+09:00"
session_id: "20260910-002"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "55cc0fcc-d3a8-4c54-a4d1-ef78c5bd3ef6"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/__tests__/blocked.test.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/features/code/CodeDebugPanel.tsx"
    op: update
  - path: "src/features/code/CodeReferences.tsx"
    op: update
  - path: "src/features/code/CodeSearchPanel.tsx"
    op: update
  - path: "src/features/code/CodeScreenV2.tsx"
    op: update
  - path: "src/features/code/inlineEdit/InlineEditWidget.tsx"
    op: update
related: []
tags:
  - "a11y"
  - "design-consistency"
  - "blocked"
  - "code"
  - "mcp-tool"
---
[x] 자를 고쳤더니 부채가 116 이 아니라 78 이었다

## 추가 기능

`{#fix-disabled-reason}` 3차. 이번엔 자리를 고치기 전에 **자**를 봤다.

### 자가 세던 것

래칫 스캐너는 "진행 중" 을 낱말 아홉 개(busy·loading·saving·pending·running·
sending·submitting·inflight·working)로만 알았다. 그래서:

- 같은 뜻의 **다른 낱말** — `installing`·`starting`·`deleting`·`renaming`·
  `verifying`·`coercing`·`checking`·`scanning`·`compacting`·`rebuilding`·
  `reindexing`·`recording`… 전부 부채로 셌다.
- **표현 형태** — `busy != null`(5곳) · `updater.kind === "checking"` ·
  `ledger.scanning` 처럼 낱말이 연산자·멤버 뒤에 숨은 것도 못 알아봤다.
- **프리미티브 통과** — `disabled={disabled}` · `item.disabled` 는 호출자의
  값을 나르는 자리라 **이유를 알 수 없다**. 고칠 수 없는 항목이라 목록에
  남아 있어도 아무도 못 갚는다 (호출자 쪽은 어차피 따로 세어진다).

부채가 아닌 것을 부채로 세면 숫자를 갚아도 화면은 안 좋아진다. 그래서 세는
규칙을 셋으로 나눴다: **진행 중**(안 셈) · **통과**(안 셈) · **나머지**(= 조건이
안 맞아 막혔고, 무엇을 고쳐야 하는지 사용자가 알아야 풀린다).

**116 → 78.** 38 은 처음부터 부채가 아니었다.

자를 바꿨으니 자도 검사한다 — 프로브 8개가 `busy != null`·`ledger.scanning`·
`updater.kind === "installing"`·`item.disabled` 를 안 세고, `!draft.trim()`·
`projectId == null`·`!stopped`·`state !== "ready"` 는 세는지 본다.

## 동작 흐름

갚은 것은 코드 화면 9곳 (78 → 69):

- **디버그 컨트롤 5개** — `CtlButton` 이 `disabled: boolean` 대신
  `why: string | null` 을 받는다. 계속·한 줄 실행·안으로·밖으로는 "실행이 멈춰
  있을 때만 쓸 수 있어요", 「중지」는 "지금 도는 디버그 세션이 없어요".
- **참조 목록** — 프로젝트 밖 파일의 히트는 "프로젝트 밖 파일이라 열 수 없어요".
- **모두 바꾸기** — "바꿀 대상이 없어요 — 먼저 검색해 보세요".
- **⌘K 위젯의 「고치기」** — "무엇을 고칠지 먼저 적어 주세요".
- **툴바 저장** — "저장할 변경이 없어요". 툴팁이 이유와 동작 설명을 두고 다투는
  자리라 `blocked(reason, label)` 이 골라 준다.

## 못 간 자리

실행 대화상자의 「시작」은 `CodeScreenV2.tsx` 가 한계의 두 배(1,492줄)라 **크기
래칫이 막았다**. 이유 한 줄을 넣으려면 그 파일을 먼저 쪼개야 한다 — 부채가 부채를
막는 자리이므로 여기 적어 둔다.

곁가지 하나: 저장소에 prettier 설정이 없어서 `npx prettier --write` 를 부르면
기본값(80칸)으로 파일 전체를 다시 접는다 — 이 저장소는 100칸으로 쓰여 있어
CodePane 이 1,595 → 1,839줄이 됐다. 되돌리고 손으로 고쳤다. **프런트 파일에
prettier 를 통째로 돌리지 말 것.**

## 검증

typecheck · test(200파일 2,599) · lint 6종 · build 전부 exit 0. 래칫은 69로
내려 적었다.