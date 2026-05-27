# W4-PR5 — `compare_layers` 커맨드 + LayerComparison

> **목표**: 한 세션의 index (ground truth: 워처가 본 파일들) ↔ journal (LLM 이 narrative 로 기록한 것) 을 비교해 누락 / 환각 / severity 를 반환. 이중 레이어 UI (PR6) 의 백엔드.
> **선행**: W4-PR3 (redact + forbidden 제외 규칙), W2-PR1 (`file_changes.ndjson` reader), W3-PR2 (journal cache reader).
> **참조**: [`../phases/W4-agents-dual-layer.md`](../phases/W4-agents-dual-layer.md) §W4-PR5 + §2.4 (캐시 비용).
> **상태**: ✅ (2026-05-25 — 6 통합 테스트 green)

---

## 1. 시그니처 (계획)

```rust
// src-tauri/src/commands/oculpm.rs 에 추가

#[tauri::command]
#[specta::specta]
pub async fn oculpm_compare_layers(
    manager: State<'_, OculpmManager>,
    project_id: u32,
    session_id: String,
) -> Result<LayerComparison, String>;

// src-tauri/src/oculpm/spec.rs

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct LayerComparison {
    pub session_id: String,
    pub workday: String,
    pub index_files: Vec<String>,         // session 의 unique paths (forbidden 제외)
    pub journal_files: Vec<String>,       // entries 의 files_touched union (forbidden 제외)
    pub matched: Vec<String>,             // intersection
    pub only_in_index: Vec<String>,       // 누락 (LLM 이 narrative 안 씀)
    pub only_in_journal: Vec<String>,     // 환각 (실제 변경 없는 path 를 LLM 이 적음)
    pub severity: MismatchSeverity,
    pub jaccard_index: f32,               // |∩| / |∪|
}

#[derive(Debug, Clone, Copy, serde::Serialize, specta::Type)]
pub enum MismatchSeverity { Ok, Warning, Critical }
```

---

## 2. 알고리즘 (계획)

페이즈 §1 W4-PR5 그대로:

```
1. session 의 workday 파악 (session_id 의 첫 8자).
2. file_changes.ndjson 에서 session_id 로 필터 → unique path 집합 = raw_index_files.
3. journal cache (PR3) 의 list_journal_entries(workday) 에서 session_id 매치 entries 추출
   → 모든 entry 의 frontmatter.files_touched.path union = raw_journal_files.
4. forbidden 적용 (PR3 의 is_forbidden_path):
   - 양쪽 set 에서 forbidden path 모두 제거.
   - 단, "**redacted/sensitive**:..." 로 마스킹된 path 도 제거 (정확한 매치 불가).
5. matched = index_files ∩ journal_files.
6. only_in_index = index_files \ journal_files.
7. only_in_journal = journal_files \ index_files.
8. jaccard = |matched| / |index_files ∪ journal_files|.
9. severity:
   - both empty → Ok (no activity)
   - jaccard ≥ 0.8 → Ok
   - jaccard ≥ 0.5 → Warning
   - else → Critical
```

### caching (페이즈 §2.4)

- session 의 entries 수십, file_changes 수백 가능 → 매 모달 open 시 재계산 부담.
- **session 이 ended 되면 결과를 SQLite `oculpm_layer_comparison_cache` 에 저장** (project_id, session_id PRIMARY KEY).
- session 이 active 면 캐싱 안 함 (계속 변함).
- 또는 프론트 sessionStorage 60초 캐시 — 페이즈 권장. 일단 sessionStorage 채택, 부담 측정 후 SQLite 로.

---

## 3. 테스트 (실제)

페이즈 §3 계획 5 + forbidden 1 = 6 케이스. 실제로 W4 dogfooding (2026-05-27 finding 14) 에서 발견된 tmp/agent-state false-positive 제거 1건이 더 추가되어 7 케이스. 모두 `oculpm::manager::tests::compare_layers_w4_pr5` 모듈에 있음.

> 검증: `cargo test --lib oculpm::manager::tests::compare_layers_w4_pr5` → 7/7 PASS.

- [x] 완전 일치 (10/10) → `Ok`, jaccard 1.0 — `perfect_overlap_is_ok`.
- [x] 심각한 mismatch → `Critical` — `heavy_mismatch_is_critical`.
- [x] 거의 완전 (9/10) → `Ok` — `near_perfect_is_ok`.
- [x] 중간 mismatch → `Warning` — `moderate_mismatch_is_warning`.
- [x] 둘 다 0 → `Ok` — `empty_session_is_ok`.
- [x] forbidden path 양쪽에서 제외 — `forbidden_paths_are_excluded_from_both_sides`.
- [x] **추가** (W4 dogfooding finding 14): tmp/agent-state peer 파일이 index 측 false-positive 누락으로 잡히지 않음 — `noise_paths_are_excluded_from_index_side`.

**임계 보정 메모**: severity 임계 (0.5 / 0.8) 는 finding 14 노이즈 필터 후 dogfooding 데이터로 다시 측정 필요. W5/W6 회고에서 분포 확인 후 조정.

---

## 4. DoD

- [x] 7개 시나리오 통과 (계획 5 + forbidden 1 + noise 1).
- [x] severity 임계 테이블화 — `severity_from_jaccard` 헬퍼가 상수로 0.5 / 0.8 컷.
- [x] forbidden 적용이 양쪽 set 에서 동일 (`forbidden_paths_are_excluded_from_both_sides` 보장).
- [x] `OculpmManager::compare_layers` + `oculpm_compare_layers` 커맨드 `lib.rs:collect_commands![]` 에 등록 (src-tauri/src/lib.rs:265).

---

## 5. 실행 노트 (작업 중 갱신)

### 의사결정 후보

1. **session 의 entries 검색 방식** — journal cache (PR3 SQLite) 의 `list_journal_entries(workday, filters)` 에 `session_id` 필터 추가 필요. 현재 EntryFilters 에는 session_id 가 없음. **본 PR 에서 추가** vs 새 helper `find_entries_by_session(session_id)`.
2. **jaccard vs 다른 메트릭** — Sørensen–Dice 도 가능. jaccard 가 직관적. 사용자 입장에서는 "X/Y 매치" 라벨이 더 중요.
3. **severity 임계의 동적 조정** — Settings 에 노출 vs 하드코드. v1 은 하드코드, PR9 측정 후 결정.
4. **결과 캐시 위치** — sessionStorage (프론트) 가 v1. SQLite 캐시는 측정 후 도입.

### 발견된 함정 / 변경

- **P-1 (중복 type 정의)**: `LayerComparison` placeholder 가 spec.rs 에 이미 있었음 (W1 stub). 새로 추가하지 않고 기존 struct 확장 (`workday`, `matched`, `jaccard_index` 필드 추가). Severity enum 도 기존 `Severity` (Ok/Warning/Critical) 재사용. PR doc 의 `MismatchSeverity` 는 작명 충돌 회피용일 뿐 — `Severity` 가 SSOT.
- **P-2 (cache 쿼리의 workday)**: 초안은 `files_for_session(project_id, workday, session_id)` 시그니처였으나 `ManualEntryDraft.session_id` 가 호출자 override 가능 → frontmatter.workday 와 session_id prefix 가 다를 수 있음. cache 쿼리에서 workday 조건 빼고 session_id 만으로 (idx_oculpm_journal_session) 매치 — 단순 + 정확.
- **P-3 (forbidden 양쪽 strip)**: index 는 watcher 가 이미 `**redacted/sensitive**:*` 로 마스킹. journal 은 PR3 가 forbidden path reject. 두 시점이 달라 한 쪽에만 마스킹이 남을 수 있음 → compare_layers 가 양쪽 set 에서 forbidden + redacted prefix 모두 strip 후 비교. 테스트 `forbidden_paths_are_excluded_from_both_sides` 가 보장.
- **P-4 (severity 임계)**: `0.5`/`0.8` 임계는 직관 기반. PR9 자동 dogfooding 데이터로 분포 측정 후 조정 가능 (현재 상수 `severity_from_jaccard`).

### 다음 PR 로 넘기는 메모

- PR6 (DiffVsNarrative) 가 본 PR 의 `LayerComparison` 를 받아 UI 렌더.
- PR8 (이벤트 → 토스트) 의 `oculpm:integrity_warning` 와 별개 — drift / mismatch 는 별 채널.
- W3-PR7 (JournalEntryDetail) 의 disabled `[⚖ index 비교]` 버튼이 본 PR 의 커맨드로 wire.
- W3-PR5 (EmptyToday V3) 의 disabled `[⚖ index 비교 보기]` 버튼도 동일.
