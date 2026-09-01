---
schema_version: 1
type: bug
slug: import-dedupe-timezone-boundary
status: done
difficulty: medium
created_at: 2026-09-01T20:42:00+09:00
session_id: manual-20260901-204200
agent:
  id: claude-code
  version: Opus 5 (1M context)
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/src/oculpm/manager/lifecycle.rs
    op: update
  - path: src-tauri/src/commands/import.rs
    op: update
  - path: src-tauri/src/oculpm/import/journalize.rs
    op: update
  - path: src-tauri/src/oculpm/manager/tests.rs
    op: update
related:
  - kind: follows_up
    ref: 20260901/Features_to_add/1958_feature_conversation-import-and-offline.md
tags: [phase7, import, timezone, dedupe]
---

[x] 자정을 걸친 대화만 매번 새로 들여오고 매번 과금되던 문제

## 발생 원인

「같은 파일을 두 번 열어도 이미 들여온 것은 다시 과금되지 않는다」가 임포트의
핵심 약속인데, **워크데이를 두 곳에서 서로 다르게 계산**하고 있었다.

- 어댑터(`adapters.rs`)는 순수 함수라 프로젝트를 모른다. 대화의 **원본 오프셋**
  문자열에서 날짜를 잘라 썼다 — `created_at[..10]`.
- 쓰기 경로(`create_manual_journal_entry`)는 **프로젝트 타임존**의
  `WorkdayResolver` 로 계산한다 (`day_starts_at` 까지 반영).

두 값은 보통 같다. 어긋나는 구간이 있다 — `2025-07-14T23:00:00Z` 는 `+09:00`
에서 이미 15일이다. 그러면 파일은 `20250715/` 에 들어가는데 중복 판정
(`already_imported`)은 `20250714/` 를 뒤진다. 못 찾으니 **없는 것으로 보고 다시
모델을 부르고 다시 쓴다.** 자정을 걸친 대화만, 열 때마다.

세션 id 도 같은 값을 썼으므로 `import-20250714-...` 인데 파일은 15일 폴더에
있는 상태가 됐다 — 출처 배지는 접두만 보므로 안 깨지지만 사실과 어긋난다.

## 무엇을 고쳤나

`OculpmManager::workday_at(project_id, instant_utc)` 을 신설했다. **임의 시각**의
워크데이를 묻는 유일한 문이고, 쓰기 경로가 쓰는 것과 **같은 리졸버**를 지난다.

- 어댑터는 순수하게 남는다. `candidate.workday` 는 **목록 표시용**이라고 문서에
  못박았다.
- 저장 워크데이는 커맨드 층(`storage_workday`)이 리졸버에게 묻는다. 스캔의 중복
  판정 · 실행의 중복 판정 · 세션 id 발급이 전부 이 한 값을 쓴다.
- 리졸버를 못 읽거나 시각을 못 읽으면 어댑터 값으로 떨어진다 — 부가 판정 하나
  때문에 임포트를 막지 않는다.

## 어떻게 찾았나

릴리스 직전에 「원본 날짜 보존」을 **쓰기 경로에서** 확인하는 테스트를 쓰다가
잡혔다. 조각(어댑터 파싱 · 세션 id 발급)은 각각 단위 테스트가 있었고 전부 통과
했지만, **두 계산이 갈라지는 지점**은 어느 조각에도 없었다. 그 테스트가 이제
경계까지 고정한다 — 11:30Z 는 14일 폴더 + `2030` 파일명(로컬 20:30), 23:00Z 는
15일 폴더, 그리고 `workday_at` 이 두 경우 모두 **쓰기와 같은 날**을 답한다.

## 검증

- `cargo test` 1164 통과 (신규 경계 단언 포함) · `clippy --all-targets -D warnings` ·
  `fmt --check` exit 0. 프런트 게이트 4종 exit 0.
- 로컬 툴체인을 1.98 로 올려 CI(러너 stable)와 같은 clippy 기준에서 확인했다.
