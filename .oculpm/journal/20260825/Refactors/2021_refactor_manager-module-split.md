---
schema_version: 1
type: refactor
slug: "manager-module-split"
status: done
difficulty: medium
created_at: "2026-08-25T20:21:00+09:00"
session_id: "manual-20260825-202100"
agent:
  id: "claude-code"
  version: "Opus 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/manager.rs"
    op: delete
  - path: "src-tauri/src/oculpm/manager/mod.rs"
    op: create
  - path: "src-tauri/src/oculpm/manager/lifecycle.rs"
    op: create
  - path: "src-tauri/src/oculpm/manager/journal.rs"
    op: create
  - path: "src-tauri/src/oculpm/manager/indexing.rs"
    op: create
  - path: "src-tauri/src/oculpm/manager/agents_sync.rs"
    op: create
  - path: "src-tauri/src/oculpm/manager/session_ops.rs"
    op: create
  - path: "src-tauri/src/oculpm/manager/tests.rs"
    op: create
related: ["20260825/Chores/1942_chore_feedback-triage-ci-plan.md"]
tags: ["refactor", "module-boundary", "oculpm", "manager"]
---

[x] manager.rs 4,514줄을 7개 파일로 분할 — 동작·시그니처 무변경

## 동기

외부 리뷰가 지적한 비대 모듈 3종 중 첫 번째. 52개 메서드가 **단일
`impl OculpmManager` 블록**에 몰려 있어 일지 CRUD·인덱싱·생명주기·에이전트 동기가
한 파일에서 뒤섞였다. Rust 는 같은 크레이트 안에서 고유 impl 을 여러 파일로 나눌
수 있으므로 공개 API 를 건드리지 않고 경계만 세울 수 있다.

## 변경 요약

`manager.rs` → `manager/` 디렉터리:

| 파일 | 줄 | 내용 |
|---|---|---|
| `mod.rs` | 495 | 타입 4종 · 상수 · 자유 함수 14개 · `new`/`plan_write_lock`/`lock_evicted_signal` + private 헬퍼 3개 |
| `lifecycle.rs` | 571 | init/status/config/종료 · 워처 기동·정지·건강성 (13) |
| `journal.rs` | 482 | 일지 경로·조회·검증·메타/본문 수정·수동 작성 (10) |
| `indexing.rs` | 424 | 캐시 재색인 · entry_diffs/line_counts/git 백필 · 집계 (8) |
| `agents_sync.rs` | 318 | AGENTS.md 동기·업그레이드·드리프트·레이어 비교 (7) |
| `session_ops.rs` | 223 | 세션 조회/수동 시작·종료 · 좀비 복구 (8) |
| `tests.rs` | 2,050 | 기존 `mod tests` 를 그대로 (4칸 내어쓰기만) |

각 자식 모듈은 `use super::*;` 뒤에 `impl OculpmManager { … }` 만 담는다. 메서드
본문은 한 줄도 고치지 않았다.

## 컴파일이 잡아낸 두 가지

1. **모듈명 충돌** — 자식을 `session.rs` 로 두니 헤더의
   `use crate::oculpm::session::{self, SessionActor}` 와 이름이 겹쳐 E0255. 자식을
   `session_ops` 로 바꿔 기존 임포트를 그대로 뒀다(호출부 무변경).
2. **private 헬퍼의 형제 접근** — `redact_patterns`·`tz_for`·`project_snapshot` 은
   `fn`(모듈 private)이라 형제 모듈에서 E0624. `pub(super)` 로 넓히는 대신 **셋을
   `mod.rs` 에 남겼다** — `manager` 에 private 인 항목은 모든 자손 모듈에서 보이므로
   가시성이 문자 그대로 그대로다.

## 검증

순수 이동임을 세 가지로 단언했다.

- **공개 표면 동일** — 분할 전(`git show HEAD:…/manager.rs`)과 분할 후 파일들에서
  `pub`/`pub(crate)` 시그니처를 뽑아 정렬 비교 → **diff 없음, 56개 그대로**.
- **테스트 동일** — `cargo test` 18스위트 **888 passed / 0 failed / 7 ignored**.
  분할 전 기준선과 숫자가 완전히 일치한다.
- **bindings 무변경** — `git diff --exit-code src/lib/bindings.ts` 클린.

컴파일은 **에러 0 · 경고 0**. 프런트 게이트 4종(typecheck·test·lint·build)도 전부
exit 0 을 직접 확인했다.

## 메모

분할 스크립트는 rustfmt 규약(메서드는 정확히 `    }` 로 닫힘)을 경계 파서로 썼고,
메서드 52개가 종결자 52개와 1:1로 맞는지, 배정 누락·오타가 없는지 assert 로 막았다.
남은 두 파일(db.rs 실코드 3,184줄 · cache.rs 2,318줄)은 플래너
[#db-split]·[#cache-split] 로 이어진다.
