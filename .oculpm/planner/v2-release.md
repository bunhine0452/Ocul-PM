---
oculpm_plan: v1
id: v2-release
title: "v2.0.0 대규모 업데이트 — 키보드 퍼스트·되돌려주기·자원 규율"
status: active
created: 2026-07-06
updated: 2026-07-11
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
- [x] U5 로그 retention 상한 (max_log_files) {#log-retention}

## Phase 2 — 키보드 & 되돌려주기 {#round2}
- [x] U6 화면별 lazy 분할 (ShellV2 청크 −58%, manualChunks 불필요 판정) {#bundle-split}
- [x] U7 팔레트 엔티티 점프 — search_entities 커맨드 + go-to-anything {#entity-jump}
- [x] U8 키보드 diff 검토 — j/k·`/` in-diff 검색·n/N {#keyboard-diff}
- [x] U9 플래너 상태 토글 낙관적 업데이트 {#optimistic-planner}
- [x] U10 스탠드업·PR 본문 생성 (generate_summary, LLM+결정적 폴백) {#generate-summary}

## Phase 3 — 깊이 & 성능 {#round3}
- [x] U11 FTS5 텍스트 검색 (trigram substring 보존, LIKE 폴백; 심볼은 LIKE 유지 판정) {#fts-search}
- [x] U12 workday brief 단일 집계 커맨드 (Today IPC 12+N→3+gitLog) {#workday-brief}
- [x] U13 공유 모달 동작 — useModalBehavior 훅+AppDialog 셸 (폼 모달 3곳+산출물 모달) {#app-dialog}

## Phase 4 — 릴리스 {#release}
- [x] 전 게이트 재확인 + 버전 2.0.0 bump + CHANGELOG {#v2-ship}
- [x] README·랜딩(oculpm.com) v2.0 내용 반영 {#readme-landing-refresh}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-07-06T21:20:30+09:00 | #v2-docs | claude-code | →x | journal/20260706/Chores/2120_chore_v2-master-plan-docs.md | docs/20260706_v2 4종(마스터플랜+UX/기능/성능 스펙)+플랜 등록. U1~U13 3라운드, 이월(F6/P2/반응형/폰트) 명시 |
| 2026-07-06T21:31:00+09:00 | #nav-registry | claude-code | →x | journal/20260706/Features_to_add/2131_feature_nav-registry-shortcuts.md | navRegistry 단일 소스(11화면), 팔레트 누락 3화면 해소, ⌘1~9·0=사이드바 순서, ⌘P 실동작(NAV_BUS), hover ⌘힌트. 신규 테스트 5케이스, 게이트 ✓ |
| 2026-07-06T21:34:30+09:00 | #toaster-skeleton | claude-code | →x | journal/20260706/Features_to_add/2134_feature_toaster-theme-skeleton.md | Toaster 다크 하드코딩→카드 토큰+틴트, .skel 승격 Skeleton/SkeletonList(reduced-motion 정지), 일지/플래너/Today 3화면 적용. 게이트 ✓ |
| 2026-07-06T21:43:00+09:00 | #workspace-render | claude-code | →x | journal/20260706/Refactors/2143_refactor_workspace-render-surgery.md | recentChangesStore 분리(useSyncExternalStore, watcher push 가 셸 리렌더 0), persist 300ms 디바운스+flush, value useMemo, 영속 blob 에서 버퍼 제외. 격리 계약 테스트 신설, 게이트 4/4=0 |
| 2026-07-06T21:52:00+09:00 | #agent-adapters | claude-code | →x | journal/20260706/Features_to_add/2152_feature_agent-adapters-expansion.md | 어댑터 5종(windsurf/copilot/aider/cline/zed stub)+codex 귀속, 단어단위 infer, 감지 마커, Settings/색상. Rust 테스트 2개 신설, cargo 332 ✓ |
| 2026-07-06T21:56:00+09:00 | #log-retention | claude-code | →x | journal/20260706/Chores/2156_chore_log-retention-cap.md | RollingFileAppender builder max_log_files(14), 실패시 무제한 daily 폴백. cargo 332 ✓ |
| 2026-07-06T22:04:00+09:00 | #bundle-split | claude-code | →x | journal/20260706/Features_to_add/2204_feature_screen-lazy-split.md | ShellV2 584→244KB(−58%). 7화면 lazy+공용 스켈레톤 fallback, Markdown/TerminalInstance impl 분리(xterm 288KB 격리 — TodayTerminal 경유 eager 유입이 원인이었음). 게이트 ✓ |
| 2026-07-06T22:18:00+09:00 | #entity-jump | claude-code | →x | journal/20260706/Features_to_add/2218_feature_palette-entity-jump.md | oculpm_search_entities(4캐시 병합·prefix 랭킹·이스케이프)+팔레트 "바로가기"(debounce 120ms, docs_tree 1회 캐시)+NAV_BUS.openEntity 라우팅(jumpNonce remount). Rust 테스트 3, cargo 335 ✓ |
| 2026-07-06T22:26:00+09:00 | #keyboard-diff | claude-code | →x | journal/20260706/Features_to_add/2226_feature_keyboard-diff-review.md | j/k 파일 이동(표시 순서·경계 정지·인풋 가드), `/` 검색+n/N 매치(.dl textContent 수집, PatchView 무침습), kbd 힌트. vitest 신규 1, 게이트 ✓ |
| 2026-07-06T22:36:00+09:00 | #optimistic-planner | claude-code | →x | journal/20260706/Features_to_add/2236_feature_planner-optimistic-toggle.md | 토글 즉시 반영+실패 롤백, busy 게이트 제거(N4 백엔드 직렬화 신뢰), refreshPlans 비차단. vitest 2(pending 낙관·에러 롤백), 게이트 ✓ |
| 2026-07-06T22:52:00+09:00 | #generate-summary | claude-code | →x | journal/20260706/Features_to_add/2252_feature_generate-summary.md | oculpm_generate_summary 3스타일(LLM+결정적 폴백 항상동작, note 정직표기)+list_open_plan_items. 회고 "산출물" 모달+Today "스탠드업 복사". Rust 테스트 4, cargo 339 ✓ |
| 2026-07-06T23:05:00+09:00 | #fts-search | claude-code | →x | journal/20260706/Features_to_add/2305_feature_fts5-text-search.md | 025 chunk_fts(trigram, external-content+트리거 3종+백필), search_text 2단(FTS phrase 인용→3자미만/오류 LIKE 폴백). 심볼은 LIKE 유지 판정(소형 테이블·substring 필수). 통합테스트 5, cargo 344 ✓ |
| 2026-07-06T23:40:00+09:00 | #workday-brief | claude-code | →x | journal/20260706/Features_to_add/2340_feature_workday-brief.md | oculpm_workday_brief(버킷+bytes SUM+미완항목+총계), useNextTasks 삭제·overviewStats 제거, 저널 14콜→1콜. Today IPC 12+N→3+gitLog. mock 이전 17/17, cargo 344 ✓ |
| 2026-07-06T23:52:00+09:00 | #app-dialog | claude-code | →x | journal/20260706/Features_to_add/2352_feature_app-dialog-focus-trap.md | useModalBehavior 훅(트랩·복원·Esc·스크롤락, 마크업 불변 채택 방식)+AppDialog 셸. 수동일지/대화기록/토의승격+산출물 모달 적용. 테스트 4, 게이트 ✓ |
| 2026-07-07T00:10:00+09:00 | #v2-ship | claude-code | →x | journal/20260707/Chores/0010_chore_v2-release-prep.md | 2.0.0 bump(3파일+lock)+CHANGELOG 3축 정리. 최종 게이트 cargo 344/vitest 135/lint/build 전부 0. **v2-release 전 항목 완료** — 태그 푸시는 사용자 결정 대기 |
| 2026-07-11T09:34:00+09:00 | #readme-landing-refresh | claude-code | →x | journal/20260711/Chores/0934_chore_readme-landing-v2-refresh.md | README 전면 재작성(11화면·에이전트 11종·산출물) + 랜딩 벤토 7→11셀·JSON-LD/FAQ/메타 v2.0 현행화. 앱 코드 무변경, 커밋·배포는 사용자 대기 |
<!-- oculpm:plan-log end -->
