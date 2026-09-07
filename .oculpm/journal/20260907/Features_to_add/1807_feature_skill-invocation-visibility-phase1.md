---
schema_version: 1
type: feature
slug: "skill-invocation-visibility-phase1"
status: done
difficulty: medium
created_at: "2026-09-07T18:07:10+09:00"
session_id: "20260907-002"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "6cb813ef-9c7c-4e4f-9662-101b24e03c73"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/commands/skills.rs"
    op: update
  - path: "src-tauri/src/oculpm/skill_frontmatter.rs"
    op: create
  - path: "src-tauri/src/oculpm/mod.rs"
    op: update
  - path: "src/features/skills/skillsModel.ts"
    op: update
  - path: "src/features/skills/ContextEditor.tsx"
    op: update
  - path: "src/features/skills/ContextLiveList.tsx"
    op: update
  - path: "src/features/skills/skills.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/skills_v2.test.tsx"
    op: update
  - path: "src/__tests__/agent_context_model.test.ts"
    op: update
  - path: "src/__tests__/firing_ledger_v2.test.ts"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
related: []
tags:
  - "skills"
  - "agent-discipline"
  - "ui_v2"
  - "i18n"
  - "mcp-tool"
---
[x] "이 스킬은 언제 쓰이지" — 호출 방법과 트리거를 드러낸다

## 추가 기능

발동 원장은 **사후**를 답한다 — 걸린 적 있나, 몇 번, 마지막이 언제. 사용자가 목록 앞에서 실제로 묻는 건 **사전**이다: 이게 언제 걸리나, 내가 불러야 하나. 지금까지 앱이 주는 답은 행 부제로 깔린 `description` 한 줄이 전부였고, 그건 앱이 답하는 게 아니라 *스킬이 자기 소개를 잘 썼기를 바라는 것*이었다.

Phase 1 은 **새 데이터를 만들지 않는다.** 답은 이미 frontmatter 에 있었고 산문 한 줄에 뭉쳐 있어 안 보였을 뿐이다.

**호출 방법** — `disable-model-invocation` 을 `SkillEntry.user_invoked` 로 올렸다. 목록에는 **예외에만** 배지를 단다(`직접 호출`): 자동 발동이 기본값이라 전부에 배지를 달면 소음이고, 눈에 띄어야 하는 건 "사람이 이름을 쳐야만 뜨는 스킬" 쪽이다. 이 사실이 없으면 그 스킬에 붙는 `안 걸림` 배지가 결함을 가리키는 것처럼 읽히지만 실제로는 정상이다 — 배지가 거짓말을 하고 있었다.

**언제 걸리나 카드** — 상세 맨 위, SKILL.md 본문보다 **먼저** 온다. 사용자는 지시문을 읽으러 온 게 아니라 "이게 나한테 언제 걸리지" 를 물으러 왔다. 카드는 셋을 편다: 부르는 법 한 줄(자동 / 직접 호출 전용 / description 없음), 트리거 문장 불릿, 그리고 keywords 칩.

**뽑은 척하지 않는다** — `triggerHints()` 는 description 을 문장으로 갈라 트리거 표지("때·경우·하거나·요청·사용", "Use when", "Triggers on"…)가 있는 문장만 「언제」로 올린다. 표지가 하나도 없으면 **나누지 않고** 그 사실을 말한다("언제 걸리는지가 description 에 안 적혀 있습니다"). 잘못 가르는 것이 못 가르는 것보다 나쁘다 — 사용자가 *스킬이 안 적은 말*을 읽게 된다. 그리고 못 가른 상태 자체가 신호다: 언제 걸리는지 안 적힌 description 은 에이전트에게도 안 걸린다.

keywords 가 비면 그것도 말한다 — 능력 검색(`context_discover`)은 이름·description·keywords 만 색인하므로, 거기 적힌 말이 곧 그 스킬의 도달 경로다.

## 동작 흐름

`skills_list`/`skills_read` → `SkillEntry.user_invoked` → 목록은 배지 하나, 상세는 `TriggerCard`. 문장 가르기는 `skillsModel.triggerHints()` 의 순수 함수라 DOM·백엔드 없이 테스트한다.

문장 나누기에 정규식 lookbehind 를 쓰지 않았다(구형 WebKit 에서 조용히 깨지는 자리다). 마침표 뒤에 **공백이나 끝**이 올 때만 경계로 보므로 `v2.44`·`e.g.` 는 안 잘린다.

## 곁다리 — 파일 크기 게이트가 잡은 것

`lint:filesize` 가 `commands/skills.rs` 818줄(한계 800)로 붉어졌다. 줄이는 김에 경계를 하나 세웠다: frontmatter 파싱을 `oculpm/skill_frontmatter.rs` 로 옮겼다(703줄로). 이 저장소의 규약대로 로직은 `oculpm/` 에 살고 커맨드는 조율만 한다 — 그리고 여기 있는 네 필드는 전부 *발동*에 관한 것이라, 같은 사실 위에 선 `skill_trigger`(description 재작성 제안) 옆자리가 맞다.

옮기면서 자체 결함 1건: 헤더에 구조체를 새로 쓰고 원본 블록도 함께 가져와 `Default` 가 이중 파생됐다(E0119). 헤더 쪽을 걷었다.

## 남은 것

플랜 `skill-invocation-visibility` 로 내렸다 — 발동 순간의 인용(`firing-quotes`, 원장에 직전 프롬프트 한 줄), `휴면` 배지 3분화(`dormant-three-ways`), 프롬프트 시뮬레이터(`prompt-simulator`). 셋 다 이번 범위 밖이고, 시뮬레이터는 인용의 실측 뒤에 와야 한다(예측이 실제 발동과 어긋나면 신뢰를 잃고, 그 어긋남은 원장이 있어야 잴 수 있다).

## 검증

`pnpm typecheck` 0 · `pnpm test` 185파일 2,411개 통과 · `pnpm lint` 0(경고 50은 기존 래칫) · `pnpm build` 0 · `cargo test` 전 스위트 통과 · `cargo clippy --all-targets -D warnings` 0 · `cargo fmt` 적용.

새 테스트: `splitSentences`(마침표 뒤 공백만 경계, `v2.44` 안 잘림) · `triggerHints` 3케이스(한국어 트리거 분리 / 영어 `Use when` / **트리거 없으면 안 나눔**) · 직접 호출 스킬이 목록 배지와 상세 「언제 걸리나」를 내는 컴포넌트 회귀 · Rust `disable_model_invocation_accepts_bool_and_string`(`true`·`"true"`·`yes`·`false`·부재).

`skills_v2.test.tsx` 의 `beforeEach` 가 `fx.overview` 를 안 되돌리고 있어 새 케이스가 픽스처를 갈아끼우면 뒤 테스트가 앞 테스트의 스킬을 보게 된다 — 되돌림을 추가했다.

육안 확인은 아직: 앱이 도는 중에는 dev 빌드를 띄우지 않는 규율이라 다음 앱 실행 라운드에서 본다.