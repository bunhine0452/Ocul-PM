---
oculpm_plan: v1
id: ambition-round-20261027
title: "야망 라운드 (2026-10-27) — Rieseberg 「How to be more ambitious」 를 Ocul-PM 에: 고도 · 깊이 · 범위"
status: active
created: 2026-10-27
updated: 2026-10-27
owner: claude-code
---

글의 네 축 중 Ocul-PM 에 닿는 셋만. 고도 = 할 일이 아니라 결과(완료 조건)를 싣는다. 깊이 = 바깥 심판 — 자기 판단은 증거가 아니다. 범위 = 명사를 동사로(「일지 앱」이 아니라 「3분 안에 믿고 결정하게」), 레드팀은 쓰는 게 아니라 한다.

**완료 조건:** 세션 시작 훅·이어하기·plan_status 가 플랜의 완료 조건을 항목보다 먼저 싣고, 증거 없는 일지에 기록 도구가 경고하고, /oculpm:redteam 이 이 플랜 자체에서 반례를 찾아 로그에 남긴다.

## 고도 — 결과를 싣는다 {#altitude}
- [x] SessionStart 훅(claude·codex plan-context.sh)이 플랜마다 「**완료 조건:**」 줄을 항목 앞에 싣는다 — plugin_xplat 테스트 {#hook-goal}
- [x] 이어하기 자료(resume.rs)에 플랜별 완료 조건 한 번 — ResumeItem.plan_done_when {#resume-goal}
- [x] plan_create 에 done_when 인자, plan_status 가 플랜마다 done_when(없으면 null) — planner::done_when 공유 계약 {#plan-create-done-when}
- [x] 템플릿 v16 — 새 플랜은 완료 조건 한 줄을 반드시 {#template-done-when}

## 깊이 — 바깥 심판 {#depth}
- [x] 템플릿 v16 검증 칸 문구 — 네가 아닌 것이 말하게 하라, 네 판단은 증거가 아니다 {#template-outside-judge}
- [x] journal_write 가 bug/feature/refactor 일지의 검증 칸에 명령 증거가 없으면 경고(막지 않음) {#journal-nudge}
- [x] PROMISE.md 「측정 목표」 표 — 증거 83→97% · 무기록 세션 0 · 무기록 파일 28→10% · 재수정 47→30% {#goals-table}

## 범위 — 명사를 동사로 {#range}
- [x] PROMISE.md 한 문장 + README ko/en · 랜딩 ko/en 히어로 부제를 「3분 안에 믿고 다음을 결정하게」로 {#verb-sentence}
- [x] /oculpm:redteam 스킬 — 역할극 금지, 원재료 대조·직접 실행·반례만. 매니페스트·help 카드·랜딩 ko/en·README·pluginDocs 동기 {#redteam-skill}
- [ ] [사용자] 새 플러그인 판으로 /oculpm:redteam ambition-round-20261027 한 번 — 반례 보고를 이 플랜 로그에 {#redteam-dogfood}

## 합류 {#merge}
- [x] PR → CI 초록 → rebase 머지 {#pr-merge}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-10-27T22:14:25+09:00 | #hook-goal | claude-code | ☐→x | .oculpm/journal/20261027/Features_to_add/2213_feature_ambition-round-altitude-depth-range.md | claude·codex plan-context.sh — grep -m1 '**완료 조건:**\|**Done when:**' 240자, plugin_xplat 단언 |
| 2026-10-27T22:14:35+09:00 | #resume-goal | claude-code | ☐→x | .oculpm/journal/20261027/Features_to_add/2213_feature_ambition-round-altitude-depth-range.md | ResumeItem.plan_done_when, render_text 플랜당 한 번 항목 앞. 테스트 1 |
| 2026-10-27T22:14:41+09:00 | #plan-create-done-when | claude-code | ☐→x | .oculpm/journal/20261027/Features_to_add/2213_feature_ambition-round-altitude-depth-range.md | planner::done_when + plan_create done_when + plan_status.done_when (tests/plan_goal.rs). 정정: 이 플랜의 완료 조건 줄은 도구가 썼다 — 일지의 「손으로 넣었다」는 틀렸다 |
| 2026-10-27T22:14:46+09:00 | #template-done-when | claude-code | ☐→x | .oculpm/journal/20261027/Features_to_add/2213_feature_ambition-round-altitude-depth-range.md | master ko/en v16 §4 — 새 플랜은 done_when 한 줄 필수 |
| 2026-10-27T22:14:51+09:00 | #template-outside-judge | claude-code | ☐→x | .oculpm/journal/20261027/Features_to_add/2213_feature_ambition-round-altitude-depth-range.md | master ko/en v16 §2 검증 칸 — 네가 아닌 것이 말하게 하라 |
| 2026-10-27T22:14:57+09:00 | #journal-nudge | claude-code | ☐→x | .oculpm/journal/20261027/Features_to_add/2213_feature_ambition-round-altitude-depth-range.md | journal_write — evidence_level < COMMAND 이면 바깥 심판 경고 (tests/journal.rs) |
| 2026-10-27T22:15:03+09:00 | #goals-table | claude-code | ☐→x | .oculpm/journal/20261027/Features_to_add/2213_feature_ambition-round-altitude-depth-range.md | PROMISE.md 「측정 목표」 — 다음 외부 리뷰(v3.16.0 무렵)에 재집계 |
| 2026-10-27T22:15:08+09:00 | #verb-sentence | claude-code | ☐→x | .oculpm/journal/20261027/Features_to_add/2213_feature_ambition-round-altitude-depth-range.md | PROMISE 첫 절 + README ko/en · 랜딩 ko/en 히어로 부제. 배포는 다음 릴리스와 함께 |
| 2026-10-27T22:15:19+09:00 | #redteam-skill | claude-code | ☐→x | .oculpm/journal/20261027/Features_to_add/2213_feature_ambition-round-altitude-depth-range.md | skills/redteam/SKILL.md + 매니페스트 7종 · help · 랜딩 ko/en 커맨드 섹션 · README ko/en · pluginDocs (plugin_docs_sync 가 설명 완전 일치 요구) |
| 2026-10-27T22:43:37+09:00 | #pr-merge | claude-code | ☐→x | .oculpm/journal/20261027/Features_to_add/2213_feature_ambition-round-altitude-depth-range.md | PR #103 — CI 가 셋 잡음(템플릿 예산 110자 초과 · 검증 칸 없는 본문의 새 경고 · bindings 미재생성) → 3커밋으로 고쳐 초록, rebase 머지 ebc7b4cf |
<!-- oculpm:plan-log end -->
