---
schema_version: 1
type: bug
slug: "seeded-event-runtime-lifecycle"
status: done
difficulty: high
created_at: "2026-10-09T05:02:28+09:00"
session_id: "20261009-003"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "4450d61f-8efa-44ff-b9ec-4e171492ed94"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/hooks/useSeededEvent.ts"
    op: create
  - path: "src/contexts/useCurrentSession.ts"
    op: create
  - path: "src/api/session.ts"
    op: create
  - path: "src/__tests__/helpers/fakeTauriEvents.ts"
    op: create
  - path: "src/__tests__/seeded_event.test.tsx"
    op: create
  - path: "src/windows/TabbedWindow.tsx"
    op: update
  - path: "src/features/shell/ShellV2.tsx"
    op: update
  - path: "src/features/settings/automation/AutomationTab.tsx"
    op: update
  - path: "src/features/code/useLsp.ts"
    op: update
  - path: "src-tauri/src/commands/window/lifecycle.rs"
    op: update
  - path: "src-tauri/src/commands/diff.rs"
    op: update
  - path: "src-tauri/src/db/startup.rs"
    op: create
  - path: "src-tauri/src/db/mod.rs"
    op: update
  - path: "src-tauri/src/commands/current_session.rs"
    op: create
  - path: "src-tauri/src/commands/project.rs"
    op: update
  - path: "landing/privacy.html"
    op: update
related:
  - ref: "20261009/Bugs/0407_bug_code-exec-boundary-acp-git-plugin.md"
    kind: "followup"
tags:
  - "event-race"
  - "lsp"
  - "dap"
  - "db"
  - "security"
  - "mcp-tool"
---
[x] 이벤트로만 세우던 상태 다섯 · 닫아도 남던 언어 서버 · 블로킹 diff · 설명 없는 DB 크래시

## 발생 원인

2026-10-09 보완점 리포트의 「이벤트 경합 · 수명」 묶음. 모두 코드로 확인했다.

- **이벤트로만 세우는 상태** — 3.10.0 「신뢰하고 켜기」 칩과 같은 유형이다. `listen` 은 비동기로 붙는다. 그래서 창이 생기기 전이나 구독이 붙기 전에 지나간 이벤트는 사라진다. 반대로 먼저 묻고 나중에 구독하면, 늦게 돌아온 답이 그 사이의 새 이벤트를 덮는다. 걸린 자리:
  - 현재 세션(WorkspaceContext): 명령 팔레트가 「활성 세션 없음」 이라고 답했다.
  - 탭 바쁜 점
  - ShellV2 창 목록 둘
  - 자동화 「실행 중」
  - LSP 칩: 언어를 가리지 않아 Python 상태가 `.ts` 칩을 덮을 수 있었고, 붙은 뒤에는 상태를 묻지 않았다.
- 테스트 셋업의 `listen` 이 아무것도 안 해서, 이 유형은 테스트로 원리적으로 볼 수 없었다.
- **LSP·DAP** — `stop_project` 를 설정 명령만 불렀다. 그래서 탭을 닫거나 프로젝트를 지우거나 앱을 꺼도 rust-analyzer 가 남았다. `process::exit` 에서는 `kill_on_drop` 도 돌지 않는다.
- **diff.rs** — `async fn` 안에서 동기 git, 16MB `fs::read`, diff 렌더를 그대로 불렀다. `git.rs` 만 `blocking()` 으로 감싸 둔 상태였다.
- **DB** — `Db::open().expect` 였다. 그래서 잠긴 DB·손상·상위 스키마가 전부 설명 없는 크래시가 됐고, 파괴적 마이그레이션 앞에 사본도 없었다.

## 해결 방법

- `useSeededEvent(spec, deps)` 는 순서를 하나로 강제한다: 구독을 붙이고 → 붙은 뒤 묻고 → 묻는 사이 `touch(key?)` 된 자리는 답을 버린다. 위 다섯 자리에 적용했다.
  - 현재 세션은 새 명령 `oculpm_current_session` 과 `sessionApi` 를 쓴다. `oculpmApi` 와 따로 둔 것은 화면 테스트의 부분 목이 이 셋을 몰라도 되게 하려는 것이다.
  - 탭 바쁜 점은 프로젝트 id 를 키로 쓴다.
  - LSP 는 언어 필터와 `stateSeqRef` 순번으로 막았다.
  - `setCurrentSession` 은 같은 값이면 커밋하지 않는다. workday 롤오버 테스트의 리렌더 횟수를 지키기 위해서다.
- `fakeTauriEvents`(tauriBus): `listen` 이 한 틱 뒤에 붙고, 붙기 전 `emit` 은 `dropped` 로 버려진다.
- 닫기는 `stop_code_servers` 로 내린다(동기 창 훅은 spawn). 삭제 경로에서도 부른다. 종료 때는 `stop_code_servers_blocking` 이 LSP `stop_all(1.5초 유예)` 과 DAP `stop_all` 을 동시에 돌린다(최대 2초).
- 공용 `commands::blocking()` 을 만들어 diff.rs 전 경로와 테마 강조색 `defaults` 에 썼다.
- DB:
  - `user_version > 최신` 이면 거부한다.
  - DROP TABLE·DROP COLUMN·DELETE FROM 이 남은 마이그레이션 앞에서 `VACUUM INTO <db>.bak-v<n>` 사본을 하나만 남긴다.
  - `db::startup::open_or_ask` 는 rfd 대화상자를 쓴다. dialog 플러그인의 `blocking_show` 는 셋업 메인 스레드에서 교착하기 때문이다. 「새로 시작」 은 원본을 `.broken-<초>` 로 옮기기만 한다.
- `read_file_range` 가 `is_secret_file_name` 을 거부한다(모바일 브리지).
- 개인정보·랜딩 FAQ(ko·en)의 테마 출처에 oculpm.com 을 넣었다.
- 래칫 맞춤: `lib.rs`·`oculpm.rs`·`WorkspaceContext.tsx` 가 늘지 않게, 새 코드를 `db::startup`·`commands/current_session.rs`·`useCurrentSession.ts` 로 냈다.

## 검증

- seeded_event 4건: 창 생성 전에 시작된 세션, 종료 이벤트가 낡은 답을 이김, 추적 전 프로젝트는 구독만, 키 단위 버림.
- code_trust 에 LSP 3건을 더했다.
- db: 상위 스키마 거부, 사본 하나, 파괴 판정. startup: 옮기기. project: 비밀 파일 거부.
- typecheck · vitest 3,307 · lint · build · cargo test 2,029 모두 exit 0 (PR #81).
- 실기기 미확인: LSP·DAP 실제 종료, DB 대화상자.