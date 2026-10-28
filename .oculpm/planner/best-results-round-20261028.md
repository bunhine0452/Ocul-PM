---
oculpm_plan: v1
id: best-results-round-20261028
title: "최고의 결과 라운드 — 에이전트 운용 5원칙을 oculpm 의 자리로"
status: done
created: 2026-10-28
updated: 2026-10-28
owner: claude-code
---

2026-10-28 조사(Anthropic Claude Code best-practices · Willison Agentic Engineering Patterns · Sonar State of Code 2026 · METR 2026)에서 코딩 에이전트에게 최고의 결과를 내는 운용법은 다섯 줄로 모였다: ① 코드 전에 사양·완료 조건을 적는다 ② 에이전트에게 통과/실패를 내는 확인 명령을 준다 ③ 주장이 아니라 명령과 출력을 증거로 받는다 ④ 테스트가 초록이어도 실제로 돌려 본다 ⑤ 바깥 심판(둘째 세션·레드팀)이 판정한다. Rieseberg 의 고도·깊이·범위와 같은 축이다. oculpm 은 이 다섯 질문이 /clear 와 세션 경계를 넘어 **사라지지 않는 자리**다 — 그 자리를 플러그인(에이전트 쪽)·Today(사람 쪽)·랜딩(내세우기)에 박는다.

**완료 조건:** 새 세션의 에이전트가 플랜의 완료 조건과 확인 명령을 받고 시작해 마지막 항목을 닫을 때 완료 조건 확인을 안내받고, 사람은 Today 「약속 성적표」에서 증거 비율·7일 재수정률을 목표와 함께 보고, 랜딩·README 가 다섯 원칙마다 oculpm 의 자리를 출처와 함께 말한다.
**확인 명령:** pnpm typecheck && pnpm test && pnpm lint && (cd src-tauri && cargo test --lib && cargo test --test plugin_xplat)

## 에이전트 쪽 — 플러그인이 다섯 질문을 들고 간다 {#p1}
- [x] 플랜 「확인 명령」 줄 — planner::done_when 에 check 마커(**확인 명령:**/**Check:**), plan_create `check` 인자, plan_status 응답 `check`, 훅이 완료 조건 다음에 싣는다, plugin_xplat 테스트 {#check-line}
- [x] plan_update 닫기 안내 — 마지막 미완 항목이 닫히면 응답 warnings 에 완료 조건·확인 명령·redteam 안내(막지 않음), 테스트 {#close-nudge}
- [x] 훅 — 항목이 전부 닫혔는데 아직 active 인 플랜은 「완료 조건 확인 후 닫기」 한 줄로 싣는다 {#hook-all-done}
- [x] journal_write — 검증 칸에 명령만 있고 결과(exit 0 · N passed · 통과)가 없으면 경고, 테스트 {#evidence-output}
- [x] 템플릿 v17 — §2 「명령과 그 결과 끝 줄」, §4 새 plan 은 완료 조건+확인 명령, ko ≤4,800 · en ≤6,500 예산 안 {#template-v17}
- [x] 스킬 — next 는 완료 조건을 읽고 최소 구현이 아니라 완료 조건을 참으로 만드는 구현을 고르고 확인 명령 결과를 검증 칸에, inception·project-inception 은 plan_create 에 done_when·check 를 준다, 플러그인 버전 bump {#skills-loop}

## 사람 쪽 — Today 가 느낌 대신 숫자를 보여 준다 {#p2}
- [x] 백엔드 oculpm_promise_scorecard — 최근 30일 bug·feature·refactor 일지의 증거(2등급) 비율, 버그 일지 중 7일 안 같은 파일 재수정 비율(report-card.py 와 같은 정의: 허브 파일 제외), 활성 플랜 중 완료 조건·확인 명령 있는 수 {#scorecard-cmd}
- [x] Today 「약속 성적표」 카드 — 지표·지금·목표(PROMISE.md 표) 3줄, 0건이어도 숨지 않음, 디자인 규율 안 {#scorecard-card}
- [x] 주간 롤업 「검증된 것 / 검증 안 된 것」 절 — 증거 등급으로 가른 영수증, 롤업 대화상자에 마크다운 복사 버튼 {#rollup-receipt}

## 내세우기 — 다섯 원칙마다 oculpm 의 자리 {#p3}
- [x] PROMISE.md 「에이전트 운용 5원칙 → oculpm 의 자리」 표 + 출처(Anthropic · Willison · Sonar · METR) {#promise-principles}
- [x] README ko/en + 랜딩 ko/en 「왜 결과가 좋아지나」 절(5원칙 ↔ 훅·확인 명령·증거 등급·redteam·성적표), plugin.html plan_create `check` 인자, wiki build {#landing-why}
- [x] [사용자] 삭제 후보 결정 — 10월 fix 분포(보안 18 · 터미널 10 · 색인 5 · 워처 4 · 편집기 2 · 핵심 화면 2)를 보고 보류 등급 중 걷을 화면을 고른다 — 2026-10-28 결정: 보류 등급 전부 + 터미널 걷음 (simplify-round-20261028) {#removal-decision}

## 확인 날 — 눈으로 {#p4}
- [>] [사용자] Today 「약속 성적표」 숫자가 `python3 docs/launch/agent-report-card.py` 와 같은 자리(증거 비율·7일 재수정)에서 맞는다 → polish-round-20261027 #eyes-scorecard {#eyes-scorecard}
- [>] [사용자] 플러그인 업데이트 뒤 새 세션 시작 컨텍스트에 플랜마다 완료 조건·확인 명령 줄이 실린다 → polish-round-20261027 #eyes-hook-check {#eyes-hook-check}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-10-28T03:00:39+09:00 | #check-line | claude-code | ☐→x | .oculpm/journal/20261028/Features_to_add/0300_feature_best-results-round.md | done_when.rs check_command · plan_create check · plan_status check · 두 훅 · plugin_xplat |
| 2026-10-28T03:00:50+09:00 | #close-nudge | claude-code | ☐→x | .oculpm/journal/20261028/Features_to_add/0300_feature_best-results-round.md | plan_ops close_nudge · plan_goal 테스트 |
| 2026-10-28T03:00:58+09:00 | #hook-all-done | claude-code | ☐→x | .oculpm/journal/20261028/Features_to_add/0300_feature_best-results-round.md | 두 plan-context.sh 에 all-done 줄(최대 3) |
| 2026-10-28T03:01:09+09:00 | #evidence-output | claude-code | ☐→x | .oculpm/journal/20261028/Features_to_add/0300_feature_best-results-round.md | evidence::command_without_result + journal_write 경고 |
| 2026-10-28T03:01:16+09:00 | #template-v17 | claude-code | ☐→x | .oculpm/journal/20261028/Features_to_add/0300_feature_best-results-round.md | ko 4,755 · en 6,490 chars |
| 2026-10-28T03:01:25+09:00 | #skills-loop | claude-code | ☐→x | .oculpm/journal/20261028/Features_to_add/0300_feature_best-results-round.md | next 3~5단계 · inception/project-inception done_when·check. 플러그인 버전은 릴리스 스크립트가 올린다 |
| 2026-10-28T03:01:32+09:00 | #scorecard-cmd | claude-code | ☐→x | .oculpm/journal/20261028/Features_to_add/0300_feature_best-results-round.md | db::scorecard compute + commands::scorecard |
| 2026-10-28T03:01:39+09:00 | #scorecard-card | claude-code | ☐→x | .oculpm/journal/20261028/Features_to_add/0300_feature_best-results-round.md | PromiseScorecardCard + 테스트 4건 |
| 2026-10-28T03:01:50+09:00 | #rollup-receipt | claude-code | ☐→x | .oculpm/journal/20261028/Features_to_add/0300_feature_best-results-round.md | SECTION_UNVERIFIED + 요약 문장 + 복사 버튼 |
| 2026-10-28T03:01:59+09:00 | #promise-principles | claude-code | ☐→x | .oculpm/journal/20261028/Features_to_add/0300_feature_best-results-round.md | PROMISE.md 다섯 원칙 표 · 측정 목표 「확인 명령 1/14」 · 장치 표 2행 |
| 2026-10-28T03:02:38+09:00 | #landing-why | claude-code | ☐→x | .oculpm/journal/20261028/Features_to_add/0300_feature_best-results-round.md | README ko/en 절 · 랜딩 ko/en #why 6셀 + featureList · plugin.html 행 · wiki build |
| 2026-10-28T23:24:48+09:00 | #removal-decision | claude-code | ☐→x |  | 2026-10-28 결정: 보류 등급 전부 + 터미널 걷음 (simplify-round-20261028) |
| 2026-10-28T23:24:51+09:00 | #eyes-scorecard | claude-code | ☐→> |  | polish-round-20261027 #eyes-scorecard |
| 2026-10-28T23:24:54+09:00 | #eyes-hook-check | claude-code | ☐→> |  | polish-round-20261027 #eyes-hook-check |
| 2026-10-28T23:24:57+09:00 | #plan | claude-code | active→done |  | 덜어내기 라운드 — 플랜 18→4 (simplify-round-20261028 #plans-4). 미완은 전부 옮기거나 폐기 |
<!-- oculpm:plan-log end -->
