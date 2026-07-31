# oculpm — Claude Code 플러그인

ocul-pm 의 Claude Code 연동 두 가지를 **한 번에** 구성합니다 (수동 설정 대체):

| 구성 | 대체하는 수동 설정 | 동작 |
|---|---|---|
| 훅 브리지 (CI0) | 앱 설정의 "Claude Code 훅 연동" 토글 (`.claude/settings.local.json`) | SessionStart / Stop / SessionEnd 이벤트를 프로젝트의 `.oculpm/hooks/claude-events.jsonl` 에 append — 앱 watcher 가 소비해 세션을 실측 신호로 기록 |
| oculpm-mcp (CI2) | 앱 설정의 "MCP 등록" (`.mcp.json`) | `journal_write` / `plan_status` / `plan_update` / `plan_create` / `project_init` 구조화 도구 — `--root "${CLAUDE_PROJECT_DIR}"` 라 어느 프로젝트에서든 그 프로젝트의 `.oculpm/` 에 기록 |
| 플랜 컨텍스트 주입 | (앱에 없는 플러그인 전용) | 세션·서브에이전트 시작 시 활성 플랜의 미완 항목 요약(≤1,600자)을 컨텍스트로 주입 — 에이전트가 "현재 계획"을 알고 시작. 파일 쓰기 없음 |
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

- **macOS** (플러그인 v1 — Windows/Linux 는 후속. `bin/oculpm-mcp` 가 POSIX sh 셔틀입니다)
- **ocul-pm 앱 설치** (oculpm-mcp 바이너리가 .app 번들에 동봉됨) 또는 `OCULPM_MCP_BIN` 지정
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
2. `/Applications/ocul-pm.app` · `~/Applications/ocul-pm.app` 번들
3. `~/.local/bin/oculpm-mcp`
4. 리포 개발 빌드 (`--plugin-dir` 로 리포에서 직접 로드할 때만)

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
