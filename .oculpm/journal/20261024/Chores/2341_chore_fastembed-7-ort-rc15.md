---
schema_version: 1
type: chore
slug: "fastembed-7-ort-rc15"
status: done
difficulty: medium
created_at: "2026-10-24T23:41:50+09:00"
session_id: "20261024-007"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "917068e0-0c64-47b9-bd9d-59d40990f787"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/Cargo.toml"
    op: update
  - path: "src-tauri/Cargo.lock"
    op: update
  - path: "src-tauri/tests/perf_baseline.rs"
    op: update
related: []
tags:
  - "deps"
  - "embedding"
  - "mcp-tool"
---
[x] fastembed 5.17 → 7.5 · ort rc.12 → rc.15 — 벡터 동일(코사인 0.9999995), 색인 재생성 불필요

## 변경 요약

다음 후보 7(플랜 `optimize-round-20261024` #next-fastembed7). 크레이트에 CHANGELOG 가 없어 소스로 대조.

- fastembed 5.13.4 → 7.5.0, 측정용 직접 의존 ort `=2.0.0-rc.12` → `=2.0.0-rc.15`(fastembed 7 이 고정한 판). hf-hub 0.5 그대로.
- 앱 코드(`embedding.rs` 의 사용자 정의 모델 로드 경로)는 수정 없이 컴파일. 깨진 곳은 ort 를 직접 쓰는 `perf_baseline` 하나 — rc.15 부터 `Session::builder(&Environment)` → `ort::init().build()`(fastembed 의 `default_environment` 와 같은 모양), 폐기된 `InitOptions` → `TextInitOptions`.

## 검증

- 같은 8문장을 앱 캐시 모델로 5.17.3 · 7.5.0 각각 3회: **최소 코사인 0.9999995**, 최대 절대 차 0.00016 → 기존 벡터 그대로 써도 된다(재색인 없음). 로드 420~483 → 454~522ms, 임베딩 27 → 24~26ms, 로드 뒤 풋프린트 589 → 592MB — 사실상 같다.
- clippy -D warnings · cargo test --locked --no-fail-fast 실패 0 · cargo-deny.