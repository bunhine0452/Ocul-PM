# 05. Index 비교 — 로컬 diff 뷰어 (Session 추정 없이)

> 본 문서의 위상: [`00-master-plan.md`](./00-master-plan.md) D5 의 구체 설계.
> [`02-removal-plan.md`](./02-removal-plan.md) 의 PR3 으로 *세션 추정 UI* 가 사라진 뒤 그 자리에 들어오는 *대체 검증 경로*.

---

## 0. 사용자 발언 재인용

> *"reindex 를 통해서 변화된 파일을 감지하거나 현재 코드상으로 변화를 감지하는 로직은 구현되어있다. 이 구현은 잘 실행이 되나, 결론적으론 세션을 감지하지 못해서 반쪽자리 기능이다. 이기능을 잘 사용하면 유용할 것이라고 생각된다."*
>
> *"변경된 파일들 또는 생성된 파일들에 대한 reindex 만 실행할 수 있다면 로컬환경에서 바로 diff 도 판단 가능할 수 있지 않을까?"*
>
> *"원하는 것은 index 비교에 기록된 파일들에 대해서 어디가 어떻게 변경되었는지 코드를 보여주는 것이다. 코드를 제시하되 UI가 불편해선 안된다."*

이 세 발언이 본 문서의 *지배 명령*. 정리하면:

> **세션 추정 없이도** 변경/신규 파일의 *어디가 어떻게 바뀌었는지* 를 *불편하지 않은 UI* 로 보여준다. 외부 LLM 호출 없이 *로컬* 에서.

---

## 1. 현재 자산

### 1.1 백엔드

`src-tauri/src/oculpm/watcher.rs`:
- `notify-rs` 기반 파일 워처. 시작 시 cwd 의 모든 파일 hash 를 baseline 으로 저장.
- 변경 감지 시 `(path, op)` 를 ndjson 으로 `.oculpm/index/<workday>.ndjson` 에 append.

`src-tauri/src/db.rs`:
- `file_changes` 테이블 — `(project_id, path, change_type, old_hash, new_hash, detected_at)` — Watcher 가 write.

`src-tauri/src/commands/changelog.rs` (→ PR4 에서 삭제):
- `detect_file_changes(project_id) -> Vec<FileChange>` — `file_changes` 에서 *consumed=false* 행 반환.

`src-tauri/src/indexer.rs`:
- 전체 reindex API. *부분 reindex* 는 *없음*. 이게 사용자 발언의 핵심 갭.

`src-tauri/src/git.rs`:
- `diff_patch(project_id, path)` — git 저장소이면 `git diff HEAD -- <path>`. ✅
- 비-git 시 fallback 없음.

### 1.2 프론트엔드

`src/features/code/AiWorkbench.tsx` 의 `handleScan` — `detect_file_changes` 호출.
`src/features/code/AiWorkbench.tsx` 의 `handleSaveToChangelog` — *changelog 시스템 호출* (PR4 에서 제거).

= **변화 감지는 ✅, 부분 reindex 는 ❌, diff 시각화는 git-only ⚠️, UI 는 AiWorkbench 안의 작은 리스트 ⚠️**.

---

## 2. 신규 컴포넌트 — `LocalDiffView`

### 2.1 책임

1. *Watcher 가 본 변경 파일 리스트* 를 가져온다 (`commands::list_recent_changes`).
2. 사용자가 선택한 파일에 대해:
   - **부분 reindex** 실행 (`commands::reindex_paths`) — embedding + AST 갱신.
   - **diff 본문** 계산:
     - git 저장소: `git diff HEAD -- <path>` 결과.
     - 비-git: `file_snapshots(project_id, path, content_zstd, captured_at)` 의 *마지막 snapshot* vs *디스크 현재* 비교 (line-level diff).
3. 결과를 *unified-diff 색상 표* 또는 *side-by-side* 로 표시.
4. *어떤 파일* 에 대해 *어떤 시간 윈도우* 의 diff 를 보고 있는지 명확히 표시.

### 2.2 시간 윈도우 — *세션 없이* 어떻게 묶는가

세션 추정을 포기했으니 *시간 윈도우* 로 묶는다:

- **마지막 reindex 이후**: 사용자가 reindex 를 누른 *baseline* 시각 이후의 변경. 권장 기본.
- **오늘 (workday)**: `.oculpm/index/<오늘>.ndjson` 전체.
- **사용자 지정**: "최근 1시간 / 6시간 / 24시간".

이 윈도우 선택은 *FileTree 의 변경 하이라이트 비우기* 와 동일 의미. 사용자가 "이 변경들을 다 본 것으로 표시" 클릭 → baseline reset.

### 2.3 UI 골격

```
┌─ 변경된 파일 — 마지막 reindex 이후 ──────────────────────────┐
│ [윈도우 ▾]  [Git diff · 4 files]  [↻ 부분 reindex + diff]    │
├──────────────┬───────────────────────────────────────────────┤
│ Files (4)    │  src/features/diff/LocalDiffView.tsx       M  │
│              │                                                │
│ ● LocalDiff  │   12  import { useEffect, useState } …        │
│   View.tsx M │   13                                           │
│ ● diff.rs  A │   14- type Mode = "side-by-side" | "unified";  │
│ ● useDif…  M │   14+ type Mode = "unified";                   │
│ ● docs/    M │   15                                           │
│              │   16  export function LocalDiffView() { ...    │
│              │   ...                                          │
│              │   [unified ▾]   [↗ 외부 에디터]                │
└──────────────┴───────────────────────────────────────────────┘
```

- 좌측: 변경 파일 리스트. 클릭 → 우측에 diff.
- 상단: 윈도우 토글 + reindex 트리거 + 모드 (unified / side-by-side).
- diff 본문: react-diff-viewer 또는 직접 `diff` 라이브러리 + 우리 토큰으로 스타일.
- 빈 상태: "변경 없음. AI 가 작업한 후 watcher 가 변경을 감지하면 여기에 표시."

### 2.4 진입 경로

1. **Today 의 "변경된 파일" 카드** → 카드 헤더의 [diff 보기] 버튼 → ⌘B 사이드 패널에 LocalDiffView 마운트.
2. **FileTree 의 변경 하이라이트 dot** 클릭 → 좌측 ⌘B 패널에 자동 마운트 + 해당 파일 선택.
3. **CommandPalette** → "변경된 파일 diff 보기" 항목.
4. **TitleBar 의 Git chip** 클릭 → split 모드 + `git status` → 사용자가 직접 진입 (외부 경로).

---

## 3. 부분 reindex — 신규 백엔드

### 3.1 함수 시그니처

```rust
// src-tauri/src/commands/diff.rs (또는 indexer.rs 확장)

#[tauri::command]
#[specta::specta]
pub async fn reindex_paths(
    project_id: i64,
    paths: Vec<String>,            // relative paths
) -> Result<ReindexReport, AppError>;

pub struct ReindexReport {
    pub indexed: Vec<String>,
    pub skipped: Vec<SkipReason>,  // 예: too large, binary, gitignored
    pub elapsed_ms: u64,
    pub embeddings_updated: usize,
    pub ast_updated: usize,
}
```

### 3.2 구현

기존 `indexer::index_project` 의 *파일 1개당 파이프라인* 을 함수로 추출:

- `index_single_file(project_id, abs_path) -> ...` (이미 존재한다면 재사용).
- `reindex_paths` 가 paths 를 *순회 + 결과 누적*.
- 1만 파일 reindex 시 5분이 걸린다면, 10 파일 부분 reindex 는 < 5초 — 사용자 발언과 정합.

### 3.3 부수효과 (FileTree 의 하이라이트 정책)

부분 reindex 가 완료되면:
- 해당 paths 의 *변경 하이라이트 dot* 는 *유지* (사용자가 명시적 비우기 전까지는 표시).
- baseline 은 *유지* (윈도우 의미가 깨지지 않도록). 사용자가 reindex 결과를 *확인했음* 을 명시할 때 baseline reset.

---

## 4. diff 본문 — git / 비-git

### 4.1 git 저장소

- `commands::git::diff_patch(project_id, path)` 를 그대로 사용.
- 64KB 초과 시 head/tail truncation. (W1 PR3 에서 이미 구현)
- 바이너리: "(binary, no preview)".

### 4.2 비-git 저장소

- 새 테이블 `file_snapshots`:
  ```sql
  CREATE TABLE file_snapshots (
    id INTEGER PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    content_zstd BLOB NOT NULL,
    captured_at INTEGER NOT NULL,
    hash TEXT NOT NULL
  );
  CREATE INDEX idx_file_snapshots_path ON file_snapshots(project_id, path, captured_at);
  ```
- 워처가 변경 감지 직전 *수정 전 본문* 을 snapshot 으로 저장.
- diff 본문 = `last_snapshot.content` vs `현재 디스크` (line diff).

비용:
- 100KB 파일 1000 개 = 100MB. zstd 압축 후 ~30MB. 1.0 안엔 *최근 50 snapshot per path* 만 유지 (LRU).

### 4.3 마이그레이션 010

이미 [`docs/refactor/MASTER-GUIDE.md`](../refactor/MASTER-GUIDE.md) 의 §8.2 에 `010_file_snapshots.sql` 가 *조건부* 로 예약되어 있었음. **Lite 1.0 에서 정식 도입**.

---

## 5. 시각화 — *UI 가 불편하지 않게*

사용자 발언 *"UI가 불편해선 안된다"* 의 구체 보장:

| 보장 | 구현 |
|---|---|
| diff 가 *너무 길면 collapse*. 100줄 초과 시 "(... 234 more lines, expand)" 클릭. | react-diff-viewer 의 `extraLinesSurroundingDiff=3` + custom collapse 버튼. |
| diff 가 *너무 좁은 폭에서 깨지지 않음* | width < 640px 시 자동 unified 모드. side-by-side 는 ≥ 1024px. |
| 시각적 *과부하* 방지 | 추가/삭제 색은 W4 dogfood 때 검증된 토큰 `--cat-feature` / `--cat-fix` 의 *알파 30%* 배경. |
| 사용자가 *어디까지 봤는지* 표시 | 각 파일 우측에 *읽음/안읽음* 체크 (✓ 토글). 영속화. |
| 사이드 패널이 *언제든 닫힘* | ⌘B 또는 우측 ✕ 클릭. 패널이 닫혀도 *변경 하이라이트는 FileTree 에 잔존* — 다시 ⌘B 로 진입 가능. |
| 모달 X (W4 dogfood 의 교훈) | LocalDiffView 는 *오버레이가 아닌 사이드 패널*. 다른 모달과 동시에 살아남음. |
| 시간 윈도우 *명시* | 상단에 항상 "마지막 reindex 이후 · 4 files" 같은 컨텍스트 라벨. |

---

## 6. *Watcher* 의 invariant 보존

PR3 (Session UI 제거) 와 본 PR6 가 *백엔드 Watcher 모듈을 깨지 않는다* 는 보장이 핵심.

| Watcher invariant | 보존 방법 |
|---|---|
| `.oculpm/index/<workday>.ndjson` 에 *append-only* 작성 | 변경 없음. PR6 는 *읽기 전용 소비자* 만 추가. |
| `events.oculpmIndexLineAppended` 이벤트 발생 | 변경 없음. FileTree 가 새 listener 1 개 추가. |
| Workday boundary 처리 (자정 회전) | 변경 없음. |
| `.oculpm/agent-state/<agent>.json` 의 peer 파일 처리 | 변경 없음 (D4 의 *UI 만 제거*, watcher 의 인식은 유지). |

회귀 테스트: PR0 의 통합 테스트 W2 시나리오를 그대로 보존.

---

## 7. 데이터 흐름 — 한 그림

```
                 ┌──────────────────────────┐
                 │  Watcher (notify-rs)     │
                 │  → file_changes 행 추가   │
                 │  → ndjson 1줄 append      │
                 │  → emit oculpmIndexLine   │
                 └────────┬─────────────────┘
                          │
   ┌──────────────────────┼──────────────────────────┐
   ▼                      ▼                          ▼
WorkspaceContext       Today 카드               FileTree (변경 dot)
.recentChanges         "변경된 파일 (N)"
                          │
                          │ 클릭
                          ▼
              ┌─────────────────────────┐
              │ ⌘B 사이드 패널 마운트     │
              │ LocalDiffView           │
              │   ┌──────────────────┐   │
              │   │ reindex_paths    │   │
              │   │ → 부분 인덱스      │   │
              │   └──────────────────┘   │
              │   ┌──────────────────┐   │
              │   │ diff_patch       │   │
              │   │ or               │   │
              │   │ snapshot compare │   │
              │   └──────────────────┘   │
              │                         │
              │ side-by-side 또는        │
              │ unified diff 표시        │
              └─────────────────────────┘
```

---

## 8. PR 단위 분해 (PR6 의 내부)

`Lite-W6 PR6` 의 하위 작업:

- **PR6.1** — 마이그레이션 010 (`file_snapshots`) + Watcher 의 snapshot 작성.
- **PR6.2** — `commands::diff::reindex_paths`, `commands::diff::compute_diff(path, baseline_at)`.
- **PR6.3** — `LocalDiffView.tsx` + ⌘B 사이드 패널 mount.
- **PR6.4** — Today 카드 / FileTree 의 진입 경로 wire-up.
- **PR6.5** — collapse / 폭 적응 / 읽음 토글 등의 UX 디테일.

각 sub-PR 은 *부모 PR* 의 feature flag (`feature_local_diff_v1`) 뒤에서 점진 머지. PR6.5 까지 ✅ 되면 플래그 ON.

---

## 9. 성능 SLO

| 항목 | 목표 |
|---|---|
| 부분 reindex (10 파일, 평균 200줄) | < 5초 |
| diff_patch 단일 파일 64KB | < 200ms |
| LocalDiffView 마운트 | < 100ms |
| 100 lines unified diff 렌더링 | < 50ms (60fps) |
| 1000 lines side-by-side | < 200ms (가상화 적용 시) |

미달 시: react-virtual 도입, 워커 스레드 (web worker) 로 diff 계산, snapshot 압축 비율 조정.

---

## 10. 결정 완료 항목 (2026-05-28 잠금)

본 §의 결정은 모두 [`07-implementation-checklist.md`](./07-implementation-checklist.md) §0.6 에서 잠금.

1. **`file_snapshots` 보관 정책** → **per-path 최근 50개, LRU**.
2. **diff 기본 모드** → **폭 ≥ 1024px = side-by-side, 외 = unified**. 사용자 토글 영속화.
3. **읽음/안읽음 체크** → **1.0 포함**.
4. **다중 파일 동시 diff** → **1.1 로 미룸** (1.0 은 1 파일씩).
5. **"AI 에게 이 변경 설명" 액션** → **1.0 옵션**. LocalDiffView 우상단 액션 — Quick Edit 의 변형으로 호출. [`03-feature-revisions.md`](./03-feature-revisions.md) 의 AI 패널과 연동.
