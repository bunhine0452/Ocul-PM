---
schema_version: 1
type: chore
slug: "supply-chain-actions-sha-audit"
status: done
difficulty: medium
created_at: "2026-10-09T04:07:21+09:00"
session_id: "20261009-003"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "4450d61f-8efa-44ff-b9ec-4e171492ed94"
language: "ko"
verified_by_user: false
files_touched:
  - path: ".github/workflows/ci.yml"
    op: update
  - path: ".github/workflows/release.yml"
    op: update
  - path: ".github/workflows/e2e.yml"
    op: update
  - path: ".github/workflows/portability.yml"
    op: update
  - path: ".github/workflows/extension-release.yml"
    op: update
  - path: ".github/dependabot.yml"
    op: create
  - path: "deny.toml"
    op: update
  - path: "package.json"
    op: update
  - path: "pnpm-lock.yaml"
    op: update
related: []
tags:
  - "security"
  - "ci"
  - "supply-chain"
  - "release"
  - "mcp-tool"
---
[x] 공급망 — Actions 79줄 SHA 고정 · deny 대상에 Windows·Linux · npm audit 68→0 · 서명 잡 environment

## 작업 요약

2026-10-09 보완점 리포트의 공급망 항목을 실측하고 반영했다. 숫자는 리포트와 같았다: Actions `uses:` 79줄 중 SHA 고정 0줄, `pnpm audit --prod` 68건(치명 1·높음 25), `deny.toml` 대상은 macOS 둘뿐.

- **Actions** — 10종을 `gh api repos/<r>/commits/<ref>` 로 풀어 79줄 전부 `@<sha> # <정확한 버전>` 으로 바꿨다. `dtolnay/rust-toolchain@master` 는 `# master` 로 둔다. `.github/dependabot.yml` 은 github-actions 를 월 1회 한 PR 로 묶는다(혼자 유지하는 저장소의 PR 소음 때문).
- **cargo-deny** — 대상에 `x86_64-pc-windows-msvc`·`x86_64-unknown-linux-gnu` 를 넣었다. 넣자마자 `tiny-keccak` 2.0.2(CC0-1.0 단독)가 라이선스 게이트에 걸렸다. Windows·Linux 에서만 deep-link → rust-ini → const-random 경로로 링크되는 크레이트다. 사유와 함께 예외로 올렸다. advisories 는 새로 걸린 것이 없다.
- **npm** — `shadcn` 은 `App.css` 의 `@import "shadcn/tailwind.css"` 한 줄 때문에 dependencies 에 있었다. devDependencies 로 옮기자 68건이 5건이 됐다. 남은 5건은 Monaco 가 핀한 `dompurify` 3.4.8 이라 `pnpm.overrides` 로 `^3.4.16` 에 맞췄고, 0건이 됐다. CI frontend 잡에 `pnpm audit --prod --audit-level=high` 를 넣었다.
- **권한·environment** — e2e·portability 최상위에 `permissions: contents: read` 를 넣었다. 서명 키를 읽는 `macos`·`bundle` 잡에는 `environment: release` 를 달았다. 보호 규칙이 없는 지금은 아무것도 바뀌지 않는다. 승인자와 environment 비밀은 사용자가 설정한다.
- **결정** — 업데이터 키는 다시 만들지 않는다. 설치본이 지금 공개키를 들고 있어서, 키를 바꾸면 모든 사용자의 자동 업데이트가 끊긴다. 키와 같은 secrets 저장소에 두는 비밀번호는 막아 주는 것이 없다. release.yml 주석에 이 판단을 남겼다.

## 검증

- `cargo deny check licenses advisories sources bans` 네 가지 ok.
- `pnpm audit --prod` 는 "No known vulnerabilities found".
- 워크플로 YAML 5개와 dependabot.yml 이 ruby YAML 로 파싱된다. `uses:` 중 SHA 아닌 줄은 0개다.