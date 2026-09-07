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
|---|---|---|---|
| `buildPlannerSystemContext` | 5 | **2** | `planGet` × `MAX_CTX_PLANS`(4) |
| `buildOculpmSystemContext` | 4 | **2** | `oculpmGetJournalEntry` × 3 |

`Promise.all` 은 입력 순서를 보존하므로 출력 마크다운은 바이트까지 같다.

**남은 것:** 두 빌더 자신은 호출부(`aiContext.ts:388`·`394`)에서 여전히 순차다
(조건 분기 안에 각각 들어 있다). 합치면 4 → 2 가 되지만 `candidates` 의 적재
순서를 건드려야 해서 이 라운드에서는 손대지 않았다 → `{#ai-context-callsite}`.

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

---

## 2. 확정 — 아직 안 고쳤다

### 2.1 진입 청크 606KB `{#entry-chunk}`

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

---

## 3. 기각 — 재 봤더니 아니었다

| 의심 | 판정 | 근거 |
|---|---|---|
| 프로덕션 코드의 `unwrap`/`expect` 남용 | **기각** | 974건 중 대부분이 `*/tests.rs`. 프로덕션은 `mobile_bridge/server.rs` 의 락 13건 등 소수 (2026-09-07) |
| `std::sync` 락을 `await` 너머로 들고 간다 | **기각** | 후보 33건 전부 tokio 락(`.lock().await`). std 가드가 await 를 넘는 자리 0 |
| SQL 문자열 조립 | **기각** | `format!` 로 만드는 곳도 placeholder 만 조립하고 값은 전부 바인딩 (`cache/mod.rs`·`db/planning.rs`) |
| clippy 부채 | **기각** | `cargo clippy --all-targets` 경고 **0** |
| 마크다운·하이라이트 XSS | **기각** | hljs `.value` 는 이스케이프 출력, `markMatchesInHtml` 은 DOM 기반, `rehype-raw` 부재 |
| `t` 누락 exhaustive-deps 18건 | **기각(무해)** | `useT()` 의 `t` 는 모듈 레벨 `t()` 에 위임하고 그쪽이 호출 시점에 언어를 읽는다. 스테일 클로저여도 현재 언어가 나온다 — 다만 **이 노이즈가 진짜 2건을 덮고 있었다** (§1.2) |

---

## 4. 잔고 표 (한눈에)

이 표만 라운드마다 갱신하면 추세가 보인다.

| 지표 | 2026-09-07 | 목표 |
|---|---|---|
| 진입 청크 (gzip) | 207 KB | 조성 파악 후 결정 |
| eslint 경고 | 50 (`--max-warnings=50`) | 잔고와 상한을 붙여 뒀다 — 늘리려면 상한을 먼저 올려야 한다 |
| clippy 경고 | 0 | 0 유지 |
| 800줄 초과 파일 | 37 | 늘지 않기 (래칫) |
| 800줄 초과 줄 합 | 17,923 | 감소 |
| AI 컨텍스트 직렬 왕복 | 4 | 2 (`{#ai-context-callsite}`) |

---

## 새 항목을 적을 때

1. §1(고쳤다) · §2(확정·미해결) · §3(기각) 중 하나에 넣는다. **셋 중 하나에는
   반드시 들어간다** — "봤는데 애매하다" 는 §2 에 추정이라고 적는다.
2. 날짜와 파일 경로를 단다. 값에는 재현 명령을 단다.
3. §4 잔고 표를 갱신한다.
4. 실행 대상이면 `.oculpm/planner/` 의 살아 있는 플랜에 항목을 만든다 —
   **이 문서에만 적으면 유실된다** (선례: `{#eyes-mixed-dpi}`).
