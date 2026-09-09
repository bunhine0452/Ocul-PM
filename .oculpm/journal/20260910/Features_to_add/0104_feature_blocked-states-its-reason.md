---
schema_version: 1
type: feature
slug: "blocked-states-its-reason"
status: done
difficulty: medium
created_at: "2026-09-10T01:04:49+09:00"
session_id: "20260910-001"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "7f46e6a3-e2a2-4e31-9d04-a1da677c1b6a"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/lib/blocked.ts"
    op: create
  - path: "src/__tests__/blocked.test.ts"
    op: create
  - path: "src/features/settings/automation/AutomationEditor.tsx"
    op: update
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags:
  - "a11y"
  - "design"
  - "i18n"
  - "mcp-tool"
---
[x] 회색 버튼이 이유를 말하게 — 감사의 처방 둘은 사용자에게 도달하지 않는 것이었다

## 추가 기능

`{#fix-disabled-reason}` — 이 라운드에서 유일하게 `blocked` 였던 항목. 사용자가 2026-09-10 에 방안 ⓑ(aria-disabled + 포커스 유지)를 골랐다.

## 처방이 틀렸던 이유

감사는 "비활성 버튼에 `title`·`aria-describedby` 를 붙여라" 였다. **둘 다 사용자에게 도달하지 않는다**:

- `disabled` 요소는 마우스 이벤트를 받지 않는다 → `title` 툴팁이 뜨지 않는다.
- `disabled` 요소는 포커스를 잡지 않는다 → `aria-describedby` 가 읽히지 않는다.

붙여도 회색 버튼 앞에서 이유를 물을 방법이 없는 상태 그대로다. 감사가 "이미 있는 16곳" 이라 센 것도 전부 아이콘 버튼의 **이름**(이름 바꾸기·삭제·위로)이지 막힌 이유가 아니었다 — 이유를 말하는 곳은 처음부터 0 이었다.

## 동작 흐름

`aria-disabled` 는 요소를 **살려 둔 채** 보조기술에 "지금은 못 누른다" 를 알린다. 포커스가 남으므로 툴팁도 뜨고 설명도 읽힌다. 대신 브라우저가 클릭을 막아 주지 않으니 그 일은 `lib/blocked.ts` 가 한다.

```tsx
<button {...blocked(problem ? t(problem) : null)} disabled={busy}>
```

**둘을 가르는 것은 "사용자가 물을 것이 있는가"** 다. 이 규칙을 정의 자리에 적었다:

- `disabled` — 진행 중이라 잠깐 못 누른다(busy·saving·loading). 스스로 설명되고 곧 풀린다.
- `blocked(reason)` — 조건이 안 맞아 못 누른다. 사용자가 **무엇을 고쳐야 풀리는지** 알아야 한다.

클릭은 `onClickCapture` 에서 막는다. 버튼 자신의 `onClick` 뿐 아니라 조상의 위임 핸들러(목록 행 클릭 등)까지 멈춰야, 눌리지 않는 버튼을 눌렀을 때 엉뚱한 것이 열리지 않는다. submit 버튼이면 `preventDefault` 가 폼 제출도 막는다.

**겉모습은 그대로다.** CSS 의 `:disabled` 58곳을 `:is(:disabled, [aria-disabled="true"])` 로 바꿔 둘을 함께 받는다 — `:is()` 는 인자 중 최고 특이도를 취하는데 두 선택자가 같은 (0,1,0) 이라 특이도가 안 변한다.

## 툴팁을 헬퍼가 가져간 이유 (설계 중 잡힌 것)

처음엔 호출부가 `title` 을 그대로 두고 `{...blocked()}` 를 얹게 했다. `TodayScreenV2` 에서 **TS2783** 이 났다 — "title 이 두 번 지정돼 덮어쓴다". 타입 검사가 설계 결함을 짚은 것이다: 막힌 이유와 동작 설명은 같은 자리를 두고 다투는 다른 문장인데, 두 자리에 두면 둘 중 하나가 조용히 덮인다.

`blocked(reason, title)` 로 한 자리에서 고르게 바꿨다 — "막혔으면 이유, 아니면 설명" 이 규칙이 됐다.

## 적용

- **`AutomationEditor`** — `problem` 이라는 이유 문자열을 손에 들고도 안 붙이던 자리. 다만 이 화면은 이미 이유를 버튼 곁에 **보이는 문장**으로 띄우고 있었다(그게 가장 확실히 도달하는 방법이고, 이유가 하나뿐인 폼에서는 그쪽이 정답이다). 헬퍼는 문장을 놓을 자리가 없는 곳을 위한 것이라고 정의 자리에 적어 뒀다.
- **`TodayScreenV2` 스탠드업 버튼** — `title` 이 **동작 설명**만 하고 있었다. 못 누르는 상태에서 "무엇을 하는 버튼인지" 만 말하고 왜 못 누르는지는 말하지 않던, 이 항목의 전형이다. 이유 둘(`.oculpm` 미준비 / 기록된 작업 없음)을 ko·en 에 넣었다.

## 남은 것 — 래칫으로 붙잡았다

실측은 35곳이 아니라 **131곳**이다(busy 전용 제외). 둘을 옮겨 129 가 됐고, 그 수를 래칫으로 동결했다. 이월을 일지에만 적으면 유실되므로 코드가 세게 했다.

## 검증

계약 테스트 5개 — 이유 없으면 비활성 신호를 안 만든다 · 툴팁만 있으면 툴팁만 · 막히면 이유가 툴팁을 이긴다 · **`disabled` 를 안 내보낸다**(그걸 쓰면 이유가 다시 도달하지 않는다) · capture 단계에서 막는다. 래칫은 128 로 한 칸 내려 실패시키고 되돌려 129 가 정확함을 확인했다.

4게이트 각각 exit 0: typecheck · lint(경고 9, 기준선 — 새 테스트 파일은 한글 제목이라 `check-no-hardcoded-korean.mjs` 허용목록에 알파벳 자리로 넣었다) · test 197파일/2576 · build.