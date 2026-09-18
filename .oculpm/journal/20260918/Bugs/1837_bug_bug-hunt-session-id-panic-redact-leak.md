---
schema_version: 1
type: bug
slug: "bug-hunt-session-id-panic-redact-leak"
status: done
created_at: "2026-09-18T18:37:24+09:00"
session_id: "20260918-001"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "02144d22-a518-4a7f-922a-6e2a1d78825d"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/session_id.rs"
    op: update
  - path: "src-tauri/src/oculpm/redact.rs"
    op: update
  - path: "src/windows/ProjectTab.tsx"
    op: update
  - path: "src/features/terminal/useAgentRuns.ts"
    op: update
  - path: "src/components/CommandPalette.tsx"
    op: update
related: []
tags:
  - "bug-hunt"
  - "session-id"
  - "redact"
  - "logging"
  - "command-palette"
  - "mcp-tool"
---
[x] 버그 헌팅 라운드 — SessionId 비ASCII 패닉 · 마스킹 겹침 누출 · [object Object] 로그 · 팔레트 낡은 결과</title>
<parameter name="difficulty">medium

## 발생 원인

전체 코드베이스를 lang-review 레시피(락·unwrap·바이트 슬라이스·떠 있는 Promise·정리 없는 effect)로 좁히고, 설치본 `oculpm.log` 3일분을 모양별로 집계해 결함 4종을 확정했다. grep 이 잡은 것은 앞의 둘, 로그가 낸 것은 셋째다.

1. **`SessionId::kind()` / `workday()` 가 비ASCII id 에서 패닉** — `&rest[..8]` 이 바이트 인덱스라 `manual-한글세션` 처럼 손으로 적은 프론트매터 값에서 UTF-8 문자 중간을 자른다 (`end byte index 8 is not a char boundary`). 색인 태스크가 통째로 멎는 경로다. 접두 방언 다섯 분기가 같은 슬라이스를 복붙하고 있었다.
2. **`redact_text` 의 겹침 처리가 비밀의 꼬리를 남긴다** — 겹치는 매치를 "가장 왼쪽 하나만 남기고 나머지는 버림"으로 처리했는데, 같은 위치에서 시작하는 짧은 매치가 `(start, end)` 정렬로 먼저 오므로 긴 매치가 버려져 `[REDACTED]5678ijkl…` 꼴로 절반이 노출됐다. 사용자 규칙과 기본 규칙이 한 키를 다른 길이로 잡는 흔한 조합에서 난다.
3. **`[object Object]` 로그** — `oculpmInit` · `oculpmAgentRunSignal` 은 `AppError` 봉투를 돌려주는데 `ProjectTab` · `useAgentRuns` 가 `${res.error}` 로 템플릿에 넣어 원인이 사라졌다 (설치본 로그에 `oculpmInit failed: [object Object]` 실재).
4. **⌘K 팔레트의 낡은 검색 결과** — 디바운스 타이머만 정리하고 이미 나간 `oculpmSearchEntities` / `lspWorkspaceSymbols` 응답은 버리지 않아, 느린 워크스페이스 심볼 응답이 새 검색어의 결과를 덮었다.

## 해결 방법

1. `leading_workday(s) = s.get(..8).filter(is_digits)` + `has_dated_tail(rest)` 헬퍼로 바이트 경계를 검사하고 다섯 분기를 한 함수로 접었다. `Unknown => leading_workday(s)`. 회귀 테스트 `non_ascii_ids_classify_as_unknown_without_panicking` (8개 입력).
2. 겹치는 범위를 **합집합으로 병합** — `kept.last_mut()` 의 `end` 를 늘린다. 테스트 `redact_overlapping_hits_mask_the_union` (같은 시작·다른 길이, 부분 겹침 둘).
3. 두 자리를 `toAppError(...).detail ?? code` / `res.error.detail ?? res.error.code` 로. AppError 를 돌려주는 커맨드 90여 개 중 템플릿 보간은 이 둘뿐이었다 (나머지 `${…error}` 7곳은 `string` 계약).
4. effect 정리 함수에 `stale` 플래그를 두고 두 `.then` 이 그 뒤엔 setState 하지 않게 했다.

살펴봤지만 결함이 아니었던 것: tokio Mutex 가드의 await 횡단(전부 직렬화 의도), 커맨드 경로의 unwrap(모두 테스트 코드), git 인자 조립(경로는 `--` 뒤, rev 는 상수), SQL format!(플레이스홀더만), 워크데이 DST 경계, ndjson 찢어진 마지막 줄, `lspOpen: Path escapes the project root` 로그(심볼릭 링크 가드의 정상 거부).

## 검증

- `cargo fmt --check` · `cargo clippy --all-targets -D warnings` · `cargo test` 1489+ 통과 (새 테스트 2 포함, 먼저 빨갛게 확인 후 초록)
- `pnpm typecheck` · `pnpm lint` 6게이트 · `pnpm vitest run` 2740 통과