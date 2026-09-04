# v2.42.0 성능 기준선 — 측정이 Phase 0 이다

> **살아 있는 문서.** 이 표의 값은 `{#measure-after}` 와 다음 라운드가 **같은 방법으로**
> 다시 재서 비교하는 기준선이다. 값을 고칠 때는 방법도 같이 적는다.

`v3-round` 감사는 **앱을 한 번도 실행하지 않고** 코드만 읽어서 나왔다. 그래서 플랜
`v242-load-bearing` 의 성능 주장은 전부 **구조적 추정**이었다 — "이런 조건에서 비용이
선형/곱으로 는다"는 코드 판정이지 "느리다"는 관찰이 아니다.

Phase 0 의 목적은 **고칠 것을 정하는 게 아니라 고칠 값어치가 있는지를 정하는 것**이다.
아래에서 추정 하나가 죽었고(`screens.css` 파싱), 둘이 확정됐다.

## 재현 방법

| 무엇 | 명령 | 어디서 |
|---|---|---|
| 백엔드 M1~M3 | `cargo test --release --test perf_baseline -- --ignored --nocapture` | `src-tauri/tests/perf_baseline.rs` |
| 번들 | `pnpm build` | vite 출력 |
| CSS 파싱 · 카드 레이아웃 | 아래 §2 참고 (Chromium 하니스) | 일회성 |
| WKWebView 초기 페인트 | dev 로 앱 실행 후 `grep '\[perf\]' <앱데이터>/logs/oculpm.log.$(date +%F)` | `src/lib/perfProbe.ts` |

측정 환경: macOS (darwin 25.6.0), Apple Silicon, 2026-09-04. `cargo` 는 `--release`
(설치본과 같은 프로필). 프런트 수치는 Chromium 139 / jsdom.

## 1. 백엔드 — 워처·인덱서·DB

`cargo test --release --test perf_baseline -- --ignored --nocapture` (13.1 s, 3 passed).

### M1 — 브랜치 전환이 워처에 쏟는 양 `{#watcher-bounded}`

이 저장소를 `--local` 로 복제해 `HEAD~50` 에 두고, 워처를 건 뒤 `HEAD` 로 돌아왔다
(디바운스 1,000 ms = 앱의 `balanced` 티어).

| 값 | |
|---|---|
| `git diff --name-only` 파일 수 | 378 |
| `git checkout` 자체 | 149 ms |
| 디바운스 **배치** 수 | **1** |
| 배치 안의 **이벤트** 수 | **1,058** |
| 고유 경로 수 | 418 |
| 체크아웃 → 워처 정적화 | **4,272 ms** |

→ **확정.** 한 번의 체크아웃이 **한 배치에 1,058 이벤트**를 unbounded 채널에 부어 넣고,
소비자가 그걸 비우는 데 **4.3 초**가 걸린다(체크아웃 자체는 0.15 초). 소비 루프는
`watcher.rs:175-197` 에서 이벤트를 **하나씩 `await`** 하는 직렬 루프다.

그리고 채널이 받는 것은 **필터 이전의 날것**이다: `.gitignore` 판정은 `handle_event`
안(6단계, `watcher.rs:505`)에서 일어나므로 `target/`·`node_modules/` 의 쓰기도 전부
채널에 먼저 들어온다. 지금 이 저장소의 `src-tauri/target` 에는 **55,663 개 파일**이 있다.
`cargo build` 한 번이 그 일부를 건드리고, 그 전부가 큐에 쌓인 뒤에야 버려진다.

### M1b — `classify` 의 `read`+blake3 `{#classify-blocking}`

같은 경로 집합에 `watcher.rs:785-790` 을 그대로 재현.

| 값 | |
|---|---|
| 해시한 파일 | 381 (8 MB 상한 초과 0) |
| 읽은 바이트 | 7,318,058 |
| 총 소요 | **33 ms** |

→ **확정하되 작다.** 체크아웃당 33 ms(≈0.09 ms/파일), 최악의 단일 파일(8 MB 상한)이
약 36 ms 다. 런타임 워커 위에서 파일 IO 를 도는 것은 고쳐야 할 위생이지만, 위의 4.3 초
드레인을 만드는 주범은 **이것이 아니다** — 나머지(DB·히스토리·색인 스케줄)다.
이 항목으로 성능 개선을 주장하지 않는다.

### M2 — `index_project` 의 CPU 심 `{#index-project-blocking}`

`walk_text_files` → 파일별 `read` + blake3 + `chunk_file`(tree-sitter). 실제 코드,
릴리스 프로필, 이 저장소 전체.

| 단계 | |
|---|---|
| `walk_text_files` | 1,327 파일, 204 ms |
| `read` + blake3 + `chunk_file` | **6,207 ms** (14,307,602 B) |
| tree-sitter 파싱 | 789 파일, 심볼 7,481 |
| 청크 | 16,244 |
| **워커 1개 점유 총합** | **6,411 ms** |

→ **확정 — 이 라운드의 최대 발견.** `commands/project.rs:187` 의 이 심 전체가
`spawn_blocking` **밖**, 즉 tokio 런타임 워커 위에서 돈다. 프로젝트 하나를 색인하는 동안
그 워커가 **6.4 초** 통째로 멈춘다.

### M3 — 단일 연결 DB 액터 큐 — **추정이 죽은 두 번째 자리**

| 값 | |
|---|---|
| 순차 500 `upsert_file` | 27 ms (**0.05 ms/op**) |
| 동시 500 `upsert_file` | 14 ms |

→ **문제가 아니다.** M1 의 고유 경로 418개를 전부 이 큐에 실어도 약 21 ms 다. "3.0 이
색인·그래프·히스토리를 확장하면 전부 단일 DB 큐를 지난다"는 플랜 서두의 걱정은 **현재
규모에서 근거가 없다.** 4.3 초 드레인의 원인을 DB 큐에서 찾으면 안 된다.


## 2. 프런트 — CSS 파싱과 일지 렌더 (Chromium, 실제 빌드 산출물)

`dist/` 를 로컬 정적 서버로 띄우고 실제 청크를 그대로 읽혔다. 파싱은
`new CSSStyleSheet().replaceSync(text)` 3회 중앙값, 렌더는 `innerHTML` 뒤
`offsetHeight` 로 레이아웃을 강제한 3회 중앙값.

### CSS 파싱 — **추정이 죽은 자리**

| 청크 | 크기 | 규칙 수 | 파싱 |
|---|---|---|---|
| `index-*.css` (= `styles/index.css` → `screens.css` + `agent.css`) | 142,170 B | 1,364 | **4.00 ms** |
| `App-*.css` (= `App.css` + tailwind + `primitives.css`) | 111,990 B | 237 | 3.00 ms |
| `TabbedWindow-*.css` | 29,581 B | 290 | 0.60 ms |
| **합계 (프로젝트 창 초기 경로)** | **283,741 B** | 1,891 | **7.60 ms** |

→ 플랜의 `screens.css(148KB) 파싱` 은 **문제가 아니다.** 초기 페인트 예산에서 7.6 ms 는
한 프레임(16.7 ms)의 절반이 안 되고, 그중 `screens.css` 몫은 4 ms 다. 파일을 쪼개도
파싱 총량은 그대로다.

### 일지 카드 렌더

| 장수 | 레이아웃까지 | 장당 |
|---|---|---|
| 25 (= 현재 `DAY_PAGE_SIZE`) | **3.90 ms** | 0.156 ms |
| 200 (= 현재 `JOURNAL_PAGE_SIZE`) | 31.80 ms | 0.159 ms |
| 542 (= 이 저장소의 전체 일지) | **139.40 ms** | 0.257 ms |

→ v2.41.0 의 `{#journal-timeline-limit}`(`DAY_PAGE_SIZE = 25`)가 **실제로 먹혔다**:
139 ms(≈8프레임 정지)를 3.9 ms 로 낮춘다. 이 수치는 순수 DOM 비용이고 React 재조정은
그 위에 얹힌다.

### 초기 로드 폭포 — CSS 는 JS 를 기다린다

`dist/index.html` 이 직접 참조하는 것은 엔트리 JS **하나뿐**이다. CSS `<link>` 는 그
모듈이 실행되며 주입되므로, 로컬 정적 서버(무지연)에서도 첫 CSS 요청이 **76 ms** 에야
시작했다(엔트리 JS 요청은 11 ms). 즉 `HTML → JS 285 KB 파싱·실행 → CSS 요청 → 페인트`
가 직렬이다. 파싱이 싼 것과 별개인 구조이며, v2.42.0 의 수정 항목에는 없다 — 기록만 한다.

## 3. 프런트 — 재렌더 (vitest, 정확한 **횟수**)

밀리초가 아니라 횟수를 센 이유는 그게 결정적이기 때문이다. 러너 부하에 흔들리지 않고,
다음 라운드가 같은 숫자를 얻는다.

### 컨텍스트 조각이 실제로 재렌더를 막는가 — `{#workspace-full-consumers}`

각 방향으로 필드를 5회 바꾼 뒤 각 소비자의 **추가 렌더 수**:

| 바뀐 것 | `useWorkspace()` | `useUiPrefs()` | `useProjectRuntime()` | `useTerminalSessions()` |
|---|---|---|---|---|
| `uiV2View` ×5 (UI 취향) | **+5** | +5 | 0 | 0 |
| `setIndexing` ×5 (런타임) | **+5** | 0 | +5 | 0 |
| `openTab` ×5 (터미널) | **+5** | 0 | 0 | +5 |
| `selectTab` ×5 (터미널) | **+5** | 0 | 0 | +5 |

→ **확정.** 조각 훅은 정확히 자기 조각에서만 깨어나고, `useWorkspace()` 는 **네 방향
전부**에서 깨어난다. 상시 마운트된 세 소비자(`ShellV2`·`ProjectTab`·`TerminalDock`)가
그 전체 겉면을 쓰므로, **터미널 탭을 하나 고를 때마다 16화면 라우터가 다시 그려진다.**

### 설정 슬라이더 한 번 드래그 — `{#settings-slider}`

`set("uiScale", …)` 20프레임(= 짧은 드래그 한 번), 창 1개:

| 무엇 | 횟수 |
|---|---|
| `settingsSet` IPC (SQLite 쓰기) | **20** |
| `setZoom` 네이티브 호출 | **20** |
| `useSettings()` 소비자 재렌더 | **20** |

여기에 **창 수만큼 더 붙는다**: `commands/config.rs:28` 의 `announce()` 가
`SettingsChanged` 를 `app.emit` 으로 **모든 창에** 쏘고, 각 창의 `SettingsProvider` 가
그 이벤트에 `reload()` = `settingsGetAll()`(설정 테이블 **전체** 조회)로 답한다. 창이
셋(프로젝트·트레이 팝오버·분리 터미널)이면 20프레임이 **쓰기 20 + 전체조회 60 +
프로바이더 재렌더 60** 이 된다.

→ **확정.** 다만 플랜 서술의 네 항목 중 **"구독 재무장"은 사실이 아니다** —
`SettingsContext.tsx:66` 의 구독 deps 는 `[reload]` 이고 `reload` 는 `useCallback(…, [])`
로 안정적이다. 나머지 셋(전체 재렌더·SQLite 쓰기·`setZoom`)은 프레임마다 그대로 일어나고,
플랜이 적지 않은 **창당 전체조회**가 하나 더 있다.

## 4. 판정

| 항목 | 판정 | 근거 |
|---|---|---|
| `{#watcher-bounded}` | **확정** | 체크아웃 1회 = 한 배치 1,058 이벤트 · 드레인 4.3 s · 필터 이전이라 `target/` 55,663 파일이 큐에 들어온다 |
| `{#classify-blocking}` | **확정(작음)** | 33 ms/체크아웃, 최악 단일 파일 36 ms. 위생 수정이지 성능 수정이 아니다 |
| `{#index-semaphore}` | **확정(정확성)** | `tauri::async_runtime::spawn` 이 detached — 프로젝트를 닫아도 DB 를 계속 두드린다. 성능이 아니라 수명 문제 |
| `{#index-project-blocking}` | **확정(최대)** | 워커 1개를 **6,411 ms** 점유 |
| ~~`{#pty-broadcast-scope}`~~ | **죽음 — 전제가 사실이 아니다** | 아래 §4-1 |
| `{#pty-write-lock}` | **확정(구조)** | `host.rs:518` 이 전역 세션 뮤텍스를 잡은 채 `write_all`+`flush`. 같은 파일 `:578-586` 이 옳은 모양 |
| `{#manager-write-lock}` | **확정(구조)** | `lifecycle.rs:326` 전역 write 락을 `ps` fork·워처 등록 너머로 |
| `{#lsp-status-lock}` | **확정(구조)** | `state.rs:296` 이 맵 락을 쥔 채 `resolve_binary().await` — 그 안에 `login_shell_path()` 가 있다. 같은 파일 `:342-357` 이 옳은 모양 |
| `{#embedder-mutex}` | **확정(구조)** | `embedding.rs:177` 전역 std 뮤텍스를 `spawn_blocking` 안에서 — N 동시 호출자가 N 개 OS 스레드를 파킹 |
| `{#settings-slider}` | **확정, 단 한 갈래는 오류** | 20프레임 = IPC 20 + `setZoom` 20 + 재렌더 20, 창마다 전체조회가 더. **"구독 재무장"은 사실이 아니다** (§3) |
| `{#workspace-full-consumers}` | **확정** | 네 방향 전부 5/5 (§3) |
| `{#floating-promises}` · `{#settings-set-unhandled}` | 측정 불요 | 성능이 아니라 삼켜지는 실패 — 개수로 판정 |
| ~~`screens.css` 파싱~~ | **죽음** | 프로젝트 창 초기 CSS 284 KB 전부 합쳐 **7.6 ms** (§2) |
| ~~DB 큐 지연~~ | **죽음** | **0.05 ms/op** (§1 M3) |

**추정 셋이 죽었고, 그중 하나는 수정 항목이었다.** `screens.css` 파싱과 DB 큐는
`{#measure-once}` 가 재라고 한 대상이었지 수정 항목이 아니었지만, `{#pty-broadcast-scope}`
는 **플랜의 수정 항목이면서 전제가 틀렸다** — 아래 §4-1. 그리고 플랜이 크기를 잘못 잡은
곳이 둘 드러났다: `{#classify-blocking}` 은 생각보다 **작고**(33 ms),
`{#index-project-blocking}` 은 생각보다 **크다**(6.4 s).

### 4-1. `{#pty-broadcast-scope}` — 왜 폐기인가

플랜의 서술은 "열린 모든 웹뷰가 모든 세션의 모든 청크를 역직렬화한다" 였다. **tauri
2.11.2(`Cargo.lock` 이 핀한 그 버전) 소스를 직접 읽어 확인한 결과 그런 일은 일어나지
않는다.**

1. `emit_js_filter` 는 웹뷰마다 `js_listeners.get(webview.label()).and_then(|s| s.get(event))`
   가 비면 **그 웹뷰를 통째로 건너뛴다** (`src/event/listener.rs:283`). 이벤트 이름이
   `pty-data-{sid}` 로 **세션별**이므로, 그 세션을 그리지 않는 창에는 스크립트조차 가지
   않는다. `app.emit` 의 실제 초과 비용은 웹뷰 수만큼의 해시 조회뿐이다.
2. `emit_to` 로 바꿔도 **전달이 줄지 않는다.** 프런트 `listen()` 은 target 을 안 주면
   `{kind:'Any'}` 로 등록하고(`@tauri-apps/api` 2.11.0 `event.js:75`),
   `match_any_or_filter` 는 `Any` 를 **필터와 무관하게 통과**시킨다
   (`listener.rs:310`). 조회를 하나 더 하고 아무것도 줄이지 못한다.
3. 게다가 **한 세션을 두 웹뷰가 동시에 그릴 수 있다** — 프로젝트 창의 도크와 분리된
   터미널 창. 라벨 하나로 좁히면 나머지 한쪽이 **조용히 청크를 잃는다.**

즉 현행(브로드캐스트)이 정답이다. 근거를 `commands/terminal.rs` 의 `on_event` 자리에
주석으로 못박아 다음 감사가 같은 항목을 다시 올리지 않게 했다.

**이 판정은 측정이 아니라 소스 판정이다.** 청크 실측률과 동시에 열린 웹뷰 수는 여전히
재지 않았다. 남는 실제 비용은 청크마다의 `serde_json::to_string` + eval 스크립트 생성이고,
그걸 줄이는 길은 `project.rs` 식 **코얼레싱/스로틀**이다 — 터미널 에코 지연과 `seq` 의미에
직결되고 한 번도 측정된 적이 없어 이 라운드에서 손대지 않았다.

## 5. 측정하지 못한 것 — "확인 못 함"

- **WKWebView 의 실제 초기 페인트.** §2 는 Chromium 이다. `src/lib/perfProbe.ts` 가
  dev 빌드에서 자동으로 재서 `oculpm.log` 에 `[perf]` 로 남기지만, **이 라운드에서는
  앱을 띄우지 않았으므로 값이 없다.** 다음에 dev 로 앱을 띄우면 값이 생긴다.
- **PTY 청크 실측률과 동시에 열린 웹뷰 수.** `{#pty-broadcast-scope}` 는 소스 판정으로
  폐기했지만(§4-1), 남은 비용(청크당 직렬화 + eval)의 크기는 여전히 모른다.
- **`target/` 실제 churn** — `cargo build` 한 번이 55,663 중 몇 개를 건드리는지는 세지
  않았다. 채널이 필터 **이전**이라는 구조만 확인했다.


## 6. 측정 재실행 (`{#measure-after}`) — 하니스가 볼 수 있는 것과 없는 것

수정을 전부 넣은 뒤 **같은 명령**으로 다시 쟀다.

| | 전 | 후 |
|---|---|---|
| 브랜치 전환 이벤트 수 | 1,058 (378파일) | 935 (384파일) |
| 체크아웃~정적화 | 4,272 ms | 4,282 ms |
| classify read+blake3 | 33 ms | 30 ms |
| `index_project` CPU 심 | 6,411 ms | 5,882 ms |
| DB 액터 | 0.05 ms/op | 0.03 ms/op |

**이 표에서 개선을 주장하지 않는다.** 차이는 노이즈이고(그사이 HEAD 가 6커밋 움직여 diff
자체가 378→384 파일로 달라졌다), 더 중요하게는 **이 하니스가 재는 것이 바뀐 것이 아니기
때문**이다:

- M2/M2b/M3 은 **날것의 일**(이벤트 수 · 읽기+해시 · walk+파싱)을 잰다. 우리가 바꾼 것은
  그 일의 **양**이 아니라 **어느 스레드에서 도는가**와 **큐에 바닥이 있는가**다. 6,411 ms
  어치의 CPU 일은 그대로 있고, 이제 그게 tokio 런타임 워커가 아니라 blocking 풀에서 돈다 —
  하니스는 그 차이를 볼 수 없다.
- 4.3초 드레인이 그대로인 것도 **예상대로**다. `handle_event` 는 여전히 직렬이고, 유계 큐가
  고치는 것은 메모리 상한과 만회 가능성이지 드레인 시간이 아니다 (§1 M1).

**실제 전/후가 숫자로 남은 곳은 프런트다** — 그리고 그건 벤치가 아니라 **테스트 단언**이라
회귀하면 CI 가 붉어진다:

| | 전 | 후 | 어디서 무는가 |
|---|---|---|---|
| 슬라이더 20프레임의 설정 쓰기 | 20 | **0** (놓을 때 1) | `settings_deferred_commit.test.tsx` |
| 슬라이더 20프레임의 미리보기 | 20 | 20 (그대로 — 요점이다) | 〃 |
| `openTab`+`selectTab` 10회에 `TerminalDock` 추가 렌더 | +10 | **0** | `workspace_slice_consumers.test.tsx` |

## 7. 다음 라운드를 위한 메모

이 하니스의 한계가 곧 다음에 만들 것을 가리킨다. **스케줄링을 재는 계측이 없다** — "런타임
워커가 얼마나 오래 막혀 있었나", "큐가 얼마나 찼나", "버림이 몇 번 있었나" 는 지금 로그로만
보인다. `WatcherStatus` 에 `dropped_total` 을 노출하는 것이 그 첫 걸음이고, 이번에는
`spec.rs` + `bindings.ts` + 프런트가 함께 움직여야 해서 하지 않았다.
