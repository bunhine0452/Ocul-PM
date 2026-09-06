---
schema_version: 1
type: bug
slug: "first-five-minutes-truth"
status: done
difficulty: high
created_at: "2026-09-06T13:05:01+09:00"
session_id: "20260906-002"
agent:
  id: "claude-code"
  session: "b2e235a0-7801-4870-9780-7b970cc85e65"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/onboarding/WelcomeWizard.tsx"
    op: update
  - path: "src/features/today/PluginSetupCard.tsx"
    op: create
  - path: "src/features/today/HonestyAudit.tsx"
    op: update
  - path: "src/features/today/JournalMissingCard.tsx"
    op: update
  - path: "src/api/claudeSurface.ts"
    op: update
  - path: "src/__tests__/firstrun_honesty.test.tsx"
    op: create
related: []
tags:
  - "v3-surface"
  - "onboarding"
  - "today"
  - "honesty"
  - "mcp-tool"
---
[x] 첫 5분이 사실을 말한다 — 시제를 고치고, 초라한 자리에 행동을 놓는다

기둥 2(`v3-surface`)의 「첫 5분이 사실을 말한다」 Phase — `{#wizard-tense}` `{#today-empty-truth}` `{#plugin-onboarding}` `{#first-day-screens}` `{#honesty-actions}`.

## 발생 원인

이 제품은 "기록이 진짜로 남는다"를 파는데, **첫 5분의 화면이 아직 일어나지 않은 일을 일어난 것처럼 말하고 있었다.**

- 마법사 마무리 판이 체크 표시(✓)와 함께 완료형으로 말했다. 그런데 그 시점에 심긴 것은 없다 — `StartTab.tsx:211` 의 `addProjectFromFolder` 는 `create_project`(DB 행 하나, `commands/project.rs:70`)와 `index_project` 만 부르고, `.oculpm/` 과 `AGENTS.md` 는 `ProjectTab.tsx:124` 의 `oculpmInit` 이 **프로젝트를 열 때** 만든다.
- Today 빈 상태가 "Ocul-PM이 자동으로 일지를 작성합니다"라고 했다. `oculpm/config.rs:73-76` 에서 `auto_reconcile`·`auto_journal_draft` 둘 다 기본이 `false` 다 — **그 시점에 켜진 자동화가 하나도 없다.**
- Claude Code 플러그인이 없으면 핵심 고리(에이전트가 일지를 쓴다)가 안 도는데, **미설치를 알리는 토스트·카드·배지가 0곳**이고 안내는 설정 3단 깊이뿐이었다.
- 17화면 중 첫날 살아 있는 것은 5개인데, 나머지는 "비어 있음"만 말하고 무엇을 하면 살아나는지는 말하지 않았다.
- 정직성 감사 패널은 미기록 파일을 **나열만 하고 버튼이 하나도 없었다**. 「일지없는세션」 카드의 유일한 행동은 **과금 LLM 을 켜라는 제안**뿐이었다.

## 해결 방법

**시제.** 마무리 판의 ✓ 를 → 로 바꾸고 문구를 미래형으로, "프로젝트를 열면:" 이라는 목록 라벨을 새로 넣었다. 무엇이 언제 생기는지가 이제 화면에 그대로 적혀 있다.

**Today 빈 상태.** 거짓 문장을 지우되 **"지금 꺼져 있다"고도 쓰지 않았다** — 렌더 시점에 config 를 읽지 않으므로 그것도 근거 없는 주장이다. 상태를 주장하는 대신 "무엇을 하면 시작되는가"만 말하고 행동 두 개(에이전트 실행·규칙 화면)를 놓았다.

**플러그인 카드.** 판정 근거가 실제로 있었다 — `commands/mcp.rs:157 claude_plugin_status`(`~/.claude/plugins/**` 얕은 탐색)와 `commands/greenfield.rs:94 check_cli_available`. 다만 그 함수 주석이 "놓쳐도 무해, 오탐만 없으면 된다"라고 스스로 한계를 적어 두었으므로, 문구를 **"미설치"가 아니라 "못 찾음"** 으로 했다. 새 `PluginSetupCard` 는 CLI 있음 ∧ 플러그인 못 찾음 ∧ 일지 0건일 때만 뜬다. 설치 명령 두 줄 복사 + 다시 확인 + 설정으로 가기.

**빈 상태 12화면.** 화면마다 그 화면을 채우는 **구체적인 한 가지**를 놓았다 — 일지=직접 쓰기/git 백필 · 논의=새 문제 · 플래너=새 계획 · 회고=30일로 넓히기 · 변경=직전 커밋 · 문서=폴더 만드는 명령 복사 · 스킬=필터 0건과 "아직 하나도 없음"을 **분리** · 검색/코드 맵=색인 만들기. 터미널·편집기는 첫날부터 살아 있어 대상이 아니다.

**행동.** 정직성 감사에 무료 3종(「일지로 남기기」·「경로 복사」·「변경 검토」)을 붙였다. 일지 씨앗은 화면에 보이는 12개 상한이 아니라 **경로 전부**를 싣는다. 「일지없는세션」 카드는 무료 행동을 앞에 놓고, 과금 토글 라벨에 **"(모델 호출)"** 을 붙여 무엇이 돈을 쓰는지 라벨에서 보이게 했다.

## 검증

`pnpm typecheck` · `pnpm test`(179파일 2,328건) · `pnpm lint`(eslint 61/61, 증가 0) · `pnpm build` 전부 exit 0. 새 `firstrun_honesty.test.tsx` 7건이 씨앗 전량 실림과 **"근거 없으면 카드 없음"** 을 문다. 문구를 바꿔 깨진 기존 테스트 4개(`today_v2`·`journal_v2`·`today_journal_missing`·`welcome_wizard`)도 함께 고쳤다.

`lint:bindings` 가 새 파일의 `@/lib/bindings` 직접 import 를 막으므로, 스크립트 허용목록을 늘리는 대신(게이트가 "새로 늘리지 말 것") `src/api/claudeSurface.ts` 에 래퍼를 더했다 — 순수 추가다.

## 남은 것

`PluginSetupCard` 에 닫기 버튼이 없다. 영구 닫기는 설정 키가 필요한데 그 파일이 이 레인 소유 밖이었다. 대신 표시 조건을 일지 0건으로 좁혀 **첫 일지 한 건이면 영영 사라진다**. `ShellV2.tsx:520` 의 `shell.selectProjectFirst` 와 `features/projects/` 의 네 번째 리치 빈 상태는 소유 밖이라 남았다. 플러그인 카드는 Claude Code 가 실제로 깔린 기기에서만 뜨므로 실행 확인이 필요하다.