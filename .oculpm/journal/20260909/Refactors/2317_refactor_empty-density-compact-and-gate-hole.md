---
schema_version: 1
type: refactor
slug: "empty-density-compact-and-gate-hole"
status: done
difficulty: medium
created_at: "2026-09-09T23:17:36+09:00"
session_id: "20260909-001"
agent:
  id: "claude-code"
  session: "7f46e6a3-e2a2-4e31-9d04-a1da677c1b6a"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/components/EmptyState.tsx"
    op: update
  - path: "src/components/LoadingState.tsx"
    op: update
  - path: "src/styles/empty.css"
    op: update
  - path: "scripts/check-design-discipline.mjs"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
  - path: "src/__tests__/designFs.ts"
    op: create
  - path: "src/__tests__/design_ratchets.test.ts"
    op: create
  - path: "src/__tests__/design_tokens.test.ts"
    op: update
  - path: "src/features/today/TodayTerminal.tsx"
    op: update
  - path: "src/features/today/AgentBreakdown.tsx"
    op: update
  - path: "src/features/diff/BinaryFileView.tsx"
    op: update
  - path: "src/features/diff/DiffBody.tsx"
    op: update
  - path: "src/features/oculpm/EntryDetailView.tsx"
    op: update
related: []
tags:
  - "design"
  - "density"
  - "gate"
  - "ratchet"
  - "test-split"
  - "mcp-tool"
---
[x] 기본값이 지배적 용법에 안 맞으면 호출부가 매번 되돌린다 — 그리고 내 게이트에 구멍이 있었다

## 동기

`{#layout-empty-density}` 의 숫자는 정확했다 — `EmptyState` 호출부 50곳 중 **20곳**이 인라인 padding 으로 `.es--plain` 의 60px 을 덮는다. 덮는 값이 여덟 가지였다: `16` · `"16px"` · `"24px 8px"` · `"24px 16px"` · `"18px 16px"` · `"16px 20px"` · `"8px 0"` · `"6px 2px"`.

읽는 방식이 중요하다. 이건 호출부가 제멋대로인 게 아니라 **기본값이 지배적 용법에 안 맞는다는 신호**다. 20곳이 전부 60px 을 *아래로* 덮고 있었다 — 60px 은 화면 전체가 빈 자리의 치수인데, 실제 용법의 다수는 카드·패널 안의 좁은 슬롯이다. 기본값이 틀리면 호출부가 매번 되돌리고, 되돌리는 값은 자리마다 갈린다.

## 변경 요약

**`compact` 한 단(16px = `--space-6`)을 더했다.** 20곳의 최빈값이 정확히 16px 이고(10곳) 그게 램프에 딱 맞는 값이다. 그 10곳만 옮겼다 — 계산값이 같으니 **시각 변화 0**이다. 남은 10곳(24/8 · 24/16 · 18/16 · 16/20 · 8/0 · 6/2)은 램프 밖이라 접으면 2~8px 씩 움직인다: `{#ramp-space}` 가 램프 밖 480곳에 한 것과 같은 판단으로, 인라인에 남기고 **래칫 10으로 동결**했다.

`LoadingState` 도 같은 축을 갖는다(`plain` | `compact`). 로딩과 빈 상태는 한 자리에서 번갈아 뜨므로 둘의 밀도가 갈리면 전환할 때 자리가 튄다. `rich` 는 주지 않았다 — 아이콘·제목·행동이 있는 로딩은 이 앱에 없다.

## 어제 세운 게이트에 구멍이 있었다

변환하다가 `EntryDetailView.tsx:728` 에서 **아홉 번째 loading-as-empty** 를 만났다. 바로 앞 커밋에서 여덟 곳을 고치고 규칙 16 을 세웠는데, 그 규칙이 이걸 못 잡았다 — 줄 단위 정규식이라 여는 태그와 문안이 다른 줄이면 안 걸린다:

```tsx
<EmptyState align="start" style={{ padding: 16 }}>
  {t("common.loading")}
</EmptyState>
```

게이트를 세운 바로 그 라운드에서 아홉 번째가 규칙을 빠져나간 셈이다. 규칙 13(전이)·10(미정의 var)이 이미 같은 이유로 **별도 패스**인데, 16 만 줄 단위로 넣은 것이 잘못이었다. `checkLoadingAsEmpty` 로 옮겨 여는 태그부터 첫 문안까지를 통째로 뜬다. probe 로 한 줄·여러 줄 **둘 다** 발화하는지, 그리고 로딩이 아닌 `EmptyState` 는 안 걸리는지 확인했다(2 violations → clean).

## 크기 래칫이 쪼갤 자리를 물었다

`design_tokens.test.ts` 가 810줄로 한계(800)를 넘었다 — 이 라운드가 609줄에서 불려 온 것이다. 주석을 줄여 통과시키는 대신 쪼갰고, **쪼갠 자리는 크기가 아니라 뜻이 정했다**: 계약(참이어야 하는 것)과 래칫(나빠지지 않아야 하는 것)은 깨졌을 때 고치는 방법이 다르다 — 계약이 깨지면 코드를 고치고, 래칫이 걸리면 숫자를 내려 적거나 코드를 고친다. 한 파일에 섞여 있으면 "이 expect 는 계약인가 잔액인가" 를 매번 다시 읽는다. `design_ratchets.test.ts`(밀도 10 · 여백 480) + 공용 `designFs.ts` 로 갈랐다. 733 + 89 + 25.

## 검증

`pnpm typecheck` · `pnpm lint`(6게이트, 경고 9 = 기준선) · `pnpm test` · `pnpm build` 각각 exit 0 직접 확인. 래칫은 **음성 테스트**했다 — 상한을 9로 내리니 정확히 `인라인 밀도 10곳` 과 위반 파일 목록을 뱉고 실패했고, 10으로 되돌리니 통과했다. 옮긴 10곳은 `padding:16` → `padding: var(--space-6)` 로 계산값이 같아 시각 변화가 없다. **아홉 번째 로딩 자리에는 없던 스피너가 생기는 시각 변화가 있다** — 실기기 확인 대기 목록에 함께 올린다.