---
schema_version: 1
type: chore
slug: "fastembed-7-deferred-linux-gcc"
status: done
difficulty: medium
created_at: "2026-10-25T00:18:08+09:00"
session_id: "20261025-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "917068e0-0c64-47b9-bd9d-59d40990f787"
language: "ko"
verified_by_user: false
files_touched: []
related: []
tags:
  - "deps"
  - "embedding"
  - "linux"
  - "mcp-tool"
---
[x] fastembed 7.5 보류 — ort rc.15 의 onnxruntime 정적 라이브러리가 ubuntu-22.04(GCC 11)에서 링크 실패 (PR #96 닫음)

## 변경 요약

다음 후보 7(#next-fastembed7). fastembed 5.13.4 → 7.5.0 · ort `=2.0.0-rc.12` → `=2.0.0-rc.15` 를 PR #96 으로 올렸다가 닫았다.

- macOS 에서는 좋았다: 같은 8문장·앱 캐시 모델·각 3회 비교에서 최소 코사인 0.9999995(재색인 불필요), 로드 420~483 → 454~522ms, 임베딩 27 → 24~26ms, 풋프린트 589 → 592MB. 앱 코드 수정 0, `perf_baseline` 만 rc.15 API.
- **Linux 에서 막혔다**: E2E(ubuntu-22.04) 「사이드카 (debug)」 의 `cargo build --bin oculpm-mcp` 가 `rust-lld: error: undefined symbol: std::__cxx11::basic_string<…>::_M_replace_cold(…)` (referenced by onnxruntime_c_api.cc.o). ort-sys rc.15 가 내려받는 onnxruntime 정적 라이브러리가 GCC 13 libstdc++ 를 요구하는데 Linux 판을 굽는 러너는 GCC 11.

## 다시 보려면

- Linux 빌드 기반을 ubuntu-24.04 로 올린다 — AppImage·deb 가 돌아가는 배포 범위가 좁아지므로 사용자 결정.
- 또는 ort `load-dynamic`(시스템/동봉 onnxruntime 공유 라이브러리를 런타임에 로드) — 패키징 변경.

## 검증

- PR #96 의 E2E(ubuntu) 실패 로그로 확인. macOS 로컬 게이트(clippy · cargo test · deny)는 통과했었다 — macOS 만 보고 머지했다면 다음 릴리스에서 리눅스 판이 또 빠졌다.