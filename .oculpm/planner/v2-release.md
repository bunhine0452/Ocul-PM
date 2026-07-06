---
oculpm_plan: v1
id: v2-release
title: "v2.0.0 대규모 업데이트 — 키보드 퍼스트·되돌려주기·자원 규율"
status: active
created: 2026-07-06
updated: 2026-07-06
owner: claude-code
---

설계 SSOT: `docs/20260706_v2/00-master-plan.md`. 유닛당 1커밋+1일지, 게이트 전부 exit 0 확인.

## Phase 0 — 설계 {#design}
- [x] 마스터 플랜 + UX/기능/성능 스펙 문서 작성 {#v2-docs}

## Phase 1 — 빠른 승리 {#round1}
- [x] U1 단축키·팔레트 정비 (navRegistry 단일 소스, 누락 3화면, ⌘번호 일치, ⌘P) {#nav-registry}
- [x] U2 Toaster 테마 토큰화 + 공용 Skeleton (Today·Journal·Planner 적용) {#toaster-skeleton}
- [x] U3 WorkspaceContext 리렌더 수술 (value 메모·recentChanges 스토어 분리·persist 디바운스) {#workspace-render}
- [x] U4 에이전트 감지 확대 — Windsurf/Copilot/Codex/aider/Cline/Zed {#agent-adapters}
- [ ] U5 로그 retention 상한 (max_log_files) {#log-retention}

## Phase 2 — 키보드 & 되돌려주기 {#round2}
- [ ] U6 화면별 lazy 분할 + manualChunks (ShellV2 청크 −40% 목표) {#bundle-split}
- [ ] U7 팔레트 엔티티 점프 — search_entities 커맨드 + go-to-anything {#entity-jump}
- [ ] U8 키보드 diff 검토 — j/k·o·`/` in-diff 검색 {#keyboard-diff}
- [ ] U9 플래너 상태 토글 낙관적 업데이트 {#optimistic-planner}
- [ ] U10 스탠드업·PR 본문 생성 (generate_summary, LLM+결정적 폴백) {#generate-summary}

## Phase 3 — 깊이 & 성능 {#round3}
- [ ] U11 FTS5 텍스트/심볼 검색 (LIKE 풀스캔 제거, 실패시 LIKE 폴백) {#fts-search}
- [ ] U12 workday brief 단일 집계 커맨드 (Today IPC 12+N→3 이하) {#workday-brief}
- [ ] U13 공유 AppDialog 프리미티브 (포커스 트랩·복원, 폼 모달 3곳 이전) {#app-dialog}

## Phase 4 — 릴리스 {#release}
- [ ] 전 게이트 재확인 + 버전 2.0.0 bump + CHANGELOG {#v2-ship}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-07-06T21:20:30+09:00 | #v2-docs | claude-code | →x | journal/20260706/Chores/2120_chore_v2-master-plan-docs.md | docs/20260706_v2 4종(마스터플랜+UX/기능/성능 스펙)+플랜 등록. U1~U13 3라운드, 이월(F6/P2/반응형/폰트) 명시 |
| 2026-07-06T21:31:00+09:00 | #nav-registry | claude-code | →x | journal/20260706/Features_to_add/2131_feature_nav-registry-shortcuts.md | navRegistry 단일 소스(11화면), 팔레트 누락 3화면 해소, ⌘1~9·0=사이드바 순서, ⌘P 실동작(NAV_BUS), hover ⌘힌트. 신규 테스트 5케이스, 게이트 ✓ |
| 2026-07-06T21:34:30+09:00 | #toaster-skeleton | claude-code | →x | journal/20260706/Features_to_add/2134_feature_toaster-theme-skeleton.md | Toaster 다크 하드코딩→카드 토큰+틴트, .skel 승격 Skeleton/SkeletonList(reduced-motion 정지), 일지/플래너/Today 3화면 적용. 게이트 ✓ |
| 2026-07-06T21:43:00+09:00 | #workspace-render | claude-code | →x | journal/20260706/Refactors/2143_refactor_workspace-render-surgery.md | recentChangesStore 분리(useSyncExternalStore, watcher push 가 셸 리렌더 0), persist 300ms 디바운스+flush, value useMemo, 영속 blob 에서 버퍼 제외. 격리 계약 테스트 신설, 게이트 4/4=0 |
| 2026-07-06T21:52:00+09:00 | #agent-adapters | claude-code | →x | journal/20260706/Features_to_add/2152_feature_agent-adapters-expansion.md | 어댑터 5종(windsurf/copilot/aider/cline/zed stub)+codex 귀속, 단어단위 infer, 감지 마커, Settings/색상. Rust 테스트 2개 신설, cargo 332 ✓ |
<!-- oculpm:plan-log end -->
