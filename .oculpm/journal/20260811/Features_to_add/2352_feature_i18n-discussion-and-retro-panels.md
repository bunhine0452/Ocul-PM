---
schema_version: 1
type: feature
slug: "i18n-discussion-and-retro-panels"
status: done
difficulty: medium
created_at: "2026-08-11T23:52:01+09:00"
session_id: "mcp-20260811-235201"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/discussion/DiscussionScreenV2.tsx"
    op: update
  - path: "src/features/retro/DeferLedger.tsx"
    op: update
  - path: "src/features/retro/EvalTrend.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags:
  - "i18n"
  - "phase2"
  - "토의"
  - "회고"
  - "mcp-tool"
---
[x] 문제 해결 화면 + 회고 패널 2종 영어화 — 번역 중 정보 손실을 테스트가 잡다

## 추가 기능

DiscussionScreenV2(58건) · DeferLedger(9건) · EvalTrend(5건) 영어화. 사전 키 63개. allowlist 92 → 89.

## 번역이 정보를 지운 것을 테스트가 잡았다

`edd_lite_v2` 가 깨졌다. EvalTrend 의 빈 상태 안내에서 **`run-evals` 스킬 이름이 사라져** 있었다.

원문은 `<strong>run-evals</strong> 추천 스킬로 채점을 기록하면…` 이었는데, `<strong>` 을 장식으로 보고 문단을 키 하나로 접으면서 한국어 값에서 그 단어를 통째로 빠뜨렸다. 영어 값에는 남아 있어서 사전만 봐서는 알아채기 어려웠다.

**`<strong>` 이 항상 장식은 아니다.** 여기서는 사용자가 실행해야 할 스킬의 **이름**이었다 — 그게 없으면 안내가 "뭔가 하면 된다"로 끝난다. 강조 태그를 버릴 때 그 안의 내용이 정보인지 장식인지 봐야 한다.

테스트가 `/run-evals/` 를 찾고 있었기에 즉시 걸렸다. 이런 검증이 없는 문장에서 같은 실수를 했다면 조용히 지나갔을 것이다.

## 그 밖에 다룬 것

**모듈 상수에서 `t()` 호출 금지.** `DeferLedger` 의 `const NO_TRIGGER_TITLE = t(...)` 는 임포트 시점에 평가돼 언어가 그때 굳는다 — 설정에서 언어를 바꿔도 안 바뀐다. 함수(`noTriggerTitle()`)로 바꿔 호출 시점에 해석하게 했다. 사전을 모듈 스코프에서 쓰는 코드가 앞으로 더 나올 텐데 같은 함정이다.

**`## 기록` 은 번역하지 않는다.** EvalTrend 가 언급하는 그 문자열은 사용자의 `EVALS.md` 안에 실제로 있는 섹션 제목이다 — 디스크 산출물이라 번역 범위 밖이고, 번역하면 파일에 없는 이름을 가리키게 된다. `i18n-ignore-next-line` 로 사유와 함께 면제했다.

**`statusMeta` 는 순수 함수라 훅을 못 쓴다.** 알 수 없는 상태값을 그대로 라벨로 쓰던 폴백이 있어서, `{ labelKey?, rawLabel?, cls }` 로 나눠 사전 키가 있으면 번역하고 없으면 원문을 보여준다.

`t` 섀도잉이 두 번 더 (`const t = newTitle.trim()` · `const t = renameTitle.trim()`) — 일곱·여덟 번째다.

## 검증

게이트 4종 전부 exit 0 직접 확인 — typecheck / vitest(54파일 649건) / lint / build.

## 남은 일

89파일. RetroScreenV2 72 · RuleCandidates 24 · SkillCandidates 35 · retroGen 은 회고 묶음에 남았다. 그 외 skillsGallery 112 · SkillsScreenV2 89 · TrayPopover 70 · RulesTab 63 · GreenfieldWizard 56 · AiPanelScreenV2 50 등. 테스트 20여 개와 Rust 에러 ~130곳도 미착수.