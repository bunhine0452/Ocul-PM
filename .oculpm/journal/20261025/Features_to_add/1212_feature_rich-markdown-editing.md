---
schema_version: 1
type: feature
slug: "rich-markdown-editing"
status: done
difficulty: high
created_at: "2026-10-25T12:12:14+09:00"
session_id: "20261025-005"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "2a1d0079-cc16-453f-acab-dc425538e24b"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/code/richMarkdown/codec.ts"
    op: create
  - path: "src/features/code/richMarkdown/frontmatter.ts"
    op: create
  - path: "src/features/code/richMarkdown/slashCommands.ts"
    op: create
  - path: "src/features/code/richMarkdown/anchorMarks.ts"
    op: create
  - path: "src/features/code/richMarkdown/RichMarkdownEditor.tsx"
    op: create
  - path: "src/features/code/richMarkdown/rich-markdown.css"
    op: create
  - path: "src/features/code/codePane/markdownView.tsx"
    op: create
  - path: "src/features/code/codePane/CrumbActions.tsx"
    op: update
  - path: "src/features/code/codePane/PaneBanners.tsx"
    op: update
  - path: "src/features/code/CodePane.tsx"
    op: update
  - path: "src/features/discussion/DiscussionEditor.tsx"
    op: update
  - path: "src/features/discussion/outline.ts"
    op: update
  - path: "src/features/discussion/discussion-editor.css"
    op: update
  - path: "src/contexts/WorkspaceContext.tsx"
    op: update
  - path: "package.json"
    op: update
  - path: "src/__tests__/rich_markdown_codec.test.ts"
    op: create
  - path: "src/__tests__/rich_markdown_editor.test.tsx"
    op: create
related: []
tags:
  - "markdown"
  - "code-editor"
  - "discussion"
  - "orca-bench"
  - "mcp-tool"
---
[x] 노션식 리치 마크다운 편집 — 코드 화면 .md · 논의 편집기, 고친 블록만 저장에 바뀐다

## 추가 기능

사용자 요청 "마크다운을 노션처럼 편집도". 붙일 곳은 사용자가 고른 두 곳 — 코드 화면의 .md, 논의 문서 편집기. TipTap 3.31.3(`@tiptap/markdown`, Orca 와 같은 판) 위에 `RichMarkdownEditor` 를 얹었다.

**핵심은 코덱이다 (`richMarkdown/codec.ts`).** 이 앱이 여는 .md 는 에이전트가 같이 읽고 쓰는 파일이라, 서식 표기가 조용히 바뀌면 git diff 소음이고 남의 편집을 지운 것처럼 보인다(논의 편집기가 예전에 WYSIWYG 을 거절한 이유가 정확히 이것). 첫 시도 — 문서 통째 직렬화 — 는 저장소 .md 425개 중 1개만 원문과 같았다(표 칸 맞춤·앞 빈 줄·`*`→`-`·머리 주석). 그래서:

- 표준 `marked` 렉서로 최상위 블록을 나눠 블록마다 원문을 기억하고(`parseWithSource`), 저장 때 처음과 같은 블록(스키마를 거친 JSON 열쇠로 대조)은 원문을, 고친 블록만 직렬화한다(`serializeWithSource`). 원문 토막 사이 간격은 원문 그대로, 새 블록 앞엔 빈 줄을 보장(lazy continuation 방지).
- TipTap 이 렉서에 끼운 표 토크나이저는 칸 수 어긋난 표(`docs/optimization/00-ledger.md`)의 `raw` 를 글자마다 줄바꿈으로 망가뜨린다 — 블록 나누기는 TipTap 이 손대지 않은 `new Lexer({gfm:true})` 로. `marked@17.0.6` 을 직접 의존성으로(TipTap 과 같은 판).
- `<!-- x begin -->…<!-- x end -->` 관리 블록(토의 로그)과 HTML 은 `rawBlock`(atom) 하나에 원문 그대로. 자리표로 갈아 끼웠다 되돌리되, 코드 펜스 안의 예시도 되돌린다.
- 머리 정보는 떼어 두었다 원문 그대로 붙인다(칩, 펼쳐도 읽기 전용).

편집기: `/` 블록 메뉴(제목 1~3·할 일·목록·번호·표·코드·인용·구분선, 영문 별칭), 안정 id `{#…}` 흐리게(데코레이션 — 글은 그대로), 원문 블록은 한 줄로 접고 고르면 펼침.

**코드 화면**: `codePane/markdownView.tsx` — .md 는 리치로 열고 크럼 줄의 「리치 / 원문」 세그먼트로 오간다(세션 동안 파일별 기억, 비교 중엔 원문). 리치 편집기는 lazy 청크(506KB/gzip 159KB). 충돌 띠의 비교 닫기를 배너 안으로 옮겨 CodePane 800줄 래칫을 지켰다.

**논의 편집기**: 리치가 기본, 원문(Monaco) 유지. 「나란히」·「미리보기」 모드·스크롤 동기·미리보기 렌더(`previewText`)는 리치가 대신해 걷었다(범위 동결 — 대체는 옛 길 제거로). 서식 버튼·⌘S·⌘K 는 모드별로 갈린다. 옵션·단계 삽입은 글에 바로 넣고 리치 판을 다시 연다; 토의 메모는 관리 블록이라 줄을 넣고 원문 모드의 그 칸으로 간다. 옛 저장값 `split`·`preview` 는 리치로 읽는다.

## 검증

- typecheck · lint · vitest 258 파일 3,280 · build 통과 (PR #99).
- `rich_markdown_codec`: 저장소의 모든 .md 가 실제 Editor 를 거쳐 열고 닫아도 바이트 단위로 같다 · 마지막 문단만 고치면 표·`*` 목록 그대로 · 새 블록 빈 줄 · 블록 삭제 · 관리 블록 보존 · 머리 정보 왕복 · 슬래시 별칭.
- CHANGELOG(637블록) 직렬화 2ms — 타자마다 해도 무리 없음. 빌드 CSS 하네스로 논의 편집기·README·코드 화면 라이트/다크 육안 확인. 실기기 한글 IME 입력·체크박스 클릭은 미확인.