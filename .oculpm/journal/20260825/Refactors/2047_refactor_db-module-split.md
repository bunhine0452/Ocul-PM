---
schema_version: 1
type: refactor
slug: "db-module-split"
status: done
difficulty: medium
created_at: "2026-08-25T20:47:00+09:00"
session_id: "manual-20260825-204700"
agent:
  id: "claude-code"
  version: "Opus 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/db.rs"
    op: delete
  - path: "src-tauri/src/db/mod.rs"
    op: create
  - path: "src-tauri/src/db/code_index.rs"
    op: create
  - path: "src-tauri/src/db/graph.rs"
    op: create
  - path: "src-tauri/src/db/planning.rs"
    op: create
  - path: "src-tauri/src/db/chat.rs"
    op: create
  - path: "src-tauri/src/db/changes.rs"
    op: create
  - path: "src-tauri/src/db/projects.rs"
    op: create
  - path: "src-tauri/src/db/settings.rs"
    op: create
  - path: "src-tauri/src/db/tests.rs"
    op: create
  - path: ".github/workflows/ci.yml"
    op: update
related: ["20260825/Refactors/2021_refactor_manager-module-split.md"]
tags: ["refactor", "module-boundary", "db", "ci"]
---

[x] db.rs 3,292줄을 9개 파일로 분할 + CI 캐시 개선 — 동작·시그니처 무변경

## 동기

외부 리뷰가 지적한 비대 모듈 3종 중 **실코드 기준으로 가장 큰 파일**. 전체 3,292줄
중 테스트가 107줄뿐이라 실코드가 3,184줄이고, `impl Db` 단일 블록 하나가 2,661줄에
79개 메서드를 담고 있었다. 설정·프로젝트·코드인덱스·그래프·대화·회고가 한 파일에서
뒤섞인다.

## 변경 요약

`db.rs` → `db/` 디렉터리 (도메인 8분할):

| 파일 | 줄 | 메서드 |
|---|---|---|
| `mod.rs` | 690 | 마이그레이션 상수 · `Db`/DTO 타입 전체 · row 매퍼 6 · open/conn/migrate/heal_columns/health (6) |
| `code_index.rs` | 653 | 파일·청크·심볼 업서트, 임베딩/FTS/엔티티 검색, 해시·스냅샷 (15) |
| `graph.rs` | 585 | 의존성·심볼 관계·그래프 재구축/조회·변경영향·호출 (9) |
| `planning.rs` | 434 | 목표·서브태스크·회고·블루프린트·대시보드 집계 (12) |
| `chat.rs` | 266 | conversation/chat_message CRUD·액션 기록 (9) |
| `changes.rs` | 238 | file_changes·일지 역참조·에이전트 상태 (8) |
| `projects.rs` | 207 | 프로젝트 CRUD·외형·overview (9) |
| `settings.rs` | 184 | settings_*·훅 오프셋·모바일 기기 (11) |
| `tests.rs` | 105 | 기존 `mod tests` 그대로 |

DTO 타입과 row 매퍼는 `mod.rs` 에 남겼다 — `db` 에 private 인 매퍼를 모든 자식이
쓰고, `crate::db::Project` 같은 외부 경로도 그대로 유지된다.

## 컴파일이 잡아낸 것

`MIGRATIONS` 의 `include_str!("../migrations/0NN_*.sql")` **27개**가 전부 깨졌다.
`include_str!` 은 소스 파일 기준 상대경로라 `src/db.rs` → `src/db/mod.rs` 로 한 단계
깊어지면서 `src/../migrations` 가 `src/db/../migrations` 로 어긋났다.
`../../migrations/` 로 고쳤다. 파일을 옮길 때 **경로 매크로가 조용히 따라오지 않는다**는
사례로 남긴다.

## CI 캐시 개선 (동승)

CI 2차 실행이 캐시를 못 타 또 콜드였다. `swatinem/rust-cache` 의 `cache-on-failure`
기본값이 `false` 라, 1차가 실패하면서 캐시를 저장하지 않았기 때문이다. 붉은 빌드를
고치고 다시 미는 흐름에서 매번 콜드가 되므로 `cache-on-failure: true` 를 켰다.

## 검증

manager 분할과 같은 3중 단언.

- **공개 표면 동일** — 분할 전후 `pub`/`pub(crate)` 시그니처 정렬 비교 → diff 없음,
  **107개 그대로**.
- **테스트 동일** — `cargo test` 18스위트 **888 passed / 0 failed / 7 ignored**.
- **bindings 무변경** — DTO 들이 `specta::Type` 이라 이동이 TS 생성물에 영향을 줄까
  걱정했는데, specta 는 경로가 아니라 **타입 이름**을 쓰므로 `git diff --exit-code
  src/lib/bindings.ts` 클린이었다.

컴파일 에러 0 · 경고 0. 프런트 게이트 4종도 exit 0 직접 확인.

## 메모

CI 실측(2차, 초록): 프런트 잡 **2분 36초**, Rust 잡 **10분 31초**(콜드). 웜은 다음
실행에서 확인한다. 남은 항목은 [#cache-split](cache.rs 2,318줄).
