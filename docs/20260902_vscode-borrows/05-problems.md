# B6 문제 패널

> [00-master-plan.md](00-master-plan.md) 의 Phase 5.
> 근거: `vscode/src/vs/workbench/contrib/markers`

## 지금 상태

진단은 **열려 있는 파일 하나**에만 보인다.

```
서버 publishDiagnostics
  → lsp/state.rs:428  ServerNotice::Diagnostics
      · raw_diagnostics(HashMap<PathBuf, Value>) 에 원본 저장 (코드 액션 context 용)
      · LspDiagnosticsPublished { project_id, path, diagnostics } 이벤트 emit
  → useLsp 가 **활성 파일 것만** 골라 CM6 lint 확장에 밀어 넣는다
```

그래서 "에이전트가 방금 뭘 깨뜨렸나" 를 보려면 파일을 하나씩 열어야 한다. rust-analyzer 는
`cargo check` 결과를 워크스페이스 단위로 밀어 주는데, 그 정보가 통째로 버려지고 있다.

## 무엇

코드 화면 우측(참조 패널과 같은 자리, 탭으로 공존)에 **문제** 목록. 파일별로 접히고,
심각도 필터(오류/경고/정보), 항목 클릭 시 그 파일·그 줄로 이동.

## 설계

### 어디에 모으는가 — 프런트 스토어

**백엔드에 워크스페이스 진단 저장소를 새로 만들지 않는다.** `raw_diagnostics` 는 코드
액션용이라 `forget_document` 에서 지워지고(문서를 닫으면 사라진다), 프로젝트 축도 없다
(키가 절대경로 하나). 그걸 문제 패널의 SSOT 로 승격하려면 수명·소유권을 다시 설계해야 하는데,
얻는 것은 "앱을 껐다 켜도 진단이 남는다" 뿐이다 — 그건 사실 **거짓말**이다. 서버를 다시
띄우면 진단은 어차피 다시 온다.

그래서: **`src/features/code/problemsStore.ts`** — 화면 밖에서 사는 모듈 스코프 스토어
(`codeBuffers.ts` 와 같은 선례).

```ts
type Key = `${number}:${string}`;                 // projectId:relPath
const map = new Map<Key, LspDiagnostic[]>();
export function applyPublished(e: LspDiagnosticsPublished): void;  // 빈 배열이면 delete
export function snapshot(projectId: number): ProblemFile[];        // 정렬된 읽기
export function subscribe(fn: () => void): () => void;             // useSyncExternalStore
export function clearProject(projectId: number): void;             // 서버 중지·프로젝트 전환
```

구독은 **창 최상위가 아니라 코드 화면**에서 한다(`CodeScreenV2` 가 마운트될 때
`events.lspDiagnosticsPublished` 하나를 붙인다). 코드 화면을 한 번도 안 연 창이 진단을
메모리에 쌓을 이유가 없다.

### 초기 스냅샷 — 얇은 커맨드 하나

이벤트만 들으면 "화면을 늦게 연" 경우가 빈다. 그래서 커맨드 하나를 **추가한다**:

```rust
// src-tauri/src/commands/lsp.rs
#[tauri::command] #[specta::specta]
pub async fn lsp_diagnostics_snapshot(
    db: State<'_, Db>, lsp: State<'_, LspState>, project_id: u32,
) -> Result<Vec<LspFileDiagnostics>, String>
// LspState 에 project_root 접두로 거른 raw_diagnostics → 좁은 타입으로 변환
// (diagnostics_from_json 재사용). 서버가 안 떠 있으면 빈 배열.
```

`LspFileDiagnostics { path: String, diagnostics: Vec<LspDiagnostic> }`.
브리지 절차(D2)를 지킨다 — `lib.rs` 의 `use` + `collect_commands![]` 양쪽 + `cargo test`.

한계는 정직하게 적는다: **서버가 그 파일을 아직 안 본 진단은 없다.** 이 패널은
"지금 언어 서버가 아는 문제" 이지 "프로젝트의 모든 문제" 가 아니다. 빈 상태 문구가
그 말을 해야 한다(빈 목록 = 문제 없음이 아니라 "아직 아는 문제 없음").

### 순수 모듈 `src/features/code/problemsModel.ts`

```ts
export interface ProblemFile { path: string; counts: SeverityCounts; items: LspDiagnostic[]; }
export function groupByFile(entries: [string, LspDiagnostic[]][]): ProblemFile[];
   // 정렬: 오류 있는 파일 먼저 → 오류 수 내림차순 → 경로 사전순
   // 파일 안: 줄 오름차순 → 열 오름차순
export function filterBySeverity(files: ProblemFile[], min: LspSeverity): ProblemFile[];
export function totalCounts(files: ProblemFile[]): SeverityCounts;
```

### UI

- `src/features/code/CodeProblems.tsx` — 참조 패널(`CodeReferences.tsx`)의 구조를 그대로
  따른다(같은 자리, 같은 접기·키보드 규약). 새 패널 껍데기를 만들지 않는다.
- 상태줄에 총계 뱃지 `⊘ 3 △ 12` — 클릭하면 패널을 연다. 이게 "패널이 있다" 를 알리는
  유일한 신호이므로 반드시 넣는다.
- 항목 클릭 → 기존 `openPath(path, line, pane, { ch, len })` (전역 검색이 쓰는 그 경로).
  미리보기 탭(B3)이 켜져 있어도 **고정으로 연다**(코드 이동이므로 — B3 표 참고).

## 실패 모드

- **진단 폭주**: 대형 리팩터 중 rust-analyzer 가 수천 개를 밀 수 있다. 스토어는 파일당
  상한 없이 들되, 렌더는 파일당 기본 50개 + "더 보기". 총 파일 200개를 넘으면 상위 200만.
- **경로 표기**: 서버는 `file://` URI 로 준다. 백엔드가 이미 프로젝트 상대 경로로 바꿔
  이벤트에 싣는다(`LspDiagnosticsPublished.path`) — 프런트는 그대로 쓴다.
- **프로젝트 전환**: 창이 프로젝트를 바꾸면 `clearProject`. 안 하면 남의 프로젝트 진단이
  섞인다.

## 파일별 변경

| 파일 | 변경 |
|---|---|
| `src-tauri/src/commands/lsp.rs` | `lsp_diagnostics_snapshot` |
| `src-tauri/src/lsp/state.rs` | 접두 필터 + 좁은 타입 변환 헬퍼 |
| `src-tauri/src/lib.rs` | `use` + `collect_commands![]` |
| `src/lib/bindings.ts` | (생성물 — `cargo test`) |
| `src/features/code/problemsStore.ts` · `problemsModel.ts` · `CodeProblems.tsx` | 신규 |
| `src/features/code/CodeScreenV2.tsx` | 이벤트 구독 · 패널 탭 · 상태줄 뱃지 |
| `src/features/code/code.css` · `src/i18n/*` | 패널 · 빈 상태 · 뱃지 |
| `src/__tests__/code_problems.test.tsx` | 신규 |

## 테스트

**순수** — `groupByFile` 정렬(오류 우선 · 개수 · 경로) · 파일 안 줄/열 정렬 ·
`filterBySeverity` · `totalCounts`.
**스토어** — `applyPublished` 로 갱신·빈 배열이면 삭제 · `clearProject` · 구독 알림 1회.
**컴포넌트** — 이벤트가 오면 목록이 는다 · 항목 클릭이 `openPath` 를 부른다 ·
빈 상태 문구가 "문제 없음" 이 아니라 "아직 아는 문제 없음" 이다 · a11y.
