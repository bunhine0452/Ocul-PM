---
oculpm_plan: v1
id: planner-scale-tidy
title: "계획이 쌓여도 목록은 짧게 — 플래너 정리·레일 조절"
status: active
created: 2026-09-03
updated: 2026-09-03
owner: claude-code
---

에이전트가 작업 단위마다 계획을 만들어 '완료' 가 39개까지 자랐다. 쌓인 것을 접고(월별·상한), 치우고(보관), 레일 자체를 사람이 조절할 수 있게 한다.

## 쌓인 걸 접는다 {#fold}
- [x] 완료·보관 묶음이 12개를 넘으면 월별 섹션으로 분할 (planList.splitByMonth) {#month-split}
- [x] 섹션 행 상한 10 + "N개 더 보기" — 검색 중에는 상한 해제, ↑/↓ 는 보이는 행만 {#row-cap}

## 쌓인 걸 치운다 {#archive}
- [x] plan_set_status_bulk 백엔드 커맨드 — 락 1회·재투영 1회 {#bulk-cmd}
- [x] 완료 섹션 헤더의 보관 버튼 + 인라인 확인 {#section-archive}
- [x] 계획 헤더 단건 보관 버튼 (완료 상태에서만) · 보관 상태 칩 구분 {#single-archive}

## 레일을 사람이 조절한다 {#rail}
- [x] PlanRailDock — 폭 드래그·←/→ 키·더블클릭 리셋 (170~460px) {#resize}
- [x] 좌/우 이동 — DOM 순서 그대로 두 자리 렌더 (row-reverse 금지) {#side}
- [x] plannerRailWidth / plannerRailSide 영속 {#persist}

## 곁다리 — 파일 크기 래칫 {#ratchet}
- [x] PlannerScreenV2 에서 PlanItemRow · planMeta 분리 (1408→1090줄) {#split-screen}
- [x] WorkspaceContext 에서 DEFAULT_STATE 분리 (TDZ 회피로 스키마 상수 동반 이동) {#split-context}

## 남은 것 {#next}
- [ ] 실기기 육안 확인 — 드래그 감각·오른쪽 배치·월 섹션 라벨 {#eyeball}
- [ ] 뿌리 원인: plan_create 시 유사한 활성 계획이 있으면 재사용을 권하기 (MCP 서버 쪽) {#dedupe-on-create}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-09-03T20:30:12+09:00 | #month-split | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/2029_feature_planner-rail-tidy-and-resize.md | MONTH_SPLIT_MIN=12, 최신 달이 위, 기록 없음은 맨 아래 |
| 2026-09-03T20:30:17+09:00 | #row-cap | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/2029_feature_planner-rail-tidy-and-resize.md | ROW_CAP=10, rowsOf 를 ↑/↓ 이동과 공유 |
| 2026-09-03T20:30:22+09:00 | #bulk-cmd | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/2029_feature_planner-rail-tidy-and-resize.md | 알 수 없는 id 는 건너뛰고 고쳐 쓴 수를 반환 |
| 2026-09-03T20:30:27+09:00 | #section-archive | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/2029_feature_planner-rail-tidy-and-resize.md | 헤더를 버튼→줄(div+두 버튼)로, axe 통과 |
| 2026-09-03T20:30:32+09:00 | #single-archive | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/2029_feature_planner-rail-tidy-and-resize.md | 되돌리기는 기존 '잠금 해제' 하나로 |
| 2026-09-03T20:30:36+09:00 | #resize | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/2029_feature_planner-rail-tidy-and-resize.md | 드래그 중엔 로컬 값, 놓을 때만 영속 |
| 2026-09-03T20:30:41+09:00 | #side | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/2029_feature_planner-rail-tidy-and-resize.md | 코드 화면 codeSidebarSide 와 같은 규약 |
| 2026-09-03T20:30:46+09:00 | #persist | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/2029_feature_planner-rail-tidy-and-resize.md | WorkspaceContext 경유 (localStorage 규율) |
| 2026-09-03T20:30:51+09:00 | #split-screen | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/2029_feature_planner-rail-tidy-and-resize.md | 래칫이 한 줄도 못 늘리게 막아 먼저 쪼갬 |
| 2026-09-03T20:30:56+09:00 | #split-context | claude-code | ☐→x | .oculpm/journal/20260903/Features_to_add/2029_feature_planner-rail-tidy-and-resize.md | WORKSPACE_SCHEMA_VERSION 을 defaults 로 옮겨 TDZ 회피 |
<!-- oculpm:plan-log end -->
