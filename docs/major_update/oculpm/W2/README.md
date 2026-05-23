# W2 — 작업 트래커

> 페이즈 명세: [`../phases/W2-watcher-session.md`](../phases/W2-watcher-session.md) (SSOT)
> 본 폴더의 PR 파일들은 **그 PR 의 워킹 도큐먼트** — 진행하면서 체크박스/노트 갱신.

---

## 진행 현황

| PR | 제목 | 상태 | 워킹 도큐먼트 |
|---|---|---|---|
| W2-PR1 | `index.rs` (writer/reader) — sessions/ndjson/snapshot | ✅ 완료 | [`PR1-index-writer.md`](./PR1-index-writer.md) |
| W2-PR2 | `session.rs` 상태 머신 (Idle/Active/Closing) | ✅ 완료 | [`PR2-session-actor.md`](./PR2-session-actor.md) |
| W2-PR3 | `watcher.rs` notify 통합 + should_track/classify | ✅ 완료 | [`PR3-watcher-notify.md`](./PR3-watcher-notify.md) |
| W2-PR4 | Crash recovery 통합 (zombie sessions) | ✅ 완료 | [`PR4-crash-recovery.md`](./PR4-crash-recovery.md) |
| W2-PR5 | Tauri 이벤트 emit + 프론트 listener 스모크 | ✅ 완료 | [`PR5-tauri-events.md`](./PR5-tauri-events.md) |
| W2-PR6 | `oculpm_*` 커맨드 9개 확장 | ✅ 완료 | [`PR6-watcher-commands.md`](./PR6-watcher-commands.md) |

상태 표기: ⬜ 시작 전 · 🟡 진행 중 · ✅ 완료 · 🔴 블로커.

---

## 페이즈 종료 조건

- W2 의 모든 PR 이 ✅
- `phases/W2-watcher-session.md` §3 의 통합/수동 QA 11개 항목 ✅
- `phases/W2-watcher-session.md` §5 의 Definition of Done 6개 항목 ✅
- W3 의 선행 조건 (`phases/W2-watcher-session.md` §6) 6개 ✅

---

## 페이즈 회고

- **예상 대비 실제 소요**:
  - PR1~PR3 (IndexWriter, SessionActor, ProjectWatcher): 핵심 로직은 스펙 대로 진행. `notify-debouncer-full` 의 `FileIdMap` + macOS `fsevents` 경로 정규화 (`/tmp` → `/private/tmp`) 가 테스트 환경에서 까다로웠으나 `canonicalize()` 로 해결.
  - PR4 (Crash Recovery): 스펙 대비 순조로움. `last_event_ts` 역방향 ndjson 스캔 + `started_at` fallback 패턴이 깔끔하게 동작.
  - PR5 (Tauri Events): `tauri::test::mock_app()` 가 unit test 환경과 호환 불가 → `app_handle: Option` 패턴으로 전환. emit 수신 검증 대신 "emit 호출 시 panic 방지" 안전성 테스트로 대체.
  - PR6 (Commands): 9개 커맨드 + manager delegate 메서드 추가. `ProjectWatcher::stop(mut self)` 소비 패턴 → `Option<ProjectWatcher>` + `take()` 로 관리. `SessionActor::get_current_session` 은 `oneshot` query/response 패턴 추가.

- **발견된 함정 vs 가이드 예측**:
  - ⚠️ **inactivity timer 테스트**: 원 문서의 "테스트는 5초"는 `InactivityFired` force-fire 로 대체했었으나, 이것만으로는 `spawn_inactivity_timer`와 타이머 리셋 로직 검증이 불완전. `tokio::time::pause` + `advance` 기반 real-timer 테스트 2개 추가하여 보완. dev-dependency 에 `tokio = { features = ["test-util"] }` 필요.
  - ⚠️ **`Snapshot` 읽기**: `capture_snapshot` (쓰기) 만 있고 `read_snapshot` (읽기) 가 없었음 → PR6 에서 추가.
  - ⚠️ **`JsonDeserialize` 에러 variant**: snapshot 역직렬화 경로에 필요했으나 `error.rs` 에 없었음 → 추가.

- **W3 로 넘기는 결정/주의**:
  - `start_session_manual` 은 watcher 미시작 시 자동 `watcher_start` 호출 — W3 의 journal UI 에서 "활성화" 버튼 누를 때 이 경로 사용 예정.
  - `watcher_status` 는 init 전에도 `Stopped` 반환 (에러 아님) — W3 UI 에서 안전하게 polling 가능.
  - E2E 수동 QA (DevTools 콘솔 invoke) 는 W3 UI 통합 시 함께 수행 권장.
  - 최종 테스트: **79 tests, 0 failed, clippy 0 (oculpm), 빌드 green**.
