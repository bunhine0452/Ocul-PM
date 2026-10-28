---
schema_version: 1
type: feature
slug: "ui-density-round-3"
status: done
difficulty: high
created_at: "2026-10-28T12:32:09+09:00"
session_id: "20261028-004"
agent:
  id: "claude-code"
  session: "d10a8c2c-116c-4611-b76f-b84aa7c64d3d"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/settings/tabs/DensitySection.tsx"
    op: update
  - path: "src/features/today/FirstRunSheet.tsx"
    op: create
  - path: "src/components/Toolbar.tsx"
    op: update
  - path: "src/components/Sidebar.tsx"
    op: update
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
  - path: "src/features/today/TodayNums.tsx"
    op: create
  - path: "src/features/oculpm/EntryNextRow.tsx"
    op: create
  - path: "src/features/oculpm/EvidenceCard.tsx"
    op: update
  - path: "src/features/oculpm/evidenceInbox.ts"
    op: create
  - path: "src/features/planner/PlanLog.tsx"
    op: create
  - path: "src-tauri/src/oculpm/planner/log_query.rs"
    op: create
  - path: "src-tauri/src/commands/plan.rs"
    op: update
  - path: "src/features/diff/DiffEntryFooter.tsx"
    op: create
  - path: "src/features/branch/BranchReceipt.tsx"
    op: update
  - path: "src/features/discussion/DiscussionView.tsx"
    op: update
  - path: "src/features/discussion/discussionDecide.ts"
    op: create
  - path: "src/features/skills/SkillsSimpleView.tsx"
    op: create
  - path: "src/features/terminal/TerminalResultBar.tsx"
    op: create
  - path: "src/features/terminal/lastResultStore.ts"
    op: create
  - path: "src/features/terminal/terminalSurface/useResultLine.ts"
    op: create
  - path: "src/features/terminal/terminalSurface/blockSticky.ts"
    op: create
  - path: "src/features/terminal/TerminalDock.tsx"
    op: update
  - path: "src/windows/TerminalWindow.tsx"
    op: update
  - path: "src/features/onboarding/StartScreen.tsx"
    op: update
  - path: "src/features/onboarding/home/LeadBand.tsx"
    op: update
  - path: "src/features/onboarding/home/useProjectScores.ts"
    op: create
  - path: "src/lib/resumeIntent.ts"
    op: create
  - path: "src/lib/settings.ts"
    op: update
  - path: "src/styles/density.css"
    op: update
  - path: "src/__tests__/ui_density_round3.test.tsx"
    op: create
related: []
tags:
  - "ui-density"
  - "design-canvas"
  - "terminal"
  - "settings"
  - "onboarding"
  - "planner"
  - "discussion"
  - "mcp-tool"
---
[x] UI 밀도 라운드 3 — 시안 17장의 나머지를 전부 (설정 표시·첫 실행 시트·베타 알약·결과 끝 줄·도크 접힘·결정 칸·스킬 두 열·시작 탭 사령탑)

## 추가 기능

사용자가 「시안 그대로 적용해야지」라고 했다 — 라운드 2 뒤 「그대로 둔 것」으로 적었던 셋(첫 실행 시트 · 논의 옵션 카드/결정 · 스킬 후보·잠자는 중)과, 시안 17장을 다시 대조해 나온 나머지 전부를 넣었다. 새 자료는 거의 없고 **이미 아는 것을 시안의 자리로** 옮긴 라운드다.

- **설정 「표시」** (시안 F) — 탭 이름 모양→표시. 밀도 두 카드(「기본」 꼬리말 + 누구를 위한 것인가), 베타 화면 스위치 다섯(`hidden_hold_views`, 쉼표 id — 끄면 사이드바 베타 단 행이 **접힘**; 열려 있으면 돌아오고 ⌘K·⌘번호는 그대로), 그 밖에(단축키 힌트 `kbd_hints` · 테마 바로가기). 간단 밀도의 「전문 · 7」 아래 접힌 탭 이름.
- **첫 실행 세 단계 시트** (시안 E) — 일지 0건 동안 오늘 화면 위에. ① 프로젝트 추가했어요 ② 플러그인 두 줄(탐침이 찾으면 스스로 초록, 30초마다) ③ 한 가지 시키고 기다리기. 「이미 알아요 — 건너뛰기」는 `first_run_sheet_dismissed`. 시트가 있는 동안 PluginSetupCard 는 접는다.
- **툴바 알약** — 보류 등급 네 화면(터미널·편집기·에이전트·AI 대화)에 「베타 · 결함 수정만」. 랜딩·README 와 앱이 같은 말.
- **사이드바** — 일지(오늘 N)·변경(미커밋 N) 배지, ⌘K 바닥 「접힌 단의 화면도 여기서 열려요」.
- **오늘** — 머리글 숫자 셋(증거 N/M 은 bug·feature·refactor 만 분모 · 미기록 파일 · 다음 할 일), ① 칼럼 꼬리(+N건 더 · 에이전트별 · 스탠드업 복사), ③ 칼럼에 이어하기 카드 + 첫 항목 플랜의 완료 조건, MiniEntry 증거 방패.
- **일지 상세** — 증거 카드에 「사람 확인」 곁줄(증거와 다른 사실), 「다음은」 줄(변경 N파일 · 관련 N · redteam 복사), 목록 「증거 없음」 칩.
- **플래너** — `[사용자]` 알약, 「변경 로그 N행」 접힘(간단 한 줄 · 전문 표). 새 명령 `plan_log` — `project.rs` 가 래칫(836줄)이라 `planner/log_query.rs` 를 신설.
- **변경** — 일지별/파일별 토글, 「이 일지의 검증: 명령 · 결과 끝 줄」 바닥줄 + 확인 명령 복사 + 사람 확인 토글.
- **브랜치** — 영수증에 한 일(방패/「칸 없음」) · 바깥 심판(CI 는 「이 앱은 몰라요」, redteam 「아직 안 돌림」) · 릴리스 노트 초안.
- **논의** — 옵션 격자 A/B/C 알약, 결정 칸(사유 한 줄 필수 → 결론 절 + 토의 로그 → resolved 잠금), 목록 열림/결정됨 묶음.
- **스킬** — 간단 밀도 두 열(규칙 후보·규칙 / 플러그인 명령 「언제 쓰나」·프로젝트 스킬 + FiringBadge). 전문은 3존 그대로.
- **터미널** — 결과 끝 줄 바(마지막 끝난 명령의 `명령 · 끝 줄 · exit`, 「검증 칸으로 ⇧⌘J」 · 출력 복사), **검증 칸 받은함**(`evidenceInbox`, 수동 일지가 열릴 때 `## 검증` 절로 미리 채우고 비움), 실패 블록 「에러 일지 초안」(type=error), 상태줄 명령 N·실패 N, **도크 접힘 한 줄**(`terminal_dock_collapsed`, xterm 은 내려가고 PTY 는 산다 — 마지막 결과는 `lastResultStore` 가 든다), 분리 창 크롬에 일지 N·앱으로 되돌리기, 에이전트 두 화면에도 「이 터미널과 기록」 열.
- **시작 탭** — 「오늘 어디서부터?」 머리글(프로젝트 N · 오늘 일지 N · 사용자 몫 N), 사령탑에 최근 일지 셋·훅 문장·「이 맥락으로 이어서 작업」(`resumeIntent` 슬롯 → 오늘 화면이 디스패치) · 「오늘 화면」, 원장 행 숫자 셋(증거 % · 미기록 · 다음 할 일, 전문은 재수정도 — `useProjectScores`, 프로젝트당 질의 둘, 30개 캡), 첫 실행 한 가지 행동 문구.

## 동작 흐름

터미널에서 명령이 끝나면(OSC 133;D) `TerminalInstanceImpl` 이 출력의 마지막 비공백 줄을 읽어 `onBlockDone` → `lastResultStore`. 결과 줄 바·접힌 도크가 그걸 읽고, 「검증 칸으로」/⇧⌘J 는 `evidenceInbox` 에 넣는다. 수동 일지 작성기가 열리면 받은함을 비워 `## 검증` 절로 미리 채운다. 에이전트 일지에는 닿지 않는다 — 클립보드에도 같은 줄이 있어 붙이는 건 사람의 손.

## 정직하게 둔 것

- 브랜치 영수증의 CI 열은 데이터가 없어 「이 앱은 몰라요」로 적었다. 시안의 pass 행은 그리지 않았다.
- 원장의 「다음 할 일」은 brief 가 ≤3 만 주므로 3 이면 「3+」.
- 설정 베타 스위치의 「10월 fix N」 숫자는 실시간으로 셀 근거가 없어 뺐다.
- 터미널 블록 **접기**는 xterm 그리드라 불가(commandBlocks.ts 주석) — 손잡이는 캔버스 아래 한 줄.

## 검증

- `pnpm typecheck` · exit 0
- `pnpm test` · 260 files · **3,296 passed** (라운드 전) → `ui_density_round3.test.tsx` 13 passed 추가
- `pnpm lint` · 6 게이트 clean (eslint 경고 4 = 기존 허용치)
- `pnpm build` · ✓ built
- `cargo fmt --check` · `cargo clippy --all-targets --locked -D warnings` · exit 0 (`plan_log`)
- 설치본 육안은 아직 — 플랜 `ui-density-round-3-20261028` 의 사용자 항목.

## 함정

- 기본 밀도가 simple 이라 3존 스킬 화면을 재는 테스트 넷은 `vi.mock("@/hooks/useDensity")` 로 pro 고정.
- `blocked()` 래칫: 이유 없는 `disabled` 가 둘 늘어 붉었다 — 표준 패턴으로.
- 색 리터럴 화이트리스트: `var(--term-bg, #211e18)` 같은 폴백도 잡는다.
- 도크가 `useTerminalSessions` 를 직접 구독하면 `workspace_slice_consumers` 가 붉는다 — 접힌 줄을 자식으로.
- `modifier_glyph_gate`: `k("⌘J")` 처럼 콜백 인자 안의 글리프는 kbd() 로 안 친다.