---
schema_version: 1
type: bug
slug: "startup-white-flash"
status: done
difficulty: low
created_at: "2026-11-11T21:30:00+09:00"
session_id: "manual-20261111-213000"
agent:
  id: "claude-code"
  version: "Opus 5.5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "index.html"
    op: update
  - path: "public/boot.css"
    op: create
  - path: "src/main.tsx"
    op: update
  - path: "src-tauri/tauri.conf.json"
    op: update
  - path: "src-tauri/tauri.windows.conf.json"
    op: update
  - path: "src-tauri/src/commands/window/lifecycle.rs"
    op: update
  - path: "src-tauri/src/commands/window/tests.rs"
    op: update
  - path: "src-tauri/tests/webview_csp.rs"
    op: update
related: []
tags:
  - "기동"
  - "windows"
  - "테마"
---
[x] 기동: 첫 화면의 흰 번쩍임을 없앤다

## 발생 원인
창을 열면 웹뷰의 기본 바탕(흰색)이 먼저 칠해지고, 앱 CSS 는 지연 청크(AppWindow · ShellV2)라 언어 사전 → 앱 창 청크 → CSS 순으로 줄 서서 온 뒤에야 캔버스 색이 깔렸다. 어두운 테마에서 특히 눈에 띄었다. 본문 서체(Pretendard 1.7MB)도 그 CSS 의 @font-face 가 읽힌 뒤에야 받기 시작했다.

## 해결 방법
- 창 바탕: `tauri.conf.json` · `tauri.windows.conf.json` 첫 창에 `backgroundColor #f1eee6`(tokens.css `--bg-sidebar` 밝게). 셋업의 `adopt_first_window` 가 저장된 테마(`theme`: light/dark/시스템=OS)로 바로 고쳐 칠하고(첫 페인트 전), 새 창(`spawn_window`)은 빌더에서 같은 규칙(`background_for`)으로 칠한다. 규칙은 프런트 `resolveThemeAttrs` 와 같다.
- 웹뷰 첫 페인트: `public/boot.css` 를 index.html 이 링크 — `prefers-color-scheme` 와 `data-theme` 을 따르는 html 바탕 두 색. **index.html 안 `<style>` 로 두지 않았다**: Tauri 가 빌드된 HTML 의 `<style>` 에 nonce 를 붙이면 style-src 의 `'unsafe-inline'` 이 무시돼 인라인 style 속성 수백 곳이 막힌다(webview_csp.rs 머리말의 전제). 그 전제를 테스트로 박았다(index.html 에 `<style`·인라인 script 없음).
- `main.tsx`: 앱 창 청크 `import()` 를 언어 사전 · 설정 조회와 나란히 시작하고, 서체를 `?url` 로 받아 `<link rel=preload as=font crossorigin>` 을 맨 먼저 단다. Vite 가 CSS 의 url() 과 같은 해시 파일 하나를 낸다(dist 확인). font-src 'self' 그대로.
- 테마 의미(`data-theme`/`data-accent`)는 건드리지 않았다.

## 검증
- `cargo test --no-fail-fast` → 1117 passed · 0 failed (그중 `window_background_follows_the_theme_setting` · `the_policy_still_matches_what_the_frontend_actually_does` ok)
- `pnpm build` → dist/index.html 에 `<link rel="stylesheet" href="/boot.css">`, dist/boot.css 있음, `Pretendard-subset-CaqBRB0h.woff2` 1개를 AppWindow CSS(2곳)와 index JS(1곳)가 같이 가리킴
- `pnpm typecheck` exit 0 · `pnpm lint` 6 게이트 통과(기존 경고 1) · `vitest run --maxWorkers=2` → Tests 1085 passed
- 설치본 눈 확인은 남음 (어두운 테마에서 창을 열 때 흰 판이 안 보이는지)
