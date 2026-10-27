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

## 고도 — 결과를 싣는다 {#altitude}
- [ ] SessionStart 훅(claude·codex plan-context.sh)이 플랜마다 「**완료 조건:**」 줄을 항목 앞에 싣는다 — plugin_xplat 테스트 {#hook-goal}
- [ ] 이어하기 자료(resume.rs)에 플랜별 완료 조건 한 번 — ResumeItem.plan_done_when {#resume-goal}
- [ ] plan_create 에 done_when 인자, plan_status 가 플랜마다 done_when(없으면 null) — planner::done_when 공유 계약 {#plan-create-done-when}
- [ ] 템플릿 v16 — 새 플랜은 완료 조건 한 줄을 반드시 {#template-done-when}

## 깊이 — 바깥 심판 {#depth}
- [ ] 템플릿 v16 검증 칸 문구 — 네가 아닌 것이 말하게 하라, 네 판단은 증거가 아니다 {#template-outside-judge}
- [ ] journal_write 가 bug/feature/refactor 일지의 검증 칸에 명령 증거가 없으면 경고(막지 않음) {#journal-nudge}
- [ ] PROMISE.md 「측정 목표」 표 — 증거 83→97% · 무기록 세션 0 · 무기록 파일 28→10% · 재수정 47→30% {#goals-table}

## 범위 — 명사를 동사로 {#range}
- [ ] PROMISE.md 한 문장 + README ko/en · 랜딩 ko/en 히어로 부제를 「3분 안에 믿고 다음을 결정하게」로 {#verb-sentence}
- [ ] /oculpm:redteam 스킬 — 역할극 금지, 원재료 대조·직접 실행·반례만. 매니페스트·help 카드·랜딩 ko/en·README·pluginDocs 동기 {#redteam-skill}
- [ ] [사용자] 새 플러그인 판으로 /oculpm:redteam ambition-round-20261027 한 번 — 반례 보고를 이 플랜 로그에 {#redteam-dogfood}

## 합류 {#merge}
- [ ] PR → CI 초록 → rebase 머지 {#pr-merge}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
<!-- oculpm:plan-log end -->
