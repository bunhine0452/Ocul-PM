---
oculpm_plan: v1
id: polish-round-20261027
title: "완성도 라운드 (2026-10-27) — 약속 문서 · 화면 3등급 · 릴리스 리듬 · 경계 테스트 · 플랜 끝 적기 · 캐시 정리"
status: active
created: 2026-10-27
updated: 2026-11-19
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
- [-] [사용자] bug-opt-round-20261018 의 eyes — 7건 중 터미널·PTY 호스트 4건은 10-28 폐기, 남은 둘 {#sweep-bug-opt}
  - [-] 앱이 도는 중 폴더 삭제 → 의미검색에서 빠짐 · .gitignore 편집 → 새로 무시된 경로 미색인 {#eyes-ghost-gitignore}
  - [-] 로그 vec0 partition repacked 확인 · 진단 탭 compact 로 DB 813→~370MB · 다지기 중 탭 init 안 막힘 {#eyes-vec0}
- [~] [사용자] improvement-round-2026-09-14 의 eyes — 9건 중 터미널 1건 폐기, 나머지는 걷은 화면 몫을 뺀 채 {#sweep-improvement}
  - [-] 설치본 진단 탭 「정리」 → DB 크기·의미 검색 정상, 전체 재색인으로 스냅샷 회수 확인 {#eyes-compact}
  - [~] 죽은 모델 토스트가 색인 뒤 한 번만 뜨는지 · 설정 모델 칸 경고 · 파일 로그에 ANSI 없음 · 유휴 RSS {#eyes-round-0914}
  - [-] 프로젝트 탭·창 드래그 — 창 두 개 스트립 왕복·배율 다른 모니터·세손가락 드래그·고스트·떼어낸 창 닫기·붐비는 스트립·재부착 Escape {#eyes-tabs-windows}
  - [-] Claude 연동 실기기 — Claude Desktop 실연결·규칙 탭 CRUD/Cursor .mdc·플러그인 게이트 (Notion·Codex·EVALS 몫은 제거됨) {#eyes-claude-integration}
  - [-] 첫 실행 마법사 한 바퀴(onboarded 삭제) · 스킬 CRUD/토글 · 프리셋 테마 · Today 리플 언마운트 {#eyes-first-run}
  - [ ] 이벤트 해제 셤이 웹뷰의 모든 Tauri 구독을 지난다 — 테마 다창 반영 · 트레이 딥링크 · 논의 편집기 한글 입력 (터미널·ACP·Monaco 몫은 제거됨) {#eyes-bug-hunt-0922}
  - [ ] 보안 라운드 1~3차 실기기 — CSP 전 화면(wasm 포매터 포함)·위험 모드 확인·자동화 동의 안내/오늘 카드의 바뀐 정의 이름/설정 「허락 거두기」·링크 든 저장소 열기(어댑터·.gitignore 건너뜀 로그)·설정 「지금 동기화」 실패 사유 문구·/Users 추가 거부 문구 {#eyes-security}
- [~] [사용자] optimize-round-20261024 의 eyes — 8건 중 ACP 1건 폐기 {#sweep-optimize}
  - [~] 업데이트 뒤 재시작 — tauri 2.12 open -n 경로로 새 판이 뜨고 트레이·창 복원 · updater 2.14 원자적 교체 {#eyes-restart}
  - [-] macOS 27 트레이 왼쪽 클릭 팝오버 · 오른쪽 클릭 메뉴 → 되면 tray.rs show_context_menu 우회 걷기 판정 {#eyes-tray}
  - [ ] 새 창 직후 키 입력 즉시 · Finder 끌어다 놓기 (wry 0.57) {#eyes-focus-drop}
  - [ ] 다이얼로그·메뉴·툴팁·select·scroll-area 모양과 포커스, 아이콘 (React 19.3 · radix 1.8.1 · lucide 1.61) {#eyes-ui-react193}
  - [ ] 걷은 기능의 빈자리 — 설정 탭 · ⌘1~⌘8 재배정 안내 · 딥링크 open, 죽은 버튼 없음 (10-28 제거분 포함) {#eyes-removals}
  - [-] 프로젝트 안 worktree 사본이 의미 검색·로컬 히스토리에서 빠짐 · 기동 화해 뒤 DB 크기 감소 {#eyes-worktree-index}
- [-] [사용자] artifact-board-drop-notion 의 eyes 3건 확인 — 보드 스킬 제거(2026-10-28)로 폐기 {#sweep-board}
- [ ] [사용자] compact-chrome 의 eyes 1건 확인 {#sweep-chrome}
  - [ ] 설치본에서 8화면 툴바·시트 모서리·라이트·다크·글자 크기 설정 110% {#eyes-compact-chrome}

## 확인 날 — 10-27~28 라운드 육안 (닫은 플랜에서 옮김) {#eyes-day-late}
- [ ] [사용자] Today 「약속 성적표」 숫자가 `python3 docs/launch/agent-report-card.py` 와 같은 자리(증거 비율·7일 재수정)에서 맞는다 (← best-results-round-20261028) {#eyes-scorecard}
- [ ] [사용자] 플러그인 업데이트 뒤 새 세션 시작 컨텍스트에 플랜마다 완료 조건·확인 명령 줄이 실리고, 활성 플랜이 넷이면 최근 갱신 셋만 실린다 (← best-results-round-20261028) {#eyes-hook-check}
- [ ] [사용자] 새 빌드로 Today 에 드리프트 카드(3.3.0 → 새 판)가 뜨고, /plugin update 뒤 사라진다 (← record-quality-round-20261027) {#eyes-drift-card}
- [ ] [사용자] 일지 행에 방패 배지(증거 있음) · 상세 칩 · 모델 이름이 표준형으로 보인다 (← record-quality-round-20261027) {#eyes-evidence-badge}
- [ ] [사용자] 플래너 받은함 — 하나 옮기면 활성 플랜 「이월」 단계에 생기고 받은함에서 빠진다 (← record-quality-round-20261027) {#eyes-carry-inbox}
- [-] [사용자] 설치본 3.16.0+ 에서 간단↔전문 토글·세 칼럼·증거 카드·플래너 머리글을 눈으로 (← ui-density-round-20261028) {#eyes-density}
- [ ] [사용자] 설정 「표시」 스위치로 베타 행이 접히고 ⌘K 로는 열리는지 · 첫 실행 시트가 일지 0건에만 뜨는지 · 논의 「A 로 결정」이 잠그는지 (터미널·도크 몫은 제거됨, ← ui-density-round-3-20261028) {#eyes-round3}
- [ ] [사용자] 플러그인 업데이트 뒤 .oculpm 만 있는 새 폴더에서 claude 새 세션 — 「플랜·일지 없음」 줄과 확인 명령 후보, Cursor 에서 AGENTS.md v19 만으로 완료 조건 한 줄 (← any-project-best-results-20261028) {#eyes-empty-project}
- [ ] [사용자] 첫 기록 실제 왕복 1회 — 실제 대화의 첫 일지가 Today 카드에 도착하는지 + 촬영 (← first-record-loop #p1-verify #p3-intro) {#eyes-first-record}
- [ ] [사용자] 새 플러그인 판으로 /oculpm:redteam 한 번 — 반례 보고를 이 플랜 로그에 (← ambition-round-20261027) {#redteam-dogfood}
- [ ] [사용자] 4.0 설치본 — 윗줄(탭 다섯 · 찾기 · 설정 톱니) · 창 버튼(신호등)이 윗줄 가운데 · 오늘 한 칼럼 · 계획의 끝난 단계 접힘을 눈으로 (← v4-major-20261028) {#eyes-v4-shell}
- [ ] [사용자] 4.0 터미널 — 설치본에서 한글 입력 · Claude Code 박스 문자(WebGL) · 창 닫기 뒤 셸 정리를 눈으로 (← terminal-v4-20261029 #ship-eyes) {#carry-ship-eyes}
- [ ] [사용자] Windows 설치본 — 새 설치 화면(그림 · 안내 문구 · 마침 쪽 자동 넘김)과 앱 안 업데이트(받기 % → 작은 진행 창 → 다시 열림), macOS 의 「바꾸고 있어요」 덮개를 눈으로 {#eyes-win-installer}

## 사용자 액션 (닫은 플랜에서 옮김) {#user-actions}
- [ ] [사용자 액션] release 환경 보호 — 필수 승인자 + 배포 정책(태그 v*) → 서명 비밀 7개(APPLE_* 6 · TAURI_PRIVATE_KEY)를 환경 비밀로 옮기고 저장소 비밀에서 삭제. 비밀을 옮기지 않으면 승인자는 막는 것이 없다. 키 재발급 금지 (← external-review-2026-10-08 #release-env) {#release-env}
- [ ] [사용자 액션] 저장소 topics·Show HN/awesome 런칭 (← improvement-round-2026-09-14 #star-outreach) {#star-outreach}
- [ ] [사용자 액션] VS Marketplace·Open VSX 의 oculpm.ocul-pm 지원 중단/게시 취소 · 저장소 시크릿 OPEN_VSX_TOKEN·VSCE_PAT 삭제 (← optimize-round-20261024 #carry-vscode-market) {#carry-vscode-market}

## 캐시 정리 {#cache}
- [x] 개발 캐시 — src-tauri/target 증분(pnpm clean:target) · node_modules/.vite · ~/Library/Caches/ai-pm(옛 dev 웹뷰) · pnpm store prune {#cache-dev}
- [ ] [사용자 결정] app-data 의 ocul-pm.db.bak-v40(735MB, 10-14 마이그레이션 백업) 삭제 · 진단 탭 compact(DB 837MB) {#cache-app-decision}

## 업그레이드 라운드 결정 · 눈 확인 (11-15) {#quality-decisions}
- [x] [사용자 결정] 변경 화면 메모 판정 낱말 — 「바뀜/그대로」 가 오늘의 「통과 뒤 바뀜」 과 겹친다. 「반영됨/아직」 으로 바꿀지 (← quality-round-20261115) {#memo-verdict-words}
- [x] [사용자 결정] 목록 칸의 고른 줄 면이 고전 스크롤바 앞 10px 에서 끊긴다 — 설치본에서 보고 스크롤바 폭 0 · 가리킬 때만 등 고르기 (← quality-round-20261115) {#list-scrollbar-gutter}
- [ ] [사용자 결정] 오늘 화면에서 Claude 권한 요청에 답하기 — 보안 설계(한 번만 · 경로 잠금 · 출처) 먼저 (← quality-round-20261115) {#answer-permission}
- [ ] [사용자 결정] 업데이트 재시작 뒤 셸 출력 다시 보이기 — 11-15 엔 안 함(화면의 비밀이 디스크에 남을 수 있음) (← quality-round-20261115) {#replay-after-update}

## 사랑받는 앱 라운드 결정 (11-23) {#love-decisions}
- [ ] [사용자 결정] 일지 빈 화면 「첫 작업」 을 플러그인 연결 순서에 맞출지 {#love-firstday-order}
- [ ] [사용자 결정] 760 창 목록 제목 잘림(목록 칸 232) 맞바꿈을 둘지 {#love-narrow-titles}
- [ ] [사용자 결정] 「기기를 떠나는 것」 둘 · 셋 셈과 CLAUDE.md 「정확히 둘」 문장 {#love-egress-count}
- [ ] [사용자 결정] 「마지막 판정」 · 「마지막 확인 결과」 이름을 하나로 {#love-verdict-name}

<!-- oculpm:plan-log begin v1 -->
<!-- oculpm:plan-log archived: 27 rows → polish-round-20261027.log.md -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
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
| 2026-10-29T14:32:21+09:00 | #carry-ship-eyes | claude-code | ☐→☐ |  | ← terminal-v4-20261029 #ship-eyes (사용자 결정으로 그 플랜을 닫으며 이월) |
| 2026-10-29T14:32:27+09:00 | #eyes-v4-shell | claude-code | ☐→☐ |  | ← v4-major-20261028 (v4.0.0 공개, 그 플랜을 닫으며 — macOS 설치본 육안은 아직 0건) |
| 2026-11-19T16:22:00+09:00 | #eyes-win-installer | claude-code | →☐ | .oculpm/journal/20261119/Bugs/1622_bug_windows-install-update-polish.md | 설치 스크립트 컴파일 · 테스트는 통과, 설치 화면과 업데이트 창은 사람 눈이 남았다 |
| 2026-11-19T16:44:30+09:00 | #eyes-win-installer | claude-code | ☐→☐ | .oculpm/journal/20261119/Bugs/1644_bug_mac-update-applying-overlay.md | macOS 「바꾸고 있어요」 덮개를 눈 확인에 더함 |
| 2026-11-15T11:33:35+09:00 | #memo-verdict-words | claude-code | →☐ |  | ← quality-round-20261115 이월 |
| 2026-11-15T11:33:35+09:00 | #list-scrollbar-gutter | claude-code | →☐ |  | ← quality-round-20261115 이월 |
| 2026-11-15T11:33:35+09:00 | #answer-permission | claude-code | →☐ |  | ← quality-round-20261115 이월 |
| 2026-11-15T11:33:35+09:00 | #replay-after-update | claude-code | →☐ |  | ← quality-round-20261115 이월 |
| 2026-11-23T19:09:48+09:00 | #eyes-ghost-gitignore | claude-code | ☐→- |  | 사용자 결정 11-23: 걷은 화면 눈 확인 걷기 — 의미검색은 4.0 에서 걷음(043) |
| 2026-11-23T19:09:52+09:00 | #eyes-vec0 | claude-code | ~→- |  | 사용자 결정 11-23: 걷은 화면 눈 확인 걷기 — vec0 · 진단 탭 다지기는 4.0 에서 걷음 |
| 2026-11-23T19:09:56+09:00 | #eyes-compact | claude-code | ☐→- |  | 사용자 결정 11-23: 걷은 화면 눈 확인 걷기 — 진단 탭 정리 · 의미 검색 · 재색인은 4.0 에서 걷음 |
| 2026-11-23T19:10:01+09:00 | #eyes-tabs-windows | claude-code | ☐→- |  | 사용자 결정 11-23: 걷은 화면 눈 확인 걷기 — 크롬식 탭 · 떼어내기는 4.0 에서 걷음 |
| 2026-11-23T19:10:13+09:00 | #eyes-claude-integration | claude-code | ☐→- |  | 사용자 결정 11-23: 걷은 화면 눈 확인 걷기 — Claude Desktop 연결 · 규칙 탭 · 번들 게이트는 4.0 에서 걷음 |
| 2026-11-23T19:10:19+09:00 | #eyes-first-run | claude-code | ☐→- |  | 사용자 결정 11-23: 걷은 화면 눈 확인 걷기 — 첫 실행 마법사 · 스킬 CRUD · 프리셋 테마는 4.0 에서 걷음 |
| 2026-11-23T19:10:24+09:00 | #eyes-tray | claude-code | ☐→- |  | 사용자 결정 11-23: 걷은 화면 눈 확인 걷기 — 메뉴바 트레이는 4.0 에서 걷음 |
| 2026-11-23T19:10:28+09:00 | #eyes-worktree-index | claude-code | ☐→- |  | 사용자 결정 11-23: 걷은 화면 눈 확인 걷기 — 의미 검색 색인 · 로컬 히스토리는 4.0 · 11-01 에 걷음 |
| 2026-11-23T19:10:32+09:00 | #eyes-density | claude-code | ☐→- |  | 사용자 결정 11-23: 걷은 화면 눈 확인 걷기 — 밀도(간단/전문) 토글은 4.0 에서 걷음 |
| 2026-11-23T19:10:36+09:00 | #memo-verdict-words | claude-code | ☐→x |  | 사용자 결정 11-23: 이미 된 것 닫기 — 코드는 11-15 에 「반영됨/아직」 으로 확정(ko.ts diff.notes.* · en Applied/Not yet) |
| 2026-11-23T19:10:41+09:00 | #list-scrollbar-gutter | claude-code | ☐→x |  | 사용자 결정 11-23: 이미 된 것 닫기 — 일지 · 변경 · 계획 목록 모두 스크롤바 폭 0(journal.css · changes.css · planner.css) |
<!-- oculpm:plan-log archived: 27 rows → polish-round-20261027.log.md -->
| 2026-11-23T21:29:11+09:00 | #love-firstday-order | claude-code | →☐ | .oculpm/journal/20261123/Chores/2126_chore_love-round-merge-final-review.md | ← love-round-20261123 최종 검수 이월 |
| 2026-11-23T21:29:11+09:00 | #love-narrow-titles | claude-code | →☐ | .oculpm/journal/20261123/Chores/2126_chore_love-round-merge-final-review.md | ← love-round-20261123 최종 검수 이월 |
| 2026-11-23T21:29:11+09:00 | #love-egress-count | claude-code | →☐ | .oculpm/journal/20261123/Chores/2126_chore_love-round-merge-final-review.md | ← love-round-20261123 최종 검수 이월 |
| 2026-11-23T21:29:11+09:00 | #love-verdict-name | claude-code | →☐ | .oculpm/journal/20261123/Chores/2126_chore_love-round-merge-final-review.md | ← love-round-20261123 최종 검수 이월 |
<!-- oculpm:plan-log end -->
