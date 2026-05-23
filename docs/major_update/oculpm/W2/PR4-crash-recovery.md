# W2-PR4 — Crash recovery 통합

> **목표**: 앱 부팅 시 (워처 시작 직전) 최근 3 workday 의 `sessions.json` 을 스캔해 `ended_at == null` 인 zombie 세션을 `crash_recovered` 로 마감. race 없이 워처보다 먼저 완료.
> **선행**: W2-PR1 (`IndexWriter::{list_sessions, finalize_session, last_event_ts}`), W2-PR3 (워처 부팅 hook).
> **참조**: [`../phases/W2-watcher-session.md`](../phases/W2-watcher-session.md) W2-PR4, [`../00-spec.md`](../00-spec.md) §4.2 (sessions.json), §6 (lock 의 stale recovery 와 분리).

---

## 1. 시그니처 (계획)

`OculpmManager::on_project_opened` 안에서 워처 시작 **전**:

```rust
async fn recover_zombie_sessions(&self, runtime: &ProjectRuntime) -> Result<(), OculpmError> {
    let today = runtime.resolver.workday_of(chrono::Utc::now());
    for workday in self.list_recent_workdays(runtime, 3).await? {
        let sessions = runtime.index_writer.list_sessions(&workday).await?;
        for s in sessions.iter().filter(|s| s.ended_at.is_none()) {
            let last_event_ts = runtime.index_writer.last_event_ts(&workday, &s.id).await?;
            runtime.index_writer.finalize_session(&s.id, SessionEnd {
                ended_at: last_event_ts.unwrap_or(s.started_at.clone()),
                ended_reason: EndedReason::CrashRecovered,
            }).await?;
        }
    }
    Ok(())
}
```

`last_event_ts(workday, session_id)`: ndjson 을 거꾸로 스캔해 첫 매치 — 본 PR 에서 추가하거나, PR1 에서 미리 추가 후 호출.

---

## 2. 왜 최근 3일치만?

사용자가 한 달 만에 프로젝트를 열어도 한 달 전 zombie 를 매번 복구하는 건 낭비. 3일 한도 + 별도 "전체 검사" 커맨드 (W4 settings 에서 노출 — 본 PR 범위 X).

---

## 3. lock 의 stale recovery 와의 분담

- W1-PR5 의 `LockGuard::acquire` 는 **lock 파일**의 stale heartbeat 검사 — heartbeat 가 오래된 lock 만 회수. Held 면 `LockStateView::HeldByOther` 로 read-only.
- 본 PR 의 `recover_zombie_sessions` 는 **sessions.json** 의 ended_at null 검사 — lock 이 정상 회수되었거나 새로 잡혔을 때만 호출.
- 즉 순서: `acquire` → (Acquired/Recovered 면) `recover_zombie_sessions` → 워처 start. `Held` 면 본 PR 코드 미실행 (read-only).

---

## 4. 테스트 (계획)

- [ ] **zombie 2개 회수** — 가짜 `sessions.json` 에 ended_at null 세션 2개 (어제 + 오늘) → recover 후 둘 다 `ended_reason="crash_recovered"`, `ended_at` 채워짐
- [ ] **heartbeat 미래 → 다른 인스턴스로 분류** — ended_at null + heartbeat_at 이 현재보다 미래 → `Held` 분기. (실제로는 lock 검사가 먼저 잡지만, 본 PR 의 safety check 로 한 번 더 확인)
- [ ] **3일 한도** — 4일 전 workday 에도 zombie 가 있을 때 → 본 PR 의 recover 는 무시 (3일 한도 적용 확인)
- [ ] **last_event_ts 폴백** — ndjson 에 해당 session_id 이벤트 0건이면 `ended_at = started_at` 으로 폴백
- [ ] **race-free** — recover 끝나기 전에 워처가 새 이벤트를 append 하지 않음 (실제로는 워처 시작이 await 뒤에 옴 — `on_project_opened` 의 순서 보장)
- [ ] **finalize 후 list_sessions** — recover 후 list_sessions 가 갱신된 ended_reason 반환

---

## 5. DoD

- [ ] 위 6개 테스트 통과
- [ ] `recover_zombie_sessions` 가 워처 시작 **전에** 완료 — `on_project_opened` 의 순서 명시 (코드 주석 + 테스트로 검증)
- [ ] 3일 한도 hard-code 위치를 `const RECOVERY_WORKDAYS: usize = 3` 로 분리 (W4 의 "전체 검사" 가 같은 상수 참조)
- [ ] `oculpm/manager.rs` 의 추가 코드 clippy lint 0건

---

## 6. 실행 노트

- (작업 중 채움)
