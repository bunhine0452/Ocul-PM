---
schema_version: 1
type: bug
slug: "release-blockers-linux-deeplink-tests"
status: done
difficulty: medium
created_at: "2026-10-24T21:56:43+09:00"
session_id: "20261024-006"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "917068e0-0c64-47b9-bd9d-59d40990f787"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/Cargo.lock"
    op: update
  - path: "src-tauri/src/instance_lock.rs"
    op: update
  - path: ".github/scripts/install-smoke-windows.ps1"
    op: update
  - path: ".oculpm/planner/optimize-round-20261024.md"
    op: update
related:
  - ref: "20260929/Bugs/0340_bug_port-dbus-panic-shortcut-exact-pty-cwd.md"
    kind: "followup"
tags:
  - "release"
  - "deps"
  - "ci"
  - "linux"
  - "mcp-tool"
---
[x] v3.13.6 릴리스 직전 결함 셋 — Linux 빌드(deep-link × rust-ini) · 상류 동작 변화에 묶인 게이트 둘

## 발생 원인

PR #90 머지 뒤 main 의 E2E(ubuntu)·Portability 가 붉었다. 셋 다 최적화 라운드의 의존성 갱신이 원인이고, macOS 로컬·CI 게이트는 못 보는 자리였다.

1. **Linux 빌드 E0063** — tauri-plugin-deep-link 2.4.10 → 2.6.2 의 Linux 코드가 `ini::ParseOption { enabled_quote, enabled_escape }` 두 필드로만 만드는데 rust-ini 0.21.2+ 는 필드가 넷(패치 판에서 semver 깸). 고친 deep-link 판 없음(다음은 3.0 알파).
2. **instance_lock 테스트(Linux)** — "잘못된 세션 주소면 single-instance 가 패닉한다" 는 상류 버그를 못박았는데, 새 판이 빈 주소를 패닉 없이 넘긴다.
3. **Windows 설치 스모크 프로브 D** — tauri 2.12 번들러의 NSIS 템플릿이 설치 폴더 밖의 같은 이름 프로세스를 더는 끝내지 않는다.

## 해결 방법

1. `[target.linux] rust-ini = "=0.21.1"` 고정(사유·해제 조건 주석). 소스로 판별 필드 수 확인(0.21.1 = 2, 0.21.2·0.21.3 = 4). 619411b0.
2. 맨몸 실패라면 주소 자리여야 한다는 것만 보고(`ok || at_address`), 지키는 계약은 guarded 쪽. 3. D 는 관찰로, A·B 끝남 · C(다른 이름 복사본) 생존이 게이트 — Windows 호스트 설계의 전제는 C. 81434d3f.
- 81434d3f 의 E2E(ubuntu) 「사이드카 일지 → 화면 60초」 1회 실패 → 앱 코드 동일(테스트만 변경)이라 재실행 → 통과. 간헐로 플랜 #next-e2e-linux-flake.

## 검증

- 619411b0: E2E 양 OS 초록. 81434d3f: CI · Portability 전 잡 · E2E(재실행) 초록 → v3.13.6 태그.