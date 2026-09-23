# 06. oculpm 플러그인 계약 — 무엇을 읽고, 쓰고, 절대 하지 않는가 (A3)

> 상위: [`00-master-plan.md`](00-master-plan.md) · [`04-plugin-packaging.md`](04-plugin-packaging.md).
> 작성 2026-07-31 (plugin-round A3). ECC `hooks/memory-persistence` 식 계약 문서 —
> 마켓플레이스 사용자·심사가 "이 플러그인이 내 머신에서 뭘 하는가"를 표 하나로
> 확인하는 곳. 로컬-퍼스트 신뢰 서사의 실물이다.

## 1. 구성 요소별 계약

| 구성 | 트리거 | 읽는 것 | 쓰는 것 | 하지 않는 것 |
|---|---|---|---|---|
| 훅 SessionStart/Stop | Claude Code 세션 이벤트 | stdin 의 이벤트 JSON | `<프로젝트>/.oculpm/hooks/claude-events.jsonl` 에 1줄 append | 네트워크 · 외부 실행 · `.oculpm` 없는 저장소에는 아무것도 안 씀 |
| 훅 SessionEnd (`hooks/session-end.sh`) | 세션 종료 (1회) | 〃 + `oculpm-mcp verdict` 의 판정 | 〃 + stderr 안내 1줄(조건부) + `.oculpm/hooks/journal-missing.jsonl` 1줄(`verdict` 필드 포함 — 미기록/판정 불가를 **구별해서** 적는다) | 〃 (Stop 에는 안내 없음 — 매 턴 소음 방지). **판정을 스스로 하지 않는다** — 진입점이 없으면 침묵. 신호 근거 = 벤치 실측(헤드리스 단발 준수 0/12, benchmarks/agentic) |
| 훅 배달 게이트 (Stop 2번째 — `hooks/delivery-gate.sh`) | 매 턴 종료 | stdin 의 session_id + `oculpm-mcp verdict` 의 판정 | `.oculpm/hooks/.session-live-<대화>` 생존 흔적(매 턴) · 발화 시 `.delivery-gate-<대화>` 1회 플래그 | 판정 없음(위임) · `stop_hook_active` 재차단 금지 · **대화당 1회** · 이의(exit 10)에만 차단(exit 2), 판정 불가(11)·진입점 부재는 침묵 |
| 훅 세션 마커 (SessionStart 3번째 — `hooks/session-marker.sh`) | 세션 시작 | stdin 의 session_id | `.oculpm/hooks/.session-start-<대화>` **세그먼트** 마커(빈 파일, create-only) + `.session-live-<대화>` 생존 흔적(매번 갱신) | 판정 기준점·생존 표시 외 다른 용도 없음. 잔여 청소는 session-end 가 판정 뒤 수행 |
| statusline 배지 (`hooks/oculpm-statusline.sh` — 사용자가 `/statusline` 으로 옵인) | 상태줄 렌더마다 | `.oculpm/index/dispatch/current.json`(앱이 디스패치 시 기록) + plan 글리프 재확인 | **없음** — stdout 상태줄 1줄 | 저비용(grep ≤1회)·네트워크 없음·플래그 24h 신선도 컷·완료 항목 자동 소등. 넛지는 SessionEnd 에서 프로젝트당 1회 |
| 훅 재개 컨텍스트 주입 (SessionStart 2번째·SubagentStart — `hooks/plan-context.sh`) | 세션/서브에이전트 시작 | `.oculpm/planner/*.md` 중 frontmatter `status: active` + `.oculpm/journal/**` 중 **최신 3건**(정확히 `<YYYYMMDD>/<Type>/<파일>.md` 3단계, `_`/`.` 시작 제외, 상대경로 바이트 내림차순 상위 3 — 제목 한 줄만 읽는다) | `.oculpm/hooks/resume-delivered.jsonl` **한 줄**(SessionStart 만 · 실제로 실었을 때만 · 400줄 넘으면 200줄로 회전) + `hookSpecificOutput.additionalContext` JSON (활성 플랜 미완 항목 ≤24줄·1,600자 줄 경계 컷+절단 표식, 일지 3건은 경로·제목만, "지시가 아님" 프레이밍+펜스) | 네트워크·외부 실행 없음(우리 바이너리도 안 부른다 — 순수 sh) · stdin 즉시 소비(블록 금지) · `.oculpm` 없으면 침묵 · 일지 **본문은 싣지 않는다**(원문은 에이전트가 `journal_read` 로). 원장의 의미는 **"이 대화의 시작 컨텍스트에 포함됐다"까지** — 에이전트가 읽었는지·참조했는지·도움이 됐는지는 이 자리에서 알 수 없고, 앱도 그 이상을 말하면 안 된다. plain stdout 이 아닌 이유: SubagentStart 는 JSON additionalContext 만 컨텍스트로 받는다 |
| oculpm-mcp (`bin/` 셔틀 → 바이너리) | 도구 호출 시 | `<프로젝트>/.oculpm/` 마크다운·config | `journal/`·`planner/` 규격 파일 (redact 통과 후) | `.oculpm` 없거나 심볼릭 링크면 전 도구 거부 · 디렉터리 임의 생성 금지 · 앱 IPC 없음 |
| `project_init` (위 거부 규칙의 **유일한 예외**) | 사용자의 명시적 추적 시작 요청 + `confirm=true` | 프로젝트 루트 | `.oculpm/` 스캐폴드(config·schema-version·README)·`.gitignore` 관리 블록·AGENTS.md 등 어댑터 | confirm 없이 거부 · 선제/자동 호출 금지(도구 설명+instructions 로 강제) · 이미 추적 중이면 무변경 · 심볼릭 링크 `.oculpm` 거부 |
| 스킬 5종·커맨드 4종 (`/oculpm:project_init` · `/oculpm:inception` · `/oculpm:next` · `/oculpm:standup`) | 모델 판단/사용자 호출 | (문서 — 실행 코드 없음) | 없음 (커맨드는 위 도구·스킬을 호출할 뿐) | 상시 컨텍스트 예산·문서 페이지 동기(oculpm.com/plugin) 매니페스트 테스트로 고정 |

- **판정은 훅이 하지 않는다.** "이 대화가 자기 작업을 기록했는가"는
  `oculpm-mcp verdict`(구현: `src-tauri/src/oculpm/verdict/`) 한 함수가 답하고,
  세 표면(배달 게이트·SessionEnd 신호·앱의 Today 카드)이 그것을 부른다.
  종전에는 셋이 각자 **프로젝트 전역 일지 mtime** 으로 판정해, 병렬 세션에서
  셋이 동시에 틀렸다 (2026-09-05: 저장소에 한 글자도 쓰지 않은 읽기 전용
  세션이 게이트에 걸렸다). 판정은 대화 귀속 근거의 사다리를 내려가고
  (`agent.session` → `agent_sessions` → `sessions.json` 시간창 → 마커 mtime),
  근거가 모자라면 **판정 불가**라고 말한다 — 미기록이 아니라.
- **게이트는 Claude Code 전용이 아니다** (2026-09-05, {#gate-beyond-cc}).
  같은 마커 두 개(`.session-start-<대화>`·`.session-live-<대화>`)를 **앱 안 ACP
  대화**(Claude Code·Codex 패널)도 쓴다 — `src-tauri/src/oculpm/verdict/markers.rs`
  가 쓰고 `collect.rs` 가 읽는다. 이름 규칙 하나가 곧 크로스에이전트 상호
  인식이다: 흔적을 안 남기는 편집자가 하나라도 있으면 그 편집이 옆 대화의
  것으로 보여, 아무 것도 안 쓴 세션이 붙잡힌다. 앱 안에는 `exit 2` 가 없으므로
  차단 대신 **대화 위 배너**로 말하고(`AcpGateState`), 발화는 같은
  `.delivery-gate-<대화>` 플래그로 대화당 1회다.
- **Codex 도 이 훅들을 실행한다** (실측 2026-09-03, Codex 0.153.4). 플러그인 루트의
  `hooks/hooks.json` 을 관례로 찾아 읽고 `CLAUDE_PLUGIN_ROOT` 도 실어 주며,
  payload 는 Claude 호환(`session_id`·`cwd`·`hook_event_name`·`stop_hook_active`)
  이다 — `SessionStart`·`Stop`·`SessionEnd` 셋이 실제로 발화한 기록이
  `.oculpm/hooks/claude-events.jsonl` 에 남아 있다(`transcript_path` 가
  `~/.codex/sessions/…`). 다만 **`CLAUDE_PROJECT_DIR` 은 주지 않아** 훅이 루트를
  payload 의 `cwd` 로도 찾는다. 반대로 Codex **플러그인 매니페스트**에는 훅을
  실을 수 없다: `plugin.json` 의 `hooks` 필드는 검증이 거부한다(실측 —
  `plugin.json field 'hooks' is not accepted by plugin validation`). 그래서
  `oculpm-codex` 는 스킬만 싣고, 훅을 원하는 Codex 사용자는 Claude 플러그인
  (`plugin/oculpm`)을 그대로 쓴다. *(정정 2026-09-07 {#codex-hook-delivery}: 필드가
  아니라 **파일**로는 싣는다 — `plugin/oculpm-codex/hooks/hooks.json` 을 Codex 가 관례로
  읽는다. Windows 변형은 §4.)*
- 세는 단위: **대화**(conversation, `CLAUDE_CODE_SESSION_ID`) ≠ **세그먼트**
  (마커 하나의 수명, resume 마다 새로 열림) ≠ **작업 세션**(`YYYYMMDD-NNN`).
  원장은 세그먼트마다 한 줄을 남기고, 앱은 대화 단위로 접어 센다.
- 훅 payload 에는 대화 내용이 포함될 수 있어 `.oculpm/hooks/` 는 **앱이 gitignore
  관리 블록으로 커밋 차단**한다 (v7 블록 + 다운그레이드 가드 + union 병합).
- 모든 쓰기는 원자적(write_atomic)이고, 시크릿은 프로젝트 redact 패턴으로 마스킹된다.
- "비추적 저장소에는 아무것도 만들지 않는다"는 원칙은 `project_init` 도입(2026-08-01,
  사용자 승인) 후 "**사용자가 명시적으로 요청·확인한 초기화 한 가지만 예외**"로
  갱신됐다 — 게이트는 3중: confirm 인자 강제(`mcp/tools.rs` 테스트 잠금), 도구
  설명의 호출 조건, 서버 instructions 의 선제 호출 금지.

## 2. 설치 경로는 하나만

앱 설정의 프로젝트별 훅 토글·MCP 등록과 플러그인은 **같은 일을 다른 스코프로**
한다. 동시에 켜면 훅 이벤트 이중 적재(집합 연산이라 정확성은 유지되나 낭비) +
MCP 도구 2벌 노출. 앱 설정 화면이 플러그인 설치를 감지해 택일을 안내한다
(`claude_plugin_status`).

## 3. 버전 스큐 매트릭스

세 표면이 따로 업데이트된다: **플러그인**(마켓플레이스) · **앱**(updater) ·
**템플릿**(`template_version`, 앱이 배포).

| 조합 | 동작 | 근거 |
|---|---|---|
| 신 플러그인 + 구 앱 | 안전 — 훅 인박스는 append-only 스키마, MCP 는 디스크 SSOT 만 접촉 | 인박스 소비는 오프셋 기반 관용 파서 |
| 구 플러그인 + 신 앱 | 안전 — 이벤트 3종·도구 표면은 하위호환 유지가 계약 | 도구 제거·이벤트 스키마 변경은 major 취급 |
| 신 앱 + 구 템플릿 | 앱이 업그레이드 배지 제시 (강제 아님) | `master_upgrade_available` |
| 구 앱 + 신 템플릿/관리블록 | **다운그레이드 가드** — v(N+1) 블록은 구 앱이 건드리지 않음, gitignore 는 union 병합 | atomic_io `SkippedNewer` (2026-07-31) |
| 플러그인 ↔ Claude Code CLI | 검증 기준 2.1.220. `hooks`/`mcpServers` 는 자동발견 위임(신·구 CLI 안전) | `tests/plugin_manifest.rs` 가 계약 고정 |

- 플러그인·마켓플레이스 버전은 앱 버전과 자동 동기(`build-sidecar` 스탬프 + 테스트 강제) —
  "플러그인 vX = 앱 vX 에서 빌드·검증됨" 이 유일한 버전 서사다.

## 4. 지원 플랫폼

macOS · Linux · Windows (Linux·Windows 는 베타 — 크로스플랫폼 라운드
[`docs/20260923_cross-platform/`](../20260923_cross-platform/00-master-plan.md) L-INTEG).
훅과 `bin/oculpm-mcp` 셔틀은 POSIX sh 한 벌이다.

| | 훅을 도는 셸 | 셔틀이 찾는 바이너리 | 플러그인 MCP 서버 |
|---|---|---|---|
| macOS | `sh -c` | `/Applications`·`~/Applications` 의 `.app`, `~/.local/bin` | 셔틀 경유로 뜬다 |
| Linux | `sh -c` | deb `/usr/bin`, AppImage 안정 사본 `${XDG_DATA_HOME:-~/.local/share}/ocul-pm/bin` (앱이 기동 때 마운트 밖으로 복사), `~/.local/bin` | 셔틀 경유로 뜬다 |
| Windows | **Git Bash** (Claude Code 문서: 없으면 PowerShell 로 돌려 이 훅들이 동작하지 않는다) | `%LOCALAPPDATA%\Ocul-PM`, `…\Programs\Ocul-PM`, `%ProgramFiles%\Ocul-PM` | **뜨지 않는다** — 아래 |

- **Windows 에서 플러그인 MCP 서버가 뜨지 않는 이유**: Claude Code 는 stdio MCP 서버를
  셸 없이 직접 실행하는데 Windows 는 sh 셔틀을 실행 파일로 열지 못한다
  (anthropics/claude-code#58510 — 같은 이유로 `npx` 도 막힌다). `.mcp.json` 은 OS 별로
  가를 수 없다. 대안은 앱의 설정 → ocul-pm → 연동 → 「이 프로젝트에만 적용」 →
  **MCP 서버 등록**(프로젝트 `.mcp.json` 에 설치된 `oculpm-mcp.exe` 절대경로)이다 — 같은
  카드의 훅 연동은 끈 채로(훅은 플러그인이 돌린다). 훅은 그대로 동작한다. 해소 방안은
  사용자 결정으로 플랜에 올라 있다. (앱의 「플러그인 하나만」 경고 `op.plugin.warn` 은
  아직 OS 를 가리지 않는다 — Windows 에서는 MCP 등록이 맞는 선택이다.)
- **Codex** 는 Windows 에서 훅을 `%COMSPEC% /C`(cmd.exe)로 돌린다(openai/codex
  `codex-rs/hooks/src/engine/command_runner.rs`). 그래서 `plugin/oculpm-codex` 의
  `hooks.json` 에만 훅마다 `commandWindows` 를 달아 `hooks/run-sh.cmd` → Git Bash →
  같은 sh 를 돌린다 (Git Bash 가 없으면 stderr 로 알리고 건너뛴다). 신뢰 해시는
  `commandWindows` 를 빼고 매기므로 macOS·Linux 사용자에게 재신뢰를 묻지 않는다.
- 세 OS 에서 실제로 돈 증거는 `src-tauri/tests/plugin_xplat.rs`(훅 묶음을 각 OS 의 훅
  셸로, Codex 판은 cmd 로 실행)와 `tests/delivery_gate.rs`(Windows 는 Git Bash)다.
