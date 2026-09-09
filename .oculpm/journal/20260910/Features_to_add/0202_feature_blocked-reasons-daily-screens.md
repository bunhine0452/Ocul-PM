---
schema_version: 1
type: feature
slug: "blocked-reasons-daily-screens"
status: done
difficulty: medium
created_at: "2026-09-10T02:02:05+09:00"
session_id: "20260910-001"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "7f46e6a3-e2a2-4e31-9d04-a1da677c1b6a"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/planner/PlannerScreenV2.tsx"
    op: update
  - path: "src/features/diff/DiffScreenV2.tsx"
    op: update
  - path: "src/features/oculpm/JournalScreenV2.tsx"
    op: update
  - path: "src/features/oculpm/EntryDetailView.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/blocked.test.ts"
    op: update
  - path: "src/__tests__/journal_v2.test.tsx"
    op: update
related: []
tags:
  - "a11y"
  - "i18n"
  - "mcp-tool"
---
[x] 이유를 이미 계산해 놓고 `title` 에 넣어 둔 자리가 셋 더 있었다

## 추가 기능

`{#fix-disabled-reason}` 2차 — 매일 보는 화면(플래너·변경·일지)의 비활성 버튼에 이유를 붙였다. 메커니즘(`lib/blocked.ts`)과 방식(aria-disabled + 포커스 유지)은 1차에서 정해졌다.

## 이 항목의 논지가 코드에 세 번 더 적혀 있었다

1차에서는 `AutomationEditor` 하나가 "이유 문자열을 손에 들고도 안 붙인다" 는 예였다. 이번에 옮긴 12곳 중 **셋은 이유를 이미 계산해서 `title` 에 넣고 있었다**:

```tsx
disabled={selectedId == null || busy || locked}
title={locked ? t("plan.aiLockedTitle") : t("plan.aiTitle")}
```

`plan.aiLockedTitle` 은 "완료·잠금된 계획은 갱신할 수 없어요" 다 — 정확히 필요한 문장이 이미 쓰여 있고, `disabled` 때문에 **한 번도 화면에 뜬 적이 없다**. `plan.addLockedTitle`(항목 추가), `journal.newDisabled`("ocul-pm 활성화 후 사용 가능")도 같았다.

문안을 새로 쓴 게 아니라 **도달하게** 만든 것이다. 세 문장은 그대로 쓰고 `blocked()` 로 옮겼다.

## 옮긴 12곳

- **플래너** — AI 갱신 · 항목 추가(둘 다 잠금/미선택 두 이유를 구분) · 계획 만들기 · 항목 추가 제출(제목 없음)
- **변경** — 규칙 승격 · 모두 검토 완료(변경 없음/이미 다 검토) · 검토 완료(파일 미선택/이미 검토) · 편집기로 열기
- **일지** — 새 일지 두 자리
- **일지 상세** — 패치 없는 파일 행 · 첫/마지막 파일 이동

새 문안 10개를 ko·en 에 넣었다. 전부 해요체 — 같은 날 `{#copy-voice}` 가 정한 화자다.

`busy`·`opening`·`verifying`·`coercing`·`backfilling` 은 그대로 `disabled` 로 뒀다. 스스로 설명되고 곧 풀리므로 사용자가 물을 것이 없다 — `blocked()` 정의 자리에 적힌 기준 그대로다.

## 테스트가 옛 계약을 붙들고 있었다

`journal_v2.test.tsx` 둘이 깨졌다: `expect(row).toBeDisabled()` · `expect(getByLabelText("이전 파일")).toBeDisabled()`.

**테스트의 의도("선택 불가")는 그대로 참이다** — 바뀐 건 그걸 이루는 방법이다. 그래서 속성을 바꿔 적는 데서 멈추지 않고 **행동을 단언하도록** 고쳤다:

```tsx
const before = container.querySelector('[aria-current="true"]')?.textContent;
fireEvent.click(rows[0]);
expect(container.querySelector('[aria-current="true"]')?.textContent).toBe(before);
```

`aria-disabled="true"` 와 이유 문자열도 함께 단언한다. 예전 테스트는 "막혔다" 만 봤고 "왜인지 말한다" 는 안 봤다 — 그래서 이 항목의 결함이 테스트를 통과한 채로 있었다.

## 남은 것

래칫 129 → **116**. 아직 116곳이 이유를 말하지 않는다(설정·코드·스킬·ACP 등). 자리마다 한국어 문안을 새로 써야 해서 점진적으로 간다.

## 검증

래칫을 116 으로 정확히 맞추고 4게이트 각각 exit 0 — typecheck · lint(경고 9, 기준선) · test 198파일/2587 · build.

**눈으로 볼 것:** 플래너에서 계획을 안 고른 채, 그리고 완료·잠금된 계획을 고른 채 툴바 버튼에 마우스를 올려 보세요 — 이유가 떠야 합니다.