---
schema_version: 1
type: feature
slug: agent-context-three-zones
status: done
created_at: 2026-08-31T18:46:00+09:00
session_id: "manual-20260831-184600"
agent:
  id: claude-code
  version: claude-opus-5[1m]
language: ko
verified_by_user: false
difficulty: high
files_touched:
  - path: src/features/skills/contextModel.ts
    op: create
  - path: src/features/skills/ContextBudgetBar.tsx
    op: create
  - path: src/features/skills/ContextLiveList.tsx
    op: create
  - path: src/features/skills/ContextInbox.tsx
    op: create
  - path: src/features/skills/ContextEditor.tsx
    op: create
  - path: src/lib/agentContextNav.ts
    op: create
  - path: src/lib/promoteSeed.ts
    op: create
  - path: src/api/claudeSurface.ts
    op: create
  - path: src/features/today/TodaySuggestions.tsx
    op: create
  - path: src/__tests__/agent_context_model.test.ts
    op: create
  - path: src/features/skills/RulesTab.tsx
    op: delete
  - path: src/features/skills/SkillsScreenV2.tsx
    op: update
  - path: src/features/skills/SkillShopTab.tsx
    op: update
  - path: src/features/skills/PluginDocsTab.tsx
    op: update
  - path: src/features/skills/skills.css
    op: update
  - path: src/features/shell/ShellV2.tsx
    op: update
  - path: src/components/CommandPalette.tsx
    op: update
  - path: src/components/Icons.tsx
    op: update
  - path: src/features/oculpm/EntryDetailView.tsx
    op: update
  - path: src/features/diff/DiffScreenV2.tsx
    op: update
  - path: src/features/terminal/TerminalBlockMenu.tsx
    op: update
  - path: src/features/today/TodayScreenV2.tsx
    op: update
  - path: src/features/retro/RuleCandidates.tsx
    op: update
  - path: src/features/retro/SkillCandidates.tsx
    op: update
  - path: src/i18n/ko.ts
    op: update
  - path: src/i18n/en.ts
    op: update
  - path: scripts/check-bindings-imports.mjs
    op: update
  - path: scripts/check-no-hardcoded-korean.mjs
    op: update
  - path: src/__tests__/skills_v2.test.tsx
    op: update
  - path: src/__tests__/rules_hub_v2.test.tsx
    op: update
  - path: src/__tests__/skills_gallery_v2.test.tsx
    op: update
related:
  - 20260829/Chores/1753_chore_agent-discipline-redesign-plan.md
  - 20260829/Features_to_add/1812_feature_firing-ledger-and-badges.md
tags:
  - agent-discipline
  - skills
  - rules
  - ui
---

[x] 스킬·규칙 재설계 Phase 2 — 5탭 관리자를 3존 화면으로 접고, 만드는 문을 사건 위로 흩었다

## 추가 기능

**AD-3 — 화면 3존 통합.** 12번째 화면의 5탭 허브(`스킬 | 샵 | 규칙 | 훅 | 플러그인`)를 한 화면 3존으로 접었다.

- **존 1 컨텍스트 예산 바** — 세션당 들어가는 양을 한 줄로 말한다. 세 조각의 출처가 다르다는 걸 숨기지 않는다: 항상-로드(CLAUDE.md + `paths` 없는 규칙)는 디스크에서 확정, 조건부는 원장이 transcript 에서 센 **실측**, 스킬은 이름+description 광고 비용. 눈금은 실측 기준선 90KB, 목표 눈금 30KB.
- **존 2 걸려 있는 것** — 스킬·규칙·CLAUDE.md 가 한 목록. 종류는 탭이 아니라 필터고, 정렬은 발동 많은 순. 30일 발동 0회와 비활성 스킬은 접힌 **휴면** 섹션으로 자동 강등된다 — 목록이 스스로 청소된다.
- **존 3 제안 인박스** — 회고 화면에만 있던 승격 루프(CI4/CI5 패널)를 그대로 재사용해 옮겼다. 하단 "추가하기" 가 샵 탭과 추천 갤러리 모달을 함께 흡수한다(큐레이션 + 스택 감지 매칭 3종 먼저, 전체 카탈로그는 한 번 더 눌러야).
- 편집은 **단일 편집기**(`ContextEditor`)로 위임 — 스킬 탭과 규칙 탭이 같은 모양의 2-pane 편집기를 두 벌 유지하던 비용이 사라졌다(`RulesTab.tsx` 867줄 삭제). 훅·플러그인 문서·샵은 탭이 아니라 모달.

**AD-4 — 사건 진입점.** 규칙은 "에이전트가 또 같은 실수를 했을 때", 스킬은 "같은 절차를 또 손으로 쳤을 때" 태어난다. 그 순간 사용자는 12번째 화면에 없다.

| 자리 | 액션 | 씨앗 |
|---|---|---|
| 일지 상세(bug/error) | 이걸 규칙으로 | 슬러그=일지 slug · `paths`=바뀐 파일의 디렉터리 · 본문=일지 근거 |
| 변경 diff | 이 변경을 규칙으로 | `paths`=변경 파일 디렉터리 |
| 터미널 명령 블록 | 이 절차를 스킬로 | 본문=그 명령의 코드 블록 |
| Today | 규칙·스킬 제안 N건 | 후보 0건이면 카드 자체가 없다 |
| ⌘K 팔레트 | 규칙 추가 / 스킬 추가 | 빈 폼 |

## 동작 흐름

1. 사건 화면이 `requestAgentContext({kind, seed})` 로 요청한다 (`lib/agentContextNav.ts` — `journalCompose` 와 같은 끈적 intent slot).
2. 컨텍스트 화면이 떠 있으면 그쪽 구독이 즉시 소비하고, lazy 라 아직 안 붙었으면 셸이 `hold` 해 두고 화면을 옮긴다. 화면은 마운트에서 `consume` 으로 회수한다.
3. 회수한 요청이 씨앗 채워진 생성 모달을 연다. **파일은 여전히 사용자가 "만들기" 를 눌러야 쓰인다** — draft=AI, decision=사람 규율 그대로.

씨앗 계산(`lib/promoteSeed.ts`)은 순수 함수다: 슬러그는 라틴 문자가 없으면 **빈 문자열**을 돌려준다(한국어 제목에 엉뚱한 자동 이름을 붙이는 것보다 사용자가 적는 편이 낫다), `paths` 는 파일이 많이 모인 디렉터리 순 `<dir>/**` 최대 3개, 루트 파일은 건너뛴다.

곁들여: 새 파일 4개를 `bindings.ts` 직접 호출 대신 `api/claudeSurface.ts` 래퍼로 냈고, 다시 쓴 `SkillsScreenV2` 도 함께 옮겨 `lint:bindings` 백로그에서 2건을 뺐다.

## 검증

- 게이트 4종 직접 확인: `pnpm typecheck` / `pnpm test`(125 파일 1510건) / `pnpm lint`(storage·i18n·bindings) / `pnpm build` 전부 exit 0.
- 새 스위트 `agent_context_model.test.ts` 15건 — 통합 목록 접기·휴면 판정(계측 전엔 0회를 주장하지 않는다)·예산 세 조각·씨앗 계산.
- 재작성한 화면 스위트 3종(스킬·규칙·추천)은 axe 포함 그린. 규칙 쪽은 옛 계약(paths 칩 편집·CLAUDE.md 시드 생성·Cursor 미러 토글·삭제 가드)이 드릴다운 편집기에서 그대로 지켜지는지로 다시 썼다.
- AD-4 는 양쪽을 갈라 덮었다: 보내는 쪽은 `promoteSeed` 순수 테스트, 받는 쪽은 화면이 씨앗 채운 모달로 회수하는 테스트 2건.

## 메모

- 실기기 육안 확인은 아직(설치본이 도는 동안 dev 빌드 금지 규율). 예산 바의 실측 조각은 transcript 스캔이 한 바퀴 돌아야 채워진다.
- Phase 3(AD-5 제안 3종 신규 · AD-6 규칙 다이어트)은 미착수. 예산 바의 "무관 규칙 경고 조각"과 존 3 정리 카드로의 점프는 AD-6 에서 붙는다.
- 사전에서 죽은 키 36개(옛 탭·2-pane 목록·빈 상태 문구)와 죽은 CSS 25블록을 함께 걷어냈다.
