---
schema_version: 1
type: chore
slug: "release-v2-8-1"
status: done
difficulty: low
created_at: "2026-08-01T13:31:45+09:00"
session_id: "mcp-20260801-133145"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "CHANGELOG.md"
    op: update
  - path: "package.json"
    op: update
  - path: "src-tauri/tauri.conf.json"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/Cargo.lock"
    op: update
  - path: "plugin/oculpm/.claude-plugin/plugin.json"
    op: update
  - path: ".claude-plugin/marketplace.json"
    op: update
  - path: "landing/index.html"
    op: update
related: []
tags:
  - "release"
  - "versioning"
  - "landing"
  - "mcp-tool"
---
[x] v2.8.1 릴리스 — 프로젝트 관리 화면

## 추가 기능

패치 릴리스 v2.8.1 — 이번 세션의 프로젝트 관리 화면을 배포했다.

버전을 이고 있는 파일 6개를 2.8.0 → 2.8.1 로 올렸다:

- `package.json` · `src-tauri/tauri.conf.json` · `src-tauri/Cargo.toml`(+`Cargo.lock`)
- `plugin/oculpm/.claude-plugin/plugin.json` · `.claude-plugin/marketplace.json`

플러그인 쪽은 이번 릴리스에서 내용 변경이 없지만 **버전은 함께 올려야 한다** — `src-tauri/tests/plugin_manifest.rs` 의 `plugin_json_is_minimal_and_version_synced` / `marketplace_points_at_plugin_and_stays_version_synced` 가 `plugin.json.version == tauri.conf.json.version == marketplace.plugins[0].version` 을 강제한다. 실수로 앱만 올리면 cargo test 에서 잡힌다.

`CHANGELOG.md` 최상단에 `## v2.8.1` 섹션 추가, 랜딩 버전 5곳 갱신(JSON-LD `softwareVersion` · 공지 필 · 업데이트 목록 · 다운로드 버튼 · CTA 아이브로우). 업데이트 목록은 v2.8.0 항목을 지우지 않고 위에 얹어 이력을 보존했다.

## 동작 흐름

1. 기능 커밋(`3416aa4`)과 릴리스 커밋(`640df9d`)을 분리 — v2.8.0 때와 같은 형태.
2. 스테이징은 명시 경로만. 워킹트리에 세션 전부터 있던 `.oculpm/planner/{ponytail-round,skill-catalog-round}.md` 수정이 남아 있어 `git add -A` 를 쓰면 남의 WIP 를 쓸어 담는다.
3. `git push origin main` → `git tag -a v2.8.1` → `git push origin v2.8.1`. 태그 푸시가 `release.yml` 을 깨우고, 워크플로가 `awk -v t="## v2.8.1"` 로 CHANGELOG 에서 해당 섹션만 뽑아 릴리스 노트에 넣는다 (헤더 문자열이 태그명과 정확히 일치해야 한다 — 푸시 전에 같은 awk 로 추출 리허설을 돌려 확인했다).
4. tauri-action 이 aarch64 dmg + 업데이터 아티팩트(.sig / latest.json)를 서명·게시하면 기존 사용자는 인앱 자동 업데이트로 받는다.

## 검증

- `pnpm typecheck` / `pnpm lint` / `pnpm build` exit 0, `pnpm test` 600건 통과(49 파일).
- `cargo test --test plugin_manifest` 7건 통과 — 버전 동기 2건 포함.
- 잔여 `2.8.0` 참조를 저장소 루트에서 재확인(첫 grep 은 cwd 가 `src-tauri` 로 남아 있어 거짓 통과했다 — 다시 돌림). 남은 건 랜딩 업데이트 목록의 v2.8.0 이력 항목뿐, 의도된 것.
- 태그 푸시 후 Actions 릴리스 워크플로 기동 확인(run 30684085653).