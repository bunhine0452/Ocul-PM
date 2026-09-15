# 최적화 원장

> **살아 있는 문서.** 최적화는 앞으로 여기에 적는다. 라운드마다 새 폴더를 파지
> 않는다 — 성능은 한 번 끝나는 일이 아니라 **같은 값을 다시 재는 일**이라서,
> 기록이 흩어지면 "좋아졌는가" 를 물을 수 없다.

## 이 문서의 규칙 세 줄

1. **측정 없이 항목을 올리지 않는다.** "이러면 느릴 것" 은 코드 판정이지 관찰이
   아니다. 근거가 구조적 추정이면 **추정이라고 적는다.**
2. **죽은 추정도 적는다.** 재 봤더니 아니었던 것은 지우지 않고 「기각」 으로
   남긴다 — 지우면 다음 사람이 같은 것을 또 의심한다. 선례는
   [`20260904_v242-load-bearing/perf-baseline.md`](../20260904_v242-load-bearing/perf-baseline.md)
   가 `screens.css` 파싱 추정을 죽인 자리다.
3. **값에는 방법이 붙는다.** 재현 명령이 없는 숫자는 다음 라운드가 비교할 수 없다.

진행 상태는 여기 없다 — `.oculpm/planner/*.md` 가 갖는다. 이 문서는 **무엇을
쟀고 무엇이 남았는가** 만 갖는다.

## 재현 방법

| 무엇 | 명령 |
|---|---|
| 백엔드 (워처·인덱서·DB) | `cargo test --release --test perf_baseline -- --ignored --nocapture` |
| 번들 크기 | `pnpm build` 후 `ls -S dist/assets \| head -25` · `gzip -c <청크> \| wc -c` |
| 800줄 초과 잔고 | 아래 §4 스니펫 |
| lint 잔고 | `npx eslint . -f json` · `cargo clippy --all-targets` |
| WKWebView 초기 페인트 | dev 실행 후 `grep '\[perf\]' <앱데이터>/logs/oculpm.log.$(date +%F)` |
| 실행 중 프로세스 메모리 | `vmmap --summary <pid>` (Physical footprint · MALLOC_LARGE 행) |
| 라이브 DB 조성 | 사본에 `sqlite3 snap.db "SELECT name, SUM(pgsize) FROM dbstat GROUP BY name ORDER BY 2 DESC"` |
| 로그 소음 | `sed -E 's/[0-9]+/N/g' oculpm.log.<날짜> \| sort \| uniq -c \| sort -rn` |

백엔드 하니스의 상세와 v2.42.0 기준선은 [`perf-baseline.md`](../20260904_v242-load-bearing/perf-baseline.md)
에 있다. 그 표는 **다시 재서 비교할 기준선**이므로 이 문서가 대체하지 않는다.

---

## 1. 확정 — 고쳤다

### 1.1 AI 패널 컨텍스트가 IPC 를 직렬로 돈다 `{#ai-context-serial}`

2026-09-07 · `src/features/chat/aiContext.ts`

이 블록은 **매 메시지마다** 재조립돼 system 프롬프트로 다시 올라간다. 그런데
상세를 루프 **안에서** `await` 하고 있어서, 왕복이 계획 수만큼 직렬로 깔렸다.
그 지연은 전송 버튼과 첫 토큰 사이에 그대로 쌓인다.

| 빌더 | 직렬 단계 (전) | (후) | 무엇이 병렬로 갔나 |
|---|---|---|---|---|
| `buildPlannerSystemContext` | 5 | **2** | `planGet` × `MAX_CTX_PLANS`(4) |
| `buildOculpmSystemContext` | 4 | **2** | `oculpmGetJournalEntry` × 3 |

`Promise.all` 은 입력 순서를 보존하므로 출력 마크다운은 바이트까지 같다.

**남은 것:** 두 빌더 자신은 호출부(`aiContext.ts:388`·`394`)에서 여전히 순차다
(조건 분기 안에 각각 들어 있다). 합치면 4 → 2 가 되지만 `candidates` 의 적재
순서를 건드려야 해서 이 라운드에서는 손대지 않았다 → `{#ai-context-callsite}`.

**2026-09-15 · 호출부도 병렬 (`{#ai-context-callsite}`).** 두 빌더를 각자의 if
분기 안에서 `Promise<RecallCandidate | null>` 로 **시작만** 하고 `Promise.all`
로 모은 뒤 null 을 걸러 담는다 — 조건은 그대로, `candidates` 의 적재 순서(플랜
→ 일지)는 `Promise.all` 의 입력 순서가 보존하므로 순차 코드와 바이트까지 같다.
전송 버튼 → 첫 토큰 사이의 직렬 왕복 **4 → 2** (두 빌더 중 긴 쪽). 검증은
`src/__tests__/ai_context_parts.test.ts` — 회상 신호 4 × 토글 4 = 16 조합을 옮겨
적은 순차 구현과 `toEqual` 로 대조하고, `planList` 를 열어 둔 채 일지 빌더가
이미 출발했는지 타이머 없이 단언한다 (순차 코드에서는 2ms 만에 빨개진다).

### 1.2 키체인·CLI 탐지가 `forEach(async …)` `{#floating-probes}`

2026-09-07 · `AiPanelScreenV2.tsx` · `GreenfieldWizard.tsx`

`forEach` 는 async 콜백의 프로미스를 **버린다.** 결과는 셋이다 — 거부를 아무도
받지 않고, 완료를 기다릴 수 없고, 프로바이더마다 `setState` 를 따로 쏴서 화면이
그 수만큼 다시 그려진다. `Promise.all` + `setState` 1회로 바꿨다.

`GreenfieldWizard` 쪽은 덤으로 **사용자에게 보이는 버그 하나**가 같이 나왔다.
ESC 리스너가 `[]` deps 로 걸려 첫 렌더의 `handleClose` 를 붙들고 있었는데, 그
함수는 **초안을 저장하고** 닫는다 — ESC 로 닫으면 그때까지 친 아이디어·폴더명이
빈 초안으로 덮여 사라졌다. 최신 함수를 ref 로 따라가게 고쳤다.

### 1.3 문자 경계 헬퍼가 한 자리에 없어 네 번째 사본이 틀렸다 `{#text-module}`

2026-09-07 · 새 모듈 `src-tauri/src/text.rs`

성능 항목은 아니지만 **중복이 결함을 만든 표본**이라 여기 남긴다. 같은
`percent_decode` 가 세 벌(딥링크·Notion·LSP), 같은 절단 가드가 네 벌 있었고,
넷 중 하나(`commands/overview.rs`)가 가드를 빠뜨려 패닉했다. 자세한 것은
플랜 `hardening-and-optimization` 과 그날 일지.

교훈 한 줄: **이 저장소가 이미 아는 것이 코드 한 자리에 모여 있지 않으면, 다음
사람은 그걸 모른다.**


### 1.4 임베딩 한 판이 RSS 1.9GB 를 남긴다 `{#ort-arena}`

2026-09-12 · `src-tauri/src/embedding.rs` · `indexer.rs` `EMBED_BATCH`

라이브 앱을 `vmmap --summary` 로 봤다 (32분 경과, 색인 한 번 뒤): RSS 1,887MB ·
풋프린트 2.1G (피크 2.7G) · **MALLOC_LARGE 1.5GB / 46 regions** — 4M→8M→16M→
32M→64M→128M×9 로 2배씩 자란 뒤 전부 dirty. ORT CPU 아레나(`kNextPowerOfTwo`)의
모양이고, 아레나는 세션이 사는 한 줄지 않는다. 피크를 정하는 것은 배치 × 토큰
길이의 어텐션이었다: fastembed 기본 `max_length` **512** 에 `EMBED_BATCH` **32**.
이 모델(paraphrase-multilingual-MiniLM-L12-v2)은 128 토큰에서 학습됐다.

`with_max_length(256)` + 배치 **8**. 같은 2KB 청크 256개 (`perf_baseline` M6):

| 설정 | 임베딩 뒤 풋프린트 | 속도 |
|---|---|---|
| 512 / 32 (전) | **2.2G** | 27.5 ms/청크 |
| 256 / 8 (후) | **940M** | **11.1 ms/청크** |

패딩이 줄어 속도까지 2.5배. 재현: `OCULPM_EMBED_MAXLEN=512 OCULPM_EMBED_BATCH=32
cargo test --release --test perf_baseline m6 -- --ignored --nocapture` (한 프로세스에
설정 하나).

**같은 날 후속 — 640MB 의 정체는 ORT 가 아니라 macOS malloc 이었다** (M6b).
세션 로드 직후 풋프린트 602MB 중 살아 있는 malloc 은 234MB(모델 224MB 파일과
같다)이고 **`MALLOC_LARGE (empty)` 323MB** 가 free 된 뒤에도 dirty 로 남아 있었다
— libmalloc 의 대형 블록 캐시. `malloc_zone_pressure_relief` 는 0 바이트, ORT 세션
옵션(prepacking·device allocator·memory pattern·threads·commit_from_memory)은 전부
602MB 로 무관. **`MallocLargeCache=0`** 이면 로드 237MB · drop 뒤 12MB.

| M6 (256/8) | 캐시 켬 (기본) | `MallocLargeCache=0` |
|---|---|---|
| 임베딩 뒤 | 936M | **806M** (2차 사이클 504M) |
| 세션 drop 뒤 | 645M | **38M** |
| 속도 | 12.7 ms/청크 | 13.7 ms/청크 (−8%) |

이 변수는 malloc 초기화 때만 읽히므로 `main.rs` 가 GUI 경로에서 **자기 자신을
그 env 로 다시 exec** 한다(`reexec_with_malloc_tuning`; 심·CLI 는 제외, PTY 호스트가
사용자 셸에는 걷어 낸다 — `ptyhost/env.rs`). 그 위에 **유휴 언로드**(5분, 1분
스윕)를 넣었다 — 이제 내리면 실제로 돌아온다. 재현: `MallocLargeCache=0
OCULPM_EMBED_MAXLEN=256 OCULPM_EMBED_BATCH=8 cargo test --release --test
perf_baseline m6_ -- --ignored --nocapture`, 옵션 비교는 `m6b` 와 `OCULPM_ORT_OPTS`.

### 1.5 DB 553MB 중 ~280MB 가 회수 가능한데 「정리」가 못 줄인다 `{#vec0-holes}` `{#snapshot-git-dup}`

2026-09-12 · 라이브 DB 사본에 `dbstat` — 15 프로젝트 · 파일 9,817 · 청크 101,120.

| 표 | 실측 | 원인 |
|---|---|---|
| `chunk_embeddings` (vec0) | 278MB · 슬롯 **189,440 / 살아 있는 101,120 (53%)** | sqlite-vec 는 통째로 빈 블록만 버리고 부분 구멍은 되돌리지 않는다. `chunks.id` 는 1,296,118 까지 갔다 |
| `file_snapshots` | 100MB · 10,817행 | `commands/diff.rs` 는 `git show HEAD:` 가 실패할 때만 읽는데 색인은 모든 파일을 찍었다 — 9,817행 **81MB 가 git 이 이미 가진 복사본**, 거기에 `files` 행 없는 고아 1,000행 12MB (`.vscode-test/` 313행 등; `delete_files_by_paths` 가 `files` 기준이라 못 봤다) |
| `freelist_count` | **1** | 그래서 `compact()` 의 VACUUM 은 사실상 0 바이트 |

고친 것: (a) `Db::compact()` 가 vec0 를 살아 있는 행으로 **다시 짓고** VACUUM 뒤
WAL 을 한 번 더 자른다 (VACUUM 이 WAL 모드에서 새 DB 전체를 WAL 에 쓰는 것을
사본에서 봤다 — 458MB 남음). (b) 전체 색인이 저장소당 `ls-tree` 한 번으로 HEAD
집합을 받아 **HEAD 에 있는 파일은 스냅샷을 찍지 않고**, 끝나면 필요 목록 밖의
스냅샷(HEAD 복사본·고아)을 한 트랜잭션으로 지운다 (`retain_file_snapshots`).
단일 파일 재색인은 `path_in_head` 하나로 같은 판정.

라이브 사본에서 (a) 만: **553MB(+WAL 64) → 434MB, 4.8초**, vec0 블록 185 → 107.
(b) 는 다음 전체 색인 때 81+12MB 를 더 뺀다. 재현: `OCULPM_DB_SNAPSHOT=<사본>
cargo test --release --test perf_baseline m5 -- --ignored --nocapture`.

### 1.6 IME 자동 덤프가 로그의 85~90% `{#ime-dump-budget}`

2026-09-12 · `src/features/terminal/imeTrace.ts`

| 날짜 | 전체 줄 | 덤프 | 덤프 줄 |
|---|---|---|---|
| 09-04 | 67,217 | 1,264 | 59,890 |
| 09-07 | 33,442 | 578 | 28,560 |
| 09-12 | 2,459 | 44 | 2,134 |

`imeBridge` 의 `post-commit-passthrough` 판정이 **정상 한글 타이핑에서 분당 1회꼴**
로 걸렸다 (샘플: "치" 확정 → "며" 조합 시작). 12일 5,500회 = 타이핑 도중 5~20KB
직렬화 + IPC 5,500번, 로그 ~50MB. 모듈 머리말이 경고한 "진단이 관측을 바꾼다"
가 상시였다. 자동 덤프에 예산을 뒀다 — 처음 3회는 그대로, 그 뒤 10분에 1회,
막힌 횟수는 다음 덤프 머리에 `(+N suppressed)`. 사람이 부르는 ⌃⌥⇧I 는 예산 밖.
재현: `grep -c IME-DUMP <앱데이터>/logs/oculpm.log.<날짜>`.

---

## 2. 확정 — 아직 안 고쳤다

### 2.1 진입 청크 606KB `{#entry-chunk}`

> **2026-09-12 정정 — 해결됨.** 같은 방법으로 다시 재니 진입 `index-*.js` 는
> **271KB (gzip 85KB)** 이고 조성은 react-dom 176KB + bindings 25KB 가 바닥이다.
> monaco(3.8MB, 청크 이름은 `theme-*`)·prettier(317KB, `babel-*`)는 전부 지연
> 로드로 확인. 아래는 09-07 의 기록.

2026-09-07 측정 (`pnpm build`, 이 저장소 HEAD)

| 값 | |
|---|---|
| `dist/assets/index-*.js` | **606,254 B** |
| 같은 것, gzip | **207,195 B** |
| `dist` 전체 | 12 MB (js 5.9 MB · css 416 KB) |

빌드가 실제로 `Some chunks are larger than 500 kB` 를 낸다. `vite.config.ts` 에
`manualChunks` 가 없다.

큰 조각 (uncompressed):

| 크기 | 청크 | 성격 |
|---|---|---|
| 2,392 K | `clang-format.wasm` | 포매터 — 지연 로드됨 |
| 1,724 K | `Pretendard-subset.woff2` | 본문 폰트 |
| 1,196 K | `ruff_fmt_bg.wasm` | 포매터 — 지연 로드됨 |
| **596 K** | **`index-*.js`** | **진입 — 여기가 대상** |
| 452 K | `typescript.js` | CodeMirror 문법 |
| 380 K | `SkillsScreenV2` | 화면 청크 |
| 360 K | `TerminalInstanceImpl` | 화면 청크 |
| 344 K | `GraphScreenV2` | 화면 청크 |
| 204 K / 180 K | `ko` / `en` | 사전 — 이미 분리됨 (완성도 라운드) |

**다음 단계는 나누기가 아니라 세기다.** 진입 청크에 *무엇이* 들었는지 아직
모른다 (소스맵이 꺼져 있어 조성을 못 봤다). `build.sourcemap` 을 일시적으로 켜고
조성을 뽑은 뒤에 판단한다 — 그 전의 `manualChunks` 는 추측이다.

데스크톱은 로컬 디스크에서 읽으니 gzip 207KB 가 체감으로 오지 않을 수 있다.
**진짜 수요자는 모바일 브리지다** — 같은 `dist` 를 Tailscale 너머 폰으로 보낸다.

### 2.2 워처가 루트 전체를 감시하고 필터는 사후 `{#watcher-prefilter}`

> **2026-09-12 정정 — 해결됨.** `watcher.rs:113` 이 같은 매처를 채널 앞에 세운다.
> perf-baseline M2 의 색인 blocking 도 `spawn_blocking` 으로 옮겨져 있다.

[`perf-baseline.md` M1](../20260904_v242-load-bearing/perf-baseline.md) 이 이미
확정한 자리다. 체크아웃 한 번 = 한 배치 1,058 이벤트, 드레인 4.3초 (체크아웃
자체는 0.15초).

그 뒤 큐는 `watcher_queue.rs` 의 **4096 bounded** 로 바뀌어 붕괴는 막혔다
(drop 카운터 있음). 그러나 **사전 필터는 아직 없다** — `.gitignore` 판정은
`handle_event` 6단계에서 일어나므로 `target/`(이 저장소 55,663 파일)·
`node_modules/` 의 쓰기가 전부 큐에 들어온 뒤에 버려진다.

인덱서(`indexer.rs`)에는 gitignore 와 무관한 하드 deny 목록이 있다. 워처에는
없다. **비대칭이 남아 있다.**

### 2.3 800줄 초과 잔고 `{#file-size-debt}`

2026-09-07 측정. 래칫(`scripts/check-file-sizes.mjs`)이 **악화만** 막으므로
잔고는 스스로 줄지 않는다.

| 값 | |
|---|---|
| 초과 파일 | **37** |
| 초과 줄 합 | **17,923** |
| 최대 | `commands/window.rs` 3,028 · `commands/code.rs` 2,251 · `oculpm/watcher.rs` 2,164 |

재현:

```bash
{ find src-tauri/src -name '*.rs'; find src -name '*.ts' -o -name '*.tsx'; } \
  | grep -v 'src/legacy/\|src/lib/bindings.ts\|src/i18n/ko.ts\|src/i18n/en.ts\|src-tauri/src/lib.rs\|src-tauri/src/oculpm/spec.rs' \
  | xargs wc -l | awk '$1>800 && $2!="total"' | sort -rn
```

> **2026-09-15 재측정 — 상위 7 을 쪼갰다** (플랜 `optimization-round-2-2026-09-15`
> Phase 1, 병렬 worktree 세션 7개, 전부 행동 변화 없는 이동 · 공개 경로 불변 ·
> `bindings.ts` diff 0). 같은 스니펫으로:
>
> | 값 | 09-07 | **09-15** |
> |---|---|---|
> | 초과 파일 | 37 | **26** |
> | 초과 줄 합 | 17,923 | **7,924** |
> | 최대 | `window.rs` 3,028 · `code.rs` 2,251 · `watcher.rs` 2,164 | `manager/tests.rs` 2,308 · `cache/tests.rs` 1,433 · `mcp/tools/mod.rs` 1,424 |
>
> 남은 상위는 **테스트 파일**과 MCP 도구 모듈이다. 쪼갠 쪽의 새 잔고: `CodePane.tsx`
> 798 (래칫 2줄 여유, 다음 절단면 `useSvgPreview`) · `commands/code/tests.rs` 770 ·
> `codePane/` 훅 5 + `codeScreen/` 훅 4 가 `lint:bindings` allowlist 에 사유와 함께
> 들어감(`{#api-facades}` 후속에서 `@/api/*` 로 옮긴다).

### 2.4 임베딩 모델 로드 자체가 ~640MB 상주 `{#embed-unload}`

> **2026-09-12 (같은 날) — 해결됨.** 정체는 macOS malloc 대형 캐시였다 — §1.4 의
> 후속 표. 아래는 그 전의 기록.

2026-09-12 · perf_baseline M6 · 세션 로드만으로 풋프린트 602~637MB (파일 224MB).
drop 해도 남고 재로드는 +140MB 를 더 남긴다. 최적화 단계 0/1/3 은 차이가 없었다(M6b).

### 2.5 그 밖의 추정 (측정 없음)

- `Pretendard-subset.woff2` 1.7MB — 모바일 브리지에서만 체감.
- (`chunks.content`·`FileIdMap` 은 같은 날 재서 §3 으로 갔다.)

---

## 3. 기각 — 재 봤더니 아니었다

| 의심 | 판정 | 근거 |
|---|---|---|
| 프로덕션 코드의 `unwrap`/`expect` 남용 | **기각** | 974건 중 대부분이 `*/tests.rs`. 프로덕션은 `mobile_bridge/server.rs` 의 락 13건 등 소수 (2026-09-07) |
| `std::sync` 락을 `await` 너머로 들고 간다 | **기각** | 후보 33건 전부 tokio 락(`.lock().await`). std 가드가 await 를 넘는 자리 0 |
| SQL 문자열 조립 | **기각** | `format!` 로 만드는 곳도 placeholder 만 조립하고 값은 전부 바인딩 (`cache/mod.rs`·`db/planning.rs`) |
| clippy 부채 | **기각** | `cargo clippy --all-targets` 경고 **0** |
| 마크다운·하이라이트 XSS | **기각** | hljs `.value` 는 이스케이프 출력, `markMatchesInHtml` 은 DOM 기반, `rehype-raw` 부재 |
| 텍스트 검색 LIKE 풀스캔 (2026-09-12 재측정) | **기각** | 가장 큰 프로젝트(청크 30MB)에서 30ms, 나머지 10~20ms. 커버링 인덱스 → `idx_chunks_file` 로 프로젝트만 훑는다 |
| 기동 경로 | **기각** | DB ready 200ms · 창 마운트 1초 · 워처 15개는 의도된 420ms 간격. 일지 재색인은 증분(skipped=690) |
| 프런트 폴링 | **기각** | `setInterval` 8곳 전부 가시성 게이트 또는 유한 재시도 |
| `acp/` 518MB | **기각** | codex·claude-agent-sdk 어댑터 바이너리 — 정당 |
| `chunks.content` 97MB 를 디스크 재읽기로 대체 | **기각** | 텍스트 검색이 그 열의 `LIKE` 풀스캔이다 (`search_text`, 2026-08-30 결정). 열을 빼면 검색이 없어진다 |
| 워처 `FileIdMap` 성장 (2026-09-12, M7) | **기각** | 파일 20,000 개 Create 에 NoCache 대비 **+3.8MB** (엔트리 ~190B). `target/` 55k 가 전부 쌓여도 ~10MB. `OCULPM_WATCH_CACHE=fileid\|none cargo test --release --test perf_baseline m7 -- --ignored --nocapture` |
| `t` 누락 exhaustive-deps 18건 | **기각(무해)** | `useT()` 의 `t` 는 모듈 레벨 `t()` 에 위임하고 그쪽이 호출 시점에 언어를 읽는다. 스테일 클로저여도 현재 언어가 나온다 — 다만 **이 노이즈가 진짜 2건을 덮고 있었다** (§1.2) |

---

## 4. 잔고 표 (한눈에)

이 표만 라운드마다 갱신하면 추세가 보인다.

| 지표 | 2026-09-07 | 2026-09-12 | 2026-09-15 | 목표 |
|---|---|---|---|
| 진입 청크 (gzip) | 207 KB | **85 KB** | — | 유지 (react-dom 이 바닥) |
| 임베딩 뒤 백엔드 풋프린트 (M6, 256청크) | — | 2.2G → **806M** (`MallocLargeCache=0`) | — | — |
| 유휴 시 임베더 풋프린트 (M6 drop 뒤) | — | 645M → **38M** | — | 5분 유휴 언로드 |
| DB 파일 (라이브) | — | 553MB → **434MB** (정리 후) | 673MB (dbstat: vec0 343 · chunks 154 · file_snapshots 101 — 아직 「정리」 안 누름, `#eyes-compact`) | 다음 전체 색인 뒤 ~340MB |
| vec0 슬롯 점유율 | — | 53% → **92%** | — | 정리 시 재구축 |
| IME 자동 덤프 / 일 | — | 최대 1,264 → **≤ 3 + 6/시간** | — | — |
| eslint 경고 | 50 (`--max-warnings=50`) | 4 (`--max-warnings=4`) | 4 | 잔고와 상한을 붙여 뒀다 — 늘리려면 상한을 먼저 올려야 한다 |
| clippy 경고 | 0 | 0 | 0 | 0 유지 |
| 800줄 초과 파일 | 37 | 래칫 기준 유지 | **26** (상위 7 분할) | 늘지 않기 (래칫) |
| 800줄 초과 줄 합 | 17,923 | — | **7,924** | 감소 |
| AI 컨텍스트 직렬 왕복 | 4 | 4 | **2** (`{#ai-context-callsite}`) | 2 — 달성 |
| 워처 드레인 중 `handle_event` 실제 처리 (M2c) | — | — | **32 ms / 정착 3,625 ms** · 큐 최대 577 · 버림 0 (`{#scheduling-telemetry}`) | 드레인 시간의 정체(디바운스·정착 대기)를 다음 라운드가 잰다 |

---

## 새 항목을 적을 때

1. §1(고쳤다) · §2(확정·미해결) · §3(기각) 중 하나에 넣는다. **셋 중 하나에는
   반드시 들어간다** — "봤는데 애매하다" 는 §2 에 추정이라고 적는다.
2. 날짜와 파일 경로를 단다. 값에는 재현 명령을 단다.
3. §4 잔고 표를 갱신한다.
4. 실행 대상이면 `.oculpm/planner/` 의 살아 있는 플랜에 항목을 만든다 —
   **이 문서에만 적으면 유실된다** (선례: `{#eyes-mixed-dpi}`).
