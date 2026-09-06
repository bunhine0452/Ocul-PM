---
schema_version: 1
type: feature
slug: "activity-meaning-layer"
status: done
difficulty: superhigh
created_at: "2026-09-06T13:31:05+09:00"
session_id: "20260906-002"
agent:
  id: "claude-code"
  session: "b2e235a0-7801-4870-9780-7b970cc85e65"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/chat/activity/activityTypes.ts"
    op: create
  - path: "src/features/chat/activity/classify.ts"
    op: create
  - path: "src/features/chat/activity/group.ts"
    op: create
  - path: "src/features/chat/activity/RawRail.tsx"
    op: create
  - path: "src/features/chat/activity/ActivityLine.tsx"
    op: create
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/features/chat/acpBusyBus.ts"
    op: update
  - path: "src/features/sessions/sessionActivity.ts"
    op: create
  - path: "src/features/sessions/SessionCard.tsx"
    op: update
related: []
tags:
  - "v3-surface"
  - "chat"
  - "acp"
  - "activity"
  - "sessions"
  - "mcp-tool"
---
[x] 도구 호출을 우리 어휘로 — 「일지를 썼다」가 화면에 뜬다

기둥 2(`v3-surface`)의 가장 큰 Phase — `{#raw-rail}` `{#activity-types}` `{#activity-classify}` `{#activity-presenters}` `{#activity-group}` `{#acp-split}` `{#working-source}` `{#activity-vocab-reuse}`.

## 추가 기능

ACP 대화 화면이 에이전트가 한 일을 **도구 호출의 날것**으로 그려서, 우리 제품의 값어치가 화면에서 사라지고 있었다. `session-shim-cli` 로 PATH 에 `oculpm` 을 심어 놨는데 **화면이 그게 도는 걸 몰랐다** — `oculpm journal write` 가 「명령 실행 + 터미널 아이콘」으로 그려졌다. 「일지를 썼다」가 화면 어휘에 없었다.

## 동작 흐름

**도망갈 데를 먼저 만들었다.** `RawRail` 을 프레젠터보다 **먼저** 넣었다 — 모든 활동의 펼친 본문 맨 아래에 접힌 `<details>` 로 원본 이벤트가 늘 있다(8KB 상한·순환참조 안전·못 찍으면 안 그린다). 분류학은 자라고 추상화는 틀리므로, 틀렸을 때 볼 수 있는 자리가 먼저 있어야 한다.

**어휘 15낱말은 지어내지 않고 실제 표면에서 뽑았다** — ACP `ToolKind` 8 + `todo`/`permission`/`error` + `other` + 우리 셋(`oculpm-journal`·`oculpm-plan`·`oculpm-a2a`). `write` 를 뺀 이유는 **프로토콜에 없어서**다(Claude 의 `Write` 도 `edit` 로 온다) — 채울 수 없는 낱말은 어휘가 아니다.

**틀리면 `shell` 로 흘린다.** `parseOculpmCliCommand()` 가 셸 문자열에서 우리 CLI 를 알아보는데, 「잘못된 일지를 썼습니다」는 **원장에 대한 거짓말**이므로 확신이 없으면 일반 셸로 그린다. 15개 단언으로 못 박았다 — 따옴표 안 `&&`·파이프·`$( )`·env 접두는 인정하고, `echo oculpm journal_write`·`grep`·경로 붙은 `oculpm`·한 줄에 둘·모르는 낱말은 전부 거절이다.

**개입 지점은 절대 안 접는다.** `NEVER_FOLD = ATTENTION_KINDS ∪ {error} ∪ OCULPM_KINDS`. 15낱말을 통째로 늘어놓고 묶어도 묶음 안에 그 셋이 없음을 테스트가 단언한다.

**누락은 컴파일 에러다.** `satisfies Record<ActivityKind, Presenter>` — 얼굴 15벌, 몸통 6벌(Tool·Ledger·Think·Todo·Attention·Failure). 새 낱말에 프레젠터를 빠뜨릴 수 없다.

**`AcpConversation.tsx` 2,176 → 749줄.** 13개 조각으로 나눴고 `TraceRow` 는 `ToolActivity` 몸통으로 재사용했다 — **버린 코드가 없다.** 파일 크기 래칫 부채 -1.

**「모른다」를 「돌고 있다」로 말하지 않는다.** `acpBusyBus` 에 `BusySource = typing|observer|none` 과 15초 침묵 타이머를 넣어, 세션 패널이 「실행 중 · 신호 없음」으로 그린다. 스트림이 끊긴 것과 진짜 도는 것이 이제 구별된다.

**세션 카드가 같은 낱말을 쓴다** — 「무엇을 하고 있는가」가 lease 뿐이었다. 이제 승인 대기 > 진행 태스크 > 잡은 구역 순으로 대화 화면과 같은 어휘로 말한다.

## 검증

`pnpm typecheck` · `pnpm test`(2,365 → 병합 후 2,402) · `pnpm lint`(6게이트) · `pnpm build` 전부 exit 0. **eslint 경고가 61 → 52 로 줄어 상한에 9칸 여유가 생겼다** — `v3-release {#eslint-ratchet-slack}` 이 지목한 "여유 0" 문제가 이번에 완화됐다.

자기 감사에서 회귀 둘을 잡았다: 활동 어휘를 얹으며 `present={{...}}` 인라인 객체를 memo 컴포넌트에 넘겨 **스트리밍마다 모든 줄이 다시 그려지고** 있었고, `useT()` 의 `t` 가 `send` 를 굳지 못하게 하고 있었다. 둘 다 별도 커밋으로 고쳤다.

## 남은 것

**육안 확인이 이 Phase 의 본질이다** — 접힌 묶음·원장 강조·곁가지·원본 레일의 밀도는 실제 대화로만 안다. 특히 `oculpm journal_write` 를 실제로 돌려 「일지 기록」이 뜨는지, 긴 Bash 에서 15초 문턱이 적절한지, 접힌 원본 레일을 펼쳐 JSON 이 읽히는지.

`project_init` 은 어휘에 안 넣었다 — 일지·계획·원장 어디에도 안 드는 한 번뿐인 설치 동작이라 일반 셸로 그려진다(의도적, 주석에 적힘). `AcpConversation.tsx` 749줄은 한계 안이지만 여전히 크다.

Today 에는 **「지금 무엇을 하고 있는가」 표면이 아예 없다**(`TodayMonitor.tsx:36` 의 「활동 시간」은 집계만 말한다). 새 행을 만드는 일이라 이번 범위 밖으로 뒀고, 재료는 준비돼 있다 — `activity/ActivityLine.tsx` 와 `sessions/sessionActivity.ts:seatActivity()`.