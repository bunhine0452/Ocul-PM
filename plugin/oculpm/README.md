# oculpm — Claude Code 플러그인

ocul-pm 의 Claude Code 연동 두 가지를 **한 번에** 구성합니다 (수동 설정 대체):

| 구성 | 대체하는 수동 설정 | 동작 |
|---|---|---|
| 훅 브리지 (CI0) | 앱 설정의 "Claude Code 훅 연동" 토글 (`.claude/settings.local.json`) | SessionStart / Stop / SessionEnd 이벤트를 프로젝트의 `.oculpm/hooks/claude-events.jsonl` 에 append — 앱 watcher 가 소비해 세션을 실측 신호로 기록 |
| oculpm-mcp (CI2) | 앱 설정의 "MCP 등록" (`.mcp.json`) | `journal_write` / `plan_status` / `plan_update` / `plan_create` / `project_init` 구조화 도구 — `--root "${CLAUDE_PROJECT_DIR}"` 라 어느 프로젝트에서든 그 프로젝트의 `.oculpm/` 에 기록 |
| 재개 컨텍스트 주입 | (앱에 없는 플러그인 전용) | 세션·서브에이전트 시작 시 활성 플랜의 미완 항목 요약(≤1,600자)과 **마지막 작업 일지 3건**(경로·제목만 — 원문은 `journal_read`)을 컨텍스트로 주입 — 에이전트가 "현재 계획"과 "직전에 한 일"을 알고 시작. 무엇을 실었는지는 `.oculpm/hooks/resume-delivered.jsonl` 에 한 줄(SessionStart 만) — 이 원장은 **"시작 컨텍스트에 포함됐다"까지만** 뜻하며, 읽었는지·도움이 됐는지는 말하지 않는다 |
| 미기록 세션 신호 | (앱에 없는 플러그인 전용) | 세션이 일지 없이 끝나면 stderr 경고 + `.oculpm/hooks/journal-missing.jsonl` 신호 — 근거: 헤드리스 단발 세션 준수 0/12 실측(benchmarks/agentic) |
| statusline 배지 | (앱에 없는 플러그인 전용) | 디스패치된 플랜 항목을 터미널 상태줄에 `⏵ OCULPM: <항목>` 으로 — 아래 "statusline 설정" 참조 |

**안전 가드**: 훅과 MCP 도구 모두 `.oculpm/` 폴더가 있는(= ocul-pm 이 추적하는)
프로젝트에서만 동작합니다. 비추적 저장소에는 어떤 파일/디렉터리도 만들지 않고,
심볼릭 링크 `.oculpm` 은 거부합니다. 훅은 로컬 append 한 줄 — 네트워크·외부 실행이
없습니다. **유일한 예외는 `project_init`**: 사용자가 추적 시작을 명시적으로
요청·확인(`confirm=true`)했을 때만 `.oculpm/` 스캐폴드를 만듭니다 — 선제·자동
호출은 도구 설명과 서버 instructions 가 금지합니다.

## statusline 설정 (선택)

앱 플래너에서 ▶실행(또는 회고 [Claude Code 로])을 누르면 `.oculpm/index/dispatch/current.json` 에 현재 항목이 기록됩니다. Claude Code 의 `/statusline` 에서 이 플러그인의 `hooks/oculpm-statusline.sh` 를 지정하면 상태줄에 그 항목이 표시됩니다 — 항목이 완료 글리프가 되거나 24시간이 지나면 자동으로 기본 상태줄(모델·폴더)로 돌아갑니다. 설치 경로 예: `~/.claude/plugins/marketplaces/oculpm/plugin/oculpm/hooks/oculpm-statusline.sh` (설치 방식에 따라 다를 수 있음 — `/plugin` UI 에서 플러그인 경로 확인).

## 요구 사항

- **macOS** · **Linux** · **Windows** (Linux·Windows 는 베타). 훅과 `bin/oculpm-mcp` 는 POSIX sh 입니다.
  - **Windows 는 Git for Windows(Git Bash)가 필요합니다** — Claude Code 는 셸 형 훅을
    Git Bash 로 돌리고, 없으면 PowerShell 로 돌려 이 훅들이 동작하지 않습니다.
  - **Windows 에서는 이 플러그인의 MCP 서버가 뜨지 않습니다** (`/mcp` 에 실패로
    보입니다). Claude Code 는 stdio MCP 서버를 셸 없이 직접 실행하는데, Windows 는 sh
    셔틀을 실행 파일로 열지 못합니다. 대신 앱의 **설정 → ocul-pm → 연동 →
    「이 프로젝트에만 적용」 → MCP 서버 → 등록**을 쓰세요 — 프로젝트 `.mcp.json` 에
    설치된 `oculpm-mcp.exe` 경로를 적습니다. 그 카드의 **훅 연동은 켜지 마세요**
    (훅은 플러그인이 이미 돌립니다). 앱이 플러그인과 겹친다고 안내해도(「여기서 또
    등록할 필요가 없어요」·「둘 중 하나를 해제하세요」) Windows 에서는 플러그인의 MCP 가
    뜨지 않으므로 도구가 두 벌이 되지 않습니다 — 앱의 MCP 등록을 해제하지 마세요.
- **ocul-pm 앱 설치** (oculpm-mcp 바이너리가 앱에 동봉됨) 또는 `OCULPM_MCP_BIN` 지정
- Claude Code **2.1.220 이상에서 검증** (`claude plugin validate` + `--plugin-dir` 실로드)

## 설치

개발/검증 (로컬 디렉터리):

```bash
claude --plugin-dir /path/to/ai-pm/plugin/oculpm
```

마켓플레이스 (권장):

```bash
/plugin marketplace add bunhine0452/Ocul-PM
/plugin install oculpm@oculpm
```

> git-source 로 add 하세요 — marketplace.json 을 직접 URL 로 add 하면 서브디렉터리
> 상대경로(source)를 해석하지 못합니다. 이 플러그인이 읽고 쓰는 것의 전체 계약은
> [docs/claude-integration/06-plugin-contract.md](../../docs/claude-integration/06-plugin-contract.md) 참조.

## 바이너리 탐색 (bin/oculpm-mcp 셔틀)

`.mcp.json` 은 머신 종속 절대경로 대신 `${CLAUDE_PLUGIN_ROOT}/bin/oculpm-mcp` 셔틀을
실행하고, 셔틀이 순서대로 탐색합니다:

1. `OCULPM_MCP_BIN` 환경변수
2. `/Applications/ocul-pm.app` · `~/Applications/ocul-pm.app` 번들 (macOS)
3. Linux — `/usr/bin/oculpm-mcp`(deb), `${XDG_DATA_HOME:-~/.local/share}/ocul-pm/bin/oculpm-mcp`
   (AppImage — 앱이 기동 때 마운트 밖으로 복사해 둔 사본)
4. `~/.local/bin/oculpm-mcp` (수동 설치)
5. Windows — `%LOCALAPPDATA%\Ocul-PM\oculpm-mcp.exe`(사용자 설치),
   `%LOCALAPPDATA%\Programs\Ocul-PM\`, `%ProgramFiles%\Ocul-PM\`(시스템 설치)
6. 리포 개발 빌드 (`--plugin-dir` 로 리포에서 직접 로드할 때만)

이 순서는 앱 설정 화면이 보여 주는 탐색 목록(`acp/recording.rs`)과 같다 —
`src-tauri/tests/plugin_xplat.rs` 가 세 OS 에서 둘을 대조한다.

못 찾으면 stderr 로 설치 안내를 내고 종료합니다.

## 캐비앗

- 앱의 훅 토글(설정 → ocul-pm)과 이 플러그인을 **동시에 켜면** 같은 이벤트가 인박스에
  두 번 적재됩니다 (세션 집합 연산이라 동작은 안전하지만 낭비) — 하나만 쓰세요.
  MCP 도 마찬가지로 프로젝트 `.mcp.json` 등록과 중복되면 도구가 2벌 노출됩니다.
- 플러그인 훅은 앱의 드리프트 감지(`claude_hooks_status`) 대상이 아닙니다 — 상태는
  `/plugin` UI 에서 확인합니다.
- `plugin.json` 의 `version` 은 앱 버전과 자동 동기됩니다 (`scripts/build-sidecar.mjs`
  가 스탬프, `src-tauri/tests/plugin_manifest.rs` 가 강제). `hooks`/`mcpServers` 를
  `plugin.json` 에 선언하지 마세요 — 자동발견(`hooks/hooks.json`·`.mcp.json`)에
  위임하는 것이 신·구 CLI 모두 안전합니다 (같은 테스트가 잠급니다).

## Codex 를 쓴다면

같은 훅 묶음(`hooks/` + `bin/oculpm-mcp`)이 `plugin/oculpm-codex` 에도 **그대로**
들어 있습니다 (`src-tauri/tests/plugin_manifest.rs` 가 바이트 동일성을 강제).
Codex 는 마켓플레이스 매니페스트의 `hooks` **필드**는 거부하지만 플러그인 루트의
`hooks/hooks.json` 은 관례로 읽습니다 — 실측(Codex 0.153.4)으로 설치·실행 양쪽을
확인했습니다. Claude 판을 대신 깔 필요가 없습니다.

주의: Codex 는 플러그인 훅에 **신뢰**를 한 번 묻습니다. 거절하면 스킬만 동작하고
세션 마커·배달 게이트는 조용히 멈춥니다 (아무도 그 사실을 보고하지 않습니다).
