# W4-PR4 — Adapter drift 감지 + 토스트 흐름

> **목표**: 4 어댑터 파일 (`.cursor/rules/ocul-pm.mdc`, `.claude/CLAUDE.md`, `.agent/rules/ocul-pm.md`, `GEMINI.md`) 의 외부 변경을 워처가 잡아 사용자에게 토스트로 안내. "동기화" 클릭 시 PR2 의 `sync_active` 재호출.
> **선행**: W4-PR2 (sync + state hash 저장), W2-PR3 (watcher), W2-PR5 (Tauri 이벤트 emit 인프라).
> **참조**: [`../phases/W4-agents-dual-layer.md`](../phases/W4-agents-dual-layer.md) §W4-PR4 + §5 (함정: ManagedBlock begin/end 파손).
> **상태**: ✅ (2026-05-25 — backend 완료. 토스트 5분 쿨다운 + UI 버튼은 PR8 에서 wire)

---

## 1. drift 정의 (계획)

| 어댑터 | 모드 | drift 조건 |
|---|---|---|
| Cursor, Antigravity | Overwrite | `sha256(현재 파일)` ≠ PR2 가 마지막 write 한 hash |
| Claude Code, Gemini | ManagedBlock | `sha256(read_managed_block 의 inner content)` ≠ PR2 의 마지막 hash. **블록 밖 변경은 무시**. |

마지막 hash 저장 위치: PR2 §6 "다음 PR 로 넘기는 메모" 의 SQLite 테이블 — 본 PR 에서 마이그레이션 추가.

```sql
-- migrations/0XX_oculpm_agent_state.sql
CREATE TABLE oculpm_agent_state (
    project_id INTEGER NOT NULL,
    agent_id   TEXT    NOT NULL,
    last_hash  TEXT    NOT NULL,           -- hex sha256
    last_written_at INTEGER NOT NULL,      -- unix sec
    PRIMARY KEY (project_id, agent_id)
);
```

PR2 의 `sync_active` 가 write 성공 시 이 테이블 upsert.

---

## 2. 워처 통합 (계획)

W2-PR3 의 watcher 에 추가 hook:

```rust
// 어댑터 마커 4 파일을 의도적으로 ignore_pattern 에서 제외 (이미 .git/.oculpm 만 ignore).
const AGENT_MARKER_PATHS: &[&str] = &[
    ".cursor/rules/ocul-pm.mdc",
    ".claude/CLAUDE.md",
    ".agent/rules/ocul-pm.md",
    "GEMINI.md",
];

// notify 이벤트 받을 때 마커 매치 시 별도 분기:
async fn handle_agent_marker_change(
    path: &Path,
    project_id: u32,
    db: &Db,
) -> Result<(), OculpmError> {
    let agent_id = lookup_agent_id_by_path(path);
    let current_hash = compute_hash_by_mode(path, adapter.write_mode).await?;
    let last_hash = db.get_agent_last_hash(project_id, agent_id).await?;
    if current_hash != last_hash {
        emit("oculpm:agent_drift", AgentDriftEvent {
            project_id,
            agent_id,
            expected_hash: last_hash,
            actual_hash: current_hash,
        });
    }
}
```

---

## 3. 이벤트 + 토스트 (계획)

새 이벤트 (W2-PR5 의 collect_events 에 추가):

```rust
#[derive(Debug, Clone, serde::Serialize, specta::Type, Event)]
pub struct OculpmAgentDrift {
    pub project_id: u32,
    pub agent_id: String,
    pub expected_hash: String,
    pub actual_hash: String,
}
```

프론트 토스트 (PR8 가 wire) — 본 PR 의 emit 만 구현:

```
"Cursor 의 ocul-pm 규칙 파일이 외부에서 수정됐습니다.
 동기화하시겠어요? [동기화] [무시]"
```

- [동기화] → `oculpmApi.syncAgents(projectId)` → PR2 의 sync_active → 새 hash 로 SQLite 갱신 → 다음 drift 안 뜸.
- [무시] → 5분 쿨다운 (sessionStorage `oculpm.drift.dismissed.${agent_id}` = timestamp) → 같은 어댑터의 다음 drift 는 5분 뒤에만 토스트.

---

## 4. 테스트 (계획)

페이즈 §1 W4-PR4: 3 케이스.

### tempdir 통합

- [ ] 직접 `.cursor/rules/ocul-pm.mdc` 편집 (echo 로 1글자 추가) → 1초 안에 `oculpm:agent_drift` emit + `agent_id == "cursor"`.
- [ ] 블록 밖 사용자 콘텐츠만 편집 (Claude Code `.claude/CLAUDE.md` 의 관리 블록 밖에 문장 추가) → drift emit 없음.
- [ ] 블록 안 편집 (ManagedBlock 안 1글자 수정) → drift emit + `agent_id == "claude-code"`.

### 5분 쿨다운 (Vitest, 프론트 PR8 의 토스트 로직)

- [ ] drift 1회 → 토스트 표시 → [무시] → sessionStorage 에 timestamp 기록.
- [ ] 같은 어댑터의 drift 5분 안 → 토스트 안 뜸.
- [ ] 5분 후 drift → 다시 토스트.

---

## 5. DoD

- [x] 3개 통합 케이스 통과 (실제 4개 — Cursor external / Claude outside-block / Claude inside-block / resync-clears).
- [ ] **PR8 책임**: drift 무시 시 다음 sync 까지 같은 토스트 반복 X (5분 sessionStorage 쿨다운). 본 PR 은 emit 까지.
- [x] SQLite migration `013_oculpm_agent_state.sql` 추가 + `CREATE TABLE IF NOT EXISTS` 로 idempotent.
- [x] managed block begin/end 한쪽 파손 → `sync_active` 가 해당 어댑터의 `AgentSyncResult.action == "error"` + `error: "managed block …"` 반환 (W4-PR2 의 `managed_block_orphan_marker_surfaces_as_error_result` 가 이미 보장). 본 PR 은 그 result 의 `last_hash: None` → db upsert 스킵 → drift 비교는 안 일어남 (PR8 가 error result 를 보고 별도 토스트).

---

## 6. 실행 노트 (작업 중 갱신)

### 의사결정 후보

1. **last_hash 저장 위치** — SQLite vs `.oculpm/agents/.state.json` vs in-memory. 페이즈 §1 의 SQLite 채택 (재시작 후에도 보존).
2. **워처 sub-debounce** — 사용자가 에디터에서 저장 → notify 가 여러 이벤트 emit (특히 atomic write 의 rename 이벤트). 어댑터 마커 path 에 대해 별도 200ms debounce 권장 (W2 의 일반 debounce 와 분리).
3. **5분 쿨다운의 store 위치** — sessionStorage (브라우저 탭 단위) vs localStorage (영구). 사용자가 앱 재시작 시까지 무시하고 싶을 수 있어 sessionStorage 가 안전.
4. **`syncAgents` 실패 시** — 토스트 destructive 로 전환 + 사용자가 수동 재시도. drift 는 여전히 미해결로 유지 (last_hash 갱신 안 됨).

### 발견된 함정 / 변경

- **P-1 (`sync_agents` 시그니처)**: 기존 `sync_agents(&self, project_id)` 가 db 필요 없었지만 PR4 가 db upsert 추가 → `(&self, db: &Db, project_id)` 로 변경. 호출자 (watcher cascade, command) 도 함께 갱신. 깨짐 없이 통과.
- **P-2 (ManagedBlock inner 헬퍼)**: `read_managed_block` 는 `ManagedBlock` struct 반환 — `.content` 필드가 inner. `as_bytes()` 직접 호출 컴파일 에러로 한 차례 fix.
- **P-3 (self-write race)**: watcher 의 notify event 가 sync 의 write 와 db upsert 사이에 끼면 false drift 가능. 실측: write 후 즉시 (sync_agents 동일 await 내) upsert 라 fs notify debounce window (500ms) 안에 다 끝남 — race 미관찰. 만약 자동 dogfooding 운영 시 false drift 보이면 watcher 에 50~100ms 추가 sleep.
- **P-4 (AppHandle 없는 단위 테스트)**: drift 통합 테스트는 manager 의 `check_agent_drift` 를 직접 호출 — watcher path 의 emit 까지는 검증 안 함. watcher 의 emit 은 PR8 wire 시 사용자 dev 손검증으로 확인.
- **P-5 (last_hash None 케이스)**: error result / removed / unhashable 시 `last_hash: None` → db upsert 스킵 → stale row 잔존. 다음 successful sync 가 overwrite. 또는 `manager.sync_agents` 가 "비활성화된 adapter 는 row 삭제" 도 고려 가능 (W4-PR7 정책 결정).

### 다음 PR 로 넘기는 메모

- **PR8**: `OculpmAgentDrift` 이벤트 listener + 5분 sessionStorage 쿨다운 (key: `oculpm.drift.dismissed.${agent_id}`) + [동기화]/[무시] 버튼. [동기화] 는 `oculpmApi.syncAgents(projectId)` 호출.
- **PR8**: `AgentSyncResult.action == "error"` 처리 — drift 와 별도 토스트 "Cursor 의 ManagedBlock 이 파손됐습니다 — 수동 정정 필요".
- **PR7 (Settings)**: "어댑터 상태" 섹션 — 각 어댑터의 `oculpm_agent_state_get` 결과 (`last_hash 첫 8자 / last_written_at`) 노출, drift 카운터 (별도 SQLite 컬럼 필요 시 별 PR).
- **PR9**: 자동 dogfooding 운영 중 LLM 이 `.claude/CLAUDE.md` 의 ocul-pm 블록을 의도치 않게 건드리면 drift 이벤트가 학습 신호로 동작 (회고에 기록).
