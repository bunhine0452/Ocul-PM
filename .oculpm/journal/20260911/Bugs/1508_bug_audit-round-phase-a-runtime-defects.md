---
schema_version: 1
type: bug
slug: "audit-round-phase-a-runtime-defects"
status: done
created_at: "2026-09-11T15:08:13+09:00"
session_id: "20260911-008"
agent:
  id: "claude-code"
  session: "2322524d-287e-4492-b82a-3b8cd46a1cfa"
language: "ko"
verified_by_user: false
files_touched: []
related: []
tags:
  - "mcp-tool"
---
[x] 로그가 가리킨 다섯 자리 — 지운 프로젝트의 좀비 자동화 · 색인 고아 · 편집기 키마다 ERROR 2줄 · 정상 종료의 crash_recovered · 히스토리 캡처 경합

## 증상

감사 라운드 2026-09-11 Phase A. 코드 grep(unwrap·TODO·억제·의존성)은 깨끗했고, 설치본 `oculpm.log.*` 일주일치 ERROR/WARN 을 `uniq -c` 로 집계한 것이 결함을 냈다.

- `watcher automation tick failed for project project_id=1 … Query returned no rows` **9,820줄/2일** — 09-09 12:38 에 지운 프로젝트(adelie)를 매니저가 계속 들고 있어 5초마다 두드렸다.
- 색인 `files` 1,459 행 중 **101 이 디스크에 없음**(`src/legacy/*`, `dist-measure/`) — `sqlite3 -readonly … dbstat` + 경로 존재 확인.
- `NotAllowedError` + `unhandled rejection: Canceled` 가 하루 **251건** — Monaco `BrowserClipboardService.installWebKitWriteTextWorkaround` 가 편집기 click/keydown 마다 `navigator.clipboard.write` 를 걸고 WKWebView 가 거절.
- 정상 종료 13번이 전부 다음 기동에 `recovered zombie session` — `shutdown_all_blocking` 은 락만 놓았다.
- `local history: capture failed … No such file or directory` **4,451건/주**.

## 원인

- `delete_project` 가 DB 행만 지웠다. `forget_project` 가 없었다.
- `index_project` 는 upsert 만 하고 walk 집합 밖의 행을 화해하지 않았다. 삭제는 워처 Delete 이벤트 한 경로.
- VS Code 웹의 확장 호스트용 장치가 확장 호스트 없는 앱에 그대로 실려 있었다.
- 종료 경로가 세션 액터 `Shutdown`(→`AppQuit`)을 부르지 않는 것이 lifecycle.rs 주석에 「의도」로 적혀 있었다.
- rename 저장의 Create+Modify 가 같은 파일 캡처 둘을 동시에 돌려 같은 `meta.json.tmp` 를 두고 먼저 rename 한 쪽이 이겼다 — 한 판은 유실.

## 해결

- `OculpmManager::forget_project` (워처 abort · 세션 Shutdown 1초 한도 · 락 해제) — `delete_project` 가 **파일 삭제 전에** 부른다. 자동화 tick 은 `QueryReturnedNoRows` 를 `TickError::MissingProject` 로 구분해 스스로 잊는다.
- `Db::delete_files_by_paths` (한 트랜잭션, `file_snapshots` 동반) + `index_project` 화해 단계, `IndexResult.files_removed`.
- `WebviewClipboardService extends BrowserClipboardService` — 우회를 설치하지 않고 `writeText` 실패는 조용히 execCommand 로. `StandaloneServices.initialize({clipboardService: SyncDescriptor})` 를 **언어 등록 전에**(첫 서비스 조회가 초기화를 굳힌다).
- `shutdown_all_blocking` 이 세션을 먼저 닫는다 — 런타임 밖이면 `block_on`+timeout, 안(테스트)이면 `rt.spawn`.
- 파일당 캡처 게이트(`Mutex`) + 임시 이름 일련번호.

## 검증

- `forget_project_drops_watcher_lock_and_workday_listing` · `shutdown_all_with_live_watchers_releases_locks_without_panicking` (manager/tests_teardown.rs)
- `delete_files_by_paths_drops_stale_rows_with_snapshots_only_in_that_project` (db/tests.rs)
- `concurrent_captures_of_one_file_neither_fail_nor_leave_tmp_files` (history_tests.rs, 8 스레드)
- `monaco_contributions.test.ts` — installClipboardService 가 registerExtraLanguages 보다 앞인지 소스 단언
- 실기기 확인은 다음 릴리스 뒤: 로그에서 세 패턴이 사라졌는지

## 배운 점

- 이 저장소에서 grep 감사는 이미 포화다. **런타임 근거(로그 집계·DB dbstat)** 가 다음 결함을 낸다.
- 800줄 래칫이 이번 라운드에서 네 번 울렸다 — `teardown.rs` · `history_tests.rs` · `plan_edit_tests.rs` · `workspacePrune.ts` 로 갈랐다. 테스트 모듈을 `#[path]` 로 빼는 것이 가장 싼 분할이다.