---
oculpm_plan: v1
id: code-editor-screen
title: "코드 화면 — 인앱 코드 뷰어·에디터"
status: done
created: 2026-08-16
updated: 2026-08-20
owner: claude-code
---

검색·코드맵·diff 가 가리키는 코드를 앱 안에서 바로 열어 보고 가볍게 고치는 13번째 화면. CodeMirror 6 + code_tree/read/write 3 커맨드. SSOT: docs/code-editor/00-master-plan.md

## PR-CODE0 — 백엔드 3 커맨드 {#backend}
- [x] commands/code.rs — code_tree(ignore 워커·자연정렬·상한) / code_read(blake3 해시·바이너리·2MB 가드) / code_write(해시 대조 충돌·원자 저장) {#code-commands}
- [x] lib.rs 등록 + cargo test 로 bindings.ts 재생성 + Rust 단위 테스트 {#code-registration}

## PR-CODE1 — 코드 화면 코어 {#screen}
- [x] CodeEditor.tsx — CM6 마운트, 언어 매핑(codeLang), CSS 변수 테마, ⌘S·라인 점프 {#code-editor-wrap}
- [x] CodeScreenV2 — 트리·필터·버퍼 캐시(codeBuffers)·저장·충돌 배너·watcher 리로드·상태줄 {#code-screen}
- [x] UiV2View·navRegistry 끝 추가·ShellV2 lazy 라우트·codeActivePath 영속·i18n ko/en {#code-shell-wiring}

## PR-CODE2 — 진입점 통합 {#integrations}
- [x] 검색 결과 행 → 코드 화면 라인 점프 (onOpenInCode 핸드오프) {#code-from-search}
- [x] 코드맵 파일 패널 → 코드 화면 열기 {#code-from-graph}

## PR-CODE3 — 품질 {#quality}
- [x] vitest — codeLang·treeUtils·codeBuffers·화면 상태(mocked CM) + a11y {#code-tests}
- [x] typecheck/test/lint/build + cargo test 전부 exit 0 확인 후 커밋·일지 {#code-gates}

## PR-CODE4 — 버그 헌팅 라운드 보강 {#hardening}
- [x] CRLF 파일 저장 시 줄바꿈 보존 — 로드 정규화 + 저장 복원 {#code-crlf-preserve}
- [x] code_read/code_write 심링크 루트 이탈 차단 (canonical_within_root) {#code-symlink-guard}
- [x] 이중 ⌘S 가드 3중 + 백엔드 WRITE_LOCK 저장 직렬화 {#code-double-save}
- [x] dirty 버퍼 축출·외부 삭제 토스트 — 조용한 유실 제거 {#code-loss-notices}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-08-16T18:57:48+09:00 | #code-commands | claude-code | ☐→x | .oculpm/journal/20260816/Features_to_add/1857_feature_code-editor-screen.md | 3 커맨드 + blake3 낙관적 잠금 + 원자 저장 |
| 2026-08-16T18:57:50+09:00 | #code-registration | claude-code | ☐→x | .oculpm/journal/20260816/Features_to_add/1857_feature_code-editor-screen.md | Rust 단위 7개 + bindings 재생성 |
| 2026-08-16T18:57:57+09:00 | #code-editor-wrap | claude-code | ☐→x | .oculpm/journal/20260816/Features_to_add/1857_feature_code-editor-screen.md | CM6 + CSS 변수 테마 + ko phrases |
| 2026-08-16T18:58:03+09:00 | #code-screen | claude-code | ☐→x | .oculpm/journal/20260816/Features_to_add/1857_feature_code-editor-screen.md | 버퍼 LRU·충돌 2중·watcher 리로드 |
| 2026-08-16T18:58:04+09:00 | #code-shell-wiring | claude-code | ☐→x | .oculpm/journal/20260816/Features_to_add/1857_feature_code-editor-screen.md | navRegistry 끝 추가 · codeActivePath 영속 · i18n 39키 |
| 2026-08-16T18:58:06+09:00 | #code-from-search | claude-code | ☐→x | .oculpm/journal/20260816/Features_to_add/1857_feature_code-editor-screen.md | 3 scope 전부 라인 점프 버튼 |
| 2026-08-16T18:58:07+09:00 | #code-from-graph | claude-code | ☐→x | .oculpm/journal/20260816/Features_to_add/1857_feature_code-editor-screen.md | 인스펙터 액션 버튼 |
| 2026-08-16T18:58:09+09:00 | #code-tests | claude-code | ☐→x | .oculpm/journal/20260816/Features_to_add/1857_feature_code-editor-screen.md | vitest 4파일 + axe, Rust 7개 |
| 2026-08-16T18:58:39+09:00 | #code-gates | claude-code | ☐→x | .oculpm/journal/20260816/Features_to_add/1857_feature_code-editor-screen.md | 4대 게이트 + cargo 풀 exit 0 → 4ce3262 커밋 |
| 2026-08-19T07:26:00+09:00 | #code-crlf-preserve | claude-code | ☐→x | .oculpm/journal/20260819/Bugs/0725_bug_code-screen-save-hardening.md | detectEol 다수결 + LF 정규화/복원, CRLF 왕복 테스트 |
| 2026-08-19T07:26:05+09:00 | #code-symlink-guard | claude-code | ☐→x | .oculpm/journal/20260819/Bugs/0725_bug_code-screen-save-hardening.md | canonicalize 포함 검사, 루트 안 심링크는 대상으로 해석 |
| 2026-08-19T07:26:10+09:00 | #code-double-save | claude-code | ☐→x | .oculpm/journal/20260819/Bugs/0725_bug_code-screen-save-hardening.md | stopPropagation+defaultPrevented+savingRef, 전역 뮤텍스 |
| 2026-08-19T07:26:15+09:00 | #code-loss-notices | claude-code | ☐→x | .oculpm/journal/20260819/Bugs/0725_bug_code-screen-save-hardening.md | putBuffer 축출 키 반환→토스트, watcher 실패 경로당 1회 |
<!-- oculpm:plan-log end -->
