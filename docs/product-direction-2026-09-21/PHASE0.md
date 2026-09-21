# Phase 0 — 기준선과 한 경로 확정 (2026-09-22)

[REPORT.md](REPORT.md) §12 Phase 0 의 산출물이다. 진척은 플래너 `first-record-loop`
(`.oculpm/planner/first-record-loop.md`) 가 갖고, 이 문서는 **왜 이 경로인가**와
**변경 전 상태**만 갖는다. 코드가 문서를 이긴다 — 여기 적힌 파일·함수 이름은
2026-09-22 기준이다.

## P0-1 기준선

- 저장소 상태: `main` @ `9ab966b6`. 작업 트리에 다른 세션의 미커밋 변경이 있었다
  (확인 대화상자 리디자인 · 터미널 키 · `TabbedWindow` · 플래너 5개 · `i18n` 4줄).
  이 라운드는 그 파일들을 건드리지 않았고, `i18n` 두 파일은 **값 교정(P1-4)과 키
  추가만** 끝에 붙였다.
- 활성 플랜: `improvement-round-2026-09-14`(18/39), `journal-scale-round`(18/20).
  겹치는 항목은 `#acp-journal-draft`(UUID↔session_id 매핑) 하나 — 이 라운드는
  그 매핑을 **새로 만들지 않고** 이미 있는 `agent.session`(037 캐시 칸)을 읽는다.
- 관련 일지: `20260921/Chores/1815_chore_adoption-barrier-audit.md`,
  `20260906/Bugs/1305_bug_first-five-minutes-truth.md`. 온보딩 태그 일지 14건 중
  "첫 기록을 세션 단위로 확인한다"를 다룬 것은 없다 — 중복 구현이 아니다.

## P0-2 현재 첫 실행 → 첫 기록 흐름 (코드 재현)

설치본이 실행 중이라(`/Applications/Ocul-PM.app`, pid 27189) dev 빌드로 실기기
재현은 하지 않았다 ([`no-dev-build-while-app-runs`] 규칙). 아래는 코드 경로를 따라
재구성한 것이고, **실제 클릭 관찰은 미검증**이다.

| 단계 | 어디서 | 실제로 일어나는 일 | 사용자가 보는 것 |
|---|---|---|---|
| 1 | `WelcomeWizard` lang→look→project | `createProject`(DB 행) + `indexProject` | "이제 열기만 남았어요" + → 목록 (미래형, 정직) |
| 2 | `ProjectTab` 마운트 | `oculpmInit` — `.oculpm/`·`config.toml`·`AGENTS.md` 블록·`.gitignore` 블록 | Today `FirstRunCard`(무엇을 썼는지) |
| 3 | Today 빈 상태 | 아무 자동화도 안 켜짐 (`auto_journal_draft`·`auto_reconcile` 기본 false) | "오늘 기록이 아직 없어요" + 「여기서 에이전트 실행」·「규칙 화면」 |
| 4 | `PluginSetupCard` | `check_cli_available("claude")` ∧ `claude_plugin_status`(못 찾음) ∧ `total_entries==0` | 설치 명령 두 줄 + 다시 확인 |
| 5 | 에이전트 실행 (터미널) | SessionStart 훅 → `.session-start-<대화>`·`.session-live-<대화>` 마커, `claude-events.jsonl` append, `plan-context.sh` 가 활성 플랜 요약 주입. AGENTS.md §0 이 `journal_search` 를 먼저 하라고 지시 | 없음 (앱은 마커 폴더에 이벤트를 내지 않는다) |
| 6 | 에이전트 `journal_write` | MCP 서버가 `agent.session = OCULPM_SESSION_ID ?? CLAUDE_CODE_SESSION_ID` 를 프론트매터에 적음. 워처 색인 → `OculpmJournalAdded` | 링 리플 + 「새 일지」 토스트(열기) — **어느 대화의 것인지는 말하지 않음** |
| 7 | Stop / SessionEnd 훅 | `oculpm-mcp verdict` 가 대화 단위 판정. 미기록이면 Stop 에서 턴 1회 차단, SessionEnd 에서 `journal-missing.jsonl` 에 `missing` | `JournalMissingCard` (일지 없이 끝난 세션) |

**변경 전 실패 위치 (확인된 사실)**

- F-A. "첫 기록 성공"을 말하는 화면이 없다. 성공은 `changedToday`·`total_entries` 숫자와
  범용 토스트로만 암시된다. `PluginSetupCard` 는 `total_entries === 0` 으로 숨는데, 그
  숫자는 git 백필·옆 대화·수동 일지로도 오른다 — 보고서 §7 이 금지한 판정이다.
- F-B. 대화 귀속 자료는 **전부 백엔드에만** 있다: 프론트매터 `agent.session`, 캐시
  `oculpm_journal.agent_session`(037), `sessions.json.agent_sessions`, 훅 마커.
  `JournalEntrySummary` 에는 없고, 대화별로 접어 주는 커맨드도 없었다. 실측:
  `20260921` 작업 세션에 대화 7개가 붙어 있었지만 `linked_journal_entries` 는
  세션 단위로만 파생됐다.
- F-C. 준비 상태가 "설정 존재"까지만이다 (CLI·플러그인 탐지). "실제로 연결됐다"
  (훅이 이 프로젝트에서 세션을 관측했다)를 말하는 자리가 없다.
- F-D. 문구 9곳이 조건부인 일을 무조건으로, 아직 안 일어난 일을 일어난 것처럼
  말했다 — `welcome.lang.sub`·`welcome.project.sub/note`·`welcome.ready.li3`·
  `today.activated`·`today.terminal.hint`·`today.plugin.body`·`today.firstRun.oculpmDir/gitignore`
  (P1-4 에서 교정, ko/en).

## P0-3 실행 경로별 관측 범위

| 경로 | 준비 감지 | 실행 감지(살아 있음) | 기록 귀속 | 검색·읽기 관측 | 전달 관측 |
|---|---|---|---|---|---|
| **Claude Code 터미널 + oculpm 플러그인** (앱 Today 빠른 터미널 포함) | CLI·플러그인 탐지(놓칠 수 있고 오탐 없음) | `.session-start/.session-live` 마커(훅), `sessions.json.agent_sessions`, `agent_register` 시 A2A 카드 | **1순위** `agent.session` (`OCULPM_SESSION_ID`/`CLAUDE_CODE_SESSION_ID`) + verdict 사다리 | 없음 — MCP 서버는 별 프로세스이고 `journal_search/read` 호출을 앱이 보지 못한다 | 없음 — `plan-context.sh` 는 플랜만 주입, 일지 회상 주입 없음 |
| 앱 안 ACP (Claude Code·Codex 패널) | 어댑터 설치·`oculpm-mcp` 물려줌(`AcpRecordingStatus`) | `journal_gate` 가 같은 마커를 씀 | `agent.session` = 앱이 발급한 기록 신원, 매 턴 판정 | 없음 | 없음 |
| AI 패널 (provider chat) | API 키 | 해당 없음 | 일지를 쓰지 않음 (플래너 액션 제안만) | `recallGate` 판정 · `recallUsage` 런타임 · `recall_touch`(**AI 패널 전용 호출**, `AiPanelScreenV2.tsx:481` 이 유일한 호출자) | 컨텍스트 포함 = `recall_touch` |
| Cursor·Gemini·기타 AGENTS.md 전용 | 없음 | 워처 파일 이벤트만 | `session_id` 시간대 매칭(3순위), `agent.session` 없음 → **귀속 불명** | 없음 | 없음 |

`recall_touch` 통계가 ACP·외부 MCP 에 연결돼 있지 않다는 보고서의 경고는 코드로
확인됐다 — Phase 2 의 "전달 관측"은 새 자리가 필요하다.

## P0-4 확정한 경로와 재사용 범위

**Claude Code 터미널 + oculpm 플러그인.** 이유 셋:

1. 대화 id 로 일지 귀속이 되는 유일하게 관측이 갖춰진 경로다 (마커·환경변수·판정).
2. README 가 권하는 "플러그인만으로 시작" 경로이고, Today 빈 상태의 CTA(「여기서
   에이전트 실행」)가 이미 이 경로를 연다 — 화면 구조를 바꾸지 않아도 된다.
3. 이 라운드를 실행한 세션 자체가 이 경로다 (대화 `11374f00-…`, 마커와
   `sessions.json` 에 실려 있음). 마지막 일지의 `agent.session` 이 그 id 로 남는지가
   곧 실제 왕복 증거다 — `{#p1-verify}` 에 기록한다.

재사용한 것 (새 스키마 없음): `verdict::collect` 의 마커 파싱·`workday_sessions`,
`verdict::ledger::journal_missing_signals`(해소 필터 포함), 캐시 `agent_session` 칸,
`claudeInstallApi` 탐침, Today 카드 CSS(`.first-run-*`), `openEntryInJournal` 핸드오프.

새로 만든 것: `oculpm::first_record`(순수 `assemble` + IO `collect`),
`cache::conversations::entries_since_workday`, 커맨드 `first_record_ledger`,
`FirstRecordCard`·`firstRecordModel`·`useFirstRecord`, 워크스페이스
`firstRecordArmed`(프로젝트별 영속), i18n `today.firstRecord.*`.

## 한계 (정직하게)

- 실기기 미검증: 설치본이 도는 동안 dev 빌드를 하지 않았다. 카드의 다섯 상태는
  vitest 로, 원장은 Rust 단위 테스트로만 확인했다.
- 「실행 중」은 마커 mtime 이 근거라 이벤트가 없고, 카드는 분 단위 틱으로 갱신한다.
- 사용자 수·전환·재방문은 여전히 모른다. 이 라운드는 제품 구조의 장벽 F-A~F-D 를
  없앤 것이지 이탈 원인을 확정한 것이 아니다.

## 실제 왕복 증거 (2026-09-22, 이 세션)

이 라운드를 실행한 Claude Code 대화 `11374f00-…` 에 대해 개발 빌드 `oculpm-mcp verdict`
를 읽기 전용으로 돌렸다 (`--ledger` 없음).

| 호출 | 결과 | 뜻 |
|---|---|---|
| `--conversation 11374f00-…` (트랜스크립트 없음) | exit 11 판정 불가 | 같은 워킹트리에 살아 있는 옆 대화 2개 — mtime 만으로는 누구 편집인지 모른다 |
| 같은 호출 + `--transcript <이 대화의 jsonl>` | exit 10 이의 — "바꾼 파일 7개가 아직 기록되지 않았습니다" | 트랜스크립트의 Write/Edit 호출로 **양성 귀속** — Bash(python)로 고친 파일은 빠진다 (모듈 문서가 적어 둔 한계 그대로) |

마커 `.session-start-11374f00-…`·`.session-live-11374f00-…` 는 훅이 찍은 그대로였고,
`sessions.json` 의 `agent_sessions` 에도 이 id 가 있다. 이 라운드의 일지가
`agent.session: 11374f00-…` 로 남으면 「첫 기록」 카드의 `recorded` 입력이 실제로
만들어지는 것이다 — 카드 화면 자체는 설치본 재빌드 전이라 미확인.
