---
oculpm_plan: v1
id: skills-star-round
title: "스킬 관리 + GitHub star 정비 라운드"
status: active
created: 2026-07-16
updated: 2026-07-16
owner: claude-code
---

프로젝트별 Claude Code 스킬(.claude/skills) 관리 화면 신설과, GitHub star 도달을 위한
저장소 정비(영문 README 등)를 추적한다. 저장소 밖 액션(topics·GIF·런칭)은 사용자 결정.

## Phase 1 — 스킬 관리 화면 {#skills}
- [x] 백엔드 skills_* 커맨드 6종 (.disabled 토글 규약 + 경로 가드 + Rust 테스트 5) {#skills-backend}
- [x] ui_v2 12번째 화면 "스킬" — 2-pane 목록/미리보기/편집·생성·복사·삭제 + vitest 7 {#skills-screen}
- [ ] 실기기(pnpm tauri dev)에서 스킬 CRUD·토글 확인 → 릴리스(v2.1.0) 여부 결정 {#skills-verify}

## Phase 2 — GitHub star 정비 {#star}
- [x] README.en.md 신설 + 한글 README 스킬 반영·언어 스위처 {#readme-english}
- [ ] 저장소 topics·데모 GIF·Show HN/awesome 리스트 런칭 (사용자 액션) {#star-outreach}

## Phase 3 — UI 폴리시 (대기업 마감) {#polish}
- [x] 모션·엘리베이션·SUITE 타이포 토큰 시스템 + 셸/모달/토스트 물성 통일 + 고대비 정합성 fix {#ui-polish}
- [x] 부트 스플래시(콜드 스타트 브랜드 모션) + 전면 리스킨 "Atelier"(아이보리/딥포레스트 팔레트, 떠 있는 콘텐츠 시트, 내비 캐스케이드) {#full-reskin}
- [x] 코드 맵 재작업 — Atelier 토큰 디자인 + 대규모 가독성(핵심 상위 N·호버 하이라이트·엣지 감쇠·폴더 드릴다운·검색 Enter·에러 상태 분리) {#code-map-readability}
- [~] 실기기 확인: 부트 모션 체감·시트 레이아웃·코드 맵 대형 저장소 체감·프리셋/액센트 회귀·터미널 한글 타이핑 — 런타임 무에러 부팅까지는 검증됨, 시각·입력 체감은 사용자 확인 필요 {#reskin-verify}

## Phase 4 — 전 기능 감사 백로그 (2026-07-16, 발견 12건 중 조치 필요분) {#audit}
- [x] Greenfield 초안 "복원" 실동작(저장 blueprint/step 재개) — 매번 새 초안이 쌓이던 것 해소 {#greenfield-resume}
- [x] 설정 GitHub PAT 탭 제거 — 소비처 verify 뿐 + 없는 기능 약속하던 안내. 백엔드 github_verify/github.rs 동반 은퇴 {#github-tab}
- [x] AI 채팅 이중화 해소 — ⌘\\ 오버레이 스택(6파일) 은퇴, ⌘\\·팔레트는 AI 패널로, G3 clarify 백엔드 2커맨드 동반 은퇴 {#ai-chat-dedupe}
- [x] 죽은 설정 정리 — 스트리밍 토글·logLevel·Save 재수출 제거 + 액센트 6색 피커 UI 복원 {#settings-cleanup}
- [x] 터미널 "변경 감시중" 표시를 실제 워처 상태(watcher_state)에 연결 {#terminal-watch-truth}
- [x] 터미널 한국어 입력 — PTY UTF-8 로케일 보장 + D2Coding 선두 폭 정합 + 조합 미리보기 스타일 {#terminal-korean}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-07-16T20:13:00+09:00 | #skills-backend | claude-code | →x | journal/20260716/Features_to_add/2011_feature_skills-manager-screen.md | commands/skills.rs 신설(list/read/save/delete/set_enabled/copy). SSOT=디스크·캐시없음, secure_skill_path 로 루트 가둠, 비활성=skills/.disabled/ 이동 규약. cargo 전체 그린+스킬 테스트 5, bindings.ts 재생성 |
| 2026-07-16T20:13:30+09:00 | #skills-screen | claude-code | →x | journal/20260716/Features_to_add/2011_feature_skills-manager-screen.md | features/skills/ 3파일+navRegistry 12번째 append(기존 ⌘번호 보존)+UiV2View "skills". AppDialog 생성/삭제 모달, frontmatter 접이식+본문 마크다운, ⌘S 저장. vitest 7(axe 포함)·typecheck·lint·build 그린 |
| 2026-07-16T20:14:00+09:00 | #readme-english | claude-code | →x | journal/20260716/Chores/2012_chore_readme-english-star.md | README.en.md 전환 목적 영문 재작성(12화면·에이전트·설치·기술). 한글 README 언어 스위처+스킬 불릿. 남은 outreach 는 #star-outreach 로 분리(사용자 액션) |
| 2026-07-16T20:29:00+09:00 | #ui-polish | claude-code | →x | journal/20260716/Refactors/2028_refactor_ui-polish-round.md | 토큰 레이어 폴리시: --dur/--ease 모션 + shadow 3단(raise 신설) + SUITE 타이포 통일 + 전역 버튼 물성/focus-visible/reduced-motion + 사이드바·팝오버·모달·토스트·jcard·toggle 물성 + WKWebView 툴바 블러 fix + 고대비 #fff→text-on-accent fix. 게이트 4종 그린, 번들 grep 검증 |
| 2026-07-16T20:44:00+09:00 | #full-reskin | claude-code | →x | journal/20260716/Features_to_add/2043_feature_boot-splash-and-reskin.md | BootSplash(마크 스프링+링 에코+리프트, reduced-motion 스킵, 입력 무차단) + Atelier 팔레트(아이보리/딥포레스트, tokens.css+App.css 짝 교체) + 떠 있는 콘텐츠 시트(캔버스+radius 20+--shadow-sheet+앰비언트, 고대비 off) + sheetIn/navIn 캐스케이드(--i 주입). 게이트 4종 그린, 번들 grep 검증. 실기기 확인은 #reskin-verify |
| 2026-07-16T21:05:00+09:00 | #code-map-readability | claude-code | →x | journal/20260716/Features_to_add/2104_feature_code-map-readability.md | graph.css 신설(React Flow 크롬 토큰 재도장+.gn 노드+.gr-* 툴바), 핵심 상위 N 캡(파일160/폴더240, 칩 토글), 호버 이웃 하이라이트(soft/hard 2단 감쇠, 400+ 자동 off), LOD 별 엣지 잉크 감쇠+1400 캡, 폴더 더블클릭 드릴다운, 검색 Enter 점프, 폴더 언어 미니바, loadError 분리(감사 #6). 게이트 4종 그린 |
| 2026-07-16T21:05:30+09:00 | #audit | claude-code | →☐ | journal/20260716/Features_to_add/2104_feature_code-map-readability.md | 전 기능 감사 12건 완료(HIGH 3: greenfield 복원 미동작·GitHub PAT vestigial·AI 채팅 2벌 / MED 4 / LOW 5). 12화면 본체는 견고 — 문제는 주변부(온보딩 복원·설정 탭·보조 오버레이) 집중. 조치 필요 5건을 Phase 4 항목으로 등재, 그래프 에러 삼킴(#6)은 즉시 fix |
| 2026-07-16T21:47:00+09:00 | #terminal-korean | claude-code | →x | journal/20260716/Bugs/2141_bug_terminal-korean-ime.md | 근본원인=Finder 실행 .app 의 LANG 부재(C 로케일 zsh ZLE 멀티바이트 깨짐). PTY env UTF-8 보장 + D2Coding 선두(한글 2:1 셀 정합) + composition-view 스타일. 실기기 타이핑 확인 남음 |
| 2026-07-16T21:47:30+09:00 | #greenfield-resume | claude-code | →x | journal/20260716/Features_to_add/2142_feature_greenfield-resume.md | resume prop 으로 단계·입력·blueprint id 복원, autoSave 가 같은 id 를 이어감(중복초안 근절). start_screen 테스트 계약 갱신 |
| 2026-07-16T21:48:00+09:00 | #ai-chat-dedupe | claude-code | →x | journal/20260716/Refactors/2143_refactor_ai-chat-unification.md | 오버레이 6파일 삭제, ⌘\\/팔레트→AI 패널, WorkspaceContext 상태·영속키 일방향 정리, 죽은 테스트 13건 제거(146→133), G3 clarify 커맨드·타입 백엔드 은퇴+bindings 축소 |
| 2026-07-16T21:48:30+09:00 | #github-tab | claude-code | →x | journal/20260716/Refactors/2144_refactor_github-pat-retire.md | 설정 GitHub 탭+GithubTab 161줄 제거, github_verify/github.rs 삭제. 릴리스 패치노트(비인증 fetch) 무영향, 키체인 기존 항목은 불파괴 |
| 2026-07-16T21:49:00+09:00 | #settings-cleanup | claude-code | →x | journal/20260716/Chores/2145_chore_dead-settings-honesty-cleanup.md | streamResponses(소비자 은퇴로 무효)·logLevel(소비자 0)·Save 재수출·lint allowlist 잔재 제거. 액센트 피커는 2146 feature 로 복원 |
| 2026-07-16T21:49:30+09:00 | #terminal-watch-truth | claude-code | →x | journal/20260716/Chores/2145_chore_dead-settings-honesty-cleanup.md | "변경 감시중" 상시 초록 하드코딩→watcher_state 연동(running/error/stopped 3상태 라벨+색) |
| 2026-07-16T22:16:00+09:00 | #reskin-verify | claude-code | ☐→~ | journal/20260716/Chores/2215_chore_runtime-verify-and-docs-truth.md | pnpm tauri dev 실구동: JS예외/패닉 0, 부트 플로우(마운트→init→에이전트 sync→워처 러닝) 정상. 스크린샷은 TCC 화면기록 권한 부재로 불가 — 시각·한글 타이핑 체감은 사용자 몫. 잔여 컴파일 경고 2건(unused import·fresh_project 잔재)도 0으로. CLAUDE.md 12화면 현행화+CHANGELOG v2.1.0 초안 동승 |
| 2026-07-20T19:57:54+09:00 | #reskin-verify | claude-code | ~→~ | .oculpm/journal/20260720/Bugs/1957_bug_pty-utf8-chunk-split-mojibake.md | 터미널 한글 깨짐 근본원인 발견·수정(PTY UTF-8 청크분할) + 터미널 대개편 — 실기기 재확인 항목에 분할/세션지속/검색 추가 |
<!-- oculpm:plan-log end -->
