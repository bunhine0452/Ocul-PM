---
schema_version: 1
type: feature
slug: "port-e2e-harness-le2e"
status: done
difficulty: superhigh
created_at: "2026-09-24T20:30:47+09:00"
session_id: "20260924-005"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ed4447b7-7384-4a70-82ba-26748d6773e1"
language: "ko"
verified_by_user: false
files_touched:
  - path: ".github/workflows/e2e.yml"
    op: create
  - path: "e2e/run.mjs"
    op: create
  - path: "e2e/scenario.mjs"
    op: create
  - path: "e2e/lib/launch.mjs"
    op: create
  - path: "e2e/lib/ime.mjs"
    op: create
  - path: "e2e/lib/terminal.mjs"
    op: create
  - path: "e2e/lib/report.mjs"
    op: create
  - path: "e2e/tauri.e2e.conf.json"
    op: create
related:
  - ref: "20260924/Bugs/0626_bug_port-watcher-root-rename-lfs2.md"
    kind: "followup"
tags:
  - "cross-platform"
  - "ci"
  - "e2e"
  - "mcp-tool"
---
[x] E2E 하네스 — 실제 앱을 Windows·Linux 러너에서 띄워 15화면·터미널·IME·사이드카 (L-E2E, PR #41)

## 추가 기능

크로스플랫폼 W3 · L-E2E. 사용자가 Windows·Linux 를 직접 볼 수 없어서, **실제 앱을 러너에서 띄우고 단계별 스크린샷을 남기는** 하네스를 만들었다(`e2e/`, `.github/workflows/e2e.yml` — `port/**` push·수동 실행만).

- `tauri-driver` — Windows msedgedriver(WebView2 버전 맞춤) · Linux WebKitWebDriver + xvfb. 앱은 `tauri build --debug --no-bundle`.
- 시나리오: 첫 실행 마법사 → 픽스처 프로젝트(.oculpm 초기화) → navRegistry 15화면 × 한국어 1440·English 1440·English 960(에러 경계 0) → 터미널 `echo 한글-ok` 왕복(WebGL 캔버스라 xterm 버퍼를 React 파이버로 읽음) → Windows 한글 IME 흉내(CDP `Input.imeSetComposition`, MS 한국어 IME 순서 재현) → 사이드카 `oculpm-mcp` `journal_write` → 일지 화면 반영.
- 의존성 0(Node 22 내장 fetch·WebSocket 으로 W3C 클라이언트). 데이터 격리(Linux HOME·XDG, Windows 는 CI VM 만). 네이티브 폴더 선택 창만 대신.
- Windows 러너는 관리자라 msedgedriver launch 가 `DevToolsActivePort` 로 늘 실패 — HKLM WebView2 정책으로 CDP 를 열어 attach.
- 산출: 번호·OS·단계·화면 이름의 스크린샷 55장 + `index.html` 목차 + summary.md.

## 발견한 앱 결함 (고치지 않고 보고 → L-UI2 레인)

오케스트레이터가 스크린샷을 직접 받아 확인했다:
1. Windows 에서 프로젝트 이름이 경로 전체(`StartTab.tsx`·`GreenfieldWizard.tsx` 가 `/` 로만 자름) — #ui-winpath-name.
2. **Windows 터미널에 빠르게 친 키가 뒤섞인다** — `echo order-0123456789` → `echo roder-0124356789`(3/3, Linux 0/5). 키마다 따로 가는 `writeToPty` 의 순서 무보장 — #ui-term-write-order.
3. 비-mac 고정폭 영역의 한글 자간 벌어짐(D2Coding Term) — #ui-mono-hangul. 4. Linux 탭 "zsh" 하드코딩·영어 전환 토스트 한국어 — #ui-e2e-minor. 5. 기본 workday 시간대 Asia/Seoul(#oculpm-default-tz), 색인 이중 실행(#index-double-run).

## 검증

- ubuntu-22.04 **5회 연속 전 단계 초록**. windows: 15화면×3 45/45 · 터미널 한글 · IME 정확히 한 번 · 사이드카 일지 초록, 붉은 두 단계는 위 결함 1·2(3회 동일).
- PR #41 ci.yml 3잡 SUCCESS → rebase 머지 d9ac4a79.
- CI 로 못 보는 것: 실제 입력기(MS IME 후보창·fcitx/ibus), 일반 권한 msedgedriver launch 경로, 트레이·알림·딥링크, HiDPI·다중 모니터, Wayland, WebView2 런타임 편차 → #w5-eyes.