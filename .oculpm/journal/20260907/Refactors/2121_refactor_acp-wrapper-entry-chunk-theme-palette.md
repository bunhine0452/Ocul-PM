---
schema_version: 1
type: refactor
slug: "acp-wrapper-entry-chunk-theme-palette"
status: done
difficulty: high
created_at: "2026-09-07T21:21:17+09:00"
session_id: "20260907-003"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context) · Sonnet 5"
  session: "b2e235a0-7801-4870-9780-7b970cc85e65"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/api/acp.ts"
    op: update
  - path: "src/features/chat/conversation/useAcpAdapter.ts"
    op: update
  - path: "src/features/chat/conversation/useAcpSend.ts"
    op: update
  - path: "src/features/chat/conversation/useAcpSessionSync.ts"
    op: update
  - path: "src/features/settings/uiScale.ts"
    op: update
  - path: "scripts/measure-entry-chunk.mjs"
    op: create
  - path: "scripts/check-bindings-imports.mjs"
    op: update
  - path: "src/features/theme/schema.ts"
    op: update
  - path: "src-tauri/src/themes/mod.rs"
    op: update
  - path: "src/features/today/agentColor.ts"
    op: update
  - path: "src/features/branch/BranchScreenV2.tsx"
    op: update
  - path: "src/features/oculpm/JournalScreenV2.tsx"
    op: update
related: []
tags:
  - "acp"
  - "perf"
  - "theme"
  - "v3-release"
  - "mcp-tool"
---
[x] ACP 가 래퍼를 지나고, 진입 청크에서 창 API 를 뺀다

## 동기

v3-release 의 `{#acp-api-wrapper}` · `{#code-tokens-theme-schema}` ·
`{#palette-claude-collision}` 과 hardening 플랜의 `{#entry-chunk}`.

## 변경 요약

**ACP 래퍼** — 직접 호출 5파일을 `api/acp.ts` 로 옮겼다(allowlist pending 108 → 103).
allowlist 주석이 "옮길 때는 다섯을 함께 보낸다" 고 적어 둔 약속이다. 어려운 건 오류
처리였다 — 봉투 분기가 전부 try/catch 로 바뀌므로 호출부 **18곳의 실패 동작을 한 글자도
안 바꾸도록** 옮겼다(조용하던 자리는 조용하고, 같은 문구를 띄우고, seq 가드 순서까지
그대로). 달라진 것은 하나뿐이고 봉투→throw 의 본질이다: 전송 실패(IPC reject)가 예전엔
어디에도 안 잡혀 **unhandled rejection 으로 샜는데** 이제 봉투 오류와 같은 길로 접힌다.

**진입 청크 — 플랜이 틀렸다.** "진입 청크 606KB" 는 사실이 아니었다. 606KB 는 CodeMirror
청크이고 이미 `React.lazy` 뒤에서 지연 로드된다(빌드 경고의 최대 청크를 진입으로 오인한
것). 진짜 진입 청크는 **288.40 kB** 였다. `manualChunks` 로 React 를 가르는 실험도 했지만
합계가 288.07 kB 로 같아 **라벨만 옮기는 짓**이라 되돌렸다.

진짜로 뺄 것은 따로 있었다 — `settings/uiScale.ts` 가 `@tauri-apps/api/webview` 를 **정적
으로** 끌어 `window.js`(62.6kB)·`dpi.js`·`image.js` 까지 진입에 딸려왔다. 동적 import 로
바꿔 **288.40 → 261.86 kB (−26.5 kB, −9.2%)**. 늦어지는 것은 없다 — 부르는 쪽이 이미 설정을
SQLite 에서 읽은 뒤(`loaded`)에야 부르므로 로컬 청크 한 조각은 그 왕복에 묻힌다. 측정
스크립트를 `scripts/measure-entry-chunk.mjs` 로 남겼다(새 의존성 0, vite build API +
rollup `generateBundle` 훅).

**테마 문법색** — `--code-*` 10개를 화이트리스트 **양쪽**(`features/theme/schema.ts` 와
`src-tauri/src/themes/mod.rs`)에 같은 순서로 넣었다. `theme_schema.test` 가 둘의 일치를
단언하므로 한쪽만 고치면 붉어진다. 이제 내려받은 커스텀 테마도 문법색을 정할 수 있고,
실제로 칠해지는지까지 라운드트립 테스트로 확인했다(화이트리스트만 늘리고 적용이 안 되면
절반만 한 것이다).

**팔레트 충돌** — `PALETTE[0]`(#d97a4f)이 Claude 코랄(#d97757)과 색상환 **4도** 차이라
모르는 에이전트가 Claude 처럼 보였다. #cb4db2 로 바꿨다: 코랄과 62.9도, 나머지 팔레트
5색과 최소 50.9도, 라이트·다크 6종 배경에서 대비비 3.5~4.3(옛 값은 라이트에서 2.9로 더
나빴다). 팔레트 6색 전부가 코랄과 RGB 거리 ≥20 임을 단언하는 회귀 가드를 붙였다.

## 검증

`pnpm typecheck` · `pnpm lint`(6게이트) · `pnpm test`(190파일 / 2,463건) · `pnpm build` ·
`cargo test`(30 스위트) · `cargo clippy -D warnings` 전부 exit 0.

**육안 미확인** — ACP 화면의 실제 실패 경로(어댑터 미설치·프로세스 사망·세션 로드 실패)는
테스트로만 덮였다. 문법색과 새 팔레트 색도 띄워 봐야 한다.