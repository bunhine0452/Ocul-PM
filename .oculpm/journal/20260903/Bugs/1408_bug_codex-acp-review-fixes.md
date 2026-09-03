---
schema_version: 1
type: bug
slug: "codex-acp-review-fixes"
status: done
difficulty: high
created_at: "2026-09-03T14:08:15+09:00"
session_id: "20260903-004"
agent:
  id: "claude-code"
  version: "Opus 5 (1M)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/acp/process.rs"
    op: update
  - path: "src-tauri/src/acp/mod.rs"
    op: update
  - path: "src-tauri/src/commands/acp.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools.rs"
    op: update
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/features/settings/OculpmSettings.tsx"
    op: update
  - path: "src/features/terminal/terminalLaunch.ts"
    op: update
  - path: "src/__tests__/nav_registry.test.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
related: []
tags:
  - "acp"
  - "codex"
  - "review"
  - "mcp-tool"
---
[x] Codex ACP 통합 리뷰 — 락 공유·귀속·자동설치를 바로잡는다

## 발생 원인

Codex ACP 통합(codex 세션 구현분)을 리뷰했다. 자동 게이트는 전부 초록이었고 —
fmt·clippy·cargo test·typecheck·vitest·lint — 결함은 전부 게이트가 볼 수 없는
자리에 있었다.

1. **락만 안 갈렸다.** 상태·싱크·capture·권한 장부는 `target_id`(프로젝트×provider)로
   정확히 갈라 놓고, `start_lock`·`session_lock` 은 `AcpState` 에 하나씩 그대로였다.
   `ensure_session` 은 `session/new` 왕복 **전체를 락 안에서** 기다리고 상한이 없다 —
   Codex 세션 생성이 늦어지면 그동안 Claude 화면의 새 대화도 함께 멈춘다. 플랜이
   내건 "서로 영향을 주지 않는다"가 바로 이 자리에서 깨진다.
2. **귀속이 거짓이 된다.** `client_mcp_servers()` 는 `oculpm` MCP 를 표식 없이
   넘기고 도구의 `agent_id` 기본값은 `claude-code` 다. Codex 가 쓴 일지·플랜이
   전부 Claude 것으로 기록된다 — 자기 자신을 추적하는 앱에서 이건 기록의 거짓이다.
3. **클릭 한 번에 수백 MB.** Codex 화면은 마운트 즉시 `acp_start` 를 부르고,
   어댑터가 없으면 그대로 npm 설치가 돈다. `codex-acp` 는 `@openai/codex` 를 정규
   의존성으로 들고 오므로 플랫폼 바이너리까지 딸려온다. Claude 의 자동 설치는
   "그것 말고 선택지가 없어서" 옳았지만, 두 번째 provider 는 안 쓸 사람이 더 많다.
4. **배지가 Claude 사용자에게 거짓말.** 설정의 ACP 배지가 `ready && codex_ready` 라,
   Codex 를 안 깐 사람도 영원히 "설정 필요"였다. 게다가 인증 탐지가 `CODEX_API_KEY`
   를 빼먹어(어댑터는 받는다) 키만 넣어 둔 사용자가 "인증 없음"으로 보였다.
5. **로그인 안내가 없다.** 어댑터가 `chat-gpt` 인증 방법을 광고하는데(핸드셰이크
   테스트가 그걸 단언한다) 우리는 `authenticate` 를 부르는 자리가 없고, 실패는
   원시 문자열로 떨어졌다.
6. **`promptCapabilities` 를 읽지 않는다.** 프로토콜이 "이 값에 맞춰 UI 를 바꾸라"고
   못 박는데 이미지를 provider 무관하게 실어 보냈다 — 안 받는 에이전트에겐 붙임
   하나로 턴 전체가 실패한다.

## 해결 방법

- 락을 **대상별로** 준다 (`AcpState::start_lock(target)`·`session_lock(target)`,
  `HashMap<u64, Arc<Mutex<()>>>`). 한쪽을 쥐고 있어도 다른 쪽은 즉시 잡힌다.
- MCP 서버에 `OCULPM_AGENT_ID` 를 실어 준다 (`AcpProvider::agent_id()` →
  `claude-code`/`codex`). 도구는 인자 → 환경변수 → `claude-code` 순으로 정한다.
  터미널에서 직접 띄운 CLI 는 예전 그대로다.
- Codex 는 자동 설치하지 않는다 — `acp_codex_adapter_missing` 으로 돌려보내고
  화면이 설치 버튼과 "몇 분·수백 MB" 안내를 띄운다. Claude 경로는 그대로.
- 배지는 Codex 가 **깔린 뒤부터** 그 건강을 반영한다(`acpBadgeReady`). 인증 탐지에
  `CODEX_API_KEY` 를 더한다.
- `session/new` 실패를 갈라, 인증 방법을 광고했고 + 오류 문구도 인증을 가리킬 때만
  `acp_auth_required` 로 돌려준다(광고만으로 판단하면 멀쩡한 실패까지 로그인 탓이
  된다 — codex-acp 는 로그인돼 있어도 광고한다). 화면은 "터미널에서 codex login".
- `promptCapabilities.image` 를 `AcpAgentInfo.supports_image` 로 들고 와, 안 받는
  에이전트에서는 붙여넣기를 막고 이유를 말한다.
- 터미널 탈출구가 맥락을 버리지 않게 `codexCommand(prefill)` 로 고친다.
- ⌘번호가 걸린 **앞 10칸을 못 박는 테스트**를 넣는다. Codex 화면은 12번째라 밀린
  번호가 없어 배치는 그대로 뒀지만, 개수만 세는 기존 테스트는 중간 삽입을 통과시켰다.

## 검증

`cargo fmt --check` clean · `cargo clippy --all-targets -D warnings` clean ·
`cargo test` 1162 passed / 0 failed (신설 3건: 대상별 락 격리, `session_create_error`
분기, `agent_id_or_default`) · `pnpm typecheck` 0 · `pnpm test` 159 files / 2073
passed (신설 1건: ⌘번호 앞 10칸 고정) · `pnpm lint` clean.
실기기 확인(Codex 로그인 → 새 세션 → 승인 → 일지 귀속)은 미완 — 플랜의 #live-smoke.