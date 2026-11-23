---
oculpm_plan: v1
id: love-round-20261123
title: "개발자와 AI 사용자가 사랑할 만하게"
status: active
created: 2026-11-23
updated: 2026-11-23
owner: claude-code
---

사용자 지시 11-23: 「쓸만한 스킬·플러그인을 찾고, 개발팀·디자인팀으로 나눠 사랑받는 프로그램으로」. 탐색 7(리서치 2 · 개발 3 · 디자인 2) → 121건 → 레인 14. 사용자 결정: 공식 플러그인 둘(pr-review-toolkit · claude-security) 이 저장소에만 설치, 걷은 화면 눈 확인 걷기, 하네스 저장소화 · Cursor/Gemini MCP 등록 · brew/winget · 잠자기 막기(설정 스위치), 머지 뒤 4.13.0.

**완료 조건:** 처음 온 개발자가 플러그인 연결 · 첫 일지 · 계획까지 막힘 없이 가고(거짓 「연결됨」·「없음」 0), 에이전트가 MCP 만으로 계획에 항목을 더하고 한 번에 맞게 호출하며, 다섯 화면이 예외를 먼저 보이고, 레인 14개가 리뷰를 거쳐 main 에 들어가 v4.13.0 으로 나간다
**확인 명령:** pnpm typecheck && pnpm test && pnpm lint && pnpm build && cd src-tauri && cargo test --locked

## 준비 {#setup}
- [x] 탐색 7 · 백로그 121건 {#discovery}
- [x] 공식 플러그인 둘을 이 저장소에만 설치 {#plugins}
- [x] 걷은 화면 눈 확인 걷기 · 된 결정 둘 닫기 {#inbox-sweep}

## 개발팀 {#dev}
- [x] MCP: 계획에 항목·결정 더하기 · 한 번에 맞게 {#l1-mcp-tools}
- [x] 시작 훅·다음: 사람 몫은 사람에게 {#l2-agent-context}
- [x] 플러그인 연결 판정을 정직하게 {#l3-plugin-connect}
- [x] 첫 10분: 거짓 「없음」 걷기 · 일지 진단 {#l4-first-run}
- [x] 터미널 입력 결함 묶음 {#l5-terminal-input}
- [x] 세션: 죽은 칸 · 잠자기 막기 · 레인 준비 {#l6-sessions-awake}
- [x] Cursor·Gemini MCP 등록 · Codex 판 {#l7-other-agents}
- [x] 변경: 내가 본 뒤로 · 영수증 어디서나 {#l8-review-flow}
- [x] 화면 하네스 저장소화 · brew·winget {#l9-harness-packaging}
- [x] ⌘K: 일지 검색 · 단축키 · 화면 동작 {#p1-palette-keys}

## 디자인팀 {#design}
- [x] 오늘·계획: 예외가 먼저 {#g1-today-planner}
- [x] 일지·변경 화면 다듬기 {#g2-journal-diff}
- [x] 앱 문구·영어 한 벌로 {#g3-app-copy}
- [x] README·랜딩·스킬 설명 문구 {#g4-outside-copy}

## 합류 · 출시 {#ship}
- [x] 레인 리뷰(pr-review-toolkit 관점) · 고침 {#review}
- [-] claude-security 변경분 스캔 {#security-scan}
- [x] 전체 게이트 · PR · 머지 {#merge}
- [x] v4.13.0 릴리스 {#release-413}
- [ ] [사용자] 설치본에서 눈 확인 {#eyes}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-11-23T19:10:47+09:00 | #discovery | claude-code | ☐→x |  | 탐색 7(리서치 sonnet 2 · 개발 opus 2 + sonnet 1 · 디자인 opus 1 + sonnet 1) → 121건, 스크린샷 42장. 탐색은 v4.11.0 을 읽었고 main 은 v4.12.1 로 ff — 레인이 소견마다 재확인 |
| 2026-11-23T19:10:52+09:00 | #plugins | claude-code | ☐→x |  | pr-review-toolkit 1.0.1 · claude-security 0.12.0 을 --scope local 로(이 경로만, 커밋 설정 무변경). claude-security 훅에 네트워크 송출 없음 확인 |
| 2026-11-23T19:10:56+09:00 | #inbox-sweep | claude-code | ☐→x |  | polish-round: 걷은 표면만 가리키는 eyes 9건 [-] · memo-verdict-words · list-scrollbar-gutter [x]. 섞인 항목(bug-hunt-0922 · security · round3 · round-0914)과 결정 둘(answer-permission · replay-after-update)은 남김 |
| 2026-11-23T19:14:57+09:00 | #inbox-sweep | claude-code | x→x |  | 확인 명령은 지금 못 돌림 — 닫은 셋(탐색 · 플러그인 설치 · 받은함 정리)은 코드 변경이 없고, 레인 9개가 공유 cargo 타깃으로 빌드 중이며 디스크 여유 15GB(스왑 8GB)라 전체 cargo test 를 겹치면 레인이 멈춘다. 판정은 합류 브랜치에서 전체 게이트로 남긴다 |
| 2026-11-23T21:26:52+09:00 | #l1-mcp-tools | claude-code | ☐→x | .oculpm/journal/20261123/Features_to_add/2122_feature_mcp-plan-add-decision-verdict.md | 판정 ✓ CI c538bf7e Rust 잡 success · 로컬 plan_add 7 · plan_parallel_write 5 · plan_cas_two_process 3 passed · mac |
| 2026-11-23T21:27:06+09:00 | #l2-agent-context | claude-code | ☐→x | .oculpm/journal/20261123/Features_to_add/2122_feature_hook-human-owned-items.md | 판정 ✓ plugin_hook_owner 6 · subfolder 5 · no_plan 10 · resume_context 5 · session_verdict 5 passed · mac |
| 2026-11-23T21:27:12+09:00 | #l3-plugin-connect | claude-code | ☐→x | .oculpm/journal/20261123/Bugs/2123_bug_plugin-connect-honest.md | 판정 ✓ vitest plugin_connect_today · settings_planner · today_v4 50 passed · CI c538bf7e 프런트 success · mac |
| 2026-11-23T21:27:27+09:00 | #l4-first-run | claude-code | ☐→x | .oculpm/journal/20261123/Bugs/2123_bug_first-run-honest-empty.md | 판정 ✓ vitest first_run_link_health 외 5파일 51 passed · CI c538bf7e Rust success · mac |
| 2026-11-23T21:27:32+09:00 | #l5-terminal-input | claude-code | ☐→x | .oculpm/journal/20261123/Features_to_add/2123_feature_terminal-input-fixes.md | 판정 ✓ vitest 레인 7파일 79 passed · CI c538bf7e success (Windows 클립보드 FFI 는 portability 몫) · mac |
| 2026-11-23T21:27:38+09:00 | #l6-sessions-awake | claude-code | ☐→x | .oculpm/journal/20261123/Features_to_add/2124_feature_keep-awake-sessions.md | 판정 ✓ vitest 31파일 209 passed · CI macOS keep_awake::tests::macos_assertion_is_created_and_released_in_process ok · mac |
| 2026-11-23T21:27:44+09:00 | #l7-other-agents | claude-code | ☐→x | .oculpm/journal/20261123/Features_to_add/2124_feature_cursor-gemini-mcp-registration.md | 판정 ✓ vitest settings_agent_mcp 32 · extension 81 · plugin_codex_skills 4 · other_agents_docs 2 passed · mac |
| 2026-11-23T21:27:51+09:00 | #l8-review-flow | claude-code | ☐→x | .oculpm/journal/20261123/Features_to_add/2124_feature_diff-review-since-receipt.md | 판정 ✓ vitest diff_ · receipt · verdict_source 20파일 184 passed · CI 7ca523f4 이후 프런트 journal_verified 포함 초록 · mac |
| 2026-11-23T21:27:57+09:00 | #l9-harness-packaging | claude-code | ☐→x | .oculpm/journal/20261123/Features_to_add/2125_feature_harness-in-repo-packaging.md | 판정 ✓ pnpm harness:shots 44장 · 문제 장 0 · IPC 누락 0 (F2) · vitest harness_kit · packaging_manifests 초록. brew/winget 제출은 사용자 확인 뒤 · mac |
| 2026-11-23T21:28:03+09:00 | #p1-palette-keys | claude-code | ☐→x | .oculpm/journal/20261123/Features_to_add/2126_feature_palette-screen-keys.md | 판정 ✓ CI e2f7cdb5 프런트 success · palette_keys_love · jump_waiting 초록 (창을 건너는 초점은 설치본 확인 몫) · mac |
| 2026-11-23T21:28:09+09:00 | #g1-today-planner | claude-code | ☐→x | .oculpm/journal/20261123/Features_to_add/2124_feature_today-planner-exceptions-first.md | 판정 ✓ CI e2f7cdb5 프런트 success · today_planner_love 11 passed · 하네스 44장 채운 단추 화면당 1(어두운 변경 27 → 1) · mac |
| 2026-11-23T21:28:14+09:00 | #g2-journal-diff | claude-code | ☐→x | .oculpm/journal/20261123/Features_to_add/2125_feature_journal-diff-craft.md | 판정 ✓ CI e2f7cdb5 프런트 · Rust success · 줄 메모 24px 미만 표적 05-diff 5 → 0 · 20-narrow-diff 15 → 0 · mac |
| 2026-11-23T21:28:21+09:00 | #g3-app-copy | claude-code | ☐→x | .oculpm/journal/20261123/Chores/2125_chore_app-copy-one-glossary.md | 판정 ✓ CI e2f7cdb5 프런트 success — i18n_copy_terms 용어표 시험 포함 · mac |
| 2026-11-23T21:28:28+09:00 | #g4-outside-copy | claude-code | ☐→x | .oculpm/journal/20261123/Chores/2125_chore_outside-copy-users-words.md | 판정 ✓ CI e2f7cdb5 Rust success — plugin_manifest · plugin_codex_skills · plugin_skill_copy 포함. 랜딩 배포는 릴리스 때(수동) · mac |
| 2026-11-23T21:28:34+09:00 | #review | claude-code | ☐→x | .oculpm/journal/20261123/Chores/2126_chore_love-round-merge-final-review.md | 판정 ✓ CI e2f7cdb5 프런트 · Rust(cargo test 전체 · bindings 신선도) · cargo-deny · 확장 모두 success — 레인 리뷰 14 + 최종 검수 4, important 전부 고침 · mac |
| 2026-11-23T22:30:35+09:00 | #merge | claude-code | ☐→x | .oculpm/journal/20261123/Bugs/2230_bug_win-subfolder-inline-hook.md | 판정 ✓ PR #177 rebase 머지(0561a32b) · main d7e1b022 CI success · E2E success · Portability 는 spawn_count 둘만 붉음(11-11 부터) — 번들 · 설치 · 업데이터 스모크 success · mac |
| 2026-11-23T22:42:55+09:00 | #security-scan | claude-code | ☐→- |  | 사용자 결정 11-23: claude-security 변경분 스캔 확인 창에서 「No」 — 스캔하지 않음. 대신 레인 리뷰 14(pr-review-toolkit 관점)와 최종 검수 F1(위험 코드 · 약속 7)이 봤다 |
| 2026-11-23T22:43:00+09:00 | #release-413 | claude-code | ☐→~ |  | 릴리스 커밋 5ebcbf69 · 태그 v4.13.0 → d7e1b022(CI · E2E success). release run 진행 중, 랜딩 배포는 그 뒤(수동) |
| 2026-11-23T23:07:04+09:00 | #release-413 | claude-code | ~→x |  | 판정 ✓ release run 45186615967 success — Latest v4.13.0(자산 9개) · latest.json 4.13.0(darwin · windows · linux). 랜딩 배포는 수동(vercel), brew/winget 제출은 사용자 확인 대기 · mac |
<!-- oculpm:plan-log end -->
