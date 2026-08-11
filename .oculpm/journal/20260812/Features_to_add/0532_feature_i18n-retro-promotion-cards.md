---
schema_version: 1
type: feature
slug: "i18n-retro-promotion-cards"
status: done
difficulty: low
created_at: "2026-08-12T05:32:41+09:00"
session_id: "mcp-20260812-053241"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/features/retro/RuleCandidates.tsx"
    op: update
  - path: "src/features/retro/SkillCandidates.tsx"
    op: update
  - path: "src/features/retro/retroGen.ts"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags:
  - "i18n"
  - "retro"
  - "mcp-tool"
---
[x] 회고 승격 후보 카드 영어화 — 쌍둥이 카드가 공용 키를 나눈다

회고 묶음 3파일 49건. allowlist 61 → 58. 플랜 항목 `i18n-retro` 의 남은 몫 — RetroScreenV2·DiscussionScreenV2 는 앞 회차에 끝나 있었다.

## 추가 기능

`promo.*` 키 39개 + `retro.genReady`. 규칙 후보 카드 · 스킬 후보 카드 · 초안 승인 모달 · 회고 생성 토스트.

## 쌍둥이 카드는 공용 키를 나눈다

`RuleCandidates` 와 `SkillCandidates` 는 구조가 거의 같다 — 후보 목록 → AI 초안 생성 → 승인 모달 → 저장. 그래서 두 카드가 글자 그대로 공유하는 11개(`promo.needProvider` · `promo.aiDraftNote` · `promo.slugInvalid` · `promo.savePath` · `promo.reject` · `promo.saving` · `promo.drafting` · `promo.draft` · `promo.hideHint` · `promo.hideAria` · `promo.recent`)를 한 벌로 두고, 갈리는 것만 `promo.rule*` / `promo.skill*` 로 나눴다. 한쪽만 고쳐 문구가 어긋나는 흔한 실패를 구조로 막는다.

저장 경로 안내는 `promo.savePath` 하나로 합치고 경로를 보간한다 — 규칙은 `.claude/rules/x.md`, 스킬은 `.claude/skills/x/SKILL.md` 로 **경로만** 다르고 문장은 같다.

## 중복 키를 타입이 잡았다

`retro.genFailed` 를 새로 넣었는데 이미 863줄에 있었다(RetroScreenV2 가 쓰는 것). typecheck 가 `TS1117: An object literal cannot have multiple properties with the same name` 로 즉시 잡았다. 확인해 보니 **같은 실패**(회고 생성 실패)라 새 키를 버리고 기존 것을 재사용했다. 사전이 커질수록 이 충돌이 늘 텐데, 타입이 게이트라 조용히 덮어쓰이지 않는다.

## 상수 테이블 labelKey (누적 10회째)

`KIND_LABEL = { bug: "버그", error: "에러" }` → `Record<string, I18nKey>`. `kind` 자체는 백엔드가 주는 판별자라 그대로다.

## 문단 가운데 `<code>`

두 카드의 안내 문단이 `.claude/rules` / `.claude/skills` 를 `<code>` 로 문장 **가운데** 넣는다. §4.2 대로 사전에 JSX 를 넣지 않고 prefix/suffix 로 쪼갰다 — 두 언어 모두 "설명 → 경로 → 마무리" 어순이라 성립한다.

## 검증

게이트 4종 exit 0 직접 확인 — typecheck / vitest 655통과 / lint(남은 미번역 58) / build.