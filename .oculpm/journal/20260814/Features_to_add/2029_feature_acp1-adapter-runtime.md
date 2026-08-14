---
schema_version: 1
type: feature
slug: "acp1-adapter-runtime"
status: done
difficulty: high
created_at: "2026-08-14T20:29:27+09:00"
session_id: "mcp-20260814-202927"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/acp/mod.rs"
    op: create
  - path: "src-tauri/src/acp/env.rs"
    op: create
  - path: "src-tauri/src/acp/adapter.rs"
    op: create
  - path: "src-tauri/src/acp/process.rs"
    op: create
  - path: "src-tauri/src/commands/acp.rs"
    op: create
  - path: "src-tauri/src/commands/mod.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/tests/acp_handshake.rs"
    op: update
  - path: "src-tauri/tests/acp_login_shell.rs"
    op: create
  - path: "src/features/settings/OculpmSettings.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
related: []
tags:
  - "acp"
  - "rust"
  - "runtime"
  - "settings"
  - "i18n"
  - "mcp-tool"
---
[x] PR-ACP1 — ACP 어댑터 런타임: node 조달·버전 고정 설치·프로세스 수명·진단

## 추가 기능

[docs/acp-panel/00-master-plan.md](docs/acp-panel/00-master-plan.md) §5 의 ACP1 — 에이전트를 띄우기 위한 **런타임 조달과 프로세스 수명**. 대화 UI 는 ACP2 몫이고 여기는 그 밑바닥이다.

새 서브시스템 `src-tauri/src/acp/`:

- **`env.rs`** — node·npm·claude 탐색. 프로세스 PATH 에서 못 찾으면 **로그인 셸을 한 번 띄워 PATH 를 받아온다**(`$SHELL -lic`, 5초 타임아웃, 프로세스 수명 1회 캐시). `-i`(대화형)까지 주는 이유는 fnm·nvm 이 `.zprofile` 이 아니라 `.zshrc` 에 훅을 심기 때문. 대화형 rc 가 stdout 에 뭘 찍어도 PATH 만 도려내도록 마커로 감쌌다.
- **`adapter.rs`** — 어댑터 npm 패키지를 **앱 데이터 디렉터리에 버전 고정으로 1회 설치**(`0.67.0`). `npx` 를 매 실행 태우면 네트워크·지연이 붙고 오프라인에서 죽는다. 고정하는 이유는 어댑터가 2주에 6회 배포되는 0.x 라서(리스크 R2).
- **`process.rs`** — ACP 연결은 `connect_with(transport, closure)` 로 **클로저가 사는 동안만** 산다. 그래서 백그라운드 태스크가 클로저를 붙잡고, 커맨드는 거기서 꺼낸 `ConnectionTo` 클론으로 말한다. 클로저가 반환되면 = 어댑터가 죽었거나 우리가 껐다는 뜻이라 그 자리에서 레지스트리를 지운다 — "켜졌다고 표시되는데 실은 죽은" 상태를 원천 차단.

커맨드 5개(`acp_diagnose` / `acp_install_adapter` / `acp_start` / `acp_stop` / `acp_status`)와 설정 → 통합 탭의 `AcpRuntimeBlock`(Node·Claude CLI·어댑터 3행 + 설치 버튼).

## 동작 흐름

`acp_start` → 진단으로 Node·어댑터 게이트 → `node <설치된 entry>` 를 spawn(우리가 해석한 PATH 를 `env` 로 물려줌 — 어댑터가 내부에서 `claude` 를 다시 찾기 때문) → `initialize` → `AcpAgentInfo` 반환, 연결은 유지.

설계에서 한 군데 바로잡았다: `AcpAgentConfig` 에 cwd 가 없다. ACP 에서 **cwd 는 프로세스가 아니라 세션의 속성**이라 프로젝트 루트는 ACP2 의 `session/new` 가 넘긴다. 그래서 `acp_start` 는 `db` 의존이 사라졌다.

진단을 "안 됨" 하나로 뭉치지 않고 3행으로 쪼갠 이유는 사용자가 취할 조치가 각각 다르기 때문이고(Node 설치 / Claude 로그인 / 설치 버튼), `path_source` 를 노출한 이유는 "터미널에선 되는데 앱에선 안 되는" 차이를 사용자가 이해할 수 있게 하기 위해서다.

## 검증

유닛 8건 신규(순수 함수 — PATH 탐색·마커 추출·버전 파싱·설치 판정). 특히 `installed_version_requires_the_entry_file` 은 package.json 만 남은 반쯤 지워진 `node_modules` 를 "설치됨"으로 오판하지 않는지 본다.

통합 2건(모두 `#[ignore]` — 외부 의존):

- `adapter_installs_and_starts_from_pinned_entry` — node 해석 → npm 설치 → **설치된 진입점으로 기동** → 핸드셰이크. 4.2초, `agentInfo.version == 0.67.0` 확인. npx 우회 없이 릴리스에서 밟을 경로 그대로다.
- `acp_login_shell.rs`(별도 바이너리 — PATH 가 프로세스 전역이라 격리) — PATH 를 `/usr/bin:/bin:/usr/sbin:/sbin` 로 깎아 Finder 실행을 흉내 냈을 때 로그인 셸 폴백이 fnm node 를 구조하는지. 통과.

게이트: `pnpm typecheck` 0 · `pnpm test` 738건 · `pnpm lint` 0 · `pnpm build` 0 · 백엔드 560 유닛 + 통합 전 스위트 통과. 유일한 실패 `plugin_json_is_minimal_and_version_synced` 는 v2.9.0 릴리스가 `build-sidecar.mjs` 를 안 돌려 생긴 **기존 드리프트**로 본 작업과 무관.

**남은 것**: 계획의 `acp1-pkg`(패키징 `.app` 실기기 확인)는 미완이다. 빈약한 PATH 라는 *메커니즘*은 위 테스트로 검증했지만, 실제 `.app` 을 Finder 로 띄워 설정 화면까지 확인한 것은 아니다.