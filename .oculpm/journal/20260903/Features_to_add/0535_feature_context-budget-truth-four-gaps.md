---
schema_version: 1
type: feature
slug: "context-budget-truth-four-gaps"
status: done
difficulty: high
created_at: "2026-09-03T05:35:53+09:00"
session_id: "20260903-002"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/agent_surface.rs"
    op: create
  - path: "src-tauri/src/oculpm/rule_negation.rs"
    op: create
  - path: "src-tauri/src/oculpm/skill_dormancy.rs"
    op: create
  - path: "src-tauri/src/oculpm/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/rules.rs"
    op: update
  - path: "src-tauri/src/oculpm/rule_scope.rs"
    op: update
  - path: "src-tauri/src/commands/rules.rs"
    op: update
  - path: "src-tauri/src/commands/skills.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/api/claudeSurface.ts"
    op: update
  - path: "src/features/skills/contextModel.ts"
    op: update
  - path: "src/features/skills/ContextLiveList.tsx"
    op: update
  - path: "src/features/skills/ContextBudgetBar.tsx"
    op: update
  - path: "src/features/skills/ContextProposals.tsx"
    op: update
  - path: "src/features/skills/ContextInbox.tsx"
    op: update
  - path: "src/features/skills/ContextEditor.tsx"
    op: update
  - path: "src/features/skills/SkillsScreenV2.tsx"
    op: update
  - path: "src/features/skills/skills.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/agent_context_model.test.ts"
    op: update
related: []
tags:
  - "context-budget"
  - "skills-screen"
  - "ad-6"
  - "measurement"
  - "mcp-tool"
---
[x] 컨텍스트 예산의 구멍 넷을 메운다 — 누락된 표면·글롭 실측·부정 감지·0회 4상태

## 추가 기능

ECC 룰팩을 전역에서 걷어내는 라운드에서 스킬·규칙 화면의 측정 구멍 4개가 드러났다. 화면은 세션당 **119KB** 를 보고했지만 실제는 약 **149KB** 였다. 플랜 `context-budget-truth` 의 A~D 를 전부 구현했다.

### A. 에이전트·커맨드 표면이 예산에서 통째로 빠져 있었다

`ContextKind` 는 `skill | rule | memory` 뿐이었다. 그런데 하네스는 `~/.claude/agents/*.md` 와 `commands/*.md` 의 **name+description 을 매 세션 시스템 프롬프트에 목록으로 실어 보낸다** — 이 머신 실측으로 에이전트 67개 18.6KB + 커맨드 94개 11.1KB = 29.7KB.

- `oculpm/agent_surface.rs` 신설 — 프로젝트·전역의 `.claude/agents`·`.claude/commands` 를 훑어 frontmatter 파싱. 세는 것은 스킬과 같은 규율로 **본문이 아니라 광고 비용**(`bytes`)이고, 디스크 전체는 `body_bytes` 로 따로 낸다.
- `ContextKind` 에 `agent`·`command` 추가, 예산 바에 `surface` 조각 추가. 항상 로드와 조각을 나눈 이유는 **되찾는 방법이 다르기** 때문이다 — 규칙은 `paths` 를 좁혀 줄이고, 표면은 파일을 지워야 준다.
- 플러그인 제공분(`~/.claude/plugins/**`)은 세지 않는다. 파일 단위로 손댈 수 없어 목록에 올려도 할 수 있는 일이 없다 — 한계를 `excludes_plugins` 로 드러낸다.
- `measurable: false` — 발동 원장은 transcript 의 규칙 주입을 세는 물건이라 에이전트 호출을 보지 못한다. 물을 수 없는 것에 "0회" 를 붙이면 거짓이므로 배지를 달지 않는다. 이 과정에서 `FiringBadge` 가 `measured=true` + stat 없음일 때 무조건 "휴면" 을 그리던 것도 `item.measurable` 로 막았다.

### B. glob 이 실제로 무는 파일 수

배지가 `paths 2` 였다. 그 2개가 모든 `.ts`·`.tsx` 를 무는 글롭이라 프런트 파일 한 줄만 고쳐도 딸려온다는 사실이 전혀 드러나지 않았다. **감사는 이미 답을 갖고 있었는데**(`GlobMatch.files`) 화면이 안 물었다.

- `audit()` 반환을 `RuleScopeAudit { findings, total_files }` 로 — `total_files` 는 판정이 아니라 **분모**다. 900개가 큰지 작은지는 저장소 크기에 달렸다.
- `globReach()` 순수 함수 + `paths 2 · 900개 파일` 배지. 파일 수는 glob 최댓값을 쓴다 — 겹치는 글롭을 더하면 부풀어 거짓 경보가 나고, 최댓값은 합집합의 **하한**이라 절대 과장하지 않는다.
- 프로젝트의 30%(`DE_FACTO_ALWAYS_RATIO`) 이상을 물면 `사실상 상시` 칩. 분모가 0이면 비율 판정을 하지 않는다.

### C. 실려 놓고 부정되는 규칙

이 머신 실측: 항상 로드 34KB 중 **8.9KB 가 CLAUDE.md 에서 "따르지 않는다" 고 무효화한** 규칙이었다. 싣는 데 한 번, 지우는 문장에 또 한 번 낸다.

- `oculpm/rule_negation.rs` — 항상 로드 규칙의 파일명이 CLAUDE.md 계열에 언급되고 **같은 섹션 안에** 부정 표지가 있으면 후보. 섹션 단위인 이유는 글이 그렇게 생겼기 때문이다 (제목에 파일명, 두 문단 뒤에 "→ 따르지 않는다").
- 맨 스템(`testing`)으로는 매칭하지 않는다 — 흔한 낱말이라 오탐이 쏟아진다. 확장자 붙은 파일명 이상만 신호로 친다.
- 휴리스틱이라 **근거 발췌를 반드시 함께 낸다.** 정리 제안에 `negated` 근거가 붙고, 판정은 사람이 한다. 아무것도 쓰지 않는다.

### D. 「0회」를 네 상태로 가른다

제안 패널이 30일 발동 0회 스킬을 전부 "설명이 발동 기준입니다" 라며 트리거 교정 후보로 밀었다. 이 저장소의 0회 스킬 5개를 뜯어 보니 **설명 문제는 하나뿐**이었다: `project-inception` 은 킥오프 사건이 없었고, `run-evals` 는 `EVALS.md` 가 없고, `tdd-workflow` 는 CLAUDE.md 가 "명시 요청할 때만" 이라 억제해 뒀고, `lang-review` 는 방금 만든 것이었다. 앞의 셋에 설명을 고쳐 쓰면 안 맞는 상황에 끼어드는 스킬이 된다 — 제안이 상황을 나쁘게 만든다.

- `oculpm/skill_dormancy.rs` — 판정하지 않고 **신호만** 모은다: 설명이 가리키는데 없는 파일 · 억제 문장 · 파일 나이. 절대 시각이 아니라 `age_days` 인 이유는 분류기가 묻는 게 "계측 창보다 새 파일인가" 하나뿐이기 때문이다 (Specta 가 `i64` 를 막은 것도 겸사).
- `classifyDormantSkill()` 순수 함수 — `precondition-missing` > `suppressed` > `too-new` > `genuine` 우선순위. **`genuine` 에만** 「설명 고쳐 쓰기」를 낸다.
- 나머지 셋은 목록에서 사라지지 않고 "설명 문제가 아닌 0회" 절에 이유와 근거로 남는다.

## 동작 흐름

`SkillsScreenV2` 가 `rules_list`·`skills_list`·`agent_surface_list` 를 함께 부르고, 보조 신호 3종(`rules_scope_audit`·`rules_negation_audit`·`skills_dormancy_signals`)을 각각 실패 허용으로 부른다. 신호가 없으면 그 조각이 0으로 그려지거나 제안이 안 뜰 뿐, 화면은 그대로 돈다 — 기존 원장·감사와 같은 규율이다.

부수적으로 `KIND_KEY` 표가 목록과 편집기에 중복돼 있어 새 종류를 추가할 때 한쪽을 빠뜨렸다. `contextModel.KIND_LABEL_KEY` 로 합치고 `satisfies Record<ContextKind, string>` 을 걸어 컴파일러가 강제하게 했다.

## 검증

`pnpm typecheck` · `pnpm test`(159파일 2071 테스트) · `pnpm lint`(storage·i18n·bindings·design) · `pnpm build` · `cargo test`(1155) · `cargo clippy --all-targets -- -D warnings` · `cargo fmt --check` — **전부 exit 0 을 직접 확인**했다.

새 테스트: Rust 19개(agent_surface 5 · rule_negation 7 · skill_dormancy 6 · rule_scope 회귀 1), 프런트 모델 20개(표면 6 · globReach 6 · negated 4 · 휴면 분류 10). 실기기 육안 확인은 미완 — 설치본이 도는 중에는 dev 빌드를 띄우지 않는 규율에 따라 보류한다.