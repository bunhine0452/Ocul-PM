---
schema_version: 1
type: feature
slug: "rename-visible-ocul"
status: done
difficulty: medium
created_at: "2026-10-30T01:08:58+09:00"
session_id: "mcp-20261030-010858"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/tauri.conf.json"
    op: update
  - path: "src-tauri/src/menu.rs"
    op: update
  - path: "src-tauri/src/commands/window/projects.rs"
    op: update
  - path: "src-tauri/src/commands/window/lifecycle.rs"
    op: update
  - path: "src-tauri/src/db/startup.rs"
    op: update
  - path: "src-tauri/src/commands/export.rs"
    op: update
  - path: "src/features/start/StartWindow.tsx"
    op: update
  - path: "src/components/BootSplash.tsx"
    op: update
  - path: "src/features/settings/DataSection.tsx"
    op: update
  - path: "src/windows/AppWindow.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/i18n_glossary.test.ts"
    op: update
  - path: "src/__tests__/settings_page.test.tsx"
    op: update
related: []
tags:
  - "rename"
  - "ocul-next"
  - "mcp-tool"
---
[x] 보이는 이름은 Ocul — 설치 이름은 Ocul-PM 그대로

## 추가 기능

사용자 결정(10-29) 「앱 이름을 Ocul 로 — 보이는 이름만」에 따른 작업이다.

### 업데이트 경로를 먼저 따졌다 (#updater-rename-check)

시험 빌드 대신 지금 쓰는 판의 코드를 읽었다(`tauri-plugin-updater` 2.14.0 `updater.rs`, `tauri-utils` 2.10.2 `config.rs`).
- **macOS**: 업데이터가 tar 의 첫 폴더(`<AppName>.app`)를 버리고 내용을 임시 폴더에 푼다. 그 폴더를 지금 설치된 경로(`/Applications/Ocul-PM.app`)와 한 번에 바꿔 끼운다(`swap_bundle`). 그러니 productName 을 바꿔도 기존 사용자의 자리는 그대로다. 실행 파일 이름도 `ocul-pm` 이라 재시작이 안전하다.
- **Windows**: 설치기가 productName 으로 설치 폴더와 제거 등록 키를 만든다. 이름을 바꾸면 옛 판 옆에 앱이 하나 더 깔릴 수 있다.
- **결정**: productName 은 `Ocul-PM` 으로 둔다. `bundle.macOS.bundleName = "Ocul"` 은 CFBundleName 이라 메뉴바 · 알림 이름만 바꾸고 경로는 건드리지 않는다. 그래서 시험 빌드 없이 갈 수 있다.

### 바꾼 것 (#rename-visible)
- macOS 메뉴바 이름(CFBundleName)
- 메뉴: 가리기 · 종료 · 정보. 정보 창 이름은 기본값이 productName 이라 `AboutMetadata` 로 따로 줬다.
- 창 제목과 그 대체값
- 시작 창 · 부트 화면 · 설정의 판 표시
- 데이터베이스 오류 창, 내보내기 머리
- 문구
  - 「ocul-pm 이 켜졌어요」 류는 무엇이 켜지는지를 말하게 「기록이 켜졌어요」로 바꿨다. 「지금 활성화」는 「지금 켜기」가 됐다.
  - 「다른 ocul-pm 창」은 「다른 Ocul 창」으로 바꿨다.
  - 로그 위치는 실제 자리(설정 → 데이터 → 로그 폴더)로 고쳤다.
- 용어 계약(`i18n_glossary`): 사전 값에 `Ocul-PM` · `ocul-pm` 을 쓰지 않는다. 저장소 주소만 예외다.

### 그대로 둔 것
설치 이름(productName · Finder 의 `Ocul-PM.app` · Windows 시작 메뉴), 번들 id, 데이터 폴더, 플러그인 `oculpm`, `.oculpm/`, MCP 이름, 저장소 주소 `bunhine0452/Ocul-PM`.

## 남은 것 (#rename-docs)

README ko/en · 랜딩 ko/en · 위키 · CHANGELOG 의 표기는 이 판을 내보내는 릴리스와 함께 바꾼다. 지금 바꾸면 내려받는 4.0.0 과 문서가 어긋난다. 랜딩 배포는 수동이다.

## 검증

- `pnpm typecheck && pnpm test && pnpm lint && pnpm build` → 944 passed, lint · build exit 0. `i18n_glossary` 에 이름 계약을, `settings_page` 에 「Ocul 4.0.0」을 넣었다.
- `cargo fmt --check && cargo clippy -D warnings && cargo test --locked` → 1153 passed. `tauri.conf.json` 의 `bundleName` 은 컴파일 때 `generate_context!` 가 읽어 통과했다.