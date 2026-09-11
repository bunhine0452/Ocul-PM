---
schema_version: 1
type: feature
slug: "editor-ide-round"
status: done
difficulty: high
created_at: "2026-09-11T00:48:29+09:00"
session_id: "20260911-002"
agent:
  id: "claude-code"
  version: "Fable 5.1"
  session: "6329180c-f6fb-4b0f-8ecc-6f01664958e4"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/code/CodeQuickOpen.tsx"
    op: create
  - path: "src/features/code/quickOpenModel.ts"
    op: create
  - path: "src/features/code/gitDecor.ts"
    op: create
  - path: "src/api/git.ts"
    op: create
  - path: "src/features/code/CodeCrumbs.tsx"
    op: create
  - path: "src/features/code/CodeStatusBar.tsx"
    op: create
  - path: "src/features/code/CodeToolbar.tsx"
    op: create
  - path: "src/features/code/CodePane.tsx"
    op: update
  - path: "src/features/code/CodeScreenV2.tsx"
    op: update
  - path: "src/features/code/CodeEditor.tsx"
    op: update
  - path: "src/features/code/CodeTree.tsx"
    op: update
  - path: "src/features/code/CodeTabsBar.tsx"
    op: update
  - path: "src/features/code/monaco/options.ts"
    op: update
  - path: "src/features/code/gotoModel.ts"
    op: update
  - path: "src/features/code/codeLang.ts"
    op: update
  - path: "src/features/code/code-frame.css"
    op: update
  - path: "src/features/code/code.css"
    op: update
  - path: "src/contexts/workspaceState.ts"
    op: update
  - path: "src/contexts/workspaceDefaults.ts"
    op: update
  - path: "src/__tests__/code_ide_round.test.ts"
    op: create
related:
  - ref: "20260911/Features_to_add/0026_feature_editor-design-upgrade.md"
    kind: "followup"
tags:
  - "code"
  - "design"
  - "ide"
  - "monaco"
  - "mcp-tool"
---
[x] 편집기 IDE 라운드 — ⌘P 빠른 열기 · git 상태 장식 · 심볼 브레드크럼 · 줄바꿈 · 사이드바 토글

- [x] 편집기에 IDE 기능·UX 추가 (디자인 라운드 후속, 사용자 요청 "더더욱")

## 추가 기능

코드로 확인해 **없던 것만** 넣었다 (⌘P · 줄바꿈 · ⌘B · 선택 통계 · 심볼 브레드크럼 · git 장식은 전부 부재였다).

1. **⌘P 빠른 열기** (`CodeQuickOpen` + `quickOpenModel`). 목록은 화면이 이미 든 전량 트리(`code_tree`)라 서버 왕복이 없고, 점수는 시작 탭의 프로젝트 매칭(`homeMatch.bestScore`)을 그대로 — `agmd`→`AGENTS.md`, `src/feat`→경로, 낱말 여럿은 전부 맞아야. 빈 질의는 열린 탭(보는 파일 맨 위)만. ⏎ 는 고정 탭으로 연다. 트리가 상한에 잘렸으면 그 사실을 힌트로 말한다.
2. **git 상태 장식** (`gitDecor` · `api/git.ts`). 변경 화면과 같은 `git_uncommitted_changes` 를 쓰고 폴더로 말아 올린다. 트리·탭 이름색: 수정=앰버 · 추가/미추적=초록 · 삭제=빨강+취소선, 파일 행 끝에 A/M/D 글자 배지. 저장·워처·파일 조작 뒤 디바운스 재조회. **진단 표식**도 같은 자리: 오류·경고가 있는 파일 이름이 빨강/앰버 (문제 스토어를 파일별로 접음). 우선순위 git < 진단 < 미저장(액센트).
3. **심볼 브레드크럼** (`CodeCrumbs` + `enclosingChain`). 폴더 › 파일 › 커서가 든 심볼 사슬(바깥→안쪽, 깊이가 한 단씩 줄어드는 것만). 클릭하면 점프. 이 때문에 파일이 열려 있으면 documentSymbol 을 늘 묻는다(열 때 + 저장·포맷 때).
4. **줄바꿈 ⌥Z** — 워크스페이스 `codeWordWrap: auto|on|off`, auto 는 산문(md·txt·mdx·rst·adoc)만 켠다 (스크린샷의 AGENTS.md 가 화면 밖으로 달아나던 것). 상태줄 토글 버튼(`aria-pressed`)과 같은 값. Monaco 는 `updateOptions` 로 재마운트 없이.
5. **사이드바 ⌘B** — `codeSidebarHidden`. 툴바 첫 버튼(PanelLeftClose/Open, `aria-pressed`). ⇧⌘F 검색은 접혀 있어도 편다.
6. **상태줄 상호작용** (`CodeStatusBar`) — Ln/Col 이 버튼(→ ⌃G 줄 이동 위젯), 선택이 있으면 "N줄 · M자 선택"(`onCursor` 에 세 번째 인자, `onDidChangeCursorSelection` 하나로 통합), 줄바꿈 토글. 빈 상태 치트시트에 ⌘P·⌘B·⌥Z 추가.
7. **미니맵 회귀 수정** — `updateOptions({ minimap: { enabled } })` 가 마운트 직후 한 번 돌며 덩어리 렌더·상시 손잡이를 기본값으로 되돌리고 있었다. `minimapOptions()` 한 벌로 통일, 테스트가 문다.

## 동작 흐름

- 래칫: `CodePane` 1,593→1,558 (상태줄·브레드크럼 분리), `CodeScreenV2` 1,491→1,473 (툴바 `CodeToolbar` 분리 후 기능 추가). `lint:bindings` 때문에 git 은 `@/api/git` 래퍼로.
- 순수 모델 자물쇠 `code_ide_round.test.ts` 12건 (순위·낱말·동점·폴더 말기·심볼 사슬·산문 판정).

## 검증

- typecheck · 코드/Monaco/디자인/a11y/blocked/glossary 스위트 41파일 566건 통과 · lint 6게이트(bindings·design·filesize·storage·i18n·eslint) 내 파일 기준 통과 · build 통과.
- **남의 실패**: 워킹트리에 병렬 세션의 일지 화면 라운드(`zz_*_harness` · `EntryFileBar` 등 15파일)가 함께 있어, `lint:i18n`(zz 하네스 한글) · `lint:filesize`(`ptyhost/host/mod.rs` · `TerminalInstanceImpl.tsx`) · `zz_dump_harness settings` 가 붉다. HEAD 격리 워크트리가 아니라 stash 로 확인하다 그 세션 파일을 몇 초 걷어 갔다(pop 으로 복구) — 메모리에 금지로 적었다.
- 육안 확인은 여전히 못 했다 (권한). `monaco-editor-round {#fin-eyes}` 격자에 ⌘P·git 배지·심볼 크럼·줄바꿈 상태줄이 추가로 걸린다.