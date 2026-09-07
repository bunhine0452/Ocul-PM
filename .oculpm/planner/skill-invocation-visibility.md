---
oculpm_plan: v1
id: skill-invocation-visibility
title: "이 스킬은 언제 쓰이지 — 발동을 사전에 보이게"
status: active
created: 2026-09-07
updated: 2026-09-07
owner: claude-code
---

발동 원장은 **사후**를 답한다(걸린 적 있나·몇 번). 사용자가 목록 앞에서 실제로 묻는 건 **사전**이다: 이게 언제 걸리나, 내가 불러야 하나. 지금 앱이 주는 답은 description 한 줄뿐이라 사실상 "스킬이 자기 소개를 잘 썼기를 바라는 것"이고, 무엇보다 `휴면` 배지가 서로 다른 세 상태(설치 직후 · 이 프로젝트엔 무관 · 걸릴 일이 있었는데 안 걸림)를 하나로 뭉갠다. Phase 1 은 새 데이터 없이 frontmatter 에 이미 있던 사실을 드러내는 데까지, Phase 2~4 는 원장을 늘려 실제 발동 순간을 근거로 삼는 데까지 간다.

## 새 데이터 없이 답할 수 있는 것 {#no-new-data}
- [x] 호출 방법을 드러낸다 — `disable-model-invocation` 을 `SkillEntry.user_invoked` 로 올리고, 목록에는 예외(직접 호출)만 배지로, 상세에는 「언제 걸리나」 카드로 부르는 법·트리거 문장·keywords 를 편다. 트리거를 못 뽑으면 뽑은 척하지 않고 그 사실을 말한다 {#skill-invocation}

## 원장이 사전을 답하게 {#ledger-quotes}
- [ ] 발동 순간의 인용 — 원장이 transcript 를 이미 읽으니 발동 직전 사용자 프롬프트 한 줄을 (redact 통과시켜) 함께 저장하고, 상세에 「최근 이렇게 불렸다」 3건을 낸다. 산문 설명이 아니라 자기 프로젝트에서 실제로 일어난 예시가 이 질문의 가장 강한 답이다 {#firing-quotes}
  - [ ] 스키마 — 마이그레이션 2단계(파일 + `MIGRATIONS` 등록) + `ADDITIVE_COLUMNS`. 인용은 길이 상한을 두고 자른다 {#quote-schema}
  - [ ] redact — `oculpm/redact.rs` 를 태워서 저장한다. 프롬프트는 시크릿이 실제로 들어오는 자리다 {#quote-redact}
  - [ ] 스캐너 — 발동 항목의 **직전** user 메시지를 집는다. 도구 호출 사이에 낀 발동은 프롬프트가 아니라 직전 도구를 근거로 삼아야 하는지 실측으로 정한다 {#quote-scan}
- [ ] `휴면` 배지 3분화 — ①설치 N일차(창보다 어림, 아직 기회 없음) ②이 프로젝트엔 무관(`indexDormancySignals` 의 스택 불일치 신호 재사용) ③걸릴 일이 있었는데 안 걸림. 액션(문구 고치기)은 ③에만 붙인다. ③의 판정 재료는 `firing-quotes` 가 만든다 {#dormant-three-ways}

## 역방향 — 이렇게 말하면 걸립니다 {#simulator}
- [ ] 프롬프트 시뮬레이터 — 한 줄 쳐 넣으면 무엇이 걸릴지 예측한다. 로컬 임베딩 + `context_discover` 색인(이름·description·keywords)으로 오프라인 가능. **`firing-quotes` 의 실측 뒤에 온다** — 예측이 실제 발동과 어긋나면 신뢰를 잃고, 그 어긋남은 원장이 있어야 잴 수 있다 {#prompt-simulator}

<!-- oculpm:plan-log begin v1 -->
| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |
|---|---|---|---|---|---|
| 2026-09-07T18:07:18+09:00 | #skill-invocation | claude-code | ☐→x | .oculpm/journal/20260907/Features_to_add/1807_feature_skill-invocation-visibility-phase1.md | user_invoked 필드 + 목록 배지(예외만) + 상세 「언제 걸리나」 카드. 트리거 못 뽑으면 그 사실을 말한다. 게이트 전부 exit 0, 육안 확인은 다음 앱 실행 라운드 |
<!-- oculpm:plan-log end -->
