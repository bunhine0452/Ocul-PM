# W4-PR2 — `agents.rs` 렌더러 + `sync_active` + `detect`

> **목표**: PR1 의 5개 템플릿을 in-binary 임베드하고, 활성 어댑터 목록에 따라 디스크에 안전하게 write/remove + 외부 마커로부터 자동 감지하는 핵심 백엔드. PR4 (drift) / PR5 (compare) / PR7 (Settings) 모두 본 PR 의 시그니처에 의존.
> **선행**: W4-PR1 (5 template), W1-PR5 (`atomic_io::{write_atomic, write_managed_block, remove_managed_block}`), W1-PR4 (`OculpmConfig.agents.active`).
> **참조**: [`../phases/W4-agents-dual-layer.md`](../phases/W4-agents-dual-layer.md) §W4-PR2 + §2.2 (managed block EOL) + §2.3 (sync idempotency), [`../00-spec.md`](../00-spec.md) §6.

> **상태**: ✅ (2026-05-24) · 🔧 **PostFix 2026-05-25**: dogfooding 발견 → `agents-md` 어댑터 추가 + 4종 어댑터 템플릿을 위임 stub 으로 단축.

> 📌 **Post-dogfooding addendum (2026-05-25)** — 자세한 동기와 변경 위치는 [`../phases/_dogfooding-w4.md`](../phases/_dogfooding-w4.md) §2026-05-25 발견 1 / 조치 완료 1 참조. 요지: 외부 LLM 들이 `.oculpm/agents/_template.md` 를 자발적으로 안 읽음 → 프로젝트 루트 `AGENTS.md` 를 1차 surface 로 삼고 `known_adapters()` 맨 앞에 `agents-md` (path: `AGENTS.md`, ManagedBlock) 등록. 기존 4종 어댑터 (`.claude/CLAUDE.md`, `.cursor/rules/ocul-pm.mdc`, `.agent/rules/ocul-pm.md`, `GEMINI.md`) 의 in-binary `.tpl` 은 풀 콘텐츠가 아니라 `@AGENTS.md` 위임 stub 으로 교체됨. `default_for_new_project()` 의 기본 active 가 `[]` → `["agents-md"]` 로 변경. `KNOWN_AGENT_IDS` 에 `"agents-md"` 추가.

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

## 4. 테스트 (실제)

페이즈 §3 매트릭스 13개 (sync_active 6 + managed_block_write 4 + detect 3) 모두 `oculpm::agents::tests` 에 작성됨. 일부 시나리오는 `atomic_io::tests` 에서 저수준으로 한 번 더 검증됨 (중복 아님: 경로 특화 vs 도구 정확성).

> 검증: `cargo test --lib oculpm::agents` → 13/13 PASS. 전체 oculpm suite 173/173.

### sync_active (`oculpm::agents::tests`)

- [x] active 다중 어댑터 → 어댑터 파일 각각 생성 + 관리 블록 작성 — `sync_writes_overwrite_and_managed_block`.
- [x] active 에서 어댑터 제거 → 어댑터 파일 삭제 — `sync_remove_overwrite_adapter`.
- [x] 사용자 콘텐츠 보존 — `sync_managed_block_preserves_user_content_byte_perfect`.
- [x] 마스터 수정 후 sync → 모든 활성 어댑터 반영 (cascade 는 watcher 가, sync 1회 호출 = `sync_writes_master_template_on_first_run_only` + PR4 drift 테스트가 외부 편집 시 hash 비교 검증).
- [x] 동일 내용 sync 재호출 → `Skipped` — `sync_is_idempotent_on_unchanged_inputs` (mtime 까지 보존).
- [x] per_agent_override 가 활성 어댑터 콘텐츠로 propagate — `sync_per_agent_override_propagates_to_active_adapter`.

### managed_block_write (`oculpm::agents::tests` + `atomic_io::tests` 미러)

- [x] 마커 부재 → 삽입 — `managed_block_inserts_when_file_absent`, `atomic_io::managed_block_insert_paths`.
- [x] 마커 한쪽만 → `ManagedBlockMismatch` 에러 — `managed_block_orphan_marker_surfaces_as_error_result`, `atomic_io::managed_block_mismatch_orphan_marker`.
- [x] 마커 양쪽 + 내용 동일 → no-op — `managed_block_unchanged_when_content_matches`, `atomic_io::managed_block_update_and_unchanged`.
- [x] CRLF 파일 EOL 보존 — `managed_block_preserves_crlf_eol_from_source`, `atomic_io::managed_block_read_remove_and_crlf`.

### detect (`oculpm::agents::tests`)

- [x] `.cursor/` 디렉토리만 → `Likely` — `detect_cursor_likely_when_only_directory_present`.
- [x] `.claude/CLAUDE.md` 존재 → `Present` — `detect_claude_present_when_adapter_path_exists`.
- [x] 어댑터 흔적 전무 → `Unknown` — `detect_unknown_when_nothing_on_disk`.

---

## 5. DoD

- [x] **13개 단위 테스트 통과** (`cargo test --lib oculpm::agents` = 13/13 green; 전체 `oculpm` suite = 145/145).
- [x] `.claude/CLAUDE.md` 의 관리 블록 밖 콘텐츠는 byte-perfect 보존 (테스트 `sync_managed_block_preserves_user_content_byte_perfect`).
- [x] `sync_active` idempotent (테스트 `sync_is_idempotent_on_unchanged_inputs` — mtime 비교까지 검증).
- [x] `OculpmManager::sync_agents` + `detect_agents` 구현. greenfield init 흐름에서 호출 가능 — Tauri 커맨드 `oculpm_agents_sync_active` / `oculpm_agents_detect` 노출. (실제 greenfield wizard wire-up 은 별 follow-up — 본 PR 은 시그니처 정합까지만.)
- [x] watcher 의 `.oculpm/agents/**` 분기에 `cascade_agents_resync` 추가 — 마스터 편집 시 모든 활성 어댑터 자동 갱신.

---

## 6. 실행 노트 (작업 중 갱신)

### 의사결정 후보

1. **`render: fn` (function pointer) vs `Box<dyn Fn>` vs trait method** — function pointer 가 가장 가볍고 dispatch 0 비용. `dyn Fn` 은 generics 회피하지만 alloc. **fn 채택**.
2. **CommentStyle::Markdown 의 정확한 마커 형식** — `<!-- oculpm:begin -->` ↔ `<!-- oculpm:end -->`. W1-PR5 의 `atomic_io` 가 결정한 컨벤션 그대로.
3. **per-agent override 파일 위치** — `.oculpm/agents/per-agent/{id}.md`. 디렉토리 없으면 fall-back to None.
4. **`sync_agents` 의 동시 호출 안전성** — 여러 Tauri command 가 동시에 호출 가능. `Mutex<()>` per project 로 직렬화 권장. 또는 W1-PR6 의 `LockGuard` 가 이미 보호 중이라면 reuse.

### 발견된 함정 / 변경

- **AgentsConfig 가 spec.rs 에 이미 정의됨** + `auto_detect_on_open` / `auto_sync_adapters` 두 필드를 갖고 있음. 본 PR 의 sync_active 는 `active` 만 보고 결정 — auto_* 두 필드는 호출자 (Greenfield wizard / Settings save / watcher) 책임 영역.
- **PR1 의 ManagedBlock 템플릿 마커가 잘못 박혀 있었음**. atomic_io 가 `oculpm:begin/end` 마커를 자동 wrap 하니까, 템플릿 contents 안에는 markers 없어야 함. claude_code.md.tpl / gemini.md.tpl 두 파일에서 마커 라인 제거 + 안내 문구를 일반 텍스트로 변경.
- **AgentSyncResult.action 이 enum 이 아니라 String** (spec.rs 에 이미 그렇게 정의). PR doc 의 SyncAction enum 은 무시하고 spec 의 String ("inserted/updated/unchanged/removed/error") 사용 — 호환성 우선.
- **watcher → manager.sync_agents cascade** 추가. PR doc 에 "watcher trigger" 가 명시되지 않았지만 페이즈 §8.3 가 요구. `app_handle.state::<OculpmManager>()` 패턴으로 (journal cache invalidation 과 동일).

### 다음 PR 로 넘기는 메모

- PR4 의 drift 감지: 본 PR 의 마지막 sync 시점의 `rendered_hash` 를 어딘가 저장해야 함. 옵션: (a) SQLite 의 `oculpm_agent_state(project_id, agent_id, hash)` 테이블 (b) `.oculpm/agents/.state.json` (c) 메모리만 (앱 재시작 시 손실 — 외부 변경 모두 drift 로 잡힘 → 잡음). **SQLite 테이블 추천**.
- PR7 (Settings) 가 본 PR 의 `detect` 결과를 받아 UI 표시.
- PR9 의 자동 dogfooding 첫 시도에서 sync 가 실패하면 본 PR 의 에러 메시지가 토스트에 노출 → 사용자가 빠르게 진단 가능해야 함.
