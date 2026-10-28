# Ocul-PM 이 약속하는 것

> 완성도는 결함이 없는 상태가 아니라, **무엇을 약속하는지가 적혀 있고 그 약속이 매번 지켜지는 상태**다.
> 이 문서가 그 약속이다. 랜딩·README 의 첫 화면은 이 문서와 어긋나면 안 되고, 어긋나면 이 문서가 아니라
> 그쪽을 고친다. 진행 상태는 여기 없다 — `.oculpm/planner/polish-round-20261027.md`.

## 한 문장 (동사로)

Ocul-PM 은 「일지 앱」이 아니다. **에이전트가 한 일을 사람이 3분 안에 믿고, 다음을 결정하게 하는 것**이다. 일지·diff·계획은 그 믿음의 증거이고, 아래 열 문장은 그 증거가 매번 서 있게 하는 약속이다. (명사를 동사로 — Rieseberg, "How to be more ambitious", 2026-10-13.)

## 약속 (10문장)

1. 프로젝트 폴더에 규칙 파일(`AGENTS.md`) 하나를 심으면, 터미널의 Claude Code 가 작업 하나를 끝낼 때마다 `.oculpm/journal/` 에 사람이 읽는 마크다운 일지를 남긴다.
2. 그 일지는 앱을 켜 두었을 때 몇 초 안에 작업 일지 화면과 Today 화면에 뜬다.
3. 일지마다 그 시점의 변경 diff 가 붙고, 변경 화면은 네트워크 없이 그 diff 를 줄 단위로 보여 준다.
4. Today 화면은 에이전트가 고쳐 놓고 일지에 적지 않은 파일을 짚어 준다.
5. 다음 날 새 대화를 열면 플러그인의 SessionStart 훅이 활성 계획의 미완 항목과 마지막 일지 3건을 시작 컨텍스트에 싣는다 — 어제를 다시 설명하지 않는다.
6. 계획은 `.oculpm/planner/*.md` 마크다운이 원본이고, 에이전트가 `plan_update` 로 갱신하면 플래너 화면이 따라 바뀐다.
7. 데이터는 전부 프로젝트의 `.oculpm/` 폴더와 로컬 SQLite 캐시에 있고, 서버도 계정도 없다 — 기기를 떠나는 것은 사용자가 시작한 것뿐이며 그 목록은 `src-tauri/tests/egress_inventory.rs` 가 빌드에서 지킨다.
8. 앱이 없어도 `.oculpm/` 은 git 에서 그대로 읽히고, 앱을 지워도 기록은 남는다.
9. 위 1~8 은 **macOS · 터미널 Claude Code + oculpm 플러그인** 경로에서 릴리스마다 사람이 확인한다.
10. 아래 「약속하지 않는 것」 에 있는 화면은 있지만 약속이 아니다 — 고장 나면 고치되, 고장 났다고 릴리스를 막지 않는다.

## 약속하지 않는 것

같은 앱 안에 있지만 **등급이 다르다**. 등급은 10월 fix 커밋 분포(터미널 9 · 설정 7 · 편집기 5 · 채팅 3 · 핵심 넷 합계 2)와
60일 fix 211건 중 주변 95 · 핵심 80 이라는 수치에서 나왔다 (`CLAUDE.md` 범위 동결). **보류 등급은 2026-10-28 에 통째로 걷었다**
(플랜 `simplify-round-20261028`) — 분기를 기다리지 않은 사용자 결정. 에이전트는 사용자의 터미널에서 돌고, 앱은 기록·증거·계획만 한다.

| 등급 | 화면 | 약속 | 받는 변경 |
|---|---|---|---|
| **핵심** | Today · 작업 일지 · 변경 · 플래너 | 위 10문장 | 결함 수정 · 다듬기 · 기능 |
| **뷰어** | 검색 · 논의 · 브랜치 · 스킬·규칙 | 열리고, 보여 주고, 깨지지 않는다 | 결함 수정 · 다듬기 |
| ~~보류~~ | ~~터미널 · 편집기 · Claude Code · Codex · AI 패널~~ — 2026-10-28 제거 | — | — |

- 보류 등급은 걷혔다. 새 화면·통합은 범위 동결(`CLAUDE.md`) 그대로 — 제안은 되지만 만들려면 사용자의 go 와 걷을 표면이 필요하다.
- 다른 에이전트(Codex · Cursor · Gemini CLI)는 1~4 가 규칙 파일만으로 동작하고 5 의 훅은 없다. 등급표는 README 「지원 에이전트」.
- Windows · Linux 는 CI 러너가 설치·기동을 확인한 판만 올라가는 **베타**다. 9 의 「사람이 확인」 은 macOS 만이다.

## 측정 목표 — 「최선을 다한다」가 아니라 숫자

구체적이고 어려운 목표가 「최선을 다하라」보다 낫다(Locke & Latham). 2026-10-27 실측에서 출발해 다음 외부 리뷰(v3.16.0 무렵)까지의 목표를 둔다. 이 저장소(`docs/launch/agent-report-card.py`)로 잰다.

| 지표 | 지금 | 목표 | 왜 이 숫자인가 |
|---|---|---|---|
| 검증 칸에 바깥 심판 증거가 있는 일지 | 83% | **97%** | 나머지 3% 는 「못 돌렸다」고 적은 것이어야 한다 — 템플릿 v16 이 그렇게 요구한다 |
| 일지 없이 끝난 세션 (Stop 훅 판정 `missing`) | 측정 중 | **0** | 약속 1 그 자체다. 하나라도 있으면 규칙이 아니라 결함이다 |
| 커밋에 든 파일 중 어느 일지에도 없는 비율 | 28% | **10%** | files_touched 추정(v3.15)이 받는 몫. 10% 아래는 사람이 손으로 고친 것뿐이어야 한다 |
| 활성 플랜 중 「완료 조건」이 있는 플랜 | 11/11 | **전부, 생성 시점부터** | `plan_create` 의 `done_when` 이 필수에 가깝게 — 없는 플랜은 훅이 목표 없이 싣는다 |
| 활성 플랜 중 「확인 명령」이 있는 플랜 | 1/14 (2026-10-28) | **전부** | 통과/실패를 내는 것이 없는 플랜은 「됐다」는 주장으로 닫힌다. `plan_create` 의 `check`, 마지막 항목을 닫는 `plan_update` 가 그 명령을 돌리라고 안내한다. 2026-10-28 부터 `check` 를 생략해도 매니페스트에서 감지한 기본값이 들어가므로, 이 비율이 100% 가 아닌 것은 손으로 만든 플랜뿐이어야 한다 |
| 버그 일지 중 7일 안에 같은 파일을 다시 고친 비율 | 47% | **30%** | 레드팀 스킬이 합류 전에 반례를 찾는 만큼만 내려간다 — 내려가지 않으면 그 스킬은 걷는다 |

목표를 못 맞춘 것은 실패가 아니라 데이터다 — 다음 리뷰에서 숫자를 다시 적는다. 목표를 낮추는 것은 사유를 적고 한다. **Today 「약속 성적표」 카드**가 이 표의 「지금」 열(증거 비율 · 7일 재수정 · 완료 조건/확인 명령 있는 플랜)을 최근 30일 창으로 보여 준다 — 느낌이 아니라 숫자를 매일 본다(METR 2025: 개발자는 AI 로 20% 빨라졌다고 느꼈고 실측은 19% 느렸다).

## 에이전트 운용 다섯 원칙 → Ocul-PM 의 자리 (2026-10-28)

코딩 에이전트에게 최고의 결과를 내는 운용법은 출처가 달라도 같은 다섯 줄로 모인다 — [Anthropic Claude Code best practices](https://code.claude.com/docs/en/best-practices) · [Willison, Agentic Engineering Patterns](https://simonwillison.net/2026/Feb/23/agentic-engineering-patterns/) · [Sonar State of Code 2026](https://www.sonarsource.com/company/press-releases/sonar-data-reveals-critical-verification-gap-in-ai-coding/) · [METR 2026 uplift update](https://metr.org/blog/2026-02-24-uplift-update/). Rieseberg 의 고도·깊이·범위와 같은 축이다. 이 제품의 주장은 「원칙을 가르친다」가 아니라 **「그 다섯 질문이 `/clear` 와 세션 경계를 넘어 사라지지 않는 자리다」** 이고, 아래 표의 셋째 열이 비어 있으면 그 주장은 거짓이다.

| 원칙 | 근거 | 자리 (기계가 지키는 것) |
|---|---|---|
| ① 코드 전에 사양·**완료 조건** | Anthropic: "Interview me until you could write the spec… a written definition of done" | `**완료 조건:**` 줄 — `plan_create done_when`, 훅이 항목보다 먼저 싣는다 (`plugin_xplat`). **플랜이 없어도**: 템플릿 v18 §1 「작업 규율」이 한 작업마다 완료 조건 한 줄을 먼저 말하게 하고, 빈 프로젝트에는 훅이 「플랜·일지 없음 → 완료 조건·확인 명령부터」 한 줄을 싣는다 (`plugin_hook_no_plan`) |
| ② **통과/실패를 내는 것**을 준다 | Anthropic: "Give Claude something it can run that comes back pass or fail" · Willison: "First run the tests" | `**확인 명령:**` 줄 — `plan_create check`, 훅이 싣고, 마지막 항목을 닫는 `plan_update` 가 돌리라고 안내 (`plan_goal` 테스트). **안 줘도 생긴다**: `check` 를 생략한 `plan_create` 는 매니페스트(package.json·Cargo.toml·pyproject·go.mod·Makefile)에서 감지한 명령을 적고 `warnings` 로 알리며, 확인 명령 없는 플랜(또는 플랜 없는 프로젝트)에는 훅이 같은 규칙의 후보를 싣는다 (`check_infer`, 훅과 공유 계약) |
| ③ **주장이 아니라 명령+출력** | Anthropic: "ask for evidence: the command it ran and its output. 'All tests pass' tells you very little" | 증거 등급(`evidence.rs`) · 명령 이름만 있는 검증 칸에 `journal_write` 경고 · 템플릿 v17 「결과 끝 줄」 |
| ④ 초록이어도 **실제로 돌려 본다** | Willison: "the test suite passes doesn't mean the web server will boot… use curl" · Showboat | 주간 요약 「검증 안 된 것」 절 + 복사 — 영수증은 건네라고 있다. `/oculpm:next` 4단계 |
| ⑤ **바깥 심판** | Sonar: 96% 불신 · 48% 만 늘 확인 · 38% 는 사람 코드보다 리뷰가 힘들다. METR: 느낌 ≠ 실측 | `/oculpm:redteam` · 「약속 성적표」 카드 · 이 표 |

**주지 않는 것.** 야망은 도구가 못 준다 — 완료 조건을 자동 생성하거나 증거를 대신 만들면 글이 경고하는 상태(모델이 스스로를 심판)가 된다. 모든 장치는 **묻고 경고하되 막지 않는다**.

## 약속을 지키는 장치

| 약속 | 지키는 것 |
|---|---|
| 1 · 6 | `src-tauri/tests/mcp_write_to_cache.rs` — MCP 로 쓴 일지가 디스크를 거쳐 캐시 질의에 선다 |
| 2 | `watcher_backpressure.rs` · 리눅스 새 폴더 경합(v3.13.7) |
| 7 | `egress_inventory.rs` · `egress_spawn_ledger.rs` — 새 송출·자식 프로세스는 빌드가 막는다 |
| 9 | `docs/RELEASE.md` §0-2 — 마이너 전날 확인 날, `bump-version` 이 미확인 `eyes-` 항목 수를 경고 |
| 5 · 6 | SessionStart 훅이 각 플랜의 `**완료 조건:**` · `**확인 명령:**` 을 항목과 함께 싣고, 항목이 전부 닫힌 active 플랜은 「판정 후 닫기」 한 줄로 싣는다(`plugin_xplat` 테스트) — 할 일이 아니라 결과를 받는다 |
| 전체 | `db::scorecard` 가 성적표 스크립트와 같은 정의로 증거 비율·7일 재수정을 산다 — 두 숫자가 갈라지면 둘 중 하나가 거짓이다 |
| 전체 | `SECURITY.md` 외부 리뷰 주기(마이너 5개마다 경고) · `docs/launch/first-user-observation.md` 첫 사용자 관찰 · `/oculpm:redteam` 이 합류 전 반례를 찾는다 |

## 이 문서를 고치는 규칙

- 문장을 **더하려면** 그 문장을 지키는 장치(테스트·게이트·확인 절차)를 같은 PR 에 넣는다.
- 문장을 **빼는** 것은 언제든 된다 — 그게 범위를 좁혀 완성도를 올리는 일이다.
- 등급을 **올리는** 것(보류 → 뷰어 → 핵심)은 두 분기 연속 fix 하위일 때만.
