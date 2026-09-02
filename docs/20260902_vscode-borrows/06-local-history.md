# B5 로컬 히스토리

> [00-master-plan.md](00-master-plan.md) 의 Phase 6 — 이 라운드에서 가장 큰 항목.
> 근거: `vscode/src/vs/workbench/contrib/localHistory/*` ·
> `vscode/src/vs/workbench/services/workingCopy/common/workingCopyHistoryService.ts` ·
> 설정 기본값은 `workbench.contribution.ts:480-512`
> (`enabled: true` · `maxFileSize: 256KB` · `maxFileEntries: 50` · `mergeWindow: 10s`)

## 왜 이 앱에서 다른 뜻인가

VS Code 의 로컬 히스토리는 "내가 저장할 때마다 판을 남긴다" 다. 여기서 파일을 고치는 것은
**주로 에이전트**다. 그래서 같은 기계가 다른 질문에 답한다:

> 이 파일이 오늘 어떻게 여기까지 왔나 — 누가(사람/에이전트), 언제, 무엇을 바꿔서.

지금 그 질문에 답하는 수단은 셋 다 구멍이 있다.
- **git** — 커밋 사이는 안 보인다. 에이전트는 한 커밋 안에서 파일을 열 번 고친다.
- **작업 일지 + entry_diffs** — 일지를 쓴 작업 단위만. 일지 없이 지나간 편집은 없다.
- **`file_snapshots`** — 경로당 **한 장**(마지막 색인분)뿐이다.

로컬 히스토리는 그 사이를 메운다. 그리고 이건 이 라운드에서 **소급이 불가능한 유일한
항목**이다 — 안 찍어 둔 판은 영원히 없다.

## 무엇

1. 파일이 바뀔 때마다 그 시점 내용을 한 장 저장한다 (사람 저장 · 에이전트 쓰기 모두).
2. 코드 화면에서 파일의 판 목록을 보고, 하나를 고르면 **지금 내용과의 인라인 비교**로
   들어간다 (이미 있는 비교 모드 기계를 그대로 쓴다).
3. 되돌리기 — 그 판의 내용을 지금 파일에 쓴다 (낙관적 잠금 통과).

## 저장 모델

### 어디에 — `.oculpm/index/history/`

`entry_diffs.rs` 의 선례를 그대로 따른다. 그 파일 주석이 이유를 이미 다 적어 뒀다:
`.oculpm/index/` 는 **워처가 자기 억제**하고(쓰기가 다시 이벤트를 만들지 않는다),
`.gitignore` 에 들어 있고(커밋으로 새어 나가지 않는다), SQLite 캐시와 달리 **마크다운에서
재생성되지 않는다**(캐시를 지워도 살아남는다).

```
.oculpm/index/history/
  <ab>/                          # blake3(rel_path) 앞 2글자 — 한 디렉터리에 수천 개를 안 넣는다
    <abcdef…16>/                 # blake3(rel_path) 앞 16글자
      meta.json                  # { path, entries: [{ ts_ms, hash, bytes, source, op }] }
      1756800000123-9f2a1c4d.snap   # 그 시점의 파일 내용 (원문 그대로)
```

- `meta.json` 은 매 캡처마다 **tmp → rename** 으로 통째 교체한다(작아서 비용이 없고,
  보존 정책 적용이 곧 이 파일의 재작성이다).
- `path` 를 meta 에 적어 두므로 해시 → 경로 역방향이 성립한다(디렉터리 이름만으로는 안 된다).
- **SQLite 테이블은 만들지 않는다.** v1 의 질문은 전부 "이 파일 하나" 라 그 파일의
  `meta.json` 한 장이면 답이 나온다. 프로젝트 전역 질문("오늘 바뀐 파일 전부")이 필요해지면
  그때 디렉터리를 걸어 캐시를 만든다 — SSOT 는 계속 디스크다 (SQLite=파생 캐시 규율).

### 언제 — 캡처 지점은 **한 곳**

`watcher.rs` 의 `handle_event` 7.5 단계 (현재 505–515행, `schedule_incremental_index` 를
부르는 바로 그 자리). 그 지점의 이점이 전부 그대로 온다:

- `.gitignore` + `watcher.ignore` 필터를 이미 통과했다 (`should_track`),
- 디렉터리 이벤트가 아니고, 금지 경로가 아니며,
- **해시가 이미 계산돼 있다** (`hash_after`) → 중복 캡처를 공짜로 거른다,
- 디바운스 루프 뒤라 저장 한 번에 이벤트 하나다,
- 그리고 **사람이 쓰든 에이전트가 쓰든 여기를 지난다** — 이게 이 설계의 핵심이다.

`code_write` 에는 캡처를 걸지 않는다(이중 캡처가 된다). 대신 **누가 썼는가**만 알려 준다:

```rust
// 새 상태: HistoryState (lib.rs 의 managed state, LspState 옆)
note_self_write(project_id, rel_path, hash)   // code_write 성공 직후 기록 (TTL 5초)
take_source(project_id, rel_path, hash) -> Source   // 워처가 소비: 있으면 User, 없으면 Agent
```

TTL 안에 해시가 맞으면 `user`, 아니면 `agent`. (에디터 저장과 에이전트 쓰기가 5초 안에
같은 해시를 만드는 경우 = 내용이 같다 = 어차피 중복 캡처로 걸러진다.)

### 무엇을 — 전문 스냅샷

VS Code 와 같다: 패치가 아니라 **파일 전문**. 이유도 같다 — 어느 판이든 O(1)로 열 수 있고,
사슬 중간이 깨져도 나머지가 산다. 압축하지 않는다(zstd 는 지금 의존성에 없고,
256KB × 50 = 파일당 최대 12.8MB 로 캡이 이미 작다).

### 보존 정책 (VS Code 기본값 그대로)

| 규칙 | 값 | 근거 |
|---|---|---|
| 최대 파일 크기 | 256KB | 넘으면 아예 안 남긴다 (상수, 설정 아님) |
| 파일당 최대 판 수 | 50 (설정) | 넘으면 가장 오래된 것부터 버린다 |
| 병합 창 | 10초 | **같은 source** 의 직전 판을 교체한다 |
| 텍스트만 | 인덱서의 바이너리 판정 재사용 | 이미지 판을 50장 쌓지 않는다 |

병합 창의 "같은 source" 조건이 특히 중요하다. 자동 저장(B2)을 켜면 사람 저장은 초 단위로
쌓이므로 병합이 필요하고, 반대로 **내 저장 직후의 에이전트 쓰기는 절대 병합하면 안 된다** —
그 경계가 바로 사용자가 보고 싶어 하는 지점이다.

## 커맨드 (D2 브리지 절차)

```rust
// src-tauri/src/commands/code_history.rs (새 파일)
code_history_list(project_id, rel_path) -> Vec<HistoryEntry>
    // meta.json 을 읽어 최신순. 없으면 빈 배열(오류 아님)
code_history_read(project_id, rel_path, ts_ms) -> String
    // 그 판의 내용. 없으면 오류(사용자에게 "그 판이 정리됐습니다")
code_history_restore(project_id, rel_path, ts_ms, base_hash) -> CodeWriteOutcome
    // 기존 write_with_lock 을 그대로 통과 — 되돌리기도 충돌 검사를 받는다 (D7)
code_history_forget(project_id, rel_path) -> ()
    // 이 파일의 판 전부 삭제 (사용자 요청 · 민감 파일)
```

`HistoryEntry { ts_ms: i64, hash: String, bytes: u32, source: "user" | "agent", op: "create" | "update" }`.

리네임/삭제: 워처가 rename 을 주면 히스토리 디렉터리도 새 경로 키로 옮긴다(내용 유지).
삭제는 판을 지우지 **않는다** — 지운 파일의 내용을 되찾는 것이 이 기능의 가장 좋은 순간이다.

## UI

두 자리만 쓴다. 새 화면을 만들지 않는다.

1. **브레드크럼 액션** (`.code-crumbs-actions` — 일지 칩·HEAD 비교·svg 토글이 있는 그 줄)에
   시계 아이콘 + 판 수. 누르면 팝오버(일지 팝오버 `.code-jrnl-pop` 와 같은 구조·같은 CSS 계열):
   `14:32 · 에이전트 · 2.1KB` 행이 최신순으로.
2. **인라인 비교 재사용** — 행을 클릭하면 `diffMode = { kind: "history", ts }` 로 들어가고
   `diffOriginal` 에 그 판의 내용을 넣는다. 지금 HEAD·일지 비교가 쓰는 그 경로 그대로다
   (`CodeEditor` 의 `diffOriginal` prop → `unifiedMergeView`). 비교 배너에 "이 판으로
   되돌리기" 버튼 하나.

되돌리기는 확인을 받는다(`useConfirm`) — 미저장 편집이 있으면 그 사실을 문구에 적는다.

## 설정

| 설정 | 기본 | 비고 |
|---|---|---|
| `codeLocalHistory` | **true** | D1 의 예외. 이 기능만 소급이 불가능하다 — 나중에 켜 봐야 잃은 판은 안 돌아온다. 대신 캡이 작고, 저장 위치가 gitignore 안이며, "이 파일 판 지우기"·"전부 지우기" 를 준다 |
| `codeLocalHistoryMaxEntries` | 50 | 0 이면 사실상 끄기와 같다 |

설정 화면에 **지금 쓰는 용량**을 표시하고(디렉터리 크기 1회 계산), "전부 지우기" 버튼을 둔다.
보이지 않는 곳에서 디스크를 먹는 기능은 반드시 자기 크기를 보여 줘야 한다.

## 실패 모드

- **디스크 폭증**: 대형 리팩터로 에이전트가 200개 파일을 20번씩 고치면 최악 200×20×평균크기.
  캡(파일당 50 · 256KB)과 병합 창이 상한을 준다. 그래도 프로젝트 총량 상한을 하나 더 둔다:
  **총 512MB** 를 넘으면 오래된 판부터 정리(캡처 시 1/50 확률로 전역 정리를 돌린다 —
  매번 걷지 않는다).
- **추적되지 않는 프로젝트**: 워처는 `.oculpm/` 이 있는 프로젝트에서만 돈다. 그 밖에서는
  히스토리도 없다 — 설정 화면과 빈 상태에 그대로 적는다.
- **비밀**: `.env` 류는 보통 gitignore 라 워처를 못 지난다. 그래도 지나는 경우를 위해
  `redact.rs` 를 **적용하지 않는다** — 스냅샷은 되돌리기용이라 원문이어야 한다. 대신
  gitignore 되지 않은 `.env*` 는 캡처에서 제외하고(상수 목록), "이 파일 판 지우기" 를 준다.
- **캐시 재구축**: `.oculpm/index/` 를 통째로 지우는 흐름(색인 정리)이 히스토리까지 지우면
  안 된다. `history/` 를 그 정리 대상에서 제외한다 — `031_purge_index_noise.sql` 계열의
  정리 코드와 `index.rs` 의 청소 경로를 함께 확인한다.

## 파일별 변경

| 파일 | 변경 |
|---|---|
| `src-tauri/src/oculpm/history.rs` | 신규 — 레이아웃·캡처·보존·읽기 (순수에 가깝게, 테스트 가능하게) |
| `src-tauri/src/oculpm/watcher.rs` | 7.5 단계에 캡처 호출 (fire-and-forget) |
| `src-tauri/src/commands/code_history.rs` | 신규 — 커맨드 4개 |
| `src-tauri/src/commands/code.rs` | `code_write` 성공 시 `note_self_write` |
| `src-tauri/src/lib.rs` | `HistoryState` managed state · `use` · `collect_commands![]` |
| `src/features/code/CodePane.tsx` | 브레드크럼 액션 · 팝오버 · `diffMode.kind = "history"` · 되돌리기 |
| `src/features/code/code.css` · `src/i18n/*` | 팝오버·배너·확인 문구 |
| `src/lib/settings.ts` · `CodeSettings.tsx` | 설정 2 + 용량 표시 + 전부 지우기 |
| `src-tauri/tests/oculpm_history.rs` | 신규 — 통합 |
| `src/__tests__/code_history.test.tsx` | 신규 — UI |

## 테스트

**Rust(`oculpm_history.rs`)** — 캡처 1회로 meta+snap 이 생긴다 · 같은 해시는 두 번 안 남는다 ·
병합 창 안의 같은 source 는 교체된다 · **다른 source 는 교체되지 않는다** · 50개 캡에서
가장 오래된 것부터 빠진다 · 256KB 초과는 안 남는다 · 리네임 후에도 판이 따라온다 ·
`code_history_restore` 가 base_hash 불일치에서 충돌을 돌려준다 · `.oculpm/index/history/`
쓰기가 워처를 재발화시키지 않는다(자기 억제 확인).

**프런트(`code_history.test.tsx`)** — 판 목록이 최신순으로 뜬다 · source 라벨(사람/에이전트) ·
행 클릭이 비교 모드로 들어간다 · 되돌리기가 확인을 거친다 · 판이 없으면 액션이 안 뜬다.
