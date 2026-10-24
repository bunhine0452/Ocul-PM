---
schema_version: 1
type: refactor
slug: "remove-periphery-four-features"
status: done
difficulty: high
created_at: "2026-10-24T19:00:16+09:00"
session_id: "20261024-003"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "917068e0-0c64-47b9-bd9d-59d40990f787"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/mobile_bridge"
    op: delete
  - path: "src-tauri/src/dap"
    op: delete
  - path: "src-tauri/src/commands/graph.rs"
    op: delete
  - path: "src/features/graph"
    op: delete
  - path: "src/mobile"
    op: delete
  - path: "extension"
    op: delete
  - path: ".github/workflows/extension-release.yml"
    op: delete
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/lib/navRegistry.ts"
    op: update
  - path: "CLAUDE.md"
    op: update
related: []
tags:
  - "refactor"
  - "scope-freeze"
  - "parallel-round"
  - "mcp-tool"
---
[x] 주변 기능 걷기 — 모바일 브리지·DAP 디버거·코드 맵·원격 테마 갤러리·VS Code 확장 (PR #90)

## 동기

사용자 지시 "필요없는 기능들을 과감하게 지워줘" — 외부 리뷰(2026-10-08) 걷기 후보 중 남은 다섯을 전부 걷었다(Notion 은 10-14 완료). 병렬 레인 3개(Opus 5.5·xhigh, worktree)로 나눠 오케스트레이터가 합류.

## 변경 요약

- **모바일 브리지**(−4.9k Rust, −4.6k TS 중 일부): `mobile_bridge/`·`commands/mobile.rs`·`src/mobile/`·설정 모바일 탭·PWA. axum·tower·tower-http·if-addrs·uqr 제거 → 앱은 네트워크에서 듣지 않는다. `mobile_devices` 테이블은 남김.
- **DAP 디버거**: `dap/`·`commands/dap.rs`·디버그 패널·중단점 거터. `code_rename`·`stop_code_servers` 에서 디버거 갈래만 덜어냄, LSP·framing 유지.
- **코드 맵**: `features/graph`·`commands/graph.rs`·그래프 전용 npm 6개·ast 관계 추출. 「영향 받는 파일」(`get_change_impact`)은 `commands/diff.rs`·`db/dependencies.rs` 로 남김. ⌘6 부터 한 칸 당김(`nav_remap_seen_2`). `graph_*`·`symbol_relations` 테이블 남김.
- **원격 테마 갤러리**: `theme_import_url`·`oculpm://theme/install`·THEME_HOSTS·랜딩 /themes(→ /wiki/settings redirect). 내장·전환·파일 가져오기 유지.
- **VS Code 확장**: `extension/`·게시 워크플로·릴리스 .vsix(자산 10→9)·앱 감지·딥링크 `entry`.
- 합류: 충돌 13파일(README·랜딩·CLAUDE.md·package.json·잠금·SettingsPanel·딥링크 테스트·egress). 글자 단위 자동 해소가 한국어 랜딩 FAQ 를 엉키게 해 되돌려 줄 단위(재작성 줄은 그쪽 채택)로 다시 풀었다. 설정 10탭, 벤토 52→51(낡은 「사이드바 15줄」 칸 제거). 합류 머지 대신 일직선 17커밋으로 다시 쌓아 PR(트리 동일 확인).

## 검증

- 합류 트리: typecheck · vitest 254/3256 · lint · build · cargo fmt · clippy -D warnings · cargo test --locked --no-fail-fast 실패 0 · cargo-deny · pnpm audit high 0. PR #90 CI 3잡 SUCCESS → rebase 머지 6e42ea61.