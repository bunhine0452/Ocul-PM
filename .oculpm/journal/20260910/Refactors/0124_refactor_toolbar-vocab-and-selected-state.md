---
schema_version: 1
type: refactor
slug: "toolbar-vocab-and-selected-state"
status: done
difficulty: medium
created_at: "2026-09-10T01:24:17+09:00"
session_id: "20260910-001"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "7f46e6a3-e2a2-4e31-9d04-a1da677c1b6a"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/diff/DiffScreenV2.tsx"
    op: update
  - path: "src/features/search/SearchScreenV2.tsx"
    op: update
  - path: "src/features/discussion/DiscussionScreenV2.tsx"
    op: update
  - path: "src/features/discussion/DiscussionEditor.tsx"
    op: update
  - path: "src/features/discussion/DiscussionView.tsx"
    op: update
  - path: "src/features/discussion/discussion.css"
    op: update
  - path: "src/features/graph/GraphScreenV2.tsx"
    op: update
  - path: "src/features/graph/graph.css"
    op: update
  - path: "src/features/skills/SkillsScreenV2.tsx"
    op: update
  - path: "src/features/skills/skills.css"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/features/code/code.css"
    op: update
  - path: "scripts/check-design-discipline.mjs"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related: []
tags:
  - "design"
  - "primitives"
  - "a11y"
  - "gate"
  - "mcp-tool"
---
[x] 「둘 중 하나」를 손으로 그린 자리가 셋이었고, 셋 다 서로를 몰랐다

## 동기

`{#unify-toolbar-vocab}` — 툴바 버튼 어휘를 넷으로, 그리고 "선택됨" 표현 통일.

## 실측 — 어휘는 이미 거의 하나였다

툴바 안 버튼 클래스를 세어 보니 `btn` 이 23 으로 압도적이고, 나머지는 스트래글러였다: `disc-btn`(12, 논의 전용) · `code-tool-btn`(6) · `gr-chip`(3) · `iconbtn` 계열(7) · `sk-textbtn`(1) · `code-save-btn`(1).

이 중 `iconbtn` 계열과 `code-tool-btn` 은 아이콘 전용이라 정당한 두 번째 어휘이고(같은 날 `{#unify-chips}` 가 두 단으로 접었다), `scope-chip` 은 필터 칩이라 세 번째 어휘다. **진짜 스트래글러는 셋**이었다.

- `.disc-btn` — `.btn` 과 여백·글자 크기만 다른 복제본. `.danger` 수정자는 TSX 어디에서도 안 쓰이던 죽은 가지.
- `.sk-textbtn` — 쓰는 곳이 한 군데, 차이는 글자 크기 한 단.
- `.gr-chip` — 필터 칩인데 그래프에서만 자기 이름을 갖고 있었다. `.scope-chip` 은 이미 검색·일지·AI패널·플래너가 공유하던 물건이다.

셋을 접고 CSS 를 지우면서 사유를 자리에 남겼다.

## 진짜 발견 — "선택됨" 을 손으로 그린 자리가 셋

항목은 "`DiffScreenV2.tsx:130-133` 은 JSX 인라인 배경색 계산" 이라며 한 곳을 짚었다. 실제로는 **셋**이었고, 셋 다 글자만 달랐다:

```
style={{ background: sel ? "var(--accent-soft)" : "transparent",
         color:      sel ? "var(--accent-text)" : "var(--text-2)" }}
```

변경 화면 둘(baseline 토글 · unified/split)과 검색 화면 하나(formatted/raw). 셋 다 `.btn ghost sm` 을 `.diff-mode-toggle` 이라는 테두리 상자에 넣고 안쪽 곡률을 0 으로 지워 세그먼트를 흉내내고 있었다 — 검색 화면이 `.diff-mode-toggle` 이라는 **다른 화면 이름의 클래스**를 쓰고 있었던 것이 그대로 증거다.

프리미티브에는 `.seg` / `.seg-item` 이 이미 있었고, 그 정의 주석이 규약까지 적어 뒀다: *"role=\"tab\" + aria-selected 로 상태를 말하므로 클래스 토글이 없다."* 정본이 있고 한 자리에만 적혀 있던, 이 라운드에서 네 번째로 나온 형태다.

인라인이라 생기던 두 가지 손해:

1. `.seg-item[aria-selected]` 은 면 + `--shadow-card` 로 "올라온 조각" 을 그리는데, 인라인 셋은 `--accent-soft` 배경만 칠했다. 같은 뜻이 두 가지 모양이었다.
2. `aria-selected` 가 없어 보조기술에는 **그냥 버튼 둘**이었다. 어느 쪽이 선택됐는지 말하지 않았다.

셋 다 `.seg` + `role="tablist"`/`role="tab"` + `aria-selected` 로 바꿨고, `.diff-mode-toggle` CSS 는 지웠다.

## 게이트

**규칙 21** (`checkInlineSelected`) — `style={{ background: … ? … var(--accent…) }}` 삼항을 잡는다. 그게 "세그먼트를 손으로 그렸다" 의 지문이다.

**probe 가 바로 구멍을 보여 줬다.** 처음 정규식이 끝에 `}}` 를 요구해서 **여러 줄 style 객체를 놓쳤다** — `background` 뒤에 `color` 가 더 오기 때문이다. 한 줄짜리 probe 만 만들었으면 못 봤을 것이고, 이건 규칙 16 이 아홉 번째 자리를 놓친 것과 정확히 같은 형태다. 끝 고정을 빼서 둘 다 잡게 고쳤고, 그 사유를 코드에 적었다.

## 검증

probe 다섯 형태: 한 줄 위반 · 여러 줄 위반 · 삼항 아닌 고정 배경 · 액센트 아닌 색 · 프리미티브. 앞의 둘만 잡히고 뒤의 셋은 통과.

JSX 주석을 삼항 가지 안에 넣었다가 `TS1128` 이 났다 — `cond ? ( {/* */} <div/> ) : null` 의 `{...}` 는 JSX 주석이 아니라 객체 리터럴로 파싱된다. 주석을 삼항 위로 뺐다.

`.diff-mode-toggle` CSS 를 지운 뒤 검색 화면이 아직 그 클래스를 쓰고 있는 것을 grep 으로 잡았다 — 지우기 전에 사용처를 다시 세지 않았으면 검색 화면 토글이 스타일 없이 남을 뻔했다.

4게이트 각각 exit 0: typecheck · lint(경고 9, 기준선) · test 197파일/2578 · build. 순 −30줄.

**눈으로 볼 것:** 논의 화면 버튼 12곳(`.btn` 이 되며 면·그림자가 생긴다) · 변경 화면 토글 둘 · 검색 화면 표시 토글 · 그래프 필터 칩 셋.