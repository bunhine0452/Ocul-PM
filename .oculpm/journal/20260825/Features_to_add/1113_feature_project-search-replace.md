---
schema_version: 1
type: feature
slug: project-search-replace
status: done
difficulty: high
created_at: "2026-08-25T11:13:08+09:00"
session_id: "manual-20260825-111308"
agent:
  id: claude-code
  version: claude-fable-5
language: ko
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/code.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/features/code/CodeSearchPanel.tsx"
    op: create
  - path: "src/features/code/searchPanelModel.ts"
    op: create
  - path: "src/features/code/CodeScreenV2.tsx"
    op: update
  - path: "src/features/code/CodePane.tsx"
    op: update
  - path: "src/features/code/CodeEditor.tsx"
    op: update
  - path: "src/features/code/code.css"
    op: update
  - path: "src/components/Icons.tsx"
    op: update
  - path: "src/contexts/WorkspaceContext.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/code_search_panel.test.tsx"
    op: create
related:
  - "20260824/Features_to_add/0135_feature_code-tab-keyboard-ux.md"
tags: [code, search, replace, sidebar]
---

[x] 코드 탭 VS Code 식 프로젝트 전역 검색·치환 — ⇧⌘F 사이드바 패널 + 디스크 직접 grep

## 추가 기능

- **백엔드 `code_search`** — SQLite 인덱스를 쓰는 기존 의미/정확 검색과 달리 **디스크를
  직접 걷는** grep. 시야는 `code_tree` 와 동일(gitignore 존중·숨김 포함·`.git` 제외),
  에디터가 못 여는 파일(바이너리·2MB 초과·비 UTF-8)은 건너뛴다. 대소문자/단어
  단위/정규식 토글, 총 2,000곳 상한(`truncated`), 매치 좌표는 **UTF-16 단위**로 변환해
  돌려준다 — CodeMirror 오프셋·JS 인덱스와 같은 단위라 프런트가 그대로 쓴다.
- **백엔드 `code_search_replace`** — 같은 패턴으로 한 매치/한 파일/전체 치환.
  줄 단위 치환이라 `^`/`$` 의미가 검색과 일치하고, 줄 종결자(`\r\n` 포함)를 보존한다.
  정규식 모드에서만 `$1` 그룹 확장(VS Code 규칙). 쓰기는 기존 `write_with_lock`
  (전역 뮤텍스 + 해시 대조 + 원자적 rename)을 그대로 타고, 파일 단위 실패는 전체를
  멈추지 않고 `errors` 로 모은다.
- **`CodeSearchPanel`** — 사이드바 자리를 파일 트리와 전환(VS Code 액티비티 바 식).
  ⇧⌘F 또는 트리 헤더의 검색 버튼으로 진입, 300ms 디바운스 검색-as-you-type,
  파일별 그룹·접기·제외, 매치 클릭 → 파일 열고 **그 범위를 선택**, hover 로 매치
  하나/파일 하나 치환, 모두 바꾸기는 확인 다이얼로그를 거친다. 토글 3종은
  `codeSearchOpts` 로 영속(검색어·결과는 휘발).
- **점프 배관 확장** — `jump` 가 line 만 아니라 `ch`/`len`(UTF-16)을 실어
  CodeScreenV2 → CodePane → CodeEditor 로 흐르고, 에디터가 그 범위를 selection 으로
  잡는다 (기존 호출자는 line 만 넘겨 무변경).

## 동작 흐름

1. ⇧⌘F → 사이드바가 검색 패널로 전환 + 입력 포커스 (`sidebarMode`, 휘발).
2. 타이핑 → 디바운스 → `code_search` (spawn_blocking 에서 `ignore` 걸음 + `regex`
   줄 단위 매칭) → 파일별 그룹 렌더 (미리보기 하이라이트는 `preview_col`/`len` 으로
   프런트에서 자름 — `previewSegments`).
3. 매치 클릭 → `openPath(path, line, undefined, {ch, len})` → jump nonce → CM
   `selection {anchor, head}` + 중앙 스크롤.
4. 치환 → `code_search_replace` → 디스크 원자 쓰기 → **열린 깨끗한 버퍼는 기존
   `oculpmFileChanged` watcher 가 자동 리로드** · 미저장 파일은 프런트가 목록에서
   배지로 알리고 치환에서 건너뜀(dirtyPaths) → 완료 후 재검색으로 정직하게 갱신.

## 검증

- Rust 단위 테스트 12종 추가(총 34 그린): UTF-16 좌표(한글)·미리보기 창·줄 단위
  `^` 앵커·빈 매치 스킵·gitignore/바이너리 시야·상한 잘림·CRLF/무종결 보존·단일
  타깃 좌표 불일치 시 무변경·`$1` 확장 모드 구분·원자 쓰기.
- 프런트 vitest 8종 추가(전체 1303 그린): previewSegments 한글 분할·dropFile·
  dirty 제외·그룹 렌더→열기 좌표·파일 제외·토글 영속·치환 확인 다이얼로그 경유.
- `pnpm typecheck` · `pnpm lint`(하드코딩 한글 게이트 포함) · `pnpm build` 모두 exit 0.

## 메모

- 치환은 **디스크가 진실** 계약: 검색 결과가 낡아도 "지금 매치되는 것"을 바꾼다.
  미저장 버퍼 파일은 건너뛰는 쪽을 택했다 — 버퍼 내 치환(JS 정규식)은 Rust regex 와
  방언이 갈라 소리 없이 다른 결과를 낼 수 있다.
- 매치 하나 제외(per-hit dismiss)는 넣지 않았다 — 파일 단위 제외만. "제외한 매치가
  모두 바꾸기에 여전히 포함되는" 거짓말을 만들지 않기 위한 v1 절충.
