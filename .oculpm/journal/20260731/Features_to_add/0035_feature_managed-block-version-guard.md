---
schema_version: 1
type: feature
slug: "managed-block-version-guard"
status: done
difficulty: medium
created_at: "2026-07-31T00:35:42+09:00"
session_id: "mcp-20260731-003542"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/atomic_io.rs"
    op: update
  - path: "src-tauri/src/oculpm/manager.rs"
    op: update
  - path: "src-tauri/src/oculpm/agents/mod.rs"
    op: update
related: []
tags:
  - "managed-block"
  - "gitignore"
  - "privacy"
  - "plugin-round"
  - "mcp-tool"
---
[x] managed-block 버전 가드 + gitignore union 병합 — 구버전 downgrade 노출 경로 차단 (A0a)

## 추가 기능

plugin-round A0a (#managed-block-versioning). 구버전 앱이 관리 블록을 자기 기준으로 다시 써서 신버전이 추가한 항목을 지우는 구조적 위험 — 특히 `.gitignore` 블록에서 `.oculpm/hooks/` 가 빠지면 훅 인박스의 대화 payload 가 public repo 에 커밋될 수 있는 프라이버시 사고 경로 — 를 이중으로 차단:

1. **다운그레이드 가드** (`atomic_io.rs`): `write_managed_block` 이 기존 블록 begin 마커의 버전을 파싱해 `MANAGED_BLOCK_VERSION`(현재 1) 보다 새 블록이면 파일을 건드리지 않고 새 `ManagedBlockResult::SkippedNewer` 를 반환. 렌더러의 하드코딩 `1` 도 상수로 통일.
2. **gitignore union 병합** (`manager.rs::merged_gitignore_body`): 블록 본문을 canonical 항목과 기존 블록 내용의 합집합으로 구성 — 신버전이 추가한 미지의 항목이 이 빌드의 재작성에서 살아남는다. 라인은 원문 보존(gitignore 의 backslash-quoted 공백 의미 유지), canonical 본문에 순서 의존 `!` 부정 패턴 금지를 테스트로 잠금 (union 이 뒤에 append 하는 구조라 순서 의존이면 깨짐).
3. `agents/mod.rs::apply_write` 가 `SkippedNewer` 를 "unchanged"+현 디스크 해시로 보고 — 드리프트 감지가 신버전 콘텐츠를 사용자 변조로 오인하지 않음 (리뷰 에이전트가 drift 배선까지 추적 확인).

## 동작 흐름

init_project → `read_managed_block` 으로 기존 블록 확보(orphan 마커는 기존과 동일하게 락 해제 후 에러) → union 본문 계산 → `write_managed_block` → 버전이 더 새 블록이면 SkippedNewer(파일 불변, wrote_gitignore=false).

## 검증

- 신규 테스트 5: 다운그레이드 거부(byte-identical), init 경유 미지 라인 보존·무중복, v99 블록 불변, `!` 부정 패턴 금지 불변식, verbatim 보존(escaped trailing space).
- cargo test 전체 464 그린. 적대 리뷰(rust-reviewer) MEDIUM 2건(trim 이스케이프 파괴·순서 재배열 문서화) 반영 완료.

## 메모

이미 배포된 구버전(가드 없음)은 소급 불가 — 가드는 지금부터의 빌드가 미래 버전의 블록을 보호하는 forward-only 장치. 버전 bump 는 가드가 충분히 배포된 뒤에만.