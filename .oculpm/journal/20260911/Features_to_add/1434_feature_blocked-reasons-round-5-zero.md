---
schema_version: 1
type: feature
slug: "blocked-reasons-round-5-zero"
status: done
difficulty: low
created_at: "2026-09-11T14:34:01+09:00"
session_id: "20260911-008"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "7cc0fab5-a8c8-411e-8f19-be819da44294"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/__tests__/blocked.test.ts"
    op: update
  - path: "src/features/settings/tabs/AppearanceTab.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related:
  - ref: "20260911/Features_to_add/1153_feature_blocked-reasons-round-4.md"
    kind: "followup"
tags:
  - "a11y"
  - "blocked-reason"
  - "ratchet"
  - "design-consistency"
  - "mcp-tool"
---
[x] 비활성 이유 5차 — 래칫 10→0, 자가 "이 패턴의 자리가 아닌 요소"를 안다 · 트레이 Dock 토글에 이유

4차가 남긴 10곳을 하나씩 열어 보니 4차의 진단이 맞았다 — **9곳은 `blocked()` 가 들어갈 수 없는 자리**였고 1곳만 진짜 부채였다. 그래서 이번 라운드는 문안보다 자를 고치는 일이 컸다.

## 추가 기능

**1. 진짜 부채 1곳 — 트레이 「상주 중 Dock 아이콘 숨김」.** `disabled={!vals || r.disabled}` 가 두 뜻을 섞고 있었다: `!vals` 는 설정이 아직 안 온 것(진행 중), `r.disabled` 는 「창 닫기 = 메뉴바로 최소화」가 꺼져 있어 막힌 것(조건). 행이 `disabled: boolean` 대신 `reason: string | null` 을 들고, 버튼은 `disabled={loading}` + `{...blocked(r.reason)}` 로 갈랐다. 문안 `settings.tray.hideDockNeedsKeep` ko/en — 이유는 설정이 온 뒤에만 붙인다(로딩 중에 "먼저 켜세요"가 뜨면 거짓말).

**2. 자에 규칙 3 「이 패턴의 자리가 아닌 요소」.** 스캐너가 속성만 보고 요소를 안 봤다. 여는 태그를 `{}` 깊이 0 의 `>` 까지 읽어(`onClick={() => …}` 의 `=>` 는 깊이 1) 세 부류를 면제한다:
- 입력 필드(`input`·`textarea`·`select`·`Input`…) 6곳 — 비활성은 동작이 아니라 **필드 상태**. `aria-disabled` 는 타이핑을 막지 못하므로 이 헬퍼가 애초에 못 들어간다. 이유는 placeholder·hint·곁 문장의 몫.
- cmdk `Command.Item` 1곳 — cmdk 가 `aria-disabled` 와 키보드 건너뛰기를 스스로 한다.
- `aria-expanded` 를 가진 펼침 버튼 1곳(`TraceRow`) — 펼칠 내용이 없는 펼침은 막힌 동작이 아니다.

**3. 규칙 2 통과에 콜백 부재.** `disabled={!onOpenEntry}`(`DiffFileList`) — 호출자가 능력을 안 준 것이지 사용자가 고칠 조건이 아니다. `^on[A-Z]\w*$` 인 맨 식별자는 통과.

**4. 접두형 진행 중.** 병렬 세션의 WIP `disabled={savingBody}` 가 0 래칫에 걸렸다. 자가 접미형(`isSaving`)만 알았던 것 — `^saving[A-Z]\w*` 도 받는다. 남의 파일을 고치지 않고 자를 넓혀 푼 것.

면제 목록을 스크립트로 뽑아 대조했다: 정확히 그 8곳 + 콜백 1 + 고친 1 = 10, 그 밖의 자리는 하나도 새로 면제되지 않았다.

## 동작 흐름

래칫이 `toBeLessThanOrEqual(10)` 에서 `toEqual([])` 로 — 이제 숫자가 아니라 **위반 목록**을 단언하므로 새 위반은 파일:줄로 바로 보인다. 프로브 테스트 둘 추가(콜백·접두형 / 요소 세 부류 + 화살표 `>` 가 태그 끝이 아님).

## 검증

- 병렬 세션 WIP(typecheck 오류가 있는 `JournalScreenV2` 등)와 섞이지 않게 **HEAD(`8ab5ae6`) 워크트리에 내 4파일만 얹어** 게이트: `typecheck` ok · `test` 206파일 2655건 ok · `build` ok · `lint` 5/6 — `lint:bindings` 하나는 HEAD 의 `ModelInput.tsx:13`(다른 세션 커밋)이 이미 붉다, 내 변경과 무관.
- 커밋은 임시 `GIT_INDEX_FILE` + `commit-tree` + CAS `update-ref` 로 4파일만(`b34eca4`). 주 워크트리는 그 사이 `feat/audit-round-20260911` 로 바뀌어 있었고 main 이 그 브랜치의 세 커밋 위에 있었으므로, 푸시에 그 셋이 함께 실렸다.