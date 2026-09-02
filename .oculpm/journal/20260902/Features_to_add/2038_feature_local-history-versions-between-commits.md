---
schema_version: 1
type: feature
slug: "local-history-versions-between-commits"
status: done
difficulty: high
created_at: "2026-09-02T20:38:06+09:00"
session_id: "20260902-008"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/history.rs"
    op: create
  - path: "src-tauri/src/commands/code_history.rs"
    op: create
  - path: "src-tauri/tests/oculpm_history.rs"
    op: create
  - path: "src-tauri/src/oculpm/watcher.rs"
    op: update
  - path: "src-tauri/src/commands/code.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src-tauri/src/oculpm/mod.rs"
    op: update
  - path: "src-tauri/src/commands/mod.rs"
    op: update
  - path: "src/api/codeHistory.ts"
    op: create
  - path: "src/features/code/CodeHistory.tsx"
    op: create
  - path: "src/features/code/useFileHistory.ts"
    op: create
  - path: "src/__tests__/code_history.test.tsx"
    op: create
  - path: "src/features/code/CodePane.tsx"
    op: update
  - path: "src/features/code/CodeScreenV2.tsx"
    op: update
  - path: "src/features/code/code.css"
    op: update
  - path: "src/features/settings/CodeSettings.tsx"
    op: update
  - path: "src/lib/settings.ts"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "scripts/check-bindings-imports.mjs"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags:
  - "code"
  - "local-history"
  - "watcher"
  - "vscode-borrows"
  - "mcp-tool"
---
[x] 로컬 히스토리 — 커밋 사이의 시간을 남긴다 (vscode-borrows Phase 6)

## 추가 기능

파일이 바뀔 때마다 그 시점 내용을 한 판 남기고, 코드 화면에서 판 목록을 보고,
하나를 고르면 지금 내용과 인라인으로 겹쳐 보고, 되돌린다.

이 라운드에서 **소급이 불가능한 유일한 항목**이다 — 안 찍어 둔 판은 영원히
없다. 지금 그 질문("이 파일이 오늘 어떻게 여기까지 왔나")에 답하는 수단은 셋 다
구멍이 있었다: git 은 커밋 사이를 못 보고(에이전트는 한 커밋 안에서 같은 파일을
열 번 고친다), 작업 일지는 일지를 쓴 작업 단위만 알고, `file_snapshots` 는
경로당 한 장뿐이다.

## 동작 흐름

- **저장 위치** — `.oculpm/index/history/<h2>/<h16>/` 에 `meta.json`(tmp→rename
  통째 교체) + 전문 스냅샷(`<ts_ms>-<hash8>.snap`). `entry_diffs` 와 같은 자리를
  고른 이유도 같다: 워처가 자기 억제하고, `.gitignore` 안이고, SQLite 캐시와
  달리 마크다운에서 재생성되지 않아 캐시를 지워도 살아남는다. **SQLite 테이블은
  만들지 않았다** — v1 의 질문은 전부 "이 파일 하나" 라 그 파일의 meta 한 장이면
  답이 난다.
- **캡처 지점은 워처 7.55 한 곳.** `should_track` 를 이미 통과했고, 해시가 이미
  계산돼 있어 중복이 공짜로 걸러지고, 무엇보다 **사람이 쓰든 에이전트가 쓰든
  거기를 지난다**. `code_write` 에는 걸지 않았다(이중 캡처가 된다) — 대신
  `HistoryState` 쪽지(TTL 5초 · 해시 일치 · 한 번 읽으면 소멸)로 **출처**만
  알려 준다. 되돌리기도 같은 쪽지를 남겨 사람의 저장으로 잡힌다.
- **보존** — 판당 256KB · 파일당 50판(설정) · 병합 창 10초 · 프로젝트 총 512MB.
  병합의 "같은 source" 조건이 이 설계의 심장이다: 자동 저장을 켜면 사람 저장은
  초 단위로 쌓이므로 접어야 하고, 반대로 **내 저장 직후의 에이전트 쓰기는 절대
  접으면 안 된다** — 그 경계가 바로 사용자가 보고 싶어 하는 지점이다. 판단
  전체(`decide_capture` · `plan_budget_eviction`)를 IO 없는 순수 함수로 떼어
  단위 테스트가 덮는다. 전역 예산 정리는 50회 캡처마다 한 번만 돌고, **파일마다
  최신 한 판은 남긴다**(예산 때문에 어떤 파일의 역사가 통째로 비는 것보다 낫다).
- **커맨드 6개** — list · read · restore · forget + 설정용 usage · clear.
  되돌리기도 `write_with_lock` 을 그대로 통과한다: 판을 되살리는 것이 남의 최신
  작업을 조용히 덮는 창구가 되면 안 된다(D7).
- **UI 는 자리를 둘만 쓴다** — 브레드크럼 시계 칩(판 수) + 팝오버(최신순 · 시각 ·
  출처 · 크기), 행 클릭은 `diffMode.kind="history"` 로 **기존 인라인 비교를 그대로
  재사용**한다. 되돌리기는 비교 배너에 두고 `useConfirm` 을 거친다 — 목록에서
  바로 누르면 무엇으로 바뀌는지 못 보고 누르게 된다. 미저장 편집이 있으면 그
  사실을 확인 문구에 적는다.
- **설정 2개** — `codeLocalHistory` 기본 **켜짐**(이 라운드의 유일한 예외 · 소급
  불가라서) · `codeLocalHistoryMaxEntries` 50, 그리고 **지금 쓰는 용량**과 "전부
  지우기". 보이지 않는 곳에서 디스크를 먹는 기능은 반드시 자기 크기를 보여 줘야
  한다.

## 구현 중 정해진 것

- **`ts` 는 경계에서만 십진 문자열.** specta 는 i64 를 그대로 못 내보내고
  (`docs/2026521/Errors/2026-05-21-specta-bigint-export.md`), f64 로 우회하면
  TS 에 `number | null` 로 샌다. 되돌려 받아야 하는 **신원 값**이 옵셔널이 되면
  안 되므로 커맨드 DTO(`CodeHistoryVersion`)에서만 문자열이고 디스크 meta 는 계속
  숫자다.
- **리네임은 `code_rename` 이 옮긴다.** 워처는 rename 을 경로별 Delete+Create 로
  흘려보내 둘을 잇지 못한다. 앱 안의 이름 바꾸기가 유일한 다리라 거기서 히스토리
  디렉터리째 옮기고(폴더 이름 바꾸기는 meta 의 `path` 접두로 하위 전부), 앱
  밖(터미널 `mv`)은 판이 옛 경로에 남는다.
- **macOS 의 원자적 저장은 rename 이라 기존 파일 저장도 Create 이벤트로 온다.**
  판이 이미 있으면 `create` 를 `update` 로 내려 그 거짓말을 되돌린다.
- **삭제는 판을 만들지도 지우지도 않는다** — 지운 파일의 내용을 되찾는 것이 이
  기능의 가장 좋은 순간이다.
- 색인 정리 경로가 `history/` 를 지우지 않는지 확인했다: `.oculpm/index/` 를
  디스크에서 지우는 흐름은 없고(031 마이그레이션은 SQLite 전용),
  `list_workdays` 는 `YYYYMMDD` 8자리 디렉터리만 센다.
- 곁들여 — 문제 패널(Phase 5)의 스냅샷이 배열이 아닐 때 `problemsStore.seed` 가
  터져 `pnpm test` 가 미처리 거부로 exit 1 이었다. `Array.isArray` 가드로 막았다.

## 검증

- Rust 통합 9건(`oculpm_history.rs`: meta+snap 한 장 · 같은 해시 중복 없음 ·
  같은 손 병합 vs 다른 손 비병합 · 캡에서 오래된 스냅샷까지 삭제 · 초과/바이너리/
  `.env` 제외 · 리네임 추적(파일·폴더) · 삭제해도 판 보존 · 예산 정리) + 순수
  단위 13건 + 워처 자기 억제 1건 + 프런트 15건.
- 게이트 전부 exit 0 — `pnpm typecheck` · `pnpm test`(158/2039) · `pnpm lint`
  4종 · `pnpm build` · `cargo test`(1200) · `cargo clippy -D warnings` ·
  `cargo fmt --check`.
- 육안 확인은 아직(설치본 도는 중 dev 빌드 금지) — Phase 7 의 한 바퀴에서 함께.