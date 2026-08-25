---
schema_version: 1
type: refactor
slug: "cache-module-split"
status: done
difficulty: medium
created_at: "2026-08-25T21:02:00+09:00"
session_id: "manual-20260825-210200"
agent:
  id: "claude-code"
  version: "Opus 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/cache.rs"
    op: delete
  - path: "src-tauri/src/oculpm/cache/mod.rs"
    op: create
  - path: "src-tauri/src/oculpm/cache/query.rs"
    op: create
  - path: "src-tauri/src/oculpm/cache/stats.rs"
    op: create
  - path: "src-tauri/src/oculpm/cache/write.rs"
    op: create
  - path: "src-tauri/src/oculpm/cache/files.rs"
    op: create
  - path: "src-tauri/src/oculpm/cache/reindex.rs"
    op: create
  - path: "src-tauri/src/oculpm/cache/conv.rs"
    op: create
  - path: "src-tauri/src/oculpm/cache/tests.rs"
    op: create
related: ["20260825/Refactors/2047_refactor_db-module-split.md"]
tags: ["refactor", "module-boundary", "oculpm", "cache"]
---

[x] cache.rs 3,435줄을 8개 파일로 분할 — Phase 2 백엔드 경계 정리 완료

## 동기

외부 리뷰가 지적한 비대 모듈 3종의 마지막. `impl<'a> JournalCache<'a>` 단일 블록에
25개 메서드 1,588줄이 있고, 쓰기·조회·파일축·집계·재색인이 한 파일에 섞여 있었다.

## 변경 요약

`cache.rs` → `cache/` 디렉터리:

| 파일 | 줄 | 내용 |
|---|---|---|
| `mod.rs` | 642 | DTO 6종 · `JournalCache` · row 스냅샷 타입/impl · new/with_redaction/with_tz/project_text (4) |
| `query.rs` | 404 | 목록·단건·개수·경로별 요약·기간 조회 (5) |
| `stats.rs` | 400 | 변경 그룹화·관측 에이전트·개요 통계 (3) |
| `write.rs` | 333 | 업서트·삭제·줄수 기록·경로 변경 반영 (4) |
| `files.rs` | 235 | 세션/엔트리/작업일 기준 touched 파일·줄수 (6) |
| `reindex.rs` | 191 | 전체/증분 리빌드·mtime 로드 (3) |
| `conv.rs` | 175 | 순수 변환 16종 — 작업일·타임스탬프 파싱, enum↔문자열, SQLite 오류 매핑 |
| `tests.rs` | 1,114 | 기존 `mod tests` 그대로 |

첫 분할에서 `mod.rs` 가 808줄로 800줄 상한을 8줄 넘겨, 순수 변환 헬퍼 16개를
`conv.rs` 로 다시 뺐다(642줄). 이때 `fn` → `pub(super) fn` 이 되지만 **가시 범위는
그대로다** — `cache::conv` 의 `pub(super)` 는 `cache` 와 그 자손에서만 보이고, 그건
분할 전 `cache` 에 private 이던 범위와 정확히 같다.

## 검증

- **공개 표면 동일** — `pub`/`pub(crate)` 시그니처 정렬 비교 diff 없음, **34개 그대로**.
- **테스트 동일** — `cargo test` 18스위트 **888 passed / 0 failed / 7 ignored**.
- **bindings 무변경** — drift 없음.
- 컴파일 에러 0 · 경고 0(첫 시도부터). 프런트 게이트 4종 exit 0.

## Phase 2 결산

세 파일 모두 끝났다. 실코드가 800줄을 넘는 백엔드 파일이 사라졌다.

| | 전 | 후(최대 구현 파일) |
|---|---|---|
| manager | 4,514줄 1파일 | 571줄 (7파일) |
| db | 3,292줄 1파일 | 690줄 (9파일) |
| cache | 3,435줄 1파일 | 642줄 (8파일) |

세 번 다 같은 방식으로 단언했다 — 시그니처 집합 정렬 비교(56·107·34개 전부 diff
없음) · 테스트 수 불변(888/0/7) · bindings drift 없음. 리팩터링 중 **로직은 한 줄도
고치지 않았고**, 손댄 것은 이동이 강제한 두 가지뿐이다: db 의 `include_str!` 경로
27개, 그리고 이름 충돌로 개명한 `manager::session_ops`.

## 메모

CI 실측 갱신 — 웜 실행에서 Rust 잡 **2분 52초**(콜드 10분 31초), 프런트 **2분 28초**.
`cache-on-failure: true` 를 켠 뒤 캐시가 정상 동작한다. 계획서의 "웜 5분 초과 시
잡 분리" 문턱에 한참 못 미치므로 추가 조정은 불필요하다.
