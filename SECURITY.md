# 보안 정책

## 신고

**공개 이슈에 적지 말고** GitHub 의 비공개 취약점 신고로 보내 주세요:
<https://github.com/bunhine0452/Ocul-PM/security/advisories/new>

- 이 저장소는 **유지보수자 한 명**이 받습니다. 응답 시간을 약속하지 않습니다 — 대신 확인된
  것은 고친 릴리스의 노트(`CHANGELOG.md`)에 무엇이 열려 있었는지 그대로 적습니다.
- 고치는 대상은 **최신 릴리스**뿐입니다. 앱이 자동 업데이트로 그 버전을 받습니다.
- 재현 경로(어떤 저장소를 열었을 때 · 어떤 화면에서 · 무엇이 어디에 써졌나)가 있으면 가장
  빠릅니다.

## 무엇이 보안 문제인가

이 앱은 남이 만든 저장소를 열고, 그 안에서 에이전트를 돌리고, 기록을 씁니다. 그래서 경계는
다섯입니다.

| 경계 | 깨졌다는 것 | 지키는 자리 |
|---|---|---|
| 프로젝트 경계 | 저장소에 실려 온 파일 · 심볼릭 링크 · `.oculpm/` 설정이 프로젝트 **밖**을 읽거나 쓴다 | `src-tauri/src/path_guard.rs` |
| 기기 밖 송출 | 사용자가 시작하지 않은 네트워크 송출이 있다 | `src-tauri/tests/egress_inventory.rs` (새 송출은 원장에 사유 없이 못 들어온다) · `egress_spawn_ledger.rs` (하위 프로세스 — 기동 자리마다 송출 가능/로컬 분류) |
| 비밀 | API 키 · 토큰이 일지 · diff · 로그 · DB 에 남는다 | `secrets.rs`(OS 키체인) · `oculpm/redact.rs`(끌 수 없는 마스킹 바닥) |
| 기기 동의 | 저장소가 켜 둔 배경 AI 작업이 이 기기의 허락 없이 내 키로 돈다 | `oculpm/automation/consent.rs` |
| 코드 실행 | 저장소가 고른 프로그램이 사람이 신뢰하기 전에 내 권한으로 돈다 | 아래 표 |

저장소가 실행 파일을 고를 수 있는 자리와 그 문:

| 자리 | 저장소가 고르는 것 | 문 |
|---|---|---|
| 언어 서버 | `build.rs` · proc-macro · 툴체인 파일 · venv · `node_modules` 의 서버 | 프로젝트 신뢰 (`src-tauri/src/trust.rs`) — 신뢰 전엔 안 띄운다 |
| 앱 안 에이전트 (Claude Code · Codex) | `.claude/settings.json` 훅 · `.mcp.json` 서버 | 같은 프로젝트 신뢰 — 신뢰 전엔 어댑터를 안 띄운다 |
| 자동 git 호출 (Today · 변경 화면) | `.git/config` 의 fsmonitor · 필터 · 외부 diff · `.git/hooks` | 신뢰 없이 늘 끈다 (`src-tauri/src/git/safe.rs` — git 을 띄우는 유일한 자리) |
| 플러그인 번들 | 번들의 `.mcp.json` 명령 | 미리본 바이트와 같을 때만 설치 (`commands/plugins.rs`) |
| 배경 AI 작업 | 자동화 정의 | 기기 동의 (위 표) |

네트워크에서 듣는 자리는 둘입니다 — 모바일 브리지(켰을 때만, Tailscale 인터페이스에만
바인드 — `src-tauri/src/mobile_bridge/bind.rs`)와 Notion 연결의 OAuth 콜백(누른 뒤 최대
3분, `127.0.0.1` 에서만). 업데이트는 서명을 검증한 뒤에만 설치됩니다.

## 외부 리뷰 이력

이 저장소의 코드는 거의 전부 AI 코딩 에이전트와 함께 썼고, 외부 리뷰어가 적습니다. 그래서
바깥의 눈이 들어온 때와 그것이 무엇을 바꿨는지를 여기 남깁니다. 실제로 아래 리뷰들이 내부
감사가 놓친 결함을 찾았습니다.

**주기:** 마지막으로 리뷰가 반영된 릴리스에서 **마이너 5개째**가 되면 다음 리뷰를 청합니다.
`scripts/bump-version.mjs` 가 버전을 올릴 때 이 표의 「반영」 열을 읽고 알립니다 —
릴리스를 막지는 않습니다(`docs/RELEASE.md` §0-1).

| 날짜 | 리뷰 | 반영 |
|---|---|---|
| 2026-09-15 | 외부 리뷰 「10점 마스터보고서」 48건 — 코드로 대조해 확인된 결함만 수용 | v3.2.0 |
| 2026-10-07 | 외부 보안 리뷰 1차 — 남의 저장소를 열 때의 위험(배경 AI 동의 · 마스킹 바닥 · 링크를 따라간 쓰기) | v3.8.0 |
| 2026-10-07 | 외부 보안 리뷰 2차 — v3.8.0 이 막지 못한 링크 자리를 프로젝트 전체에서 | v3.9.0 |
| 2026-10-08 | 외부 보안 리뷰 3차 — 경로 3건 · 상위 폴더 · 자동화 동의 범위 (PR #74) | v3.10.0 |
| 2026-10-08 | 외부 코드 리뷰 — 범위 · 리뷰어 부족 · 버스 팩터 · 생성물 diff | 범위 동결(`CLAUDE.md`) · 이 문서 |
| 2026-10-09 | 보완점 리포트 (v3.10.1 기준 19건) — 코드 실행 경로 · 공급망 · 이벤트 경합 | v3.11.0 |

---

## Security policy (English)

Please report vulnerabilities **privately** through GitHub:
<https://github.com/bunhine0452/Ocul-PM/security/advisories/new> — not in a public issue.

This project has a single maintainer, so there is no response-time promise; confirmed issues are
fixed in the **latest release only** (the app auto-updates) and described plainly in
`CHANGELOG.md`. In scope: anything a cloned repository can use to read or write outside the
project (files, symlinks, `.oculpm/` settings), any outbound traffic the user did not start, secrets
persisting into journals/diffs/logs/the DB, background AI work running without this device's
consent, and any program a repository picks (language-server build scripts, agent hooks and MCP
servers, git fsmonitor/filters/hooks, plugin commands) running before you trust the project. The external review history above is kept so that outside reviews happen on a cadence.
