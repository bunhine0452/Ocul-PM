# Claude 가 아닌 에이전트로 기록하기 (Cursor · Gemini CLI · Copilot · 그 밖)

> love-round-20261123 L7. 코드가 이 문서를 이긴다 — 경로 · 인자는 `src-tauri/src/oculpm/agent_cli.rs`
> (`USAGE`) · `oculpm/mcp/agent_json.rs` 가 정본이다.

기록 규격은 하나다. 어느 에이전트든 **같은 도구**(`journal_write` · `plan_status` · `plan_update` ·
`plan_create` · `journal_search` · `journal_read` · `project_init`)를 거치면 제목 규칙 · 시크릿 가리기 ·
검증 칸 경고 같은 서버 검사가 똑같이 걸린다. YAML 을 손으로 쓰는 것은 마지막 길이다 — 거기엔 그
검사가 하나도 없다.

고르는 순서:

1. **MCP 도구** — 에이전트가 MCP 를 읽으면 이것.
2. **셸 CLI** — MCP 가 없거나 붙이기 어려우면, 앱 실행 파일을 셸에서 부른다. 계약은 MCP 와 같다.
3. **파일 규격** — 둘 다 안 될 때만 `.oculpm/agents/journal-spec.md` 를 따라 손으로 쓴다.

## 1. MCP

| 에이전트 | 붙이는 법 |
|---|---|
| Claude Code | 플러그인 (`/plugin install oculpm@oculpm`) |
| Codex | 플러그인 `oculpm-codex` 또는 설정 → 에이전트 연결의 Codex MCP (`~/.codex/config.toml`, 기기 전체 하나) |
| Cursor | 설정 → 에이전트 연결 → **Cursor** 행의 「등록」 → 그 프로젝트의 `.cursor/mcp.json` |
| Gemini CLI | 설정 → 에이전트 연결 → **Gemini CLI** 행의 「등록」 → 그 프로젝트의 `.gemini/settings.json` |

Cursor · Gemini 행은 그 도구의 흔적(프로젝트의 `.cursor/` · `.gemini/` · `GEMINI.md`, 또는 홈의
`~/.cursor` · `~/.gemini`)이 있을 때만 선다. 누를 때만 쓰고, `mcpServers` 아래 `oculpm` 하나만
더하며 다른 서버 · 모르는 키는 순서까지 그대로 둔다. 주석이 있거나 깨진 JSON 은 덮어쓰지 않고 경로와
이유를 말한다 — 그때는 아래 항목을 손으로 더한다:

```json
{ "mcpServers": { "oculpm": { "command": "<oculpm-mcp 경로>", "args": ["--root", "<프로젝트 루트>"] } } }
```

`<oculpm-mcp 경로>` 는 앱 실행 파일 옆의 `oculpm-mcp`(Windows `oculpm-mcp.exe`)다. 이 기기의 경로가
적히므로 팀이 그 파일을 커밋해 쓰면 사람마다 다시 눌러야 한다.

GitHub Copilot(VS Code)은 앱이 등록해 주지 않는다. VS Code 의 `.vscode/mcp.json` 은 키가 `servers`
다른 모양이라, 쓰려면 위 항목을 `{"servers": {"oculpm": {"type": "stdio", …}}}` 로 손으로 옮긴다.
아니면 2번 셸 CLI 를 쓴다.

## 2. 셸 CLI — 앱 실행 파일이 곧 CLI 다

새 바이너리는 없다. 앱 실행 파일에 **도구 이름**을 첫 인자로 주면 창을 띄우지 않고 그 도구를 한 번
부르고 끝난다 (`main.rs` → `agent_cli::run`).

| OS | 실행 파일 |
|---|---|
| macOS | `/Applications/Ocul-PM.app/Contents/MacOS/ocul-pm` |
| Windows | `%LOCALAPPDATA%\Ocul-PM\ocul-pm.exe` |
| Linux (deb) | `/usr/bin/ocul-pm` |

```sh
OCUL=/Applications/Ocul-PM.app/Contents/MacOS/ocul-pm   # 위 표에서 자기 OS 의 경로

$OCUL tools                       # 도구 정의(JSON) — MCP 서버가 주는 것과 같다
$OCUL whoami                      # 어느 프로젝트로 기록되는지
$OCUL plan_status '{}'            # 활성 계획 · 미완 항목 · hash

# 일지 — 인자 JSON 을 stdin 으로 (`-`). 필수: type · title · body_markdown (slug 는 권장 — 없으면 서버가 짓는다)
$OCUL journal_write - <<'EOF'
{"type":"bug","slug":"login-null","title":"로그인: 빈 토큰에서 멈추지 않게 했다",
 "agent_id":"cursor","body_markdown":"## 무엇\n…\n## 검증\n- pnpm test → 214 passed"}
EOF

# 계획 항목 갱신 — base_hash 필수. 먼저 읽고, 그 hash 로 쓴다
h=$($OCUL plan_status '{"plan_id":"P"}' | jq -r '.plans[0].hash')
$OCUL plan_update "{\"plan_id\":\"P\",\"item_id\":\"I\",\"status\":\"done\",\"base_hash\":\"$h\"}"
```

- 프로젝트는 지금 폴더에서 위로 올라가며 `.oculpm/` 이 있는 첫 폴더다. 다른 곳이면 `--project <경로>`.
- 종료 코드: 0 성공 · 1 인자 · JSON · 도구 이름 · 2 입출력 · 3 추적 안 된 프로젝트 · 4 그 밖 ·
  **5 쓰기 충돌**(다른 세션이 먼저 고쳤다 — hash 를 다시 읽고 다시 부른다. 강제 플래그는 없다).
- stdout 은 결과 JSON 만, stderr 는 오류만이다.
- **Windows:** 앱 실행 파일은 GUI 서브시스템이라 셸이 기다리지 않고 종료 코드도 셸에 실리지 않는다.
  에이전트가 결과를 읽으려면 출력을 파이프로 받는다(`… | more`), 또는 `start /wait` · `Start-Process -Wait`.
- `$OCUL --help` 가 같은 사용법을 영어로 보여 준다.

에이전트에게 알려 주려면 루트 `AGENTS.md` 의 관리 블록(`<!-- oculpm:begin -->` … `end`) **밖**에 한 줄
둔다 — 블록 안은 앱이 다시 쓴다. Cursor · Gemini · Copilot 의 규칙 파일(`.cursor/rules/ocul-pm.mdc` ·
`GEMINI.md` · `.github/copilot-instructions.md`)은 모두 `AGENTS.md` 를 가리키므로 한 곳이면 된다:
「MCP 도구가 없으면 `<실행 파일> journal_write -` 로 기록한다」.

## 3. 파일 규격

MCP 도 셸도 안 되는 환경(앱이 없는 클라우드 세션 등)에서만. `.oculpm/agents/journal-spec.md` 의 ⚠
네 가지(created_at 오프셋 · agent 매핑 · op 값 · 경로 따옴표)를 지키지 않으면 앱이 그 일지를 못 읽는다.
