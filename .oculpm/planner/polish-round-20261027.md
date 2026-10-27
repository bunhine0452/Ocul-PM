---
oculpm_plan: v1
id: polish-round-20261027
title: "완성도 라운드 (2026-10-27) — 약속 문서 · 화면 3등급 · 릴리스 리듬 · 경계 테스트 · 플랜 끝 적기 · 캐시 정리"
status: active
created: 2026-10-27
updated: 2026-10-27
owner: claude-code
---

완성도의 부족은 기능이 아니라 확인·범위·약속에 있다(10월 릴리스 16 · fix 59:feat 10 · 육안 확인 대기 28 · 외부 사용자 신호 0). 코드를 더 쓰지 않고 무엇을 하지 않을지와 누가 확인하는지를 바꾼다.

**완료 조건:** 약속 문서가 main 에 있고 README · 랜딩 첫 화면이 그와 일치하며, bump-version 이 리듬 경고 둘을 내고, 경계 테스트가 CI 에서 초록이고, 활성 플랜 전부에 완료 조건이 적혀 있으면 코드 쪽은 끝. 확인 날 28건과 외부 관찰 3명은 사용자 몫이고, 그 둘이 끝나면 플랜을 닫는다.

## 약속 문서 한 장 {#promise}
- [x] docs/PROMISE.md — 이 앱이 하는 일 10문장 이하 · 약속하지 않는 것 · 등급 표 {#promise-doc}
- [x] README ko/en — 한 왕복 섹션 위에 약속 블록, 화면 구성에 등급 표기 {#promise-readme}
- [x] landing ko/en — 왕복 섹션에 약속 한 문장 + 보류 등급 표면에 베타 표기 {#promise-landing}
- [x] docs/README.md 살아 있는 설계 표에 PROMISE.md 등재 {#promise-docs-index}

## 화면 3등급 {#tiers}
- [x] CLAUDE.md 범위 동결 아래 등급 표 — 핵심(Today·Journal·Diff·Planner) · 뷰어(검색·논의·브랜치·스킬) · 보류(터미널·편집기·Claude Code·Codex·AI 패널): 보류는 결함 수정만 {#tiers-claude-md}
- [ ] [사용자 결정] 터미널 — 10월 fix 1위(9건). 보류 유지 vs 걷기 후보 승격 {#tiers-terminal-decision}

## 릴리스 리듬 {#cadence}
- [x] RELEASE.md §0-2 — 패치 자유 · 마이너 2주 1회 · 마이너 전날 확인 날(eyes 0) · 하루 둘째 릴리스 금지 {#cadence-release-md}
- [x] bump-version — 오늘 이미 태그가 있으면 경고(막지 않음) {#cadence-bump-same-day}
- [x] bump-version — 마이너 bump 때 활성 플랜의 미확인 eyes 항목 수를 경고 {#cadence-bump-eyes}
- [x] bump_version.test.ts 에 두 경고의 순수 함수 테스트 {#cadence-tests}

## 경계 테스트 {#boundary-tests}
- [x] src-tauri/tests — MCP journal_write(call_tool) → 실제 .oculpm 디스크 → JournalCache reindex → list_entries 에 같은 slug 가 선다 {#boundary-mcp-cache}

## 외부 눈 {#outside-eyes}
- [x] docs/launch/first-user-observation.md — 30분 관찰 프로토콜(설치→첫 일지), 기록 양식, 멈춤 지점 분류 {#observe-protocol}
- [ ] [사용자 액션] 한국에서 Claude Code 쓰는 개발자 3명 관찰 — 결과는 이 플랜 로그에 {#observe-three-users}

## 플랜에 끝을 적기 {#plan-endings}
- [x] active 플랜 10개 본문에 「완료 조건:」 한 줄 (frontmatter 는 손대지 않음) {#endings-active-plans}

## 확인 날 — 육안 확인 대기 28건 {#eyes-day}
- [~] [사용자] bug-opt-round-20261018 의 eyes 7건 확인 {#sweep-bug-opt}
- [~] [사용자] improvement-round-2026-09-14 의 eyes 9건 확인 {#sweep-improvement}
- [~] [사용자] optimize-round-20261024 의 eyes 8건 확인 {#sweep-optimize}
- [~] [사용자] artifact-board-drop-notion 의 eyes 3건 확인 {#sweep-board}
- [ ] [사용자] compact-chrome 의 eyes 1건 확인 {#sweep-chrome}

## 캐시 정리 {#cache}
- [x] 개발 캐시 — src-tauri/target 증분(pnpm clean:target) · node_modules/.vite · ~/Library/Caches/ai-pm(옛 dev 웹뷰) · pnpm store prune {#cache-dev}
- [ ] [사용자 결정] app-data 의 ocul-pm.db.bak-v40(735MB, 10-14 마이그레이션 백업) 삭제 · 진단 탭 compact(DB 837MB) {#cache-app-decision}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-10-27T19:32:04+09:00 | #promise-doc | claude-code | ☐→x | .oculpm/journal/20261027/Chores/1931_chore_polish-round-promise-tiers-cadence.md | docs/PROMISE.md — 10문장 · 등급 표 · 지키는 장치 표 |
| 2026-10-27T19:32:11+09:00 | #promise-readme | claude-code | ☐→x | .oculpm/journal/20261027/Chores/1931_chore_polish-round-promise-tiers-cadence.md | README ko/en 약속 블록 + 화면 12개 등급 태그 |
| 2026-10-27T19:32:20+09:00 | #promise-landing | claude-code | ☐→x | .oculpm/journal/20261027/Chores/1931_chore_polish-round-promise-tiers-cadence.md | landing ko/en 왕복 문장 + 콘솔·⌘J 베타 배지, wiki screens ko/en 등급 문단 (build.mjs). 배포는 다음 릴리스와 함께 |
| 2026-10-27T19:32:28+09:00 | #promise-docs-index | claude-code | ☐→x | .oculpm/journal/20261027/Chores/1931_chore_polish-round-promise-tiers-cadence.md |  |
| 2026-10-27T19:32:37+09:00 | #tiers-claude-md | claude-code | ☐→x | .oculpm/journal/20261027/Chores/1931_chore_polish-round-promise-tiers-cadence.md | CLAUDE.md Screen tiers 규칙 — 보류는 결함 수정만 |
| 2026-10-27T19:32:47+09:00 | #cadence-release-md | claude-code | ☐→x | .oculpm/journal/20261027/Chores/1931_chore_polish-round-promise-tiers-cadence.md | RELEASE.md §0-2 |
| 2026-10-27T19:32:53+09:00 | #cadence-bump-same-day | claude-code | ☐→x | .oculpm/journal/20261027/Chores/1931_chore_polish-round-promise-tiers-cadence.md | tagsCutOn + todayIso, git tag 읽기 실패도 알림 |
| 2026-10-27T19:33:03+09:00 | #cadence-bump-eyes | claude-code | ☐→x | .oculpm/journal/20261027/Chores/1931_chore_polish-round-promise-tiers-cadence.md | isMinorBump + pendingEyes(readPlans) — 실측 5플랜 28건 |
| 2026-10-27T19:33:10+09:00 | #cadence-tests | claude-code | ☐→x | .oculpm/journal/20261027/Chores/1931_chore_polish-round-promise-tiers-cadence.md | 4건 — bump_version.test.ts 10/10 |
| 2026-10-27T19:33:18+09:00 | #boundary-mcp-cache | claude-code | ☐→x | .oculpm/journal/20261027/Chores/1931_chore_polish-round-promise-tiers-cadence.md | mcp_write_to_cache.rs 2건 — 응답 path 는 루트 기준(.oculpm/journal/…) |
| 2026-10-27T19:33:24+09:00 | #observe-protocol | claude-code | ☐→x | .oculpm/journal/20261027/Chores/1931_chore_polish-round-promise-tiers-cadence.md | docs/launch/first-user-observation.md |
| 2026-10-27T19:33:34+09:00 | #endings-active-plans | claude-code | ☐→x | .oculpm/journal/20261027/Chores/1931_chore_polish-round-promise-tiers-cadence.md | 11개 플랜(이 플랜 포함) 본문에 완료 조건 한 줄 |
| 2026-10-27T19:33:43+09:00 | #cache-dev | claude-code | ☐→x | .oculpm/journal/20261027/Chores/1931_chore_polish-round-promise-tiers-cadence.md | target 9.7→6.8GB · .vite 51MB · Caches/ai-pm 482MB · pnpm store prune 1831 패키지 |
| 2026-10-27T19:51:04+09:00 | #sweep-bug-opt | claude-code | ☐→~ | .oculpm/journal/20261027/Chores/1950_chore_eyes-sweep-machine-evidence.md | 7 → 기계로 1 닫음(quit-panic) · 2 사전조사(vec0 compact 미실행 · ptyhost 옛 호스트 아직 살아 있음) · 눈 4(tiny-fit · webgl · gitignore · fit-bottom-row) |
| 2026-10-27T19:51:21+09:00 | #sweep-improvement | claude-code | ☐→~ | .oculpm/journal/20261027/Chores/1950_chore_eyes-sweep-machine-evidence.md | 9 → 기계로 1 닫음(en-surfaces) · 1 부분(round-0914: ANSI 0 · mcp 1/프로젝트) · 눈 7(compact · 드래그 7 · 터미널 4 · Claude 연동 5 · 첫 실행 · 버그헌팅 0922 · 보안 실기기) |
| 2026-10-27T19:51:32+09:00 | #sweep-optimize | claude-code | ☐→~ | .oculpm/journal/20261027/Chores/1950_chore_eyes-sweep-machine-evidence.md | 8 → 기계로 1 닫음(sqlite353) · 2 사전조사(restart 교체·재기동 OK, acp 어댑터 0.81/1.8 로 낡음=화면 미열람) · 눈 5(tray · focus-drop · ui-react193 · removals · worktree-index) |
| 2026-10-27T19:51:42+09:00 | #sweep-board | claude-code | ☐→~ | .oculpm/journal/20261027/Chores/1950_chore_eyes-sweep-machine-evidence.md | 3 → 기계로 1 닫음(keychain) · 1 사전조사(plugin-root: 플러그인 3.13.6+ 로 올린 뒤 /oculpm:board) · 눈 1(board-phone) |
<!-- oculpm:plan-log end -->
