---
schema_version: 1
type: refactor
slug: "today-ring-salvage"
status: done
difficulty: medium
created_at: "2026-08-25T23:44:00+09:00"
session_id: "manual-20260825-234400"
agent:
  id: "claude-code"
  version: "Opus 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/today/TodayActivityRing.tsx"
    op: update
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
  - path: "src/__tests__/today_ring.test.tsx"
    op: update
  - path: "src/__tests__/today_v2.test.tsx"
    op: correct
  - path: ".oculpm/planner/today-ring-followup.md"
    op: create
related: []
tags: ["refactor", "frontend", "a11y", "today", "salvage"]
---

[x] 버려진 브랜치에서 Today 링 수정 6건 건져오기 — a11y·리플·표기·mock 타입

## 동기

브랜치 정리 중 `fix/today-ring-line-delta-and-audit`(29915fb, 08-15)이 미머지로
남아 있었다. 지울지 판단하려 대조했더니, main 의 `69b1cc5`(08-20)가 같은 링을
손봤지만 **9건 중 ①②만** 다시 했고 나머지는 어디에도 없었다.

## 변경 요약

**살린 것 (프런트 6건)** — main 이 `bytesAdded→linesAdded` 개명을 독립적으로
똑같이 한 덕에 hunk 문맥이 맞았다. 두 버전 차이는 +28/−56 뿐이었다.

| | 내용 |
|---|---|
| a11y | 링에 `role="img"` — `aria-label` 은 암묵 generic(`<div>`)에 **금지**라, svg 는 aria-hidden·툴팁은 마우스 전용이라 위젯 전체가 무음이었다 |
| a11y | 툴팁 `role="status"` → `aria-hidden`. 라이브 리전이라 포인터가 스칠 때마다 공지가 나갔다 |
| 리플 | `key={projectId}` — 프로젝트 전환을 "새 기록"으로 오인해 물결이 쳤다 |
| 리플 | `onAnimationEnd` 언마운트 — `animation-fill-mode: forwards` 라 끝나도 DOM 에 남았다 |
| 표기 | `toLocaleString` — 링 호버값 3종 + 스탯 카드 |
| 타입 | brief mock 에 `satisfies WorkdayBrief` |

**버린 것 (백엔드 약 530줄)** — 마이그레이션 `028_journal_line_delta.sql`,
`cache.rs +319`, `entry_diffs.rs +141`, `db.rs`, `commands/oculpm.rs`. main 이 다른
스키마로 이미 했고(브랜치=entry 단위+`diff_mtime`, main=파일 단위), 오늘 `cache.rs`
를 8파일로 쪼개 적용 자체가 불가능하다. ②(0 이 점으로)도 버렸다 — 브랜치는
`linecap="butt"`, main 은 **arc 를 아예 안 그림**. main 쪽이 단순하다.

## 대조가 잡아낸 진짜 결함

`today_v2.test.tsx` 의 brief mock 이 `bytes_added`/`bytes_removed` 를 반환하는데
DTO 는 `lines_added`/`lines_removed` 다. 타입이 안 물려 있어 **조용히 낡아 있었고**,
그 말은 Today 의 라인 증감 표시를 검증하는 테스트가 사실상 없었다는 뜻이다.
필드를 고쳐도 1,308건이 그대로 통과한 것이 그 증거다. `satisfies` 를 물려
막았고(일부러 되돌리면 typecheck 가 잡는 것을 확인), 커버리지 공백은 플래너
[#lines-display-coverage] 로 남겼다.

배열 둘(`days`·`open_plan_items`)은 픽스처가 느슨해 `as unknown as` 로 인정했다.
정작 드리프트가 났던 건 스칼라 쪽이고, 거긴 진짜로 검사된다.

## 덮지 못한 것 — 솔직히

리플의 `animationend` 언마운트는 **단위 테스트로 못 덮는다.** jsdom 은 CSS
애니메이션을 안 돌려 이벤트가 자연 발생하지 않고, 합성해 밀어 넣어도 React 19 의
`onAnimationEnd` 에 닿지 않는다 — fireEvent 기본 · `bubbles: true` · 수동
`dispatchEvent` 셋 다 **핸들러 0회 호출**을 프로브로 실측했다. 통과하는 테스트를
지어내는 대신 테스트 파일에 사유를 주석으로 박고 [#ripple-manual-verify] 로 넘겼다.

## 검증

typecheck · lint · build exit 0, vitest **1,308 → 1,311** (회귀 3건 추가:
role=img · 툴팁 비-라이브 · 천단위). 새 테스트는 파일의 기존 문체(영어)에 맞춰
i18n allowlist 를 늘리지 않았다.

## 메모

남은 것은 [today-ring-followup](../../../planner/today-ring-followup.md) Phase 2 —
특히 **변경 파일 수 43% 과대**(`useTodayBrief.ts:186` 의 Σ files_count, 백엔드에
`COUNT(DISTINCT file_path)` 필요)와 **라인 링 k 값**(main 400 vs 브랜치 실측 4000;
400 이면 매일 상한에 붙어 정보를 안 나른다). 둘 다 브랜치의 진단은 유효하나 코드는
새로 써야 한다. 이제 브랜치는 지워도 된다.
