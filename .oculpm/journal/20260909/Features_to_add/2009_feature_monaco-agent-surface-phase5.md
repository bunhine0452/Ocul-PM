---
schema_version: 1
type: feature
slug: "monaco-agent-surface-phase5"
status: done
difficulty: superhigh
created_at: "2026-09-09T20:09:26+09:00"
session_id: "20260909-001"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "64d2ae17-87d9-425b-b5db-3a9d7e3670d1"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/code/inlineEdit/prompt.ts"
    op: create
  - path: "src/features/code/inlineEdit/hunks.ts"
    op: create
  - path: "src/features/code/inlineEdit/useInlineEdit.ts"
    op: create
  - path: "src/features/code/inlineEdit/InlineEditWidget.tsx"
    op: create
  - path: "src/features/code/inlineEdit/attribution.ts"
    op: create
  - path: "src/features/code/inlineEdit/useCodeAi.tsx"
    op: create
  - path: "src/features/code/useCodeFormat.ts"
    op: create
  - path: "src/features/code/CodeEditor.tsx"
    op: update
  - path: "src/features/code/CodePane.tsx"
    op: update
  - path: "src/features/code/code.css"
    op: update
  - path: "src/api/llm.ts"
    op: update
  - path: "src/__tests__/code_inline_edit.test.ts"
    op: create
  - path: "docs/20260908_monaco-editor/05-agent-surface.md"
    op: create
related:
  - ref: "20260909/Refactors/1940_refactor_monaco-discussion-phase4.md"
    kind: "followup"
tags:
  - "monaco"
  - "editor"
  - "llm"
  - "inline-edit"
  - "attribution"
  - "mcp-tool"
---
[x] Monaco 이관 Phase 5 — ⌘K 인라인 편집 · 조각 승인 · 귀속

## 추가 기능

선택 범위에 지시를 주면 그 자리에서 고쳐 준다(⌘K). 제안은 조각(hunk)으로
나뉘고 조각마다 켜고 끌 수 있으며, 받은 편집은 **어느 모델이 썼는지**와 함께
일지 초안이 된다.

SSOT: `docs/20260908_monaco-editor/05-agent-surface.md`

## 판단 넷

**D6 — ACP 가 아니라 프로바이더 채팅으로 간다 (D5 정정).** 마스터 플랜은
"ACP(Claude Code · Codex)가 이미 붙어 있어 전송 경로는 있고" 라고 적었는데
`acp_prompt` 를 읽어 보니 이 일에 안 맞다: 살아 있는 어댑터 연결이 필요하고,
`TurnGuard` 로 **한 번에 한 턴**이라 AI 패널이 도는 동안 ⌘K 가
`acp_session_busy` 로 거절되며, 무엇보다 ACP 에이전트는 **자기 도구로 디스크를
고친다** — 편집기에는 저장 안 한 버퍼가 있어 둘이 같은 파일을 다르게 들게 된다.

⌘K 가 필요한 것은 "이 선택을 고쳐 **텍스트로** 돌려 달라" 고, `commands.chat` 이
이미 그 모양이다. 부수 효과가 컸다 — **백엔드 커맨드가 하나도 안 늘어**
`bindings.ts` 재생성 위험(병렬 세션 미커밋)을 아예 안 건드리고 끝났다.

**D7 — 제안은 먼저 적용하고 나서 검토한다.** 유령 줄(view zone)로 미리 보여
주려면 위젯 층을 새로 만들어야 하는데 그건 `diffOriginal`(diff 편집기)이 이미
푼 문제고 두 벌을 만들 이유가 없다. 대신 선택을 그 자리에서 갈아 끼우고 받은
조각을 초록으로 칠한다. 되돌리기가 정확한 근거는 등식 하나다 —
`compose(diff, [false…]) === 원문`. ⌘Z 도 한 칸이다(편집 하나로 들어간다).

**D8 — 조각 승인은 토글이다.** 켜고 끌 때마다 본문이 즉시 다시 계산돼, 무엇을
받는 중인지 버튼을 누르기 전에 본문에서 보인다. `compose` 가 **줄 범위(spans)
까지** 내는 것이 요점 — 화면이 좌표를 다시 세면 "한 줄 밀린 하이라이트" 라는
찾기 어려운 모양이 된다. 조각이 하나면 토글 줄을 안 그린다(소음).

비교는 `features/chat/lineDiff.ts` 의 `diffLines` 를 그대로 쓴다 — ACP 편집
패널이 쓰던 것이고, diff 를 두 벌 만들면 같은 변경이 두 화면에서 다르게 보인다.

**모델은 시켜도 펜스를 붙인다.** `extractCode` 가 전체를 감싼 펜스 **하나**일
때만 걷는다 — 여러 개면 마크다운 본문이나 문서 문자열의 진짜 펜스를 지우는 것이
더 나쁘다. 들여쓰기는 안 건드린다: 첫 줄의 공백이 곧 그 코드가 놓일 자리다.
끝 개행도 원문에 맞춘다(안 그러면 빈 줄이 늘거나 다음 줄이 붙어 올라온다).

## 귀속 — 셋 중 둘

`{#agent-attribution}` 의 질문을 조사한 결과다.

1. **`entry_diffs` — 이미 된다.** 일지의 `files_touched[].path` 마다 그 시점
   diff 를 sidecar 로 잡으므로, 그 파일을 짚는 일지가 있으면 자동으로 붙는다.
2. **일지의 `agent` — 만들었다.** ⌘K 편집에는 일지를 쓸 에이전트가 없다(사용자가
   앱 안에서 모델을 부른 것이라 MCP `journal_write` 를 탈 주체가 없다). 그래서
   화면이 초안을 낸다: 파일별 누적을 상태줄 칩으로 띄우고, 누르면
   `oculpm_create_manual_entry` 로 `agent: {id: provider, version: model}` ·
   `files_touched` · **`verified_by_user: false`** 가 간다. 마지막 필드가 이
   설계의 정직함이다 — 앱이 관측한 사실을 남기되 **사람의 확인을 사칭하지
   않는다**. 본문도 아는 것(몇 곳·몇 줄·어느 모델)만 적고 "왜" 는 빈칸으로 둔다.
   지어내면 그 기록이 거짓이 되고, 이 제품은 기록이 참인지로 값이 정해진다.
3. **로컬 히스토리의 `HistorySource` — 막혔다.** 판마다 `user`/`agent` 를 적는
   자리가 **이미 있는데**(`oculpm/history.rs`) 지금 ⌘K 편집을 `user` 로 적는다 —
   앱의 `code_write` 가 남긴 자기-쓰기 쪽지를 워처가 읽어 "사람이 저장했다" 로
   판정하기 때문이다(`take_source`). **저자를 잘못 적는다.** 고치려면
   `code_write` 에 인자가 늘고 → `cargo test` 가 `bindings.ts` 를 재생성 →
   `{#cap-semantic}` 과 **같은 이유로** 막힌다.

일지 본문 문구는 UI 사전이 아니라 `attribution.ts` 가 ko/en 두 벌 든다 — 화면
카피가 아니라 **디스크에 기록되는 내용**이고 축도 작성 언어(`getContentLang()`)라
`discussionTemplates.ts` 와 같은 부류다(한글 게이트의 `DISK_CONTENT`).

## 곁다리 — 래칫이 시킨 리팩터링

⌘K 배선이 `CodePane` 을 +77줄 늘려 파일 크기 게이트에 걸렸다. 그래서 배선을
`useCodeAi.tsx` 로 뽑고, 그래도 +8 이 남아 **포맷팅(⇧⌥F)** 을 `useCodeFormat.ts`
로 옮겼다 — 이 폴더의 다른 훅들(`useLsp`·`useFileOps`·`useDebug`·`useFileHistory`)
옆이 원래 자리였고, 창이 들고 있던 마지막 인라인 훅이었다. 래칫이 하라는 일이
정확히 이것이다.

## 검증

- `pnpm typecheck` · `pnpm test`(193파일 **2,514개**) · `pnpm lint` 6종(파일
  크기 래칫 · eslint 경고 9 한계 포함) · `pnpm build` 전부 exit 0 직접 확인.
- 새 순수 테스트 35개 — 펜스 걷기(단일/다중) · 끝 개행 · 조각 나누기 · **전부
  끄면 원문 그대로** · span 좌표 · 슬러그 규격 · `verified_by_user=false`.
- **미확인**: 실제 모델 왕복은 육안 확인 전이다 — 위젯이 선택 위에 뜨는지, 조각
  토글이 본문을 눈앞에서 다시 그리는지, 초록 하이라이트가 프리셋 5종에서 읽히는지.
  Phase 6 `{#fin-eyes}` 격자에서 본다.