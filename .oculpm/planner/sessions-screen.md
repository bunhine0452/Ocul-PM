---
oculpm_plan: v1
id: sessions-screen
title: "세션 화면 — 묶기가 Today 카드에서 나온다"
status: active
created: 2026-09-04
updated: 2026-09-04
owner: claude-code
---

## 화면을 낸다 {#p1}
- [x] Today 에서 A2A 카드를 전부 걷어내고 A2aCard.tsx 를 지운다 {#today-a2a-a2acardtsx}
- [x] navRegistry 에 「세션」을 맨 뒤로 추가 — 앞 10칸의 ⌘번호는 건드리지 않는다 {#navregistry-10}
- [x] ShellV2 지연 청크 + UiV2View 에 sessions + 딥링크 허용 목록 {#shellv2-uiv2view-sessions}
- [x] 승인 대기는 사이드바 배지로 — Claude Code·Codex 가 쓰는 그 배지 {#claude-codecodex}

## 고를 수 있게 한다 {#p2}
- [x] 두 단 보드 — 왼쪽 묶이지 않음, 오른쪽 팀 레인 + 「새 팀」 자리 {#p2-1}
- [x] 드래그 — 팀에 넣기·팀에서 빼기·새 팀에 고르기 {#p2-2}
- [x] 드래그 없이도 끝난다 — 체크박스 + 대상 선택 + 행동 줄, axe 0 위반 {#axe-0}
- [x] 카드에 표면·pid·잡은 구역·마지막 활동을 겹쳐 그린다 {#pid}
- [x] 사용자가 붙이는 별명 — 워크스페이스에만, 원장에는 안 쓴다 {#p2-5}
- [x] 빈 보드가 등록 방법을 말한다 — 세션은 스스로 등록해야 목록에 온다 {#p2-6}

## 정리와 게이트 {#p3}
- [x] groups::refusal 이 가리키는 자리를 새 화면으로 — 두 곳이 다른 곳을 가리키면 안 된다 {#groupsrefusal}
- [x] WorkspaceState 를 전용 모듈로 분리 — 파일 크기 래칫이 옳았다 {#workspacestate}
- [x] 마스터플랜에 D8 — D4 를 뒤집는 결정 {#d8-d4}
- [x] typecheck · test · lint · build 게이트 {#typecheck-test-lint-build}
- [x] 릴리스 표면(README ko/en · landing)의 「Today 의 함께 일하는 중」 문구 — 다음 릴리스 노트에서 옮긴다 (과거 버전 절은 역사라 고치지 않는다) {#readme-koen-landing-today}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-09-04T08:08:30+09:00 | #today-a2a-a2acardtsx | claude-code | ☐→x |  |  |
| 2026-09-04T08:08:35+09:00 | #navregistry-10 | claude-code | ☐→x |  |  |
| 2026-09-04T08:08:39+09:00 | #shellv2-uiv2view-sessions | claude-code | ☐→x |  |  |
| 2026-09-04T08:08:44+09:00 | #claude-codecodex | claude-code | ☐→x |  |  |
| 2026-09-04T08:08:49+09:00 | #p2-1 | claude-code | ☐→x |  |  |
| 2026-09-04T08:08:54+09:00 | #p2-2 | claude-code | ☐→x |  |  |
| 2026-09-04T08:08:59+09:00 | #axe-0 | claude-code | ☐→x |  |  |
| 2026-09-04T08:09:04+09:00 | #pid | claude-code | ☐→x |  |  |
| 2026-09-04T08:09:10+09:00 | #p2-5 | claude-code | ☐→x |  |  |
| 2026-09-04T08:09:15+09:00 | #p2-6 | claude-code | ☐→x |  |  |
| 2026-09-04T08:09:19+09:00 | #groupsrefusal | claude-code | ☐→x |  |  |
| 2026-09-04T08:09:24+09:00 | #workspacestate | claude-code | ☐→x |  |  |
| 2026-09-04T08:09:29+09:00 | #d8-d4 | claude-code | ☐→x |  |  |
| 2026-09-04T08:09:35+09:00 | #typecheck-test-lint-build | claude-code | ☐→x |  |  |
| 2026-09-04T12:58:17+09:00 | #readme-koen-landing-today | claude-code | ☐→x |  | 랜딩 ko/en 6곳(JSON-LD FAQ·벤토·details)을 「세션」 화면으로. README:96 은 v2.37.0 절이라 역사로 둠 |
<!-- oculpm:plan-log end -->
