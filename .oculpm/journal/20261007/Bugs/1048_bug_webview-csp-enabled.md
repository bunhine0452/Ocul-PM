---
schema_version: 1
type: bug
slug: "webview-csp-enabled"
status: done
difficulty: high
created_at: "2026-10-07T10:48:34+09:00"
session_id: "20261007-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fdeb6d9e-9327-4e65-8f8a-4524621720ff"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/tauri.conf.json"
    op: update
  - path: "src/lib/oculpmLog.ts"
    op: update
  - path: "src/main.tsx"
    op: update
  - path: "e2e/lib/page.mjs"
    op: update
  - path: "e2e/scenario.mjs"
    op: update
  - path: "src-tauri/tests/webview_csp.rs"
    op: rename
  - path: "src-tauri/tests/egress_inventory.rs"
    op: update
related:
  - ref: "20261007/Bugs/1027_bug_acp-adapter-locked-install.md"
    kind: "followup"
tags:
  - "security"
  - "csp"
  - "e2e"
  - "external-review"
  - "mcp-tool"
---
[x] 웹뷰 CSP 가 꺼져 있어 XSS 하나가 곧 원격 코드 실행이었다 — 켜고 e2e 로 지킨다

## 발생 원인

외부 보안 피드백이 가장 큰 구조적 약점으로 짚었다: `app.security.csp: null`. 웹뷰가 부를 수 있는 커맨드에 프런트가 넘긴 문자열을 `sh -c` 로 도는 `open_in_editor`, 임의 프로그램을 띄우는 `create_greenfield_project`, 그리고 설계상 명령 실행 표면인 내장 터미널이 있다 — 렌더링 코드에 XSS 가 하나라도 생기면 곧 원격 코드 실행이다. 개별 커맨드를 좁혀도 터미널이 남으므로 실질 방어는 XSS 를 막는 쪽(CSP)이다. 현재 XSS 경로는 찾지 못했다(innerHTML 싱크는 hljs·텍스트 노드·QR SVG 뿐, react-markdown 은 raw HTML 없음).

v3-release 가 같은 정책을 초안으로만 두고 켜지 않았다(`webview_csp_draft.rs`) — 위반은 콘솔에만 나고 화면은 조용히 비는데 볼 길이 없었다. 그 뒤 크로스플랫폼 라운드가 실제 앱을 WebView2·WebKitGTK 에서 모든 화면을 도는 e2e 를 만들었다. 그것이 이번에 켤 수 있는 근거다.

## 해결 방법

- 정책: default-src 'self' · script-src 'self' 'wasm-unsafe-eval' · style-src 'self' 'unsafe-inline' · img-src 'self' data: blob: · font-src 'self' data: · media-src 'self' data: blob: · frame-src blob: · worker-src 'self' blob: · connect-src 'self' ipc: http://ipc.localhost https://api.github.com · object-src 'none' · base-uri 'self' · form-action 'none'.
- 근거 실측(dist 전수): 인라인 스크립트·eval·new Function 0, wasm 포매터 4, Monaco module 워커, 코드 미리보기 blob:(PDF iframe 포함), 원격 스크립트·폰트·이미지 0. **원격 이미지를 막으면서 에이전트가 쓴 일지·답의 `![](https://…)` 가 화면을 여는 순간 바깥에 요청하던 길도 닫혔다.**
- Tauri 2.11 소스로 확인한 전제: nonce 는 빌드된 HTML 안의 `<style>`·인라인 `<script>` 에만 붙는다(우리 index.html 엔 없음 → 'unsafe-inline' 유효). 데스크톱 `tauri dev` 는 devUrl 을 직접 열어 CSP 가 실리지 않는다(dev 프록시는 모바일 전용) — HMR 그대로.
- 위반 관측: `watchCspViolations`(main.tsx 머리)가 시작부터 `window.__oculpmCsp` 와 `oculpm.log`(`csp` 타깃)에 쌓는다. e2e `screenState` 가 화면마다 떼어 보고 한 건이라도 있으면 단계를 떨어뜨리며, 마지막 단계가 남은 것을 턴다.
- `webview_csp_draft.rs` → `webview_csp.rs`: "아직 안 켰다" 단언을 정책 대조(열 것·닫을 것)로 바꿨다 — 그 파일이 적은 다음 단계 그대로.

## 검증

- `webview_csp` 2·egress 11 통과, 전체 Rust 1983 통과, vitest 3269, lint·typecheck 통과.
- 실제 웹뷰 검증은 이 브랜치에서 e2e(workflow_dispatch)로 돌린다 — 결과는 PR 에 적는다.
- 실기기 미확인: macOS WKWebView(e2e 밖) — 전 화면·PDF 미리보기·포매터·터미널 WebGL. 막히면 `oculpm.log` 에 `csp` 줄로 남는다.