---
schema_version: 1
type: feature
slug: "code-editor-screen"
status: done
difficulty: high
created_at: "2026-08-16T18:57:42+09:00"
session_id: "mcp-20260816-185742"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/code.rs"
    op: create
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/src/commands/docs.rs"
    op: update
  - path: "src/features/code/CodeScreenV2.tsx"
    op: create
  - path: "src/features/code/CodeEditor.tsx"
    op: create
  - path: "src/features/code/CodeTree.tsx"
    op: create
  - path: "src/features/code/codeLang.ts"
    op: create
  - path: "src/features/code/codeBuffers.ts"
    op: create
  - path: "src/features/code/treeUtils.ts"
    op: create
  - path: "src/features/code/code.css"
    op: create
  - path: "src/features/shell/ShellV2.tsx"
    op: update
  - path: "src/lib/navRegistry.ts"
    op: update
  - path: "src/contexts/WorkspaceContext.tsx"
    op: update
  - path: "src/features/search/SearchScreenV2.tsx"
    op: update
  - path: "src/features/graph/GraphInspector.tsx"
    op: update
  - path: "docs/code-editor/00-master-plan.md"
    op: create
related: []
tags:
  - "code-editor"
  - "codemirror"
  - "ui_v2"
  - "new-screen"
  - "mcp-tool"
---
[x] 코드 화면 — 인앱 코드 뷰어·에디터 (CodeMirror 6, 13번째 화면)

## 추가 기능

검색·코드맵·diff 가 가리키기만 하던 코드를 앱 안에서 바로 열어 보고 가볍게 고치는 **"코드" 화면**을 추가했다 (SSOT: `docs/code-editor/00-master-plan.md`). 풀 IDE 가 아니라 "컨텍스트에서 바로 보고 고치는 에디터"로 스코프를 잡았다 — LSP·멀티탭·신규 파일 생성은 의도적으로 제외, 무거운 편집은 기존 `open_in_editor`(외부 에디터 점프)가 담당한다.

- **백엔드 3 커맨드** (`commands/code.rs`): `code_tree`(ignore 크레이트 — gitignore·hidden 존중, 2만 파일 상한 + truncated 플래그, 폴더 우선 + docs 의 natural_cmp 재사용) / `code_read`(blake3 해시 토큰, 선두 8KB NUL 바이너리 판정, 2MB 상한) / `code_write`(**낙관적 잠금** — 디스크 해시가 base_hash 와 다르면 덮어쓰지 않고 Conflict 반환, 같은 디렉터리 임시파일 + rename 원자 저장, 원본 권한 보존). 모든 경로는 기존 `secure_join` 경유.
- **에디터**: CodeMirror 6 (Monaco 대비 번들 1/10·WKWebView 궁합). 언어 12종(ts/tsx·js·rust·py·go·md·json·html·css·yaml·toml·shell), 테마는 `--code-*` CSS 변수만 참조해 data-theme/data-preset 전환 즉시 반영, 선택·활성줄은 `color-mix(var(--accent))`로 6색 컬러 테마 자동 연동. ⌘F 검색 패널 한국어 phrases.
- **편집 버퍼**: 모듈 스코프 LRU 캐시(`codeBuffers`, 상한 20) — 화면·파일 전환에도 미저장 편집 유지, 트리에 dirty 점 배지. 축출은 깨끗한 버퍼 우선.
- **충돌 2중 방어**: ① 저장 시 백엔드 해시 대조 → 충돌 배너(디스크 버전 불러오기 / 내 버전 덮어쓰기) ② 열린 파일의 watcher 이벤트(`oculpmFileChanged`) — dirty 아니면 읽던 줄 유지한 채 조용히 리로드, dirty 면 배너. 자기 저장 에코는 해시 비교로 무시.
- **진입점 통합**: 검색 결과(정확·의미·심볼 전부)에 "코드 화면에서 열기" 라인 점프 버튼, 코드맵 인스펙터에 동일 버튼. ShellV2 의 one-shot 핸드오프(`codeTarget`, journalFocus 패턴).
- **UI**: navRegistry 맨 끝 추가(기존 ⌘번호 불변), lazy 청크(에디터 비용은 여는 사람만), 필터 입력(경로 부분일치 + 자동 펼침), 상태줄(Ln·Col·언어·크기·수정됨), 바이너리/대용량은 안내 + 외부 에디터 CTA, 마지막 파일 영속(`codeActivePath`).

## 동작 흐름

트리 선택(또는 검색/코드맵 점프) → `code_read`(내용+해시) → 버퍼 캐시 확인(미저장 편집 우선, 디스크 선행 시 충돌 배너) → CM 마운트(라인 점프) → 편집 → ⌘S → `code_write`(해시 대조) → Saved 면 base 갱신 / Conflict 면 배너 → watcher 가 저장을 인덱서에 전달(검색·코드맵 자동 갱신).

## 검증

- `cargo test` 풀 스위트 exit 0 (신규 단위 7개 포함: gitignore 트리·상한 절단·바이너리 프로브·해시 일치 저장·불일치 충돌·신규 파일 거부·권한 보존), bindings.ts 재생성 확인.
- `pnpm typecheck` / `pnpm test`(978개, 신규 4파일: codeLang·treeUtils·codeBuffers LRU·화면 상태 흐름 + axe) / `pnpm lint`(storage·i18n) / `pnpm build` 전부 exit 0 직접 확인.