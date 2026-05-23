# W2 — 작업 트래커

> 페이즈 명세: [`../phases/W2-watcher-session.md`](../phases/W2-watcher-session.md) (SSOT)
> 본 폴더의 PR 파일들은 **그 PR 의 워킹 도큐먼트** — 진행하면서 체크박스/노트 갱신.

---

## 진행 현황

| PR | 제목 | 상태 | 워킹 도큐먼트 |
|---|---|---|---|
| W2-PR1 | `index.rs` (writer/reader) — sessions/ndjson/snapshot | ✅ 완료 | [`PR1-index-writer.md`](./PR1-index-writer.md) |
| W2-PR2 | `session.rs` 상태 머신 (Idle/Active/Closing) | ✅ 완료 | [`PR2-session-actor.md`](./PR2-session-actor.md) |
| W2-PR3 | `watcher.rs` notify 통합 + should_track/classify | ⬜ | [`PR3-watcher-notify.md`](./PR3-watcher-notify.md) |
| W2-PR4 | Crash recovery 통합 (zombie sessions) | ⬜ | [`PR4-crash-recovery.md`](./PR4-crash-recovery.md) |
| W2-PR5 | Tauri 이벤트 emit + 프론트 listener 스모크 | ⬜ | [`PR5-tauri-events.md`](./PR5-tauri-events.md) |
| W2-PR6 | `oculpm_*` 커맨드 9개 확장 | ⬜ | [`PR6-watcher-commands.md`](./PR6-watcher-commands.md) |

상태 표기: ⬜ 시작 전 · 🟡 진행 중 · ✅ 완료 · 🔴 블로커.

---

## 페이즈 종료 조건

- W2 의 모든 PR 이 ✅
- `phases/W2-watcher-session.md` §3 의 통합/수동 QA 11개 항목 ✅
- `phases/W2-watcher-session.md` §5 의 Definition of Done 6개 항목 ✅
- W3 의 선행 조건 (`phases/W2-watcher-session.md` §6) 6개 ✅

---

## 페이즈 회고 (W2 끝나면 작성)

(아래 빈 칸은 W2 종료 시 채움)

- 예상 대비 실제 소요:
- 발견된 함정 vs 가이드 예측:
- W3 로 넘기는 결정/주의:
