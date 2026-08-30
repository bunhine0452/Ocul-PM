---
schema_version: 1
type: bug
slug: journal-path-traversal
status: done
created_at: 2026-08-30T10:51:00+09:00
session_id: "manual-20260830-105100"
agent:
  id: claude-code
  version: claude-fable-5
language: ko
verified_by_user: false
difficulty: medium
files_touched:
  - path: src-tauri/src/oculpm/manager/journal.rs
    op: update
  - path: src-tauri/src/oculpm/error.rs
    op: update
  - path: src-tauri/src/oculpm/manager/tests.rs
    op: update
related: []
tags: [security, mobile-bridge, journal, audit-round]
---

[x] 일지 `relative_path` 가 `.oculpm/journal/` 밖으로 나갈 수 있었다 — 모바일 브리지가 그 인자를 그대로 노출했다

## 발생 원인

`manager/journal.rs` 의 다섯 경로(조회 · 검증 토글 · 메타 수정 · tz 보정 · 본문 수정)와 `resolve_journal_absolute` 가 전부 `journal_root.join(&relative_path)` 만 했다. `Path::join` 은 절대경로를 받으면 base 를 통째로 버리고, `..` 도 그대로 통과한다. 앱 안에서는 프런트가 캐시에서 받은 경로만 넘기지만, `mobile_bridge/dispatch.rs` 는 `oculpm_get_journal_entry` · `oculpm_update_entry_body` 등을 페어링된 폰에 그대로 노출하므로 토큰을 가진 기기가 `../planner/x.md` 나 `/…/anything.md` 를 읽고 덮어쓸 수 있었다. 같은 저장소의 `entry_diffs::sidecar_path` 는 이미 `..`/절대경로를 거부하고 있어 규칙이 갈라진 상태였다.

## 해결 방법

`resolve_entry_path(journal_root, relative_path)` 하나로 모은다: 빈 경로 · 절대경로 · `Normal` 이 아닌 구성 요소(`..`, `.`, 루트)를 거부하고, join 결과가 `journal_root` 로 시작하는지 한 번 더 확인한다. 실패는 새 `OculpmError::InvalidPath`. 다섯 경로 + `resolve_journal_absolute` 가 전부 이 함수를 경유한다.

## 검증

새 테스트 `journal_paths_cannot_escape_the_journal_root`: `../planner/victim.md` · `/etc/passwd` · 빈 문자열 · `20260524/../../planner/victim.md` 네 입력을 조회·검증·본문수정·해석 네 경로에 넣어 전부 `InvalidPath` 이고, 밖의 희생 파일 내용이 그대로임을 단언. 정상 경로는 통과. `cargo test` 그린.

## 메모

모바일 토큰의 만료·회전 부재와 LLM 호출 arm 노출은 별도 항목(플랜 mobile-bridge 가 약속한 회전 버튼) — 이번엔 경로 탈출만 닫았다.
