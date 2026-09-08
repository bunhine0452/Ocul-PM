# Phase 0 스파이크 — 실측

> 2026-09-08. 버리는 코드로 R1~R3·R5 를 답한다. 판정은 맨 아래.
> 스파이크 소스는 저장소 밖(스크래치패드)의 **독립 Tauri 앱**이다 —
> `com.oculpm.monaco-spike` 로 번들 id 를 따로 줘서, 돌고 있는 설치본 Ocul-PM 과
> app-data · SQLite · `.oculpm` 락을 다투지 않게 했다. 워킹트리에 남는 것은 이 문서뿐.

| | |
|---|---|
| Monaco | 0.56.0 (npm, MIT) |
| 기기 | macOS 26.6.2, WKWebView (UA: AppleWebKit/605.1.15) |
| 빌드 | Vite 7.3.6 · esbuild 0.28 · Tauri 2 (debug) |

## 요약

| 위험 | 판정 | 근거 |
|---|---|---|
| R1 WKWebView | 🟢 **초록** | 26/26 줄 히트테스트 일치, 폴딩·검색·다중커서·괄호매칭·미니맵·sticky 전부 동작 |
| R2 한국어 IME | 🟢 **초록** | 3자 비교에서 textarea · CodeMirror · Monaco 결과가 **완전 동일**. 현행 대비 회귀 없음 |
| R3 워커·Vite | 🟢 **초록** | `MonacoEnvironment.getWorker` + Vite `?worker` 로 충분. 단 0.56 은 임포트 경로가 통째로 바뀌었다 |
| R5 번들 | 🟡 **노랑** | 화면 청크 +3.53MB raw / +878KB gzip. 여는 지연은 221ms 로 작다 |

**→ 이관을 막는 것이 없다. Phase 1 로 간다.**

**D1 은 유지되지만 근거가 바뀐다.** 마스터 플랜은 "언어 워커를 켜면 번들이 ~2MB 는다"고
적었는데, 실측하면 **여는 청크 차이는 99KB(gzip 22KB)뿐**이다. 진짜 차이는 워커 파일
쪽의 **9.2MB** 이고, 그마저 지연 로드다. 그러니 D1 의 사는 근거는 번들이 아니라
**공급자 이중화**(완성·호버가 두 벌)와 앱 페이로드 9.2MB 다. → [D1 근거 정정](#d1-정정)

---

## R3 — 워커·Vite 배선 {#r3}

**선택: `self.MonacoEnvironment.getWorker` 직접 구현.** 플러그인 계열은 쓰지 않는다.
D1 로 워커가 `editor.worker` 하나뿐이라 배선이 두 줄이다.

```ts
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
```

확인된 것:

- **`globalAPI` 확인** — ESM 판은 전역 `monaco` 를 만들지 않는다. 트레이스가
  `window.monaco is undefined` 로 찍었다. 플랜의 기록이 맞다. 우리는 모듈 임포트로만
  쓰므로 `globalAPI` 는 **필요 없다**.
- **CSP** — `tauri.conf.json` 의 `csp` 가 `null` 이라 워커 로드를 막지 않는다. 실제로
  막히지 않았다. CSP 를 켜는 날 `worker-src` 를 함께 넣어야 한다.

### 0.56 의 함정 셋 {#r3-traps}

Phase 1 이 그대로 밟을 자리라 적어 둔다. 셋 다 튜토리얼·블로그·`vite-plugin-monaco-editor`
가 쓰는 관용구가 **0.56 에서 깨진 것**이다.

1. **`monaco-editor/esm/vs/...` 경로가 죽었다.** exports map 이 `esm/vs` 를 뿌리로 잡아
   (`"./*": "./esm/vs/*.js"`) 그 경로는 `esm/vs/esm/vs/...` 로 두 번 붙는다.
   → 올바른 형태는 **`monaco-editor/editor/editor.api`**, `monaco-editor/editor/editor.worker`,
   `monaco-editor/languages/definitions/rust/register`.
2. **최상위 `.css` 임포트는 통과 못 한다.** exports map 이 `.js` 를 붙여
   `codicon.css.js` 를 찾는다. 내부 모듈이 전이로 끌어오므로 **그냥 빼면 된다** (CSS 는
   정상적으로 157KB 나온다).
3. **`editor.api` 만 임포트하면 빈 껍데기다.** ← 가장 비싼 함정.
   0.56 에는 `editor.all.js` 가 **없고**, 기여(contribution) 목록이 `editor.main.js` 안에
   인라인으로 들어 있다. `editor.api` 만 부르면 폴딩·검색·다중커서·sticky·괄호매칭이
   **하나도 등록되지 않는다** — 즉 이관의 목적 그 자체가 빠진다. 실제로 첫 측정에서
   `contrib folding=false find=false multicursor=false` 가 나왔고 번들도 2.65MB 로
   작게 나왔다. **그 숫자는 버린다.**
   → D1 의 올바른 형태는 `editor.api` + **기여 74개**(`editor.main.js` 에서 추출) +
   Monarch 언어, 그리고 `languages/features/*`(ts·json·css·html 서비스)만 제외.

> 곁가지로, 0.56 의 `editor.main` 은 **`monaco-lsp-client`** 를 `lsp` 로 내보낸다.
> Monaco 가 LSP 클라이언트를 품고 나온 것이라 Phase 1 의 `port-lsp` 가 참고할 만하다.

## R1 — WKWebView {#r1}

2021년 실패 사례(#2457 · #2432 · #1255)의 재현을 노렸고, **하나도 재현되지 않았다.**

```
[R1] hit-test 26 ok 불일치 없음
[R1] contrib folding=true bracket=true find=true multicursor=true
[R1] action fold=true unfold=true minimapDOM=true
[R1] foldAll: 보이는 마지막 줄 29 → 2
[R1] scroll 0→500 height=1778
[R1] sticky(outlineModel)      렌더=true 줄수=0
[R1] sticky(indentationModel)  렌더=true 줄수=1 내용="function greet(name: string): string {"
```

- **히트테스트 26/26.** #1255 은 "WebKit 에서 마지막 줄만 클릭되던" 버그였다. 보이는 줄마다
  중앙 좌표를 만들어 `editor.getTargetAtClientPoint()` 와 `document.elementFromPoint()` 를
  둘 다 물었고 전부 제 줄로 떨어졌다.
- **선택 왕복이 한글에서 정확하다.** `안녕하세요, ${` 8자를 UTF-16 기준으로 정확히 집었다.
- **폴딩·검색·다중커서·괄호매칭이 전부 산다.** `foldAll` 이 보이는 마지막 줄을 29→2 로
  줄였다(전부 접힘).

### sticky scroll — Phase 2 에 붙는 조건 {#r1-sticky}

`stickyScroll.ts`(229) + `stickyModel.ts`(152) 삭제가 Phase 2 의 항목인데, **내장 sticky 는
살아 있되 모델이 필요하다.** 기본값 `outlineModel` 에서는 0 줄이 떴고,
`indentationModel` 로 바꾸자 곧바로 바깥 함수 줄을 정확히 그렸다.

→ 원인은 WKWebView 가 아니라 **DocumentSymbolProvider 미등록**이다. Phase 2 는 둘 중
하나를 하면 된다: 기존 `lsp_*` 의 documentSymbol 을 Monaco `DocumentSymbolProvider` 로
등록하거나(권장 — 지금 `stickySymbols` prop 이 이미 그 데이터를 나른다),
`defaultModel: "indentationModel"` 로 떨어뜨리거나.

### 하한 macOS {#r1-minmacos}

`tauri.conf.json` 에 `minimumSystemVersion` 이 없어 **Tauri 2 기본값 10.13** 이 박힌다
(`tauri-utils-2.9.3/src/config.rs`: *"Defaults to `10.13`"*). 실측으로 이 값은 **지금도
틀렸다** — Monaco 와 무관하게 이미 그렇다.

| 층 | 요구 | 근거 |
|---|---|---|
| 우리 빌드 타깃 | **Safari 16** | Vite 7 기본값 `baseline-widely-available` = `chrome107 · edge107 · firefox104 · safari16`. 저장소 `vite.config.ts` 에 `build.target` 이 없어 이 값이 그대로 걸린다 |
| Monaco 소스 문법 | Safari 16.4 (`static {}` 524곳) | 단 **esbuild 가 전부 낮춘다** — safari16 타깃 빌드에서 `static{` 524 → **0**, 크기 변화 없음(2,647,740 vs 2,649,888) |
| 낮출 수 없는 런타임 API | Safari 15.4 | `Object.hasOwn`(3) · `.at()`(25) · `findLast`(22) · `replaceAll`(10) — 문법이 아니라 API 라 트랜스파일이 안 해 준다 |

**구속 조건은 Safari 16 = macOS 13 (Ventura).** Monaco 가 아니라 우리 Vite 타깃이 정한다.

✅ **결정(2026-09-08): `"minimumSystemVersion": "13.0"` 을 박았다**
(`src-tauri/tauri.conf.json` 의 `bundle.macOS`). "macOS 12 이하를 공식 포기"라기보다
**이미 그랬던 사실을 정직하게 적은 것**이다 — 그 사용자는 10.13 이라는 약속을 믿고
설치한 뒤 흰 화면을 봤고, 이제는 설치 단계에서 거절된다.

## R5 — 번들·지연 {#r5}

### 지금 (실측, `dist/assets`)

| 청크 | raw | gzip | 성격 |
|---|---|---|---|
| `CodeScreenV2-BBxnrtP9.js` | 335,588 | 117,338 | 코드 화면 지연 청크 |
| `index-CUwV-cLG.js` | 606,254 | 207,195 | **공유 청크 — CodeMirror 코어가 여기 있다** |
| `index-Bwk7UmFG.js` | 269,009 | — | 진짜 진입 청크 (CM 없음) |

플랜이 "현재 335KB" 라고 적은 것은 **코드 화면 청크만**이다. 실제로 코드 화면을 열면
CodeMirror 가 든 **공유 청크 606KB 가 함께** 온다 (논의 화면과 나눠 쓴다). 즉 오늘의
편집기 비용은 335KB 가 아니라 그 둘의 합에 가깝다.

### Monaco (실측)

| 변형 | 메인 청크 raw | gzip | CSS | 워커 파일 합 raw |
|---|---|---|---|---|
| **D1 — 기여 74 + Monarch 10, 서비스 0** | **3,864,710** | **995,510** | 157,250 | **272,636** (editor.worker 하나) |
| 워커 켬 — `editor.main` 전부 | 3,963,821 | 1,017,090 | 157,248 | 9,474,662 |
| *(버림)* `editor.api` 만 — 기여 없음 | 2,649,889 | 683,750 | 77,170 | 272,636 |

워커 내역(켠 경우): `ts.worker` 7,031,603 (gzip 1,545,201) · `css.worker` 1,051,251 ·
`html.worker` 714,003 · `json.worker` 403,932.

### D1 근거 정정 {#d1-정정}

```
메인 청크 차이 (D1 vs 전부 켬):   -99,111 raw   /  -21,580 gzip
워커 페이로드 차이:             -9,202,026 raw  (지연 로드)
dist/assets 총합:              2,992KB  vs  14,068KB
```

**결론은 그대로, 이유가 다르다.** "켜면 ~2MB 는다"는 여는 청크 기준으로 **틀렸다**
(99KB 다). D1 이 사는 이유는 셋:

1. **공급자 이중화** — `lsp_*` 17커맨드가 이미 완성·호버·진단을 대고 있다. 켜면 두 벌이
   붙어 서로를 덮는다. (이게 원래도 제1 근거였고, 실측 후에도 유일하게 안 흔들린 근거다.)
2. **앱 페이로드 9.2MB** — 지연 로드라 "여는 순간"엔 안 오지만 `.dmg` 에는 실린다.
3. 메인 청크 22KB(gzip) — 부수적.

### 여는 순간의 지연

```
import(monaco)   148ms      ← 3.86MB 청크 파싱·평가
editor.create     71ms
t0 → 편집 가능   221ms      (debug 빌드, 앱에 임베드된 자산, 콜드)
```

**221ms.** 릴리스 빌드·워밍 후엔 더 짧다. 화면 여는 지연은 R5 의 걱정거리가 아니다.
남는 걱정은 gzip **+878KB** 라는 배포 크기 쪽이다.

### D1 이 깨는 것 — JSON·TOML 강조 {#d1-json-toml}

0.56 의 Monarch 문법 84종을 뒤졌는데 **`json` 이 없다.** JSON 강조는 워커를 쓰는
`vs/language/json` 서비스에만 있다. **`toml` 은 아예 없다** (84종 어디에도).

지금 편집기는 둘 다 강조한다 (`@codemirror/lang-json` · `legacy-modes/mode/toml`).
D1 을 그대로 두면 **JSON·TOML 이 무채색이 된다** — 이 저장소에서 `tauri.conf.json` ·
`package.json` · `Cargo.toml` · `.oculpm/config.toml` 을 여는 빈도를 생각하면 회귀다.

✅ **결정(2026-09-08): ① Monarch 문법 둘을 직접 작성한다** (각 30~50줄). 워커 0개
규약이 깨지지 않고 TOML 까지 함께 해결된다. ② `json.worker` 예외 안은 기각 —
+404KB 에 완성·진단 이중화를 막는 배선이 또 붙고 TOML 은 여전히 무채색이다.
Phase 1 `reclaim-lang` 에서 구현한다. → 마스터 플랜 `{#d1a-json-toml}`

## R2 — 한국어 IME 🟢 {#r2}

**결론: Monaco 는 현행 대비 회귀가 없다.**

### 어떻게 쟀나

합성 키 입력이 TCC 에 막혀(`osascript … keystroke` → `1002`) 자동화가 불가능했다.
접근성 권한을 켜면 되지만 시스템 설정 변경이라 임의로 하지 않았고, 대신 **사람이
실제 IME 로 치는** 하네스를 띄웠다. 전 이벤트(`compositionstart/update/end` ·
`beforeinput` · `input` · `keydown` · `onDidChangeModelContent`)를 Rust 커맨드로
파일에 떨궈 사후 재구성이 되게 했다.

### 1라운드 — 기대값이 틀렸다 {#r2-round1}

446 이벤트를 재생해 최종 줄 내용을 복원했다.

| 단계 | 결과 | 판정 |
|---|---|---|
| S1 조합 기본 | `안녕하세요` | ✓ |
| S2 조합 중 방향키 | `한그ㄹ` (끝 ㄹ 이 U+3139 로 남음) | ✗ |
| S3 조합 취소 | `간` (취소했는데 ㄴ 이 받침으로 붙음) | ✗ |
| S4 조합 중 다른 줄 클릭 | `다` | ✓ |

그런데 **둘 다 Monaco 를 탓할 근거가 약했다.**

- S3 의 `Escape` 가 **`isComposing=false`** 로 들어왔다 — 키가 페이지에 닿기 전에 IME 가
  이미 조합을 끝냈다는 뜻이다. Monaco 가 취소를 씹은 게 아니라 취소할 조합이 없었다.
- S2 는 **시험 설계가 틀렸다.** 조합 중 `←` 는 macOS IME 가 조합을 확정하는 키다.
  `그` 가 확정된 뒤의 `ㄹ` 은 합쳐질 조합이 없으니 `한그ㄹ` 이 오히려 정상이다.
  도달 불가능한 기대값을 잡았다.

### 2라운드 — 대조군을 세웠다 {#r2-round2}

판정 기준을 **"내 기대값과 같은가"에서 "현행 CodeMirror 보다 나쁜가"로 바꿨다.**
이관 결정에 필요한 것은 후자다. 같은 WKWebView 안에 셋을 나란히 놓았다:
**순수 `<textarea>`(브라우저 기본) · CodeMirror 6(지금 쓰는 것) · Monaco 0.56.**

같은 시나리오를 세 칸 모두에 수행한 결과, 수렴한 최종 상태가 **완전히 동일**했다:

```
[CMP] ta="안녕하세요"    cm="안녕하세요"    mo="안녕하세요"    same=true
[CMP] ta="안녕ㅎㅏ세요"  cm="안녕ㅎㅏ세요"  mo="안녕ㅎㅏ세요"  same=true
```

자모가 분리된 `ㅎㅏ` 아티팩트조차 **textarea 와 CodeMirror 에서 똑같이** 재현됐다.
즉 1라운드가 잡은 것은 Monaco 의 결함이 아니라 **macOS 한국어 IME 의 동작**이고,
지금 출시된 편집기도 이미 같은 동작을 한다.

> 교훈: IME 검증에 절대 기준을 쓰면 안 된다. 판정자는 **현행 편집기**여야 한다.
> Phase 1 이후의 IME 회귀 검사도 이 3자 비교 하네스를 그대로 쓴다.

## 판정 {#판정}

**R1 · R2 · R3 초록, R5 노랑 → Phase 1 로 간다.**

이관을 막는 기술적 근거가 없다. R5 는 배포 크기(gzip +878KB)를 남기지만, 여는 지연이
221ms 로 작고 지연 청크라 안 여는 사용자에게는 비용이 없다.

미결 둘 다 2026-09-08 결정됐다:

1. ✅ **`minimumSystemVersion` = `"13.0"`** — 박았다. (`{#spike-min-macos}`)
2. ✅ **JSON·TOML 강조** — Monarch 문법 직접 작성. Phase 1 `reclaim-lang` 에서.

정정 사항 — 마스터 플랜에 반영할 것:

- D1 의 "~2MB" → 여는 청크 **99KB**, 워커 페이로드 9.2MB ([D1 근거 정정](#d1-정정))
- "현재 청크 335KB" → 코드 화면은 **CM 이 든 공유 청크 606KB 와 함께** 온다
- Phase 2 의 sticky 삭제는 **DocumentSymbolProvider 등록을 함께 물어야** 성립
