---
oculpm_plan: v1
id: polish-round-20261027
title: "완성도 라운드 (2026-10-27) — 약속 문서 · 화면 3등급 · 릴리스 리듬 · 경계 테스트 · 플랜 끝 적기 · 캐시 정리"
status: active
created: 2026-10-27
updated: 2026-10-28
owner: claude-code
---

완성도의 부족은 기능이 아니라 확인·범위·약속에 있다(10월 릴리스 16 · fix 59:feat 10 · 육안 확인 대기 28 · 외부 사용자 신호 0). 코드를 더 쓰지 않고 무엇을 하지 않을지와 누가 확인하는지를 바꾼다.

**완료 조건:** 코드 쪽은 2026-10-27 에 끝났다. 이 플랜은 이제 **확인 날·사용자 결정 받은함**이다 — 2026-10-28 덜어내기 라운드에서 닫은 14개 플랜의 미완 `[사용자]` 항목이 전부 여기로 옮겨졌다(기술 부채는 tech-backlog-20261028). 확인 날 항목 전부와 외부 관찰 3명, 사용자 결정·액션이 끝나면 닫는다.

## 약속 문서 한 장 {#promise}
- [x] docs/PROMISE.md — 이 앱이 하는 일 10문장 이하 · 약속하지 않는 것 · 등급 표 {#promise-doc}
- [x] README ko/en — 한 왕복 섹션 위에 약속 블록, 화면 구성에 등급 표기 {#promise-readme}
- [x] landing ko/en — 왕복 섹션에 약속 한 문장 + 보류 등급 표면에 베타 표기 {#promise-landing}
- [x] docs/README.md 살아 있는 설계 표에 PROMISE.md 등재 {#promise-docs-index}

## 화면 3등급 {#tiers}
- [x] CLAUDE.md 범위 동결 아래 등급 표 — 핵심(Today·Journal·Diff·Planner) · 뷰어(검색·논의·브랜치·스킬) · 보류(터미널·편집기·Claude Code·Codex·AI 패널): 보류는 결함 수정만 {#tiers-claude-md}
- [x] [사용자 결정] 터미널 — 10월 fix 1위(9건). 보류 유지 vs 걷기 후보 승격 — 2026-10-28 결정: 걷음 (simplify-round-20261028) {#tiers-terminal-decision}

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

## 확인 날 — 옛 라운드 육안 (닫은 플랜에서 옮김, 터미널·편집기·ACP 몫은 폐기) {#eyes-day}
- [~] [사용자] bug-opt-round-20261018 의 eyes — 7건 중 터미널·PTY 호스트 4건은 10-28 폐기, 남은 둘 {#sweep-bug-opt}
  - [ ] 앱이 도는 중 폴더 삭제 → 의미검색에서 빠짐 · .gitignore 편집 → 새로 무시된 경로 미색인 {#eyes-ghost-gitignore}
  - [~] 로그 vec0 partition repacked 확인 · 진단 탭 compact 로 DB 813→~370MB · 다지기 중 탭 init 안 막힘 {#eyes-vec0}
- [~] [사용자] improvement-round-2026-09-14 의 eyes — 9건 중 터미널 1건 폐기, 나머지는 걷은 화면 몫을 뺀 채 {#sweep-improvement}
  - [ ] 설치본 진단 탭 「정리」 → DB 크기·의미 검색 정상, 전체 재색인으로 스냅샷 회수 확인 {#eyes-compact}
  - [~] 죽은 모델 토스트가 색인 뒤 한 번만 뜨는지 · 설정 모델 칸 경고 · 파일 로그에 ANSI 없음 · 유휴 RSS {#eyes-round-0914}
  - [ ] 프로젝트 탭·창 드래그 — 창 두 개 스트립 왕복·배율 다른 모니터·세손가락 드래그·고스트·떼어낸 창 닫기·붐비는 스트립·재부착 Escape {#eyes-tabs-windows}
  - [ ] Claude 연동 실기기 — Claude Desktop 실연결·규칙 탭 CRUD/Cursor .mdc·플러그인 게이트 (Notion·Codex·EVALS 몫은 제거됨) {#eyes-claude-integration}
  - [ ] 첫 실행 마법사 한 바퀴(onboarded 삭제) · 스킬 CRUD/토글 · 프리셋 테마 · Today 리플 언마운트 {#eyes-first-run}
  - [ ] 이벤트 해제 셤이 웹뷰의 모든 Tauri 구독을 지난다 — 테마 다창 반영 · 트레이 딥링크 · 논의 편집기 한글 입력 (터미널·ACP·Monaco 몫은 제거됨) {#eyes-bug-hunt-0922}
  - [ ] 보안 라운드 1~3차 실기기 — CSP 전 화면(wasm 포매터 포함)·위험 모드 확인·자동화 동의 안내/오늘 카드의 바뀐 정의 이름/설정 「허락 거두기」·링크 든 저장소 열기(어댑터·.gitignore 건너뜀 로그)·설정 「지금 동기화」 실패 사유 문구·/Users 추가 거부 문구 {#eyes-security}
- [~] [사용자] optimize-round-20261024 의 eyes — 8건 중 ACP 1건 폐기 {#sweep-optimize}
  - [~] 업데이트 뒤 재시작 — tauri 2.12 open -n 경로로 새 판이 뜨고 트레이·창 복원 · updater 2.14 원자적 교체 {#eyes-restart}
  - [ ] macOS 27 트레이 왼쪽 클릭 팝오버 · 오른쪽 클릭 메뉴 → 되면 tray.rs show_context_menu 우회 걷기 판정 {#eyes-tray}
  - [ ] 새 창 직후 키 입력 즉시 · Finder 끌어다 놓기 (wry 0.57) {#eyes-focus-drop}
  - [ ] 다이얼로그·메뉴·툴팁·select·scroll-area 모양과 포커스, 아이콘 (React 19.3 · radix 1.8.1 · lucide 1.61) {#eyes-ui-react193}
  - [ ] 걷은 기능의 빈자리 — 설정 탭 · ⌘1~⌘8 재배정 안내 · 딥링크 open, 죽은 버튼 없음 (10-28 제거분 포함) {#eyes-removals}
  - [ ] 프로젝트 안 worktree 사본이 의미 검색·로컬 히스토리에서 빠짐 · 기동 화해 뒤 DB 크기 감소 {#eyes-worktree-index}
- [-] [사용자] artifact-board-drop-notion 의 eyes 3건 확인 — 보드 스킬 제거(2026-10-28)로 폐기 {#sweep-board}
- [ ] [사용자] compact-chrome 의 eyes 1건 확인 {#sweep-chrome}
  - [ ] 설치본에서 8화면 툴바·시트 모서리·라이트·다크·글자 크기 설정 110% {#eyes-compact-chrome}

## 확인 날 — 10-27~28 라운드 육안 (닫은 플랜에서 옮김) {#eyes-day-late}
- [ ] [사용자] Today 「약속 성적표」 숫자가 `python3 docs/launch/agent-report-card.py` 와 같은 자리(증거 비율·7일 재수정)에서 맞는다 (← best-results-round-20261028) {#eyes-scorecard}
- [ ] [사용자] 플러그인 업데이트 뒤 새 세션 시작 컨텍스트에 플랜마다 완료 조건·확인 명령 줄이 실리고, 활성 플랜이 넷이면 최근 갱신 셋만 실린다 (← best-results-round-20261028) {#eyes-hook-check}
- [ ] [사용자] 새 빌드로 Today 에 드리프트 카드(3.3.0 → 새 판)가 뜨고, /plugin update 뒤 사라진다 (← record-quality-round-20261027) {#eyes-drift-card}
- [ ] [사용자] 일지 행에 방패 배지(증거 있음) · 상세 칩 · 모델 이름이 표준형으로 보인다 (← record-quality-round-20261027) {#eyes-evidence-badge}
- [ ] [사용자] 플래너 받은함 — 하나 옮기면 활성 플랜 「이월」 단계에 생기고 받은함에서 빠진다 (← record-quality-round-20261027) {#eyes-carry-inbox}
- [ ] [사용자] 설치본 3.16.0+ 에서 간단↔전문 토글·세 칼럼·증거 카드·플래너 머리글을 눈으로 (← ui-density-round-20261028) {#eyes-density}
- [ ] [사용자] 설정 「표시」 스위치로 베타 행이 접히고 ⌘K 로는 열리는지 · 첫 실행 시트가 일지 0건에만 뜨는지 · 논의 「A 로 결정」이 잠그는지 (터미널·도크 몫은 제거됨, ← ui-density-round-3-20261028) {#eyes-round3}
- [ ] [사용자] 플러그인 업데이트 뒤 .oculpm 만 있는 새 폴더에서 claude 새 세션 — 「플랜·일지 없음」 줄과 확인 명령 후보, Cursor 에서 AGENTS.md v19 만으로 완료 조건 한 줄 (← any-project-best-results-20261028) {#eyes-empty-project}
- [ ] [사용자] 첫 기록 실제 왕복 1회 — 실제 대화의 첫 일지가 Today 카드에 도착하는지 + 촬영 (← first-record-loop #p1-verify #p3-intro) {#eyes-first-record}
- [ ] [사용자] 새 플러그인 판으로 /oculpm:redteam 한 번 — 반례 보고를 이 플랜 로그에 (← ambition-round-20261027) {#redteam-dogfood}

## 사용자 액션 (닫은 플랜에서 옮김) {#user-actions}
- [ ] [사용자 액션] release 환경 보호 — 필수 승인자 + 배포 정책(태그 v*) → 서명 비밀 7개(APPLE_* 6 · TAURI_PRIVATE_KEY)를 환경 비밀로 옮기고 저장소 비밀에서 삭제. 비밀을 옮기지 않으면 승인자는 막는 것이 없다. 키 재발급 금지 (← external-review-2026-10-08 #release-env) {#release-env}
- [ ] [사용자 액션] 저장소 topics·Show HN/awesome 런칭 (← improvement-round-2026-09-14 #star-outreach) {#star-outreach}
- [ ] [사용자 액션] VS Marketplace·Open VSX 의 oculpm.ocul-pm 지원 중단/게시 취소 · 저장소 시크릿 OPEN_VSX_TOKEN·VSCE_PAT 삭제 (← optimize-round-20261024 #carry-vscode-market) {#carry-vscode-market}

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
| 2026-10-28T23:25:06+09:00 | #tiers-terminal-decision | claude-code | ☐→x |  | 사용자 결정 10-28: 터미널·보류 등급 전부 걷음 |
| 2026-10-28T23:25:09+09:00 | #sweep-board | claude-code | ~→- |  | 보드 스킬 제거(10-28)로 폐기 |
| 2026-10-28T23:25:12+09:00 | #eyes-ghost-gitignore | claude-code | →☐ |  | ← bug-opt-round-20261018 (플랜 18→4, simplify-round-20261028 #plans-4) |
| 2026-10-28T23:25:15+09:00 | #eyes-vec0 | claude-code | →☐ |  | ← bug-opt-round-20261018 (플랜 18→4, simplify-round-20261028 #plans-4) |
| 2026-10-28T23:25:18+09:00 | #eyes-compact | claude-code | →☐ |  | ← improvement-round-2026-09-14 (플랜 18→4, simplify-round-20261028 #plans-4) |
| 2026-10-28T23:25:21+09:00 | #eyes-round-0914 | claude-code | →☐ |  | ← improvement-round-2026-09-14 (플랜 18→4, simplify-round-20261028 #plans-4) |
| 2026-10-28T23:25:24+09:00 | #eyes-tabs-windows | claude-code | →☐ |  | ← improvement-round-2026-09-14 (플랜 18→4, simplify-round-20261028 #plans-4) |
| 2026-10-28T23:25:27+09:00 | #eyes-claude-integration | claude-code | →☐ |  | ← improvement-round-2026-09-14 (플랜 18→4, simplify-round-20261028 #plans-4) |
| 2026-10-28T23:25:30+09:00 | #eyes-first-run | claude-code | →☐ |  | ← improvement-round-2026-09-14 (플랜 18→4, simplify-round-20261028 #plans-4) |
| 2026-10-28T23:25:33+09:00 | #eyes-bug-hunt-0922 | claude-code | →☐ |  | ← improvement-round-2026-09-14 (플랜 18→4, simplify-round-20261028 #plans-4) |
| 2026-10-28T23:25:36+09:00 | #eyes-security | claude-code | →☐ |  | ← improvement-round-2026-09-14 (플랜 18→4, simplify-round-20261028 #plans-4) |
| 2026-10-28T23:25:39+09:00 | #eyes-restart | claude-code | →☐ |  | ← optimize-round-20261024 (플랜 18→4, simplify-round-20261028 #plans-4) |
| 2026-10-28T23:25:42+09:00 | #eyes-tray | claude-code | →☐ |  | ← optimize-round-20261024 (플랜 18→4, simplify-round-20261028 #plans-4) |
| 2026-10-28T23:25:45+09:00 | #eyes-focus-drop | claude-code | →☐ |  | ← optimize-round-20261024 (플랜 18→4, simplify-round-20261028 #plans-4) |
| 2026-10-28T23:25:48+09:00 | #eyes-ui-react193 | claude-code | →☐ |  | ← optimize-round-20261024 (플랜 18→4, simplify-round-20261028 #plans-4) |
| 2026-10-28T23:25:51+09:00 | #eyes-removals | claude-code | →☐ |  | ← optimize-round-20261024 (플랜 18→4, simplify-round-20261028 #plans-4) |
| 2026-10-28T23:25:54+09:00 | #eyes-worktree-index | claude-code | →☐ |  | ← optimize-round-20261024 (플랜 18→4, simplify-round-20261028 #plans-4) |
| 2026-10-28T23:25:57+09:00 | #eyes-compact-chrome | claude-code | →☐ |  | ← compact-chrome (플랜 18→4, simplify-round-20261028 #plans-4) |
| 2026-10-28T23:26:00+09:00 | #eyes-scorecard | claude-code | →☐ |  | ← best-results-round-20261028 (플랜 18→4, simplify-round-20261028 #plans-4) |
| 2026-10-28T23:26:03+09:00 | #eyes-hook-check | claude-code | →☐ |  | ← best-results-round-20261028 (플랜 18→4, simplify-round-20261028 #plans-4) |
| 2026-10-28T23:26:06+09:00 | #eyes-drift-card | claude-code | →☐ |  | ← record-quality-round-20261027 (플랜 18→4, simplify-round-20261028 #plans-4) |
| 2026-10-28T23:26:09+09:00 | #eyes-evidence-badge | claude-code | →☐ |  | ← record-quality-round-20261027 (플랜 18→4, simplify-round-20261028 #plans-4) |
| 2026-10-28T23:26:12+09:00 | #eyes-carry-inbox | claude-code | →☐ |  | ← record-quality-round-20261027 (플랜 18→4, simplify-round-20261028 #plans-4) |
| 2026-10-28T23:26:15+09:00 | #eyes-density | claude-code | →☐ |  | ← ui-density-round-20261028 (플랜 18→4, simplify-round-20261028 #plans-4) |
| 2026-10-28T23:26:18+09:00 | #eyes-round3 | claude-code | →☐ |  | ← ui-density-round-3-20261028 (플랜 18→4, simplify-round-20261028 #plans-4) |
| 2026-10-28T23:26:21+09:00 | #eyes-empty-project | claude-code | →☐ |  | ← any-project-best-results-20261028 (플랜 18→4, simplify-round-20261028 #plans-4) |
| 2026-10-28T23:26:24+09:00 | #eyes-first-record | claude-code | →☐ |  | ← first-record-loop (플랜 18→4, simplify-round-20261028 #plans-4) |
| 2026-10-28T23:26:27+09:00 | #redteam-dogfood | claude-code | →☐ |  | ← ambition-round-20261027 (플랜 18→4, simplify-round-20261028 #plans-4) |
| 2026-10-28T23:26:30+09:00 | #release-env | claude-code | →☐ |  | ← external-review-2026-10-08 (플랜 18→4, simplify-round-20261028 #plans-4) |
| 2026-10-28T23:26:33+09:00 | #star-outreach | claude-code | →☐ |  | ← improvement-round-2026-09-14 (플랜 18→4, simplify-round-20261028 #plans-4) |
| 2026-10-28T23:26:36+09:00 | #carry-vscode-market | claude-code | →☐ |  | ← optimize-round-20261024 (플랜 18→4, simplify-round-20261028 #plans-4) |
<!-- oculpm:plan-log end -->
