---
schema_version: 1
type: refactor
slug: "plan-reproject-skip"
status: done
difficulty: low
created_at: "2026-11-11T21:29:10+09:00"
session_id: "manual-20261111-212910"
agent:
  id: "claude-code"
  version: "Opus 5.5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/planner/project.rs"
    op: update
related: []
tags:
  - "planner"
  - "perf"
---
[x] 계획: 안 바뀐 투영은 다시 쓰지 않는다

## 동기
`today_digest` 를 비롯한 계획 읽기는 `reproject_all` 을 거친다. 이 함수는 부를 때마다 계획 파일을 전부 다시 읽고, 투영 표 넷의 행을 모두 지운 뒤 다시 넣었다. Today 를 새로 읽기만 해도 행 수백 개를 다시 썼다.

## 변경 요약
- 파일은 예전처럼 읽고 파싱한다. 호출부가 그 결과로 DTO 를 만들기 때문이다.
- 만든 행의 지문(blake3)을 (DB 주소, 프로젝트)별로 기억한다. 지문이 같고 표 넷의 행 수도 그대로면 DELETE + INSERT 를 건너뛴다.
- 행 수를 함께 보는 이유: 기억해 둔 지문이 이 DB 의 것이 아닌 경우(테스트의 새 DB, 지워진 프로젝트)를 잡는다.

## 검증
- `cargo test --lib -- spawn_count planner watcher` 142 passed (planner 투영 왕복 테스트 포함). 전체 lib 962 passed
- 건너뛴 횟수를 따로 재는 테스트는 없다. 행이 같은지는 기존 왕복 테스트로만 확인했다
