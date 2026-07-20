# oculpm — Claude Code 플러그인 (프로토타입)

ocul-pm 의 Claude Code 연동 두 가지를 **한 번에** 구성합니다 (PR-CI8, 수동 설정 대체):

| 구성 | 대체하는 수동 설정 | 동작 |
|---|---|---|
| 훅 브리지 (CI0) | 앱 설정의 "Claude Code 훅 연동" 토글 (`.claude/settings.local.json`) | SessionStart / Stop / SessionEnd 이벤트를 프로젝트의 `.oculpm/hooks/claude-events.jsonl` 에 append — 앱 watcher 가 소비해 세션을 실측 신호로 기록 |
| oculpm-mcp (CI2) | 앱 설정의 "MCP 등록" (`.mcp.json`) | `journal_write` / `plan_status` / `plan_update` 구조화 도구 — `--root "${CLAUDE_PROJECT_DIR}"` 라 어느 프로젝트에서든 그 프로젝트의 `.oculpm/` 에 기록 |

**안전 가드**: 훅 커맨드는 `.oculpm/` 폴더가 있는 프로젝트에서만 동작합니다 (`[ -d …/.oculpm ]` 검사 + `|| true`). ocul-pm 이 추적하지 않는 저장소에는 아무 파일도 만들지 않습니다. 훅은 로컬 append 한 줄 — 네트워크·외부 실행이 없습니다.

## 설치

개발/검증 (로컬 디렉터리):

```bash
claude --plugin-dir /path/to/ai-pm/plugin/oculpm
```

마켓플레이스 배포는 후속입니다 (`docs/claude-integration/04-plugin-packaging.md` §4).

## 요구 사항 / 경로 캐비앗

- `.mcp.json` 의 `command` 는 macOS 번들 경로(`/Applications/ocul-pm.app/Contents/MacOS/oculpm-mcp`)를 가정합니다 — **sidecar 번들(#ci2-sidecar-bundle) 이후의 릴리스 빌드 기준**입니다. 개발 중에는 리포의 `src-tauri/target/debug/oculpm-mcp` 로 바꿔 쓰세요.
- 앱의 훅 토글(설정 → ocul-pm)과 이 플러그인을 **동시에 켜면** 같은 이벤트가 인박스에 두 번 적재됩니다 (세션 집합 연산이라 동작은 안전하지만 낭비) — 하나만 쓰세요.
- 플러그인 훅은 앱의 드리프트 감지(`claude_hooks_status`) 대상이 아닙니다 — 상태는 `/plugin` UI 에서 확인합니다.
