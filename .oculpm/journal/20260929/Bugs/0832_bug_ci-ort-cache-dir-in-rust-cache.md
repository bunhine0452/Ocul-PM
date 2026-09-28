---
schema_version: 1
type: bug
slug: "ci-ort-cache-dir-in-rust-cache"
status: done
difficulty: medium
created_at: "2026-09-29T08:32:47+09:00"
session_id: "20260929-006"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ed4447b7-7384-4a70-82ba-26748d6773e1"
language: "ko"
verified_by_user: false
files_touched:
  - path: ".github/workflows/ci.yml"
    op: update
  - path: ".github/workflows/portability.yml"
    op: update
  - path: ".github/workflows/release.yml"
    op: update
  - path: ".github/workflows/e2e.yml"
    op: update
  - path: ".gitignore"
    op: update
related:
  - ref: "20260929/Features_to_add/0605_feature_release-v3-6-0-windows-linux-beta.md"
    kind: "followup"
tags:
  - "ci"
  - "cross-platform"
  - "windows"
  - "release"
  - "mcp-tool"
---
[x] CI — 복원된 target 이 없는 ONNX Runtime 폴더를 링크하던 것, 다운로드 자리를 rust-cache 안으로 (PR #63)

## 발생 원인

v3.6.0 릴리스 커밋(e1d0b3ab)의 main push 에서 portability 의 `사이드카 — windows-latest` 가 `could not find native static library onnxruntime` 으로 붉었다. 릴리스 run 자체는 전 잡 success 였다.

- rust-cache 가 `target` 을 full match 로 복원하면 `ort-sys` 빌드 스크립트는 다시 돌지 않는다.
- 스크립트가 남긴 `rustc-link-search` 는 ONNX Runtime 사전 빌드를 받아 둔 러너 사용자 캐시 폴더(ort-sys 의 `cache_dir()` 기본값)를 가리킨다. 그 폴더는 캐시에 없다.
- `ORT_CACHE_DIR` 은 `rerun-if-env-changed` 대상이 아니라서, 변수만 바꿔서는 옛 캐시가 스스로 고쳐지지 않는다.
- 같은 모양이 release.yml 번들 잡에서 나면 그 판에서 Windows 가 빠진다.

## 해결 방법

- ci · portability · release · e2e 최상위 `env: ORT_CACHE_DIR: ${{ github.workspace }}/.ort-cache` 를 두었다.
- rust-cache 7곳에 `cache-directories` 를 넣어 다운로드 자리를 target 과 함께 저장한다.
- 옛 캐시는 `prefix-key: v1-rust-ort` 로 한 번 버린다. `.gitignore` 에 `/.ort-cache/` 를 넣었다.

## 검증

- 첫 run(캐시 없음 → 저장, Cache Paths 에 `.ort-cache` 포함) 전 잡 success.
- **같은 run 재실행**(attempt 2)에서 사이드카·번들·Rust 세 Windows 잡이 `full match: true` 로 복원한 채 success 했다. 원래 실패하던 경로다. 업데이터·설치 스모크도 양 OS 에서 success.
- PR #63 18체크 pass, rebase 병합(2f989e47).