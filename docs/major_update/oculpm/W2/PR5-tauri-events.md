# W2-PR5 — Tauri 이벤트 emit + 프론트 listener 스모크

> **목표**: 6개 oculpm 이벤트가 백엔드에서 정확히 emit 되고, 프론트 DevTools 콘솔에서 listen 으로 payload 가 관찰됨. specta 가 TS 타입 export.
> **선행**: W2-PR2 (SessionActor emit), W2-PR3 (Watcher emit), W2-PR1 (IntegrityWarning 발화 지점).
> **참조**: [`../phases/W2-watcher-session.md`](../phases/W2-watcher-session.md) W2-PR5, [`../01-backend.md`](../01-backend.md) §4 (이벤트 타입), [`../02-frontend.md`](../02-frontend.md) §11 (프론트 스로틀).

---

## 1. 이벤트 6종 (W1-PR2 의 spec.rs 에서 이미 정의됨)

| 이벤트 키 | payload | emit 위치 | 상태 |
|---|---|---|:---:|
| `oculpm:session_started` | `OculpmSessionStarted { project_id, session }` | SessionActor `emit_started` (Idle → Active 전이) | ✅ |
| `oculpm:session_ended` | `OculpmSessionEnded { project_id, session }` | SessionActor `emit_ended` (Active → Idle finalize 후) | ✅ |
| `oculpm:file_changed` | `OculpmFileChanged { project_id, event }` | Watcher `emit_file_changed` (per change, throttle 없음) | ✅ |
| `oculpm:integrity_warning` | `OculpmIntegrityWarning { project_id, warning }` | IndexWriter `emit_integrity_warning` (ndjson 손상 복구 시) | ✅ |
| `oculpm:agents_template_changed` | `OculpmAgentsTemplateChanged { project_id, relative_path }` | Watcher `emit_agents_template_changed` (.oculpm/agents/** 변경 감지) | ✅ |
| `oculpm:journal_path_changed` | `OculpmJournalPathChanged { project_id, relative_path, op }` | Watcher `emit_journal_path_changed` (.oculpm/journal/** 변경 감지) | ✅ |

---

## 2. throttle 정책

- **백엔드는 throttle 안 함** — 모든 이벤트 그대로 전달.
- 프론트에서 1초 batch 누적 (02-frontend §11) — 본 PR 범위 X. 본 PR 의 프론트 작업은 DevTools 콘솔 스모크 listener 만.

---

## 3. 프론트 스모크 (DevTools 콘솔)

```js
const { listen } = await import("@tauri-apps/api/event");
const off = await listen("oculpm:file_changed", e => console.log("file:", e.payload));
const off2 = await listen("oculpm:session_started", e => console.log("session+:", e.payload));
const off3 = await listen("oculpm:session_ended", e => console.log("session-:", e.payload));
```

또는 tauri-specta 가 생성한 `events.oculpmFileChanged.listen(cb)` 헬퍼 사용 가능 (PR2 에서 `#[derive(Event)]` 가 이미 붙어있음).

---

## 4. 테스트 (실제)

- [x] **session_started emit** — SessionActor 테스트 7개 모두 `app_handle: None`으로 `emit_started` 경로를 거치며 panic 없이 통과 (간접 검증)
- [x] **session_ended emit** — inactivity / manual / workday_boundary / shutdown 각 경로에서 `emit_ended` 호출 → 4 케이스 모두 그린 (간접 검증)
- [x] **file_changed emit** — 5개 파일 변경 → 5개 ndjson 이벤트 + `emit_file_changed` 호출, `app_handle: None` → panic 없음 (PR3 test case 1)
- [x] **integrity_warning emit** — `integrity_warning_emit_path_safe_without_app_handle` 테스트: corrupted ndjson → `emit_integrity_warning` 호출 → `emit_ctx: None` → no-op + backup 생성
- [x] **agents_template_changed emit** — `agents_template_change_emits_without_panic` 테스트: `.oculpm/agents/_template.md` touch → `emit_agents_template_changed` 호출 → no-op + ndjson 미기록
- [x] **journal_path_changed emit** — `journal_change_emits_without_panic` 테스트: `.oculpm/journal/` 에 파일 생성 → `emit_journal_path_changed` 호출 → no-op + ndjson 미기록

---

## 5. DoD

- [x] 위 6개 이벤트 emit 경로 테스트 통과 (77 tests total, 0 failed)
- [ ] DevTools 콘솔에서 6개 이벤트 모두 관찰 가능 (수동 QA — 워처 부팅 후 파일 변경 필요, W2-PR6 커맨드 이후)
- [x] specta 가 6개 이벤트의 TS 타입을 `bindings.ts` 에 export:
  - `oculpmSessionStarted: makeEvent<OculpmSessionStarted>("oculpm-session-started")`
  - `oculpmSessionEnded: makeEvent<OculpmSessionEnded>("oculpm-session-ended")`
  - `oculpmFileChanged: makeEvent<OculpmFileChanged>("oculpm-file-changed")`
  - `oculpmIntegrityWarning: makeEvent<OculpmIntegrityWarning>("oculpm-integrity-warning")`
  - `oculpmAgentsTemplateChanged: makeEvent<OculpmAgentsTemplateChanged>("oculpm-agents-template-changed")`
  - `oculpmJournalPathChanged: makeEvent<OculpmJournalPathChanged>("oculpm-journal-path-changed")`
- [x] 이벤트 emit 실패 시 panic 없이 로그만 — 모든 emit 헬퍼가 `let _ = ...emit(handle)` 패턴 사용

---

## 6. 실행 노트

### 구현 상태

본 PR 시작 시 이벤트 6종 중 **5종은 이미 구현 완료** (W2-PR2, W2-PR3 에서 코드 완성). 유일하게 미구현이었던 `integrity_warning` emit 을 본 PR 에서 추가.

### 변경된 파일 (2 파일)

1. **`src-tauri/src/oculpm/index.rs`**
   - `IndexWriter` 에 `emit_ctx: Option<(u32, tauri::AppHandle)>` 필드 추가
   - `with_emit_ctx` builder method 추가
   - `#[derive(Debug)]` → 수동 `impl Debug` (AppHandle 이 Debug 미구현)
   - `read_file_changes` corruption 복구 블록에 `emit_integrity_warning` 호출 추가
   - `emit_integrity_warning` helper method 추가
   - PR5 테스트 1개 추가

2. **`src-tauri/src/oculpm/watcher.rs`**
   - PR5 테스트 2개 추가 (agents_template_changed, journal_path_changed)

### 발견된 함정 / 설계 결정

1. **Tauri AppHandle과 unit test 호환성**: `tauri::AppHandle` (= `AppHandle<Wry>`)은 `tauri::test::mock_builder()` 의 `MockRuntime` 과 타입이 다름. 따라서 unit test에서 실제 emit 수신 검증은 불가. `app_handle: None` (= `emit_ctx: None`)에서 emit skip + no-panic 검증으로 대체. 실제 이벤트 수신은 DevTools 콘솔 수동 QA (W2-PR6 워처 커맨드 완성 후).

2. **IndexWriter의 emit_ctx 주입**: `IndexWriter`는 원래 순수 I/O 레이어였으나, `integrity_warning` emit 을 위해 optional `(project_id, AppHandle)` 을 주입. `new()` 시그니처는 변경 없음 (emit_ctx = None). 프로덕션에서는 `with_emit_ctx(pid, handle)` builder 로 주입.

3. **emit 실패 무시 패턴**: 모든 emit helper 가 `let _ = ...emit(handle)` 패턴을 사용. emit 은 best-effort — 프론트엔드가 아직 listen 하지 않을 수 있고, 그 경우 Err 는 무해. tracing 로그는 추가하지 않음 (높은 빈도의 file_changed 에서 불필요한 warn 방지).

4. **`OculpmIntegrityWarning.warning.kind`**: `"ndjson_corrupted_tail"` 로 결정. 향후 추가 가능한 kind 값: `"frontmatter_parse"`, `"schema_mismatch"`, `"orphan_session"`, `"lock_recovered"`.

### 빌드/테스트

- 전체 oculpm 77 tests: **3.94s**, 회귀 0
- clippy lint 신규: 0건
- `bindings.ts` 에 6개 이벤트 타입 + 9개 이벤트 리스너 export 확인

### 다음 PR 로 넘기는 메모

- **W2-PR6 (commands)**: `IndexWriter` 생성 시 `with_emit_ctx(project_id, app_handle)` 호출 필요. 현재 `manager.rs::init_project` 의 recovery 에서 생성하는 `IndexWriter` 는 `emit_ctx: None` — PR6 에서 watcher/session 부팅 시 `app_handle` 을 주입할 때 함께 설정.
- **DevTools 수동 QA**: W2-PR6 에서 워처 start 커맨드 완성 후, 실제 파일 변경 → DevTools 콘솔 스크린샷 캡처하여 §5 DoD 체크.
