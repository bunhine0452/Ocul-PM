---
schema_version: 1
type: feature
slug: "vscode-extension-receipt-viewer"
status: done
difficulty: high
created_at: "2026-11-02T21:13:26+09:00"
session_id: "20261102-002"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "2e16d24e-1a21-4384-b5ea-51a94216db8a"
language: "ko"
verified_by_user: false
files_touched:
  - path: "extension/package.json"
    op: create
  - path: "extension/src/extension.ts"
    op: create
  - path: "extension/src/project.ts"
    op: create
  - path: "extension/src/store.ts"
    op: create
  - path: "extension/src/git.ts"
    op: create
  - path: "extension/src/text.ts"
    op: create
  - path: "extension/src/model/frontmatter.ts"
    op: create
  - path: "extension/src/model/evidence.ts"
    op: create
  - path: "extension/src/model/journal.ts"
    op: create
  - path: "extension/src/model/plan.ts"
    op: create
  - path: "extension/src/model/overview.ts"
    op: create
  - path: "extension/src/model/receipt.ts"
    op: create
  - path: "extension/src/model/time.ts"
    op: create
  - path: "extension/src/model/shared.spec.ts"
    op: create
  - path: "extension/src/model/model.spec.ts"
    op: create
  - path: "extension/src/guard.spec.ts"
    op: create
  - path: "extension/l10n/bundle.l10n.ko.json"
    op: create
  - path: "extension/README.md"
    op: create
  - path: "extension/CHANGELOG.md"
    op: create
  - path: "src-tauri/src/git/receipt_cases.json"
    op: create
  - path: "src-tauri/src/git/receipt_cases_tests.rs"
    op: create
  - path: "src-tauri/src/git/mod.rs"
    op: update
  - path: ".github/workflows/extension-release.yml"
    op: create
  - path: "docs/RELEASE.md"
    op: update
  - path: "CLAUDE.md"
    op: update
  - path: "eslint.config.js"
    op: update
related: []
tags:
  - "확장"
  - "편집기"
  - "영수증"
  - "vscode"
  - "mcp-tool"
---
[x] 확장: VS Code 에서 영수증을 본다

## 추가 기능
VS Code 확장 `oculpm.ocul` 0.2.0 을 `extension/` 에 새로 만들었다. 기능 동결 중 사용자 예외다(11-02, 「걷을 표면」 대신 「규칙 예외로 기록」 — 확장은 화면이 아니라 마켓이라는 배포 채널). 0.1.0(사이드바 트리 · 체크박스 · 앱 바이너리 경유 MCP)은 되살리지 않았다.
- 상태 표시줄 왼쪽: 진행 중인 계획의 마지막 확인 명령 결과(`✓ 2시간 전 통과`, 실패면 빨간 배경에 끝 줄)와 어느 일지에도 없는 변경 수 `○ N`. 누르면 「지금 볼 것」(실패한 계획 · 명령 없는 오늘 일지 · 기록 없는 변경).
- 상태 표시줄 오른쪽: 연 파일의 영수증 `🕘 ✓ 10`. 올려 두면 이 파일을 건드린 일지와 돌린 명령의 끝 줄.
- 탐색기 배지 `○`(설정 `ocul.explorerBadges`), 명령 「이 파일의 기록」 · 「PR 영수증 복사」(앱 변경 화면과 같은 마크다운, 「통과 뒤 바뀜」 꼬리만 뺌).

## 동작 흐름
- 앱 없이 동작한다. `.oculpm/` 을 읽기만 하고, git 은 VS Code 내장 git API 로만 본다(자식 프로세스 0), 네트워크 0 — `extension/src/guard.spec.ts` 가 소스를 훑어 막는다. 런타임 의존성 0, 번들 19KB.
- 증거 등급 · 끝 줄 · 일지 제목 · 판정 줄 · 확인 명령 줄 규칙을 앱과 **한 사례표**로 묶었다: `src-tauri/src/git/receipt_cases.json` 을 Rust(`git/receipt_cases_tests.rs`)와 TS(`extension/src/model/shared.spec.ts`)가 같이 읽는다. Rust 정규식의 유니코드 `\b` 는 TS 에서 `\p{L}\p{N}_` 둘레 검사로 옮겼다.
- 게시: `.github/workflows/extension-release.yml` 을 되살렸다(`ext-v*` 태그 → GitHub Release .vsix 항상 → Open VSX · 마켓은 토큰 있을 때). PR 에서는 패키징 dry-run. `docs/RELEASE.md` §2-1, CLAUDE.md 「Brought back」 에 적었다. 루트 eslint 는 `extension/**` 를 뺀다.

## 검증
- `extension`: `pnpm check-types` 0 · `pnpm test` 48 passed (사례표 24 포함) · `vsce package` 43.48 KB, 11 files
- Rust `cargo test --lib receipt_cases` 4 passed · `cargo fmt --check` 0 · 루트 `pnpm typecheck` 0 · `vitest run` 1000 passed · `pnpm lint` 0 (기존 경고 1) · `pnpm build` ✓ built
- 실기기: 이 기기 VS Code 에 .vsix 를 설치해 이 저장소를 열었다 — exthost.log 에 `activationEvent: 'workspaceContains:.oculpm'` · 오류 0, 화면에서 왼쪽 `✓ 2시간 전 통과` · 오른쪽 `🕘 ✓ 10`(TodayExceptions.tsx) 를 확인했다. 예전 0.1.0 확장은 지웠다. 호버 영수증 · PR 영수증 복사는 손으로 눌러 보지 못했다(사용자 몫).