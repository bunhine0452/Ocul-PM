---
schema_version: 1
type: bug
slug: "code-exec-boundary-acp-git-plugin"
status: done
difficulty: high
created_at: "2026-10-09T04:07:21+09:00"
session_id: "20261009-003"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "4450d61f-8efa-44ff-b9ec-4e171492ed94"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/trust.rs"
    op: rename
  - path: "src-tauri/src/git/safe.rs"
    op: create
  - path: "src-tauri/src/commands/acp.rs"
    op: update
  - path: "src-tauri/src/commands/plugins.rs"
    op: update
  - path: "src-tauri/src/deeplink.rs"
    op: update
  - path: "src-tauri/src/commands/themes.rs"
    op: update
  - path: "src-tauri/src/db/projects.rs"
    op: update
  - path: "src/features/chat/conversation/StartPanels.tsx"
    op: update
  - path: "src/features/chat/conversation/useAcpAdapter.ts"
    op: update
  - path: "src/features/settings/plugins/PluginBundlesBlock.tsx"
    op: update
  - path: "src/__tests__/acp_project_trust.test.tsx"
    op: create
  - path: "SECURITY.md"
    op: update
related:
  - ref: "20261008/Chores/1830_chore_perf-security-audit.md"
    kind: "followup"
  - ref: "20261008/Bugs/0559_bug_path-guard-blob-dispatch-import.md"
    kind: "followup"
tags:
  - "security"
  - "code-trust"
  - "git"
  - "acp"
  - "plugins"
  - "mcp-tool"
---
[x] 저장소가 고른 코드가 신뢰 전에 돌던 경로 넷 — 앱 안 에이전트 · 자동 git · 플러그인 설치 · 테마 URL

## 발생 원인

2026-10-09 보완점 리포트(v3.10.1 기준 19건)를 코드와 임시 저장소 재현으로 대조했다. 네 경로 모두 사실이었고, 둘은 리포트보다 넓었다.

- **앱 안 에이전트(ACP)** — 리포트는 "어댑터가 저장소 설정을 읽는지 확인 못 함" 으로 남겼다. 설치된 `claude-agent-acp` 0.81.0 의 `settingSources` 가 `["user","project","local"]` 이다. 그래서 `.claude/settings.json` 훅과 `.mcp.json` 을 CLI 의 폴더 신뢰 질문 없이 읽는다. `acp_start` 는 화면 마운트(`useEffect`) 때 불리므로 화면 하나 여는 것으로 그것이 돈다. `.claude/` 는 `git clone` 으로 따라오므로 git 경로보다 넓다 → 1순위.
- **자동 git 호출** — `-c core.fsmonitor=false --no-ext-diff --no-textconv` 를 붙여도 `filter.*.clean` 은 `git diff` 에서 돌았다(리포트 재현과 같다). 리포트에 없던 경로도 하나 찾았다: `git status` 가 인덱스를 다시 쓸 때 `.git/hooks/post-index-change` 가 돈다. 실행 도우미가 6벌이라 한 곳만 고쳐서는 안 됐다.
- **플러그인** — 미리보기와 설치가 `dry` 플래그만 다르고 각자 내려받았다. 게다가 설치는 입력창 값을 다시 읽어서, 미리본 뒤 입력을 바꾸면 보지 않은 번들이 깔렸다.
- **테마 URL** — `/`·`@` 로 문자열을 잘라 `https://evil.test?@oculpm.com/x.json` 을 oculpm.com 으로 읽었다. 실제 접속은 evil.test 로 간다.

## 해결 방법

- `lsp::trust` 를 `crate::trust` 로 옮기고, `acp_start` 가 설치보다 먼저 `require_for_agent` 를 지나게 했다(`project_untrusted`, detail = 저장소에 있는 실행 가능한 설정 파일). 신뢰는 프로젝트에 하나다. 화면(`AcpOffPanel`)은 「다시 시도」 대신 파일 이름과 「신뢰하고 시작」 을 보인다.
- `git::safe::cmd(dir, args)` 를 git 을 띄우는 유일한 창구로 만들고, 6곳을 옮겼다. 다른 자리에서 `_cmd("git")` 을 쓰면 테스트가 실패한다.
  - 늘 붙이는 것: `core.fsmonitor=false`, `GIT_OPTIONAL_LOCKS=0`, 없는 `core.hooksPath`.
  - diff·show·log 에는 `--no-ext-diff --no-textconv` 를 붙인다. textconv·드라이버를 빈 값으로 덮으면 git 이 빈 프로그램을 실행하려다 diff 가 실패해서다.
  - 필터는 플래그로 꺼지지 않는다. `config --list --show-scope -z` 로 local·worktree 범위 이름을 읽어 clean/smudge/process 를 빈 값으로, `required=false` 로 덮는다. git-lfs 표준 명령은 남긴다. `.git/config` mtime 으로 캐시한다.
  - 시간 제한 120초.
- 플러그인: `BundleImportResult.content_hash`(blake3)를 설치가 `expect_hash` 로 되돌려야 한다(`bundle_changed`). 프런트는 미리본 출처로 설치한다.
- 테마: `url::Url` 로 파싱한다(reqwest 와 같은 파서). 자격증명·비기본 포트를 거부하고, 리다이렉트는 허용 호스트로 가는 것만 따른다.
- 곁들여: `Db::project_root`(`project_not_found`)로 18벌 중 3벌(acp·acp_files·plugins)을 걷었다. `acp.rs` 의 파일 크기 래칫 때문에 시작한 정리다. SECURITY.md 에 다섯 번째 경계 「코드 실행」 표를 넣었다.

## 검증

- `repo_config_cannot_run_commands_through_status_or_diff` 는 fsmonitor·필터·textconv·드라이버·external·훅 여섯 마커가 status·diff·show·log -p 에서 0개임을 본다. 덮지 않은 git 은 실제로 돌린다(대조군).
- `acp_project_trust`·`plugin_bundles`(입력 변경 후 설치) vitest, `theme_url_host_is_the_host_reqwest_connects_to` 를 추가했다.
- typecheck · vitest 3,301 · lint · build · cargo fmt/clippy/test 2,024 모두 exit 0 (PR #79).