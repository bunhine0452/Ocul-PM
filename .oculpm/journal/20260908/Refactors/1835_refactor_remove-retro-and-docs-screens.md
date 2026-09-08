---
schema_version: 1
type: refactor
slug: "remove-retro-and-docs-screens"
status: done
difficulty: high
created_at: "2026-09-08T18:35:28+09:00"
session_id: "20260908-005"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "0986becb-221e-4316-bcf0-f7da94a7754a"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/retro/"
    op: delete
  - path: "src/features/docs/"
    op: delete
  - path: "src-tauri/src/commands/retro.rs"
    op: delete
  - path: "src-tauri/src/commands/docs.rs"
    op: delete
  - path: "src-tauri/src/oculpm/retro_file.rs"
    op: delete
  - path: "src-tauri/src/oculpm/defer_ledger.rs"
    op: delete
  - path: "src-tauri/src/oculpm/evals.rs"
    op: delete
  - path: "src-tauri/src/commands/fsutil.rs"
    op: create
  - path: "src-tauri/migrations/038_drop_retro_insights.sql"
    op: create
  - path: "src/features/skills/RuleCandidates.tsx"
    op: rename
  - path: "src/features/skills/SkillCandidates.tsx"
    op: rename
  - path: "src/lib/navRegistry.ts"
    op: update
  - path: "src/contexts/uiV2View.ts"
    op: update
  - path: "src/features/shell/ShellV2.tsx"
    op: update
  - path: "src/features/shell/screens.ts"
    op: update
  - path: "src/components/CommandPalette.tsx"
    op: update
  - path: "src-tauri/src/oculpm/watcher.rs"
    op: update
  - path: "src-tauri/src/oculpm/spec.rs"
    op: update
  - path: "src-tauri/tests/egress_inventory.rs"
    op: update
  - path: "src/__tests__/uiv2view_route_safety.test.ts"
    op: update
related: []
tags:
  - "ia"
  - "deletion"
  - "retro"
  - "docs"
  - "editor"
  - "mcp-tool"
---
[x] 회고·문서 화면을 걷어내고 편집기 강화 자리를 비운다

## 동기

편집기를 Cursor·Antigravity 급으로 끌어올리기로 하면서, 그 앞에 화면 두 개를
정리했다. 회고는 신호 집계·생성·Notion 내보내기까지 표면이 컸는데 쓰임이 그에
못 미쳤고, 문서는 `docs/` 가 없는 프로젝트에서 **영구 빈 화면**이었다 (2026-09-06
IA 재편에서 이미 ⌘번호를 회수당한 자리다).

편집기 방향은 VS Code 대규모 포크(Cursor 방식)를 검토하고 **기각**했다 — 워크벤치는
Electron 전용이라 포크는 곧 Tauri 폐기 + 앱 전체 재작성이고, MS 마켓플레이스는
ToS 상 못 쓰며(Cursor·Windsurf 전부 Open VSX), 월간 리베이스는 1인 유지 규모를
넘는다. 대신 **CodeMirror → Monaco 이관**으로 간다: Monaco 는 VS Code 의 에디터
위젯 그 자체이고 MIT·npm·WKWebView 호환이라 Tauri 와 Rust 백엔드를 그대로 두고
`lsp_*` 17개 커맨드를 재사용할 수 있다.

## 변경 요약

**삭제** — `features/retro/` · `features/docs/` · `commands/retro.rs` ·
`commands/docs.rs` · `oculpm/retro_file.rs`. 회고 커맨드가 유일한 소비처였던
`oculpm/defer_ledger.rs` · `oculpm/evals.rs` 도 고아가 되어 함께 뺐다.
`RetroInsight` 와 그 DB 메서드 두 개, `OculpmDataArea::Retro`, i18n 키 116개(양
언어), 테스트 6개.

**구해낸 것** — `RuleCandidates.tsx` · `SkillCandidates.tsx` 는 회고 폴더에 살았을
뿐 **스킬 화면의 `ContextInbox` 가 쓰는 패널**이라 `features/skills/` 로 옮겼다.
`natural_cmp` · `mime_for` 는 코드 화면 트리와 `code_asset` 미리보기가 빌려 쓰던
docs 소유 헬퍼라 중립 모듈 `commands/fsutil.rs` 로 이관했다 — 사라지는 화면의
모듈에 살아 있는 화면이 의존하면 삭제가 매번 막힌다.

**마이그레이션** — `022_retro_insights.sql` 은 등록된 채 남기고(번호 재사용 금지,
`migration_registry_matches_disk` 가 문다) `038_drop_retro_insights.sql` 이 테이블을
떨군다. 잃는 데이터는 없다 — 본문 SSOT 는 `.oculpm/retro/*.md` 였고 테이블은 파생
캐시였다. 그 파일들은 **사용자의 것이라 지우지 않는다.**

## 삭제가 열어 놓을 뻔한 두 구멍

**① 삭제된 화면에 머물던 사용자.** `uiV2View` 는 프로젝트마다 영속된다. 마지막으로
회고를 보고 있었다면 업데이트 후 그 값을 그대로 들고 오는데, 걸러지지 않으면
라우터의 ternary 사슬이 전부 빗나가 툴바도 본문도 없는 빈 화면에 갇힌다.
`migrateUiV2View` 가 이미 막고 있었지만 **그게 이 삭제의 안전망이라는 사실이 어디에도
안 적혀 있었다** — `uiv2view_route_safety` 에 `retro`/`docs` 를 명시적으로 못 박았다.

**② 남은 회고 마크다운의 역류.** `.oculpm/retro/**` 를 데이터 영역에서 빼기만 하면
남은 파일이 **코드 변경 ndjson 파이프라인으로 새어** 정직성 감사의 가짜 "누락" 행으로
되살아난다 (그 경로를 데이터 영역으로 승격한 원래 이유가 그것이었다). 워처의
`is_agent_state_path` 삼킴 조건에 합류시켜 막았다 — 별도 블록으로 두면 파일 크기
래칫(2164줄)을 넘겨서, 조건 하나로 접은 것이 크기와 정확성 양쪽에 맞았다.

## 이월 (릴리스 시점 작업)

랜딩 ko/en · README ko/en · `landing/wiki-src/{retro.md,en/retro.md}` 는 **손대지
않았다.** 이 표면들은 지금 다운로드되는 v2.45.2 를 설명하고, 그 버전에는 두 화면이
아직 있다. 버전 bump·CHANGELOG 와 같은 커밋에서 함께 고쳐야 한다.

**Notion 내보내기의 유일한 트리거가 회고 화면이었다.** 백엔드 `notion_export` 와
설정 섹션은 그대로 뒀다 — 커맨드를 지우는 건 이 요청 범위 밖이지만, 지금은 켤 수는
있는데 누를 곳이 없는 상태다. 다른 화면으로 옮기거나 접는 판단이 필요하다.

`automation/seeds.rs` 의 「월간 회고」 시드는 **화면이 아니라 일지를 쓰는 스케줄
작업**이라 남겼다. 다만 지시문이 사라진 신호 표면("회고 신호(출시·저항·노력
핫스팟)")을 가리키고 있어 그 문구만 걷었다.

## 검증

`cargo test` 1424 통과 (bindings.ts 재생성 확인 — 회고·문서 커맨드 소멸).
`pnpm typecheck` · `pnpm test` 2457 통과. lint 6게이트 중 storage·bindings·design·js
통과, i18n·filesize 에 남은 위반은 **병렬 세션의 미커밋 논의 CAS 작업**
(`mobile_pairing_poll.test.tsx` · `write_conflict_contract.test.ts` ·
`DiscussionScreenV2.tsx` 852줄)이고 내 변경분에는 없다 — `git stash` 로 HEAD 를
재현해 i18n 게이트가 그 전부터 exit 1 이었음을 확인했다.

egress 원장이 예상대로 셋을 잡았다: `CALL_SITE_FILES` 24→23, 원장의
`commands/retro.rs` 프롬프트 자리, `docs.example.com` 픽스처 호스트. 셋 다 같은
커밋에서 갱신했다.