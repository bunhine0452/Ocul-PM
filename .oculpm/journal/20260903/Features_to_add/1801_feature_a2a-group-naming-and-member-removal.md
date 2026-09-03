---
schema_version: 1
type: feature
slug: "a2a-group-naming-and-member-removal"
status: done
difficulty: low
created_at: "2026-09-03T18:01:15+09:00"
session_id: "20260903-009"
agent:
  id: "claude-code"
  version: "Opus 5 (1M)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/today/A2aCard.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/__tests__/a2a_card.test.tsx"
    op: update
related:
  - ref: "20260903/Features_to_add/1739_feature_a2a-group-enforcement.md"
    kind: "followup"
tags:
  - "a2a"
  - "ui"
  - "mcp-tool"
---
[x] 팀에 이름을 붙이고 멤버를 하나씩 뺀다

## 추가 기능

세션 묶기의 남은 두 항목.

- **이름 붙이기** — 묶을 때 이름을 적을 수 있다. 비워 두면 순번이 붙은 기본값
  (「팀 N」)이 간다. placeholder 가 곧 그 기본값이라 따로 안내 문구가 없다.
- **멤버 빼기** — 그룹 안 각 줄에 「빼기」. **셋 이상일 때만** 보인다 — 둘에서
  하나를 빼는 것은 해체이고, 그 자리에는 이미 「풀기」가 있다(백엔드도 둘 미만은
  거부한다). 버튼 둘이 같은 일을 하면 사용자가 무엇이 다른지 고민하게 된다.

## 걸린 함정

플래너가 0% 로 보였다 — **작업은 세 커밋으로 들어갔는데 내가 `plan_update` 를
16항목 중 4개만 불렀다.** 코드는 갔는데 계획이 어제에 멈춘, 이 앱이 막으려는
바로 그 상태를 내가 만들었다. 화면이 정확했고 내 기록이 틀렸다. 전 항목을 실제
상태로 맞추면서 두 개는 정직하게 `~`(이 일지가 그것을 닫는다), 하나는
`-`(폐기)로 적었다 — `#enforce-app` 은 검사할 자리가 아예 없다: 앱 쪽 쓰기는
수락·거절뿐이고 그건 받은 쪽 당사자의 결정이라 그룹을 묻지 않는다(D7).

테스트 픽스처도 한 번 어긋났다. 병렬 세션이 참여자를 `AgentCard` 에서
`{card, liveness}` 자리로 바꿔 둬서, 옛 모양으로 쓴 새 테스트가 "체크박스를 못
찾음"으로 떨어졌다 — 카드가 아예 안 그려지고 있었다.

## 검증

내 변경 범위: `pnpm vitest` a2a_card 10/10 · today_v2 · a11y 통과(24) ·
`tsc --noEmit` 내 파일 오류 0 · `check-design-discipline` clean.

**전체 스위트는 지금 붉다 — 전부 병렬 세션의 진행 중 작업이다**: A2A 도구
정의를 `mcp/a2a_tools.rs` 로 옮기는 중이라 `tools.rs` 를 읽는
`plugin_docs_sync` 가 깨졌고, 새 테스트 파일이 i18n 허용목록에 아직 없으며,
`ctx.evidence.*` 키가 사전에 없다. 그쪽이 착지하면 함께 초록이 된다.