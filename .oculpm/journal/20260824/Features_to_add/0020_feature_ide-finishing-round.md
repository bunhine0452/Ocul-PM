---
schema_version: 1
type: feature
slug: ide-finishing-round
status: done
difficulty: medium
created_at: "2026-08-24T00:20:00+09:00"
session_id: "manual-20260824-002000"
agent:
  id: claude-code
  version: claude-fable-5
language: ko
verified_by_user: false
files_touched:
  - path: "src/contexts/WorkspaceContext.tsx"
    op: update
  - path: "src/features/code/CodeScreenV2.tsx"
    op: update
  - path: "src/features/code/CodeEditor.tsx"
    op: update
  - path: "src/features/code/CodePane.tsx"
    op: update
  - path: "src/features/code/useLsp.ts"
    op: update
  - path: "src/features/code/code.css"
    op: update
  - path: "src-tauri/src/commands/lsp.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related:
  - ".oculpm/journal/20260823/Features_to_add/2335_feature_real-icons-and-agent-diff.md"
tags: [code-screen, ide, lsp, ux]
---

[x] IDE 마감 라운드 — 패널 리사이즈 · 선택 영역 포맷 · 비교 버튼 한글화

## 추가 기능

- **하단 패널 드래그 리사이즈** (#panel-resize) — 참조·디버그 패널의 높이를
  경계선을 끌어 조절. 키보드(↑/↓)로도 된다 (separator 가 장식이 되지 않게).
  높이는 `WorkspaceContext.codePanelHeight` 로 영속 — 두 패널이 같은 자리를
  쓰므로 높이도 하나다 (따로 두면 참조↔디버그 전환마다 바닥이 널뛴다).
- **선택 영역 포맷** (#lsp-format 마감) — ⇧⌥F 에 선택이 있으면
  `textDocument/rangeFormatting` 으로 그 범위만 다듬는다. 남의 코드가 섞인
  파일에서 전체 포맷은 diff 를 통째로 물들인다. 서버가 range 를 모르면 전체로
  접는다 (없는 것보단 낫다).
- **인라인 비교 청크 버튼 한글화** — unifiedMergeView 의 Accept/Reject 가
  CM phrase 키였다. koPhrases 에 "받아들이기/되돌리기" 추가.

## 동작 흐름

- 리사이즈는 **드래그 중 로컬 상태, 놓는 순간 영속** — 매 이동을 컨텍스트로
  통과시키면 창 전체가 60fps 로 리렌더된다. Pointer capture 라 빠르게 끌어도
  안 놓친다. 최소 140 / 최대 560px.
- `lsp_format` 의 범위는 **구조체 하나**(`LspFormatRange`)로 받는다 — 낱개
  Option 4개로 폈더니 specta 의 인자 수 한계(12개)에 걸렸다.
- 사용자가 Phase 1~4 전부를 앱에서 확인했다 (2026-08-24) — 플래너의
  #p1-verify · #p2-verify · #p3-verify · #p4-verify 를 닫는다.

## 검증

- 게이트 5종: typecheck · test(1266개 중 1265 통과 + 선재 플래키
  acp_parallel_sessions 1건은 재실행 통과 — 브리핑에 명시된 알려진 문제) ·
  lint · build · cargo test 전부 그린.
- 리사이즈·범위 포맷은 배선 변경이라 기존 화면 테스트가 회귀선이고, 신규
  단언은 눈 확인 대상 (jsdom 은 pointer 드래그·LSP 왕복을 못 본다).

## 메모

- 남은 [~]·미착수: #dap-config(attach·구성 영속) · #dap-more-adapters(debugpy·
  dlv 미설치 — 깔아야 왕복 검증 가능) · #tree-filter(무시된 파일 검색).
- 여기까지로 ide-completion 플랜의 실질 범위가 닫혔다 — 다음 자연스러운 단계는
  릴리스(v2.16.0, docs/RELEASE.md 다섯 면).
