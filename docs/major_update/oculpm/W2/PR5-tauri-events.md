# W2-PR5 — Tauri 이벤트 emit + 프론트 listener 스모크

> **목표**: 6개 oculpm 이벤트가 백엔드에서 정확히 emit 되고, 프론트 DevTools 콘솔에서 listen 으로 payload 가 관찰됨. specta 가 TS 타입 export.
> **선행**: W2-PR2 (SessionActor emit), W2-PR3 (Watcher emit), W2-PR1 (IntegrityWarning 발화 지점).
> **참조**: [`../phases/W2-watcher-session.md`](../phases/W2-watcher-session.md) W2-PR5, [`../01-backend.md`](../01-backend.md) §4 (이벤트 타입), [`../02-frontend.md`](../02-frontend.md) §11 (프론트 스로틀).

---

## 1. 이벤트 6종 (W1-PR2 의 spec.rs 에서 이미 정의됨)

| 이벤트 키 | payload | emit 위치 |
|---|---|---|
| `oculpm:session_started` | `OculpmSessionStarted { project_id, session }` | SessionActor (Idle → Active 전이) |
| `oculpm:session_ended` | `OculpmSessionEnded { project_id, session }` | SessionActor (Active → Idle finalize 후) |
| `oculpm:file_changed` | `OculpmFileChanged { project_id, event }` | Watcher `run` 루프 (per change, throttle 없음) |
| `oculpm:integrity_warning` | `OculpmIntegrityWarning { project_id, warning }` | IndexWriter (ndjson 손상 복구), Watcher (path 단축 후 reject) |
| `oculpm:agents_template_changed` | `OculpmAgentsTemplateChanged { project_id, relative_path }` | Watcher (.oculpm/agents/** 변경 감지) |
| `oculpm:journal_path_changed` | `OculpmJournalPathChanged { project_id, relative_path, op }` | Watcher (.oculpm/journal/** 변경 감지) |

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

## 4. 테스트 (계획)

- [ ] **session_started emit** — SessionActor Idle→Active 전이 시점에 이벤트 1회 — mock AppHandle 또는 tauri test 헬퍼로 검증
- [ ] **session_ended emit** — inactivity / manual / workday_boundary / shutdown 각 경로에서 1회씩 — 4 케이스 모두 그린
- [ ] **file_changed emit** — 5개 파일 변경 → 5개 이벤트, payload 의 project_id + event.path 일치
- [ ] **integrity_warning emit** — ndjson 손상 줄 복구 시점에 1회, `warning.kind == "ndjson_corrupted_tail"` (kind 명 결정 필요 — 노트에 기록)
- [ ] **agents_template_changed emit** — `.oculpm/agents/_template.md` touch → 1회
- [ ] **journal_path_changed emit** — `.oculpm/journal/<workday>/Bugs/foo.md` 생성 → 1회, `op == "create"`

---

## 5. DoD

- [ ] 위 6개 테스트 통과
- [ ] DevTools 콘솔에서 6개 이벤트 모두 관찰 가능 (수동 QA, 스크린샷 § 6 에)
- [ ] specta 가 6개 이벤트의 TS 타입을 `bindings.ts` 에 export (`events.oculpmFileChanged.listen` 등이 호출 가능)
- [ ] 이벤트 emit 실패 시 panic 없이 로그만 — `app_handle.emit` 의 Err 는 `tracing::warn!` 으로 swallow

---

## 6. 실행 노트

- (작업 중 채움)
