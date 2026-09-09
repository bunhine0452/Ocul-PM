---
schema_version: 1
type: refactor
slug: "monaco-discussion-phase4"
status: done
difficulty: high
created_at: "2026-09-09T19:40:20+09:00"
session_id: "20260909-001"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "64d2ae17-87d9-425b-b5db-3a9d7e3670d1"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/discussion/DiscussionEditor.tsx"
    op: update
  - path: "src/features/discussion/discussion.css"
    op: update
  - path: "src/features/code/monaco/langProse.ts"
    op: create
  - path: "src/features/code/monaco/theme.ts"
    op: update
  - path: "src/features/code/monaco/setup.ts"
    op: update
  - path: "src/__tests__/setup.ts"
    op: update
  - path: "src/__tests__/monaco_prose.test.ts"
    op: create
  - path: "src/__tests__/discussion_editor.test.tsx"
    op: update
  - path: "package.json"
    op: update
  - path: "docs/20260908_monaco-editor/04-discussion.md"
    op: create
related:
  - ref: "20260909/Features_to_add/1926_feature_monaco-capabilities-phase3.md"
    kind: "followup"
tags:
  - "monaco"
  - "codemirror"
  - "discussion"
  - "monarch"
  - "jsdom"
  - "mcp-tool"
---
[x] Monaco 이관 Phase 4 — 논의 편집기를 옮기고 CodeMirror 를 지운다

## 동기

`package.json` 에서 `@codemirror/*` 와 `@lezer/highlight` 가 **전부 사라졌다** —
플랜이 "이 라운드의 완료 신호" 라고 적어 둔 줄이다.

선행 조건(`{#disc-wait}`)은 만족됐다: `60b66a9`(논의 CAS 손실 수정)가 머지돼
있고 `src/features/discussion/` · `discussion.rs` 에 미커밋 변경이 없다.

SSOT: `docs/20260908_monaco-editor/04-discussion.md`

## 변경 요약

**이음매는 오프셋 하나였다.** `DiscussionEditor` 의 진짜 계약은 `apply(make)` 고,
순수 모듈 `mdEdit.ts` 는 문서 시작부터의 **오프셋**으로 말한다(CodeMirror 의
단위). Monaco 는 (줄, 열)이라 `getOffsetAt`/`getPositionAt` 환산을 `apply` 안에
가뒀다 — 둘 다 UTF-16 코드 유닛이라 인코딩 변환이 없고 **`mdEdit.ts` 는 한 줄도
안 바뀌었다**. 반영은 `executeEdits` **한 번**이다: 여러 번 부르면 실행 취소가
조각나서 "삽입 한 번" 이 ⌘Z 세 번이 된다.

CM 에서 오던 것들의 새 출처 — `history()`→내장 실행 취소 · `search()`→find 위젯
(⌘F·⌥⌘F) · `placeholder()`→`placeholder` 옵션 · `lineWrapping`→`wordWrap` ·
`keymap.of`→`addAction`(⌘S·⌘B·⌘I·⌘K) · `EditorView.theme`→`discussion.css`.

## 판단 셋

**코드용 `markdown` 을 안 쓰고 문법을 하나 더 썼다** (`monaco/langProse.ts`,
`markdown-prose`). Monaco 0.56 의 마크다운은 제목을 단계 구분 없이 전부
`keyword` 로 낸다. 논의 문서에서는 그 단계가 곧 구조다 — `##` 는
파서(`discussion/parse.rs`)가 아는 섹션이고 `###` 는 그 안의 옵션 하나다. 한
색으로 뭉개면 "지금 어느 섹션에 쓰고 있나" 가 사라진다(CM 판 `mdHighlight` 는
그 구분을 갖고 있었으므로 그냥 두면 회귀). 안정 id(`{#opt-a}`)도 따로 칠한다 —
삽입 메뉴가 만들어 주지만 손으로 지웠는지가 눈에 보여야 한다.

**테마는 하나다 — 접미사로 가른다.** Monaco 의 테마는 **전역**이고
(`StandaloneEditor` 생성자가 `themeService.setTheme` 을 부른다) 코드 화면과 논의
화면은 다른 창 탭에서 함께 살아 있을 수 있다(`TabbedWindow` 는 비활성 탭을
마운트한 채로 둔다). 그래서 `oculpm` 테마 하나에 두 언어의 규칙을 싣고
`.md-prose` 접미사로 갈랐다. `monaco_prose.test.ts` 가 그 짝을 문다 — 규칙이
빠지면 Monarch 가 점을 하나씩 떼며 폴백해 `type.h2.md-prose` 가 **코드용 타입
색**으로 칠해진다. 화면은 그럴싸하고 아무 테스트도 안 깨지는 종류다.

**산문 옵션은 코드와 정반대다.** 자동 괄호 닫기·줄번호·미니맵·거터·접기·브래킷
색칠·들여쓰기 가이드를 끄고 줄바꿈을 켠다 — 한국어 산문에서 `(그런데` 를 치면
닫는 괄호가 따라붙는 게 방해가 더 크다. 선택 감싸기(서식 단축키와 같은
손놀림)와 다중 커서(토의 로그 표의 같은 열)는 남겼다.

## 사고 하나 — 클립보드 스텁이 5개를 죽였다

jsdom 이 Monaco 를 만나며 전역 setup 에 셋이 늘었다.

- `document.queryCommandSupported` — 클립보드 기여가 **임포트되는 순간** 부른다.
  테스트 파일의 `beforeAll` 은 임포트보다 늦어서 거기 두면 스위트가 통째로 로드
  실패한다(실제로 그렇게 한 번 틀렸다).
- `ResizeObserver`.
- `navigator.clipboard` + `ClipboardItem` — jsdom 의 UA 가 `AppleWebKit` 만 담고
  `Chrome`·`Safari` 는 안 담아 Monaco 가 이 환경을 **WebKit 웹뷰**로 읽고
  (`isWebkitWebView`) Safari 용 쓰기 우회를 켠다. 그 우회는 클릭마다
  `DeferredPromise` 를 만들어 `ClipboardItem` 에 넘기고 다음 클릭에서 앞의 것을
  취소하는데, `ClipboardItem` 이 없으면 그 거절을 아무도 안 받아 unhandled
  rejection 으로 튄다(테스트는 통과하는데 러너는 붉다). **UA 를 크롬처럼 위장해
  그 경로를 끄는 안은 기각** — 실기기(WKWebView)가 실제로 타는 경로를 그대로
  지나가게 두는 편이 정직하다.

그 스텁을 `writable: false`(defineProperty 기본값)로 두었더니 **다른 스위트 5개가
죽었다.** `mcp_settings` · `acp_session_id` · `discussion_v2` 가
`Object.assign(navigator, { clipboard: { writeText } })` 로 자기 스파이를 얹는데,
읽기 전용 속성이라 그 대입이 **조용히 무시**됐다. `writable: true` 로 고쳤고
주석에 이유를 남겼다.

## 번들

| | 이전 | 이후 |
|---|---:|---:|
| `DiscussionEditor` 청크 | 537.97 kB (gzip 186.37) | **8.77 kB** (gzip 3.35) |
| 공유 Monaco 청크 | — | 3,871.14 kB (gzip 1,001.45) |

두 화면이 같은 Monaco 를 쓰게 되자 Rollup 이 공유 청크로 뽑았다. 앱 전체
페이로드는 CodeMirror 538KB 만큼 **줄었고**, 논의 화면 첫 열기 비용이 그만큼
올랐다 — 코드 화면을 이미 연 뒤라면 0 이다(같은 청크).

## 검증

- `pnpm typecheck` · `pnpm test`(192파일 **2,476개**) · `pnpm lint` 6종 ·
  `pnpm build` 전부 exit 0 직접 확인.
- `discussion_editor.test.tsx` 가 **이 이관의 판정자**였다 — 툴바 → 편집 →
  `onSave` 를 실제로 흘려 보므로 오프셋 환산이 어긋나면 잡힌다. 테스트 본문은
  한 줄도 안 고쳤다(전역 setup 의 shim 만 늘었다).
- **미확인**: 제목 4단계 색·캐럿·자리표시자의 실제 렌더는 육안 확인 전이다
  (Phase 6 `{#fin-eyes}` 격자).