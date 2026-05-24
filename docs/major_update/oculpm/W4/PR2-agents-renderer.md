# W4-PR2 — `agents.rs` 렌더러 + `sync_active` + `detect`

> **목표**: PR1 의 5개 템플릿을 in-binary 임베드하고, 활성 어댑터 목록에 따라 디스크에 안전하게 write/remove + 외부 마커로부터 자동 감지하는 핵심 백엔드. PR4 (drift) / PR5 (compare) / PR7 (Settings) 모두 본 PR 의 시그니처에 의존.
> **선행**: W4-PR1 (5 template), W1-PR5 (`atomic_io::{write_atomic, write_managed_block, remove_managed_block}`), W1-PR4 (`OculpmConfig.agents.active`).
> **참조**: [`../phases/W4-agents-dual-layer.md`](../phases/W4-agents-dual-layer.md) §W4-PR2 + §2.2 (managed block EOL) + §2.3 (sync idempotency), [`../00-spec.md`](../00-spec.md) §6.

> **상태**: ⬜

---

## 1. 시그니처 (계획)

```rust
// src-tauri/src/oculpm/agents.rs

pub enum WriteMode { ManagedBlock, Overwrite }

pub struct AgentAdapter {
    pub id: &'static str,                  // "claude-code" 등
    pub adapter_path: &'static str,        // ".claude/CLAUDE.md"
    pub write_mode: WriteMode,
    pub render: fn(&AgentContext) -> String,
}

pub struct AgentContext {
    pub master_template: String,            // .oculpm/agents/_template.md 내용
    pub per_agent_override: Option<String>, // .oculpm/agents/per-agent/{id}.md
    pub project_meta: ProjectMeta,          // name, root, tz, etc.
}

pub struct ProjectMeta {
    pub project_id: u32,
    pub project_name: String,
    pub timezone: String,
}

pub fn known_adapters() -> Vec<AgentAdapter>;   // 4개 하드코드

pub async fn sync_active(
    root: &Path,
    config: &OculpmConfig,
) -> Result<AgentSyncReport, OculpmError>;

pub async fn detect(root: &Path) -> Vec<AgentDetection>;

pub struct AgentSyncReport {
    pub results: Vec<AgentSyncResult>,
}

pub struct AgentSyncResult {
    pub agent_id: &'static str,
    pub action: SyncAction,   // Wrote | Skipped | Removed | Failed
    pub error: Option<String>,
}

pub enum SyncAction { Wrote, Skipped, Removed, Failed }

pub struct AgentDetection {
    pub agent_id: &'static str,
    pub confidence: DetectConfidence,  // Present | Likely | Unknown
    pub adapter_path_exists: bool,
    pub adjacent_marker_exists: bool,
}
```

또한 `OculpmManager` 에 다음 메서드 추가 (W3-PR10 의 호출 지점이 본 PR 의 sync 를 호출):

```rust
impl OculpmManager {
    pub async fn sync_agents(&self, project_id: u32) -> Result<AgentSyncReport, OculpmError>;
    pub async fn detect_agents(&self, project_id: u32) -> Result<Vec<AgentDetection>, OculpmError>;
}
```

---

## 2. `sync_active` 알고리즘 (계획)

```
1. 마스터 템플릿 로드:
   - .oculpm/agents/_template.md 가 있으면 그대로
   - 없으면 PR1 의 master_ko.md.tpl in-binary 를 atomic_io::write_atomic 으로 생성
2. for adapter in known_adapters():
   a. if config.agents.active.contains(adapter.id):
        - per_agent_override = read .oculpm/agents/per-agent/{id}.md (Option)
        - rendered = (adapter.render)(&ctx)
        - rendered_hash = sha256(rendered)
        - current_hash = read_existing_hash(adapter)
        - if rendered_hash == current_hash → SyncAction::Skipped
        - else write according to adapter.write_mode:
            - ManagedBlock: atomic_io::write_managed_block(path, "oculpm", &rendered, CommentStyle::Markdown)
            - Overwrite:    atomic_io::write_atomic(path, &rendered)
          → SyncAction::Wrote
      else:
        - ManagedBlock: atomic_io::remove_managed_block(path, "oculpm") if file exists
        - Overwrite:    fs::remove_file(path) if exists
        → SyncAction::Removed (or Skipped if already absent)
3. 모든 result 를 AgentSyncReport 로 반환
```

### idempotency (페이즈 §2.3)

- `read_existing_hash`:
  - Overwrite: `sha256(fs::read(path))` 또는 파일 없으면 None.
  - ManagedBlock: `read_managed_block(path, "oculpm")` 의 inner content hash.
- rendered == existing → skip = drift 이벤트 잡음 방지.

### managed block EOL (페이즈 §2.2)

- 읽을 때 LF/CRLF 모두 수용 (normalize 후 hash).
- 쓸 때는 **원본 파일의 EOL 보존** — Windows 사용자가 CRLF 로 편집한 경우 LF 강제 변환하면 git diff 가 시끄러움.

---

## 3. `detect` 알고리즘 (계획)

각 어댑터에 대해:

| Confidence | 조건 |
|---|---|
| `Present` | adapter_path 파일 존재 (= 우리가 이미 또는 다른 도구가 만들었음) |
| `Likely` | 인접 마커 디렉토리/파일 존재 (`Cursor: .cursor/`, `Claude: .claude/`, `Antigravity: .agent/`, `Gemini: GEMINI.md` 또는 `.gemini/`) — adapter_path 자체는 없지만 사용자가 그 LLM 을 쓴다는 신호 |
| `Unknown` | 둘 다 없음 |

Settings UI (PR7) 의 "감지" 버튼 + Greenfield 위저드의 디폴트 활성화 추천에 사용.

---

## 4. 테스트 (계획)

페이즈 §3 의 매트릭스: `sync_active` 6 + `managed_block_write` 4 + `detect` 3 = 13개 단위.

### sync_active (tempdir)

- [ ] active = ["cursor", "claude-code"] → `.cursor/rules/ocul-pm.mdc` 생성 + `.claude/CLAUDE.md` 에 관리 블록 추가.
- [ ] active 에서 cursor 제거 → `.cursor/rules/ocul-pm.mdc` 삭제.
- [ ] `.claude/CLAUDE.md` 가 이미 있고 관리 블록 밖에 사용자 콘텐츠 → 블록 추가/갱신 후 사용자 콘텐츠 byte-perfect 보존.
- [ ] 마스터 템플릿 수정 → sync 1회 호출 → 모든 활성 어댑터에 반영 + rendered_hash 비교로 변경 감지.
- [ ] 동일 내용 sync 재호출 → 모든 어댑터 `SyncAction::Skipped` (drift 잡음 방지).
- [ ] per_agent_override 가 있는 어댑터 → render context 에 그 내용이 들어가는지.

### managed_block_write (어댑터 경로 특화)

- [ ] BEGIN/END 마커 양쪽 다 없음 → 새로 삽입.
- [ ] 마커 한쪽만 있음 → `ManagedBlockMismatch` 에러 (사용자 정정 필요).
- [ ] 마커 양쪽 다 있음 + 내용 동일 → no-op.
- [ ] CRLF 파일에 LF rendered 쓰기 → 파일의 EOL 보존 (CRLF 로 변환).

### detect

- [ ] `.cursor/` 디렉토리만 있고 `.mdc` 없음 → Cursor confidence = `Likely`.
- [ ] `.claude/CLAUDE.md` 가 있음 → Claude Code confidence = `Present`.
- [ ] 인접 마커 + adapter path 모두 없음 → `Unknown`.

---

## 5. DoD

- [ ] 13개 단위 테스트 통과.
- [ ] `.claude/CLAUDE.md` 의 관리 블록 밖 콘텐츠는 byte-perfect 보존 (테스트 #3 가 검증).
- [ ] `sync_active` idempotent — 같은 입력에 두 번 호출 시 디스크 mtime 변화 없음.
- [ ] `OculpmManager::sync_agents` 가 W3-PR10 의 greenfield init 흐름 안에서 호출 가능 (시그니처 정합).

---

## 6. 실행 노트 (작업 중 갱신)

### 의사결정 후보

1. **`render: fn` (function pointer) vs `Box<dyn Fn>` vs trait method** — function pointer 가 가장 가볍고 dispatch 0 비용. `dyn Fn` 은 generics 회피하지만 alloc. **fn 채택**.
2. **CommentStyle::Markdown 의 정확한 마커 형식** — `<!-- oculpm:begin -->` ↔ `<!-- oculpm:end -->`. W1-PR5 의 `atomic_io` 가 결정한 컨벤션 그대로.
3. **per-agent override 파일 위치** — `.oculpm/agents/per-agent/{id}.md`. 디렉토리 없으면 fall-back to None.
4. **`sync_agents` 의 동시 호출 안전성** — 여러 Tauri command 가 동시에 호출 가능. `Mutex<()>` per project 로 직렬화 권장. 또는 W1-PR6 의 `LockGuard` 가 이미 보호 중이라면 reuse.

### 발견된 함정 / 변경

(작성 중)

### 다음 PR 로 넘기는 메모

- PR4 의 drift 감지: 본 PR 의 마지막 sync 시점의 `rendered_hash` 를 어딘가 저장해야 함. 옵션: (a) SQLite 의 `oculpm_agent_state(project_id, agent_id, hash)` 테이블 (b) `.oculpm/agents/.state.json` (c) 메모리만 (앱 재시작 시 손실 — 외부 변경 모두 drift 로 잡힘 → 잡음). **SQLite 테이블 추천**.
- PR7 (Settings) 가 본 PR 의 `detect` 결과를 받아 UI 표시.
- PR9 의 자동 dogfooding 첫 시도에서 sync 가 실패하면 본 PR 의 에러 메시지가 토스트에 노출 → 사용자가 빠르게 진단 가능해야 함.
