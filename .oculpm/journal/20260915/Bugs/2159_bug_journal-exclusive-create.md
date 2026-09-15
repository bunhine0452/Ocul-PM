---
schema_version: 1
type: bug
slug: "journal-exclusive-create"
status: done
difficulty: medium
created_at: "2026-09-15T21:59:30+09:00"
session_id: "20260915-006"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "b3815c20-72e0-4071-ae92-8bfdd74b590b"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/atomic_io.rs"
    op: update
  - path: "src-tauri/src/oculpm/error.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager/mod.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager/journal.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager/indexing.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools/mod.rs"
    op: update
  - path: "src-tauri/tests/journal_create_two_process.rs"
    op: create
  - path: "docs/major_update/oculpm/00-spec.md"
    op: update
related: []
tags:
  - "concurrency"
  - "journal"
  - "atomic_io"
  - "astra-feedback"
  - "parallel-session"
  - "mcp-tool"
---
[x] 신규 일지 생성이 exists→rename 창에서 다른 프로세스의 일지를 덮었다 — 배타적 게시(hard_link) + 2프로세스 테스트

## 발생 원인

Astra 리뷰 E06/S17 가설을 코드로 확인한 것. 일지 쓰기 진입점 3곳(MCP `journal_write` · 앱 수동 작성 `manager/journal.rs` · git 백필 `manager/indexing.rs`)이 모두 `pick_nonconflicting_path`(`exists()` 스캔으로 `base.md`→`__2`→…) 뒤 `write_atomic`(tmp+fsync+`rename`) 이었다. 스캔과 rename 사이에 창이 있어, 같은 분·유형·slug 로 두 OS 프로세스(앱+MCP, 또는 병렬 에이전트 세션의 MCP 둘)가 오면 둘 다 `base.md` 가 비었다고 보고 **뒤의 rename 이 앞의 일지를 조용히 교체**했다.

## 해결 방법

병렬 세션 R1 이 worktree 에서 구현, 커밋 `6ff2589`·`c08601a`.

- `atomic_io::write_atomic_new` — tmp+write+fsync 는 같고, 게시를 `hard_link(tmp → path)` 로 **배타적**으로 한다(있으면 `AlreadyExists`). 그 외 오류는 하드링크 없는 볼륨(exFAT·일부 네트워크 마운트)으로 보고 `rename` 으로 물러선다 — 그 FS 에서만 배타성을 잃는다고 주석에 명시(`file_guard::put_back` 과 같은 결). 모든 실패 경로에서 tmp 정리. 기존 `write_atomic` 은 제자리 교체용으로 그대로(스테이징을 `stage_tmp` 로 공유하면서 쓰기·fsync 실패 시 tmp 를 남기던 것도 정리됨).
- `OculpmError::is_already_exists()`.
- `manager/mod.rs::create_journal_file(dir, base, contents)` — `pick_nonconflicting_path` 를 접어 넣은 공통 헬퍼. 같은 번호 매기기(`base.md`, `__2`…`__999`, 타임스탬프 폴백)로 후보마다 `write_atomic_new` 를 시도, `AlreadyExists` 만 다음 이름으로, 다른 io 오류는 전파. 진입점 3곳 모두 교체, 반환 형태·MCP 오류 매핑 불변.
- `docs/major_update/oculpm/00-spec.md` §2.1 충돌 회피에 배타적 생성 명기, §6 "atomic rename" 에 예외 한 절.

## 검증

- `tests/journal_create_two_process.rs`(신규): 테스트 바이너리를 자식 `McpServer` 8프로세스로 재실행(`plan_cas_two_process` 수법), 3라운드 `journal_write` 를 전부 보낸 뒤 응답을 읽음. 불변식만 단언 — 반환 경로 전부 상이·존재, `.md` 24개, 본문 표식 24개 전부 보존, `.tmp` 없음. 둘째 테스트: 같은 base 로 16스레드 → 이름이 정확히 `{base, __2…__16}`, 본문 전부 온전.
- **헬퍼를 옛 exists→write_atomic 꼴로 잠시 되돌리자 두 테스트 모두 빨감**(8자식이 같은 경로를 받고 24개 중 3개만 생존 / 스레드 테스트는 `base.md` 하나만). 복구 뒤 3/3 통과 — 테스트가 결함을 잡는다는 증명.
- `cargo test --lib atomic_io` 14, `oculpm::manager::` 68(파일명 충돌 접미·백필 멱등 포함), `mcp::tools::tests::journal` 7, `plan_cas_two_process` 3 통과. `cargo fmt --check`·`clippy -D warnings` exit 0. 파일 크기 래칫 통과.
- 미검증: rename 폴백 경로는 하드링크 없는 FS 가 테스트 환경에 없어 실행 안 됨(기존 `write_atomic` 게시와 같은 코드라 위험 낮음).