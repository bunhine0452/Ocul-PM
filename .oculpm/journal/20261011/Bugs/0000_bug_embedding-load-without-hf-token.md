---
schema_version: 1
type: bug
slug: "embedding-load-without-hf-token"
status: done
difficulty: medium
created_at: "2026-10-11T00:00:36+09:00"
session_id: "mcp-20261011-000036"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "8ea7b9ae-c829-4853-a394-c185809e360d"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/embedding.rs"
    op: update
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/Cargo.lock"
    op: update
  - path: "src-tauri/tests/egress_inventory.rs"
    op: update
related:
  - ref: "20261008/Chores/1830_chore_perf-security-audit.md"
    kind: "followup"
tags:
  - "security"
  - "embedding"
  - "egress"
  - "mcp-tool"
---
[x] 임베딩 모델 로드가 사용자의 HF 토큰을 읽어 Bearer 로 붙이던 것 — 로컬 로드 + 토큰 없는 다운로드

## 발생 원인
fastembed 5.13.4 의 `try_new` 는 `pull_from_hf` 에서 `ApiBuilder::new()` 를 부른다(`common.rs:176`). 이것이 `Cache::default()` 를 거쳐 `$HOME/.cache/huggingface/token` 을 로드마다 읽는다(hf-hub 0.5 `lib.rs:69`). 토큰이 있으면 모든 요청에 Bearer 로 붙인다(`api/sync.rs:331`).
- 캐시가 적중해도 빌더를 만드니 토큰을 매번 읽는다.
- `HF_HOME` 은 캐시 폴더만 바꾸고 토큰 경로에는 영향이 없다.
- fastembed `InitOptions` 에는 토큰이나 빌더를 넘길 자리가 없다.

## 해결 방법
- 캐시가 온전하면 `hf_hub::Cache::new(앱캐시).repo().get()` 으로 경로만 해석한다(파일시스템만 본다). 그 바이트로 `try_new_from_user_defined` 를 부르고 hub 클라이언트는 만들지 않는다. 세션 옵션(Level3 · 전체 코어)은 `try_new` 와 같다. 풀링 · 양자화 · output_key 는 fastembed 모델 정보에서 가져오고, max_length 는 256 이다.
- 캐시에 없을 때만 `ApiBuilder::from_cache(앱캐시).with_token(None)` 으로 빠진 파일을 받는다. `HF_ENDPOINT` 미러는 그대로 존중한다.
- 새 송출 자리는 없다. 원장 어휘와 사유를 사실로 고쳤다.
- 합류하며 시험 하나를 더했다. 로컬 로드는 onnx 바이트만 넘기고 부속 파일(외부 초기화 데이터)은 잇지 않는다. 그런 모델로 바꾸는 날 먼저 깨지도록 `active_model_has_no_additional_files` 로 잠갔다.
- 동작 변화가 둘 있다. 로드 순간 onnx 크기(약 135MB)만큼 잠시 더 올라간다. `HF_HOME` 환경 변수는 이제 앱 캐시 폴더를 덮지 않는다.
- 병렬 레인(Sonnet 5.5)이 구현했다. PR #83.

## 검증
- 설치본 캐시를 복사해 `#[ignore]` 시험으로 실모델을 오프라인 로드했다. 384 차원이 나왔다. 단위 시험 3건이 통과했다.
- 실제 첫 다운로드에서 Authorization 이 빠지는지는 코드와 hf-hub 단위 시험으로만 확인했다. 로드 뒤 상주 메모리는 재측정하지 못했다.