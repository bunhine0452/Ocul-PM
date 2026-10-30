---
oculpm_plan: v1
id: orca-bench-20261030
title: "Orca 벤치마킹 넷 — 끌어다 놓기 · 변경 줄 메모 · 터미널 나란히 · worktree 경주"
status: active
created: 2026-10-30
updated: 2026-10-30
owner: claude-code
---

**완료 조건:** Orca(stablyai/orca, MIT)에서 고른 네 기능이 main 에 들어간다(사용자 결정 10-30). 넷은 다음과 같다. 터미널에 파일·그림을 놓으면 따옴표 친 경로가 입력된다. 변경 화면의 줄마다 메모를 달고 한 번에 묶어 Claude 세션에 보낸다. 터미널 세션 둘을 나란히 본다. 같은 프롬프트를 worktree 여럿에서 돌리고, 각 변경을 비교해 하나를 남기고 나머지를 정리한다. 넷 모두 바깥 호스트에 닿지 않고 새 상시 프로세스가 없어야 한다(egress 원장 통과).
**확인 명령:** pnpm typecheck && pnpm test && pnpm lint && pnpm build && cd src-tauri && cargo test --locked

## 작은 것 {#small}
- [x] 터미널에 파일·그림 끌어다 놓기 — 따옴표 친 경로를 활성 세션에 입력(Tauri onDragDropEvent, 놓는 자리 표시) {#drop-files}

## 리뷰 루프 {#review}
- [x] 변경 화면 줄 메모 — 줄을 골라 메모, 메모 목록, 「Claude 에게 보내기」로 줄 번호 붙인 한 묶음을 세션에 넣기 {#diff-notes}

## 터미널 {#term}
- [x] 터미널 나란히 보기 — 세션 둘을 좌우로(⌘\\ 나누기·닫기), 세션은 앱 안 그대로(PTY 호스트·떼어내기 없음) {#term-split}

## 병렬 {#parallel}
- [x] 같은 일을 worktree 여럿에서 — 프롬프트 + 개수로 worktree·세션 만들기, 각 변경 비교, 하나 남기고 정리(git worktree, 프로젝트 worktree 만 cwd 허용) {#worktree-race}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-10-30T18:11:32+09:00 | #drop-files | claude-code | ☐→x | .oculpm/journal/20261030/Features_to_add/1754_feature_terminal-drop-files.md |  |
| 2026-10-30T18:11:36+09:00 | #diff-notes | claude-code | ☐→x | .oculpm/journal/20261030/Features_to_add/1754_feature_diff-line-notes.md |  |
| 2026-10-30T18:11:40+09:00 | #term-split | claude-code | ☐→x | .oculpm/journal/20261030/Features_to_add/1757_feature_terminal-split-two.md |  |
| 2026-10-30T18:11:45+09:00 | #worktree-race | claude-code | ☐→x | .oculpm/journal/20261030/Features_to_add/1811_feature_worktree-race.md |  |
| 2026-10-30T18:52:16+09:00 | #worktree-race | claude-code | x→x |  |  |
<!-- oculpm:plan-log end -->
