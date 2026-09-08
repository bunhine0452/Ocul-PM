---
schema_version: 1
type: refactor
slug: "monaco-port-phase1"
status: done
difficulty: superhigh
created_at: "2026-09-08T20:14:59+09:00"
session_id: "20260908-005"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "5b0cd752-7a72-41db-9cea-80e0b20c6a6d"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/code/CodeEditor.tsx"
    op: update
  - path: "src/features/code/monaco/setup.ts"
    op: create
  - path: "src/features/code/monaco/theme.ts"
    op: create
  - path: "src/features/code/monaco/lsp.ts"
    op: create
  - path: "src/features/code/monaco/decorations.ts"
    op: create
  - path: "src/__tests__/monaco_contributions.test.ts"
    op: create
  - path: "src/features/code/codeLang.ts"
    op: update
  - path: "src/features/code/code.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "package.json"
    op: update
related:
  - ref: "20260908/Features_to_add/1945_feature_monaco-phase0-spike.md"
    kind: "followup"
tags:
  - "monaco"
  - "editor"
  - "lsp"
  - "codemirror"
  - "migration"
  - "mcp-tool"
---
[x] Phase 1 — CodeEditor 를 Monaco 로 이식한다 (props 계약 무변경)

## 동기

Phase 0 이 초록을 냈으니 실제 이식. **D2 를 그대로 지켰다** — `CodeEditorProps`
16개 prop 을 한 줄도 바꾸지 않고 구현만 갈아끼웠다. 그 덕에 `CodePane.tsx`(1,800줄)
위쪽은 무변경이고, 기존 코드 화면 테스트가 판정자가 됐다.

## 변경 요약

`CodeEditor.tsx` 를 다시 썼고(572→481줄), 배선을 네 조각으로 나눴다 —
`monaco/setup.ts`(111) · `monaco/theme.ts`(157) · `monaco/lsp.ts`(269) ·
`monaco/decorations.ts`(87).

**setup** — D1 진입점. 0.56 엔 `editor.all.js` 가 없어 기여 72개를 `editor.main.js`
에서 옮겨 적고 `languages/features/*`(워커 언어 서비스)만 뺐다. 옮겨 적은 목록은
반드시 대조해야 하므로 `monaco_contributions.test.ts` 가 원본과 비교하고, 언어
서비스·`?worker` 2개 이상·`editor.main` 통짜 임포트를 각각 막는다.

**theme** — `--code-*` 15개를 읽어 `defineTheme`. CodeMirror 는 `.cm-*` 가 `var()`
를 직접 들어서 프리셋 전환이 CSS 로 공짜였는데, Monaco 는 테마를 JS 로 받고 CSS
변수를 안 읽는다. 그래서 `data-theme`/`data-preset` 을 MutationObserver 로 지켜보다
바뀌면 테마를 다시 정의한다. **이 감시자가 없으면 프리셋을 바꿔도 코드 색만 옛것으로
남는다** — R4 가 지목한 조용한 회귀 자리다.

**lsp** — 완성·호버·시그니처를 Monaco 공급자로. 좌표 변환의 순수 함수
(`completionStart`·`parseHover`·`wordAtColumn`)는 `lspBridge.ts` 가 계속 소유하고
여기서는 감싸기만 한다. 공급자는 **언어 단위 전역**이라 `model.uri` 를 대조해 남의
편집기에 안 걸리게 하고, 언마운트 때 반드시 푼다 — 안 풀면 파일을 옮길 때마다
쌓여 완성 후보가 N 벌 뜬다.

**decorations** — `gitGutter.ts`·`breakpointGutter.ts` 를 데코레이션으로. git 은
`linesDecorationsClassName`, 중단점은 `glyphMarginClassName`. 둘을 **다른 컬렉션**에
두는 것이 중요하다 — 한 컬렉션이면 편집 중 계속 갱신되는 git 이 중단점을 지운다.

## 스스로 잡은 결함 하나

인라인 비교를 처음엔 "평범한 편집기를 만들어 `display:none` 으로 숨기고 그 위에
diff 편집기를 얹는" 식으로 썼다. 게이트는 전부 통과했지만 **커서 이벤트와 `jump` 가
숨은 편집기로 갔다** — 상태줄 줄·열이 멈추고 전역 검색 점프가 아무 데도 안 가는
버그였다. 원본이 있으면 처음부터 diff 편집기를 만들고 그 `getModifiedEditor()` 를
이 컴포넌트의 편집기로 삼도록 고쳤다.

## 이관이 공짜로 준 것

지금까지 실측 **0** 이던 것들이 켜졌다 — 코드 폴딩 · 괄호 매칭 · 자동 괄호 닫기 ·
선택 일치 강조 · 다중 커서 · 미니맵 · 브래킷 쌍 색칠 · find/replace 위젯.
Phase 3 가 넓히기 전에 바닥만 깐 상태다.

## 번들 — CodeMirror 가 코드 화면에서 완전히 빠졌다

```
이전  CodeScreenV2 335,588 + 공유 청크(CM 코어) 606,254 = 941,842 raw
지금  CodeScreenV2 4,001,820 raw / gzip 1,041,340
```

주목할 것은 **공유 청크가 사라졌다**는 점이다. CodeMirror 는 이제 논의 화면 전용
청크(`DiscussionEditor` 537,960 / gzip 185,572)에만 남는다 — 코드 화면을 안 여는
사용자에게 가던 CM 비용이 없어졌다. `codeLang.ts` 의 CM 함수는 트리셰이킹으로
빠졌고(`.cm-` 히트 0), 실제 제거는 Phase 2 `reclaim-lang` 이 한다.

## 검증

typecheck · test · lint · build 를 **직접 확인해 전부 exit 0**.
테스트 **189 파일 2460개 전부 통과, 한 줄도 고치지 않았다** — 코드 화면 테스트 30개가
`CodeEditor` 를 모킹해 계약만 보기 때문이고, 이것이 D2 가 산 것이다. 계약이 샜다면
여기서 붉었을 것이다. eslint 경고는 9/9 그대로(내 파일 0개).

**아직 눈으로 못 본 것**: 설치본이 돌고 있어 dev 빌드를 못 띄웠다. 프리셋 5종 ×
라이트/다크 격자, 인라인 diff 렌더, sticky, 실기기 한글 입력은 Phase 6 `fin-eyes`
에서 확인한다.