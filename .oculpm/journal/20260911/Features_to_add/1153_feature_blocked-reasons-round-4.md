---
schema_version: 1
type: feature
slug: "blocked-reasons-round-4"
status: done
difficulty: medium
created_at: "2026-09-11T11:53:22+09:00"
session_id: "20260911-006"
agent:
  id: "claude-code"
  session: "7cc0fab5-a8c8-411e-8f19-be819da44294"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/lib/blocked.ts"
    op: update
  - path: "src/components/ui/button.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/blocked.test.ts"
    op: update
  - path: "src/__tests__/journal_v2.test.tsx"
    op: update
  - path: "src/__tests__/declarative_config.test.tsx"
    op: update
  - path: "src/features/settings/McpServerBlock.tsx"
    op: update
  - path: "src/features/settings/OculpmSettings.tsx"
    op: update
  - path: "src/features/planner/PlanItemRow.tsx"
    op: update
  - path: "src/features/planner/PhaseCard.tsx"
    op: update
  - path: "src/features/onboarding/GreenfieldWizard.tsx"
    op: update
  - path: "src/features/chat/conversation/Composer.tsx"
    op: update
  - path: "src/features/chat/AiPanelScreenV2.tsx"
    op: update
  - path: "src/features/code/gitDecor.ts"
    op: update
  - path: "src/features/code/CodeScreenV2.tsx"
    op: update
  - path: "src/features/chat/conversation/SessionPanel.tsx"
    op: update
  - path: "src/features/planner/usePlanDocument.ts"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "package.json"
    op: update
related:
  - ref: "20260910/Features_to_add/1951_feature_blocked-reason-ruler-and-code-screen.md"
    kind: "followup"
tags:
  - "design"
  - "a11y"
  - "blocked"
  - "eslint"
  - "mcp-tool"
---
[x] 비활성 이유 4차 — 남은 69곳 중 59곳이 이유를 말한다 (래칫 69→10) + ESLint 경고 9→4

## 추가 기능

「oculpm 의 개선사항을 찾아 전부 진행」 라운드의 첫 항목. 3차가 남긴 69곳을 자(`blocked.test.ts` 스캐너)로 다시 뽑아 자리마다 읽고 **59곳을 `blocked()` 로** 옮겼다 — 설정 12탭·MCP/Desktop 등록·ACP 어댑터 설치·논의·플래너 단계 이동/상태 글리프·마법사 「다음」·스킬/규칙 작성·테마 편집기·트레이 스탠드업·모바일 5탭·시작 탭까지. 새 문안 41개(ko/en), `code.debug.blockedNoProgram` 은 이미 있던 키를 썼다.

- **이미 이유를 쥐고 있던 자리 셋**을 도달하게만 했다: `PlanItemRow` 상태 글리프(title 에 「하위 롤업」·「완료·잠금」이 있었는데 disabled 라 한 번도 안 떴다), 논의 「계획으로 승격」(`disc.promoteNeedSteps`), ACP 울트라 칸(`acp.ultracodeNeedsModel`).
- **문안은 「무엇을 고쳐야 풀리는가」** 한 문장 — 「보낼 내용을 적어 주세요」「프로젝트를 먼저 여세요」「MCP 서버 실행 파일을 못 찾았어요」. 에러 문자열을 이미 쥔 자리(`hooksError`·`mcpError`·`deskError`·`slugError`)는 그 문자열이 곧 이유다. 로딩(`mcp == null`)은 「상태를 아직 못 읽었어요」로 「설치 안 됨」과 구별한다.
- **스타일 훅**: shadcn `Button` 베이스에 `aria-disabled:opacity-50`, Tailwind 인라인 버튼(마법사·시작 탭·모바일)에 `aria-disabled:` 변형, `.pln-item-glyph` 의 `:disabled` 셋을 `:is(:disabled,[aria-disabled])` 로.
- **안 옮긴 10곳**(각각 이유가 있다): cmdk 항목(프로젝트 밖 심볼) · TraceRow(펼칠 게 없는 행은 동작이 아니다) · DiffFileList/AppearanceTab/AutomationEditor 입력(프리미티브 통과·`<input>`) · 가져오기 체크박스 · ContextTab textarea · 테마 체크박스 · ProjectManager 전체선택. 래칫은 **69→10**.
- 곁가지 — **ESLint 경고 9→4**: `gitDecor` 정리 함수의 ref 별칭, `CodeScreenV2 openSearch` 의 `setState` 의존성, `ManualEntryModalV2` 의 `t`, `SessionPanel`·`usePlanDocument` 의 「목록/프로젝트가 바뀔 때만 기준 시각을 다시 읽는다」 를 `void dep` 로 명시. 남은 4는 설정 파일이 **일부러** warn 으로 둔 것(`no-control-regex` 3·`no-irregular-whitespace` 1). `--max-warnings` 9→4.

## 동작 흐름

`disabled={busy || !x}` → `{...blocked(x ? null : reason)} disabled={busy}`. 진행 중은 그대로 `disabled`(스스로 풀린다), 조건은 `aria-disabled`+title+capture 클릭 차단. 폼 submit(Enter) 경로는 호출부의 기존 가드(`if (!canSubmit) return`)가 그대로 막는다. 800줄 초과 파일 다섯(`CodePane`·`CodeScreenV2`·`OculpmSettings`·`AiPanelScreenV2`·`TrayPopover`)은 import 한 줄이 늘어도 크기 래칫을 안 넘게 취소 버튼 셋을 한 줄로 접었다 — 전부 이전 크기 이하.

## 검증

- typecheck · lint 6게이트(filesize 는 `DiscussionScreenV2` 801→798 로 다시 맞춤) · vitest 전체 · build 초록. `blocked.test` 래칫 10, `journal_v2`·`declarative_config` 의 `disabled` 단언 둘을 aria-disabled+이유+클릭 무반응 단언으로 교체.
- 실기기에서 툴팁이 실제로 뜨는지는 안 봤다 — 2차에서 같은 패턴을 확인했고 이번은 자리만 늘었다.