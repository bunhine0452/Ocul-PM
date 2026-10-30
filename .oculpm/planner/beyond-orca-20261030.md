---
oculpm_plan: v1
id: beyond-orca-20261030
title: "Orca 를 넘어서 — 레인을 증거로 고르고, 보낸 메모가 고쳐졌는지 안다"
status: active
created: 2026-10-30
updated: 2026-10-30
owner: claude-code
---

**완료 조건:** 두 가지가 main 에 들어간다(사용자 결정 10-30). 하나, 「여럿에서」 띠가 레인마다 그 안의 Claude 가 쓴 일지 제목 · 검증 증거 등급 · 결과 끝 줄을 보이고, 검증된 레인 가운데 변경이 가장 작은 것을 「추천」 한다. 레인에 기록 폴더가 없어도(.oculpm 을 git 에 안 올린 저장소) 일지가 레인에 쓰인다. 둘, 줄 메모는 보낸 뒤에도 남고, 그 줄의 코드가 바뀌면 「고쳐짐」, 그대로면 「아직」 으로 저절로 보이며, 창을 다시 열어도 유지된다.
**확인 명령:** pnpm typecheck && pnpm test && pnpm lint && pnpm build && cd src-tauri && cargo test --locked

## 레인 {#lanes}
- [x] 레인에 기록 폴더 심기 — 원래 프로젝트가 추적 중이고 레인에 .oculpm 이 없으면 config 을 복사해 일지가 레인에 쓰이게 {#lane-oculpm}
- [x] 레인마다 일지 · 증거 — 레인을 만든 뒤의 새 일지 제목 · 증거 등급 · 결과 끝 줄을 띠에, 검증된 레인 중 변경이 가장 작은 것을 추천 {#lane-evidence}

## 메모 {#notes}
- [x] 줄 메모 유지 · 추적 — 보내도 남기고(보냄 표시), 그 줄 코드가 바뀌면 「고쳐짐」 · 그대로면 「아직」, 창을 다시 열어도 유지(WorkspaceContext) {#notes-track}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-10-30T22:46:46+09:00 | #lane-oculpm | claude-code | ☐→x | .oculpm/journal/20261030/Features_to_add/2246_feature_lane-evidence.md |  |
| 2026-10-30T22:46:51+09:00 | #lane-evidence | claude-code | ☐→x | .oculpm/journal/20261030/Features_to_add/2246_feature_lane-evidence.md |  |
| 2026-10-30T22:46:55+09:00 | #notes-track | claude-code | ☐→x | .oculpm/journal/20261030/Features_to_add/2246_feature_diff-notes-track.md |  |
| 2026-10-30T23:11:16+09:00 | #notes-track | claude-code | x→x |  |  |
<!-- oculpm:plan-log end -->
