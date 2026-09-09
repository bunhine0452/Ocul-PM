# Phase 4 — 논의 편집기: CodeMirror 의존성이 사라졌다

> 플랜: [`monaco-editor-round`](../../.oculpm/planner/monaco-editor-round.md) `{#discussion}`
> 앞선 단계: [`03-capabilities.md`](03-capabilities.md).

`package.json` 에서 `@codemirror/*` 와 `@lezer/highlight` 가 **전부 사라졌다.**
플랜이 "이 라운드의 완료 신호" 라고 적어 둔 줄이다.

## 선행 조건은 만족됐다 {#disc-wait}

`{#disc-wait}` 은 "병렬 세션의 논의 CAS 손실 수정이 머지될 때까지 시작하지
않는다" 였다. 확인: `60b66a9 fix: 논의 문서의 조용한 덮어쓰기…` 가 머지돼 있고,
`src/features/discussion/` 과 `src-tauri/src/oculpm/discussion.rs` 에 미커밋
변경이 없다. `DiscussionScreenV2.tsx` 는 799줄로 래칫 안이고 이 Phase 는 그
파일을 건드리지 않았다 (`{#disc-filesize}`).

## 이음매는 오프셋 하나였다 {#offset-seam}

`DiscussionEditor` 의 진짜 계약은 `apply(make)` 다 — 순수 모듈 `mdEdit.ts` 가
문서 문자열과 선택 범위를 받아 `EditOp { from, to, insert, selFrom, selTo }` 를
돌려주고, 편집기는 그것을 반영만 한다. 그 좌표는 **문서 시작부터의 오프셋**
(CodeMirror 의 단위)이다.

Monaco 는 (줄, 열)로 말한다. 그래서 환산이 `apply` 안에만 산다:

```ts
model.getOffsetAt(sel.getStartPosition())   // 선택 → 오프셋 (순수 모듈에게)
model.getPositionAt(op.from)                // 오프셋 → 위치 (편집기에게)
```

둘 다 UTF-16 코드 유닛이라 인코딩 변환은 없다. **순수 모듈은 편집기를 여전히
모른다** — `mdEdit.ts` 는 한 줄도 안 바뀌었다.

반영은 `executeEdits` **한 번**이다. 여러 번 부르면 실행 취소가 조각조각 나서
"삽입 한 번"이 ⌘Z 세 번이 된다.

## CM 에서 오던 것들의 새 출처 {#what-replaced-what}

| 옛것 | 새것 |
|---|---|
| `history()` | Monaco 내장 실행 취소 |
| `search({top:true})` + `searchKeymap` | Monaco find 위젯 (⌘F · ⌥⌘F) |
| `placeholder()` | `placeholder` 옵션 (`placeholderText` 기여) |
| `EditorView.lineWrapping` | `wordWrap: "on"` |
| `markdown()` + `HighlightStyle` | `markdown-prose` Monarch + 테마 `.md-prose` 규칙 |
| `EditorView.theme({...})` (인라인 CSS-in-JS) | `discussion.css` 의 `.disc-edit-cm .monaco-editor` |
| `keymap.of([...])` | `editor.addAction` (⌘S · ⌘B · ⌘I · ⌘K) |

⌘S 가 두 번 저장되지 않는 근거도 그대로다 — CodeMirror 는 `stopPropagation: true`
였고, Monaco 액션은 처리한 키의 전파를 스스로 멈춘다.

## 결정

### 코드용 `markdown` 을 안 쓰고 문법을 하나 더 썼다 {#prose-grammar}

Monaco 0.56 의 Monarch 마크다운은 **제목을 단계 구분 없이 전부 `keyword`** 로
낸다(`markdown.js` 의 `^(\s{0,3})(#+)…` → `["white","keyword","keyword","keyword"]`).

논의 문서에서는 그 단계가 곧 구조다. `##` 는 파서(`discussion/parse.rs`)가
아는 섹션(문제 · 배경 · 옵션 · 토의 로그 · 결론 · 다음 단계)이고 `###` 는 그 안의
옵션 하나다. 한 색으로 뭉개면 "지금 어느 섹션에 쓰고 있나" 가 화면에서 사라진다.
CodeMirror 판 `mdHighlight` 는 그 구분을 갖고 있었으므로 그냥 두면 회귀다.

`monaco/langProse.ts` 가 `markdown-prose` 를 등록한다 — 제목 4단계 + **안정
id(`{#opt-a}`)** 를 따로 칠한다. 후자는 이 문서 형식의 뼈대이고 삽입 메뉴가
만들어 주지만, 손으로 지웠는지가 눈에 보여야 한다.

언어 id 를 따로 둔 덕에 코드 화면에서 `.md` 를 열 때는 Monaco 의 것을 그대로
쓴다(거기서는 원문이 코드다).

### 테마는 **하나**다 — 접미사로 가른다 {#one-theme}

Monaco 의 테마는 **전역**이다(`StandaloneEditor` 생성자가
`themeService.setTheme` 을 부른다). 두 편집기가 서로 다른 테마를 동시에 쓸 수
없는데, 코드 화면과 논의 화면은 **다른 창 탭에서 함께 살아 있을 수 있다**
(`TabbedWindow` 는 비활성 탭을 마운트한 채로 둔다).

그래서 `oculpm` 테마 하나에 두 언어의 규칙을 싣고 `.md-prose` 접미사로 갈랐다.
`monaco_prose.test.ts` 가 그 짝을 문다 — 문법이 내는 토큰에 규칙이 없으면
Monarch 는 점을 하나씩 떼며 폴백해서 `type.h2.md-prose` 가 **코드용 타입 색**
으로 칠해진다. 화면은 그럴싸하고 아무 테스트도 안 깨지는 종류의 결함이다.

산문 팔레트를 위해 `CODE_TOKENS` 에 `--text` · `--text-2` · `--text-3` ·
`--accent-text` 가 늘었다.

### 산문에서는 자동 괄호 닫기를 끈다 {#prose-options}

코드 화면과 정반대 판단이다. 한국어 산문에서 `(그런데` 를 치면 닫는 괄호가
따라붙어 방해가 더 크다. **선택 감싸기는 남긴다** — 서식 단축키와 같은 손놀림이다.
줄 번호 · 미니맵 · 거터 · 접기 · 브래킷 색칠 · 들여쓰기 가이드도 전부 껐다. 다중
커서는 남겼다(토의 로그 표의 같은 열을 한꺼번에 고친다).

## jsdom 이 Monaco 를 만나서 생긴 것 {#jsdom}

`discussion_editor.test.tsx` 는 **이 이관의 판정자**였다 — 툴바 → 편집 → `onSave`
를 실제로 흘려 보므로 오프셋 환산이 어긋나면 여기서 잡힌다. 테스트 본문은 한 줄도
안 고쳤다. 다만 전역 setup 에 셋이 늘었다.

- `document.queryCommandSupported` — 클립보드 기여가 **임포트되는 순간** 부른다.
  테스트 파일의 `beforeAll` 은 임포트보다 늦어서 거기 두면 스위트가 통째로 로드에
  실패한다.
- `ResizeObserver`.
- `navigator.clipboard` + `ClipboardItem`. jsdom 의 UA 는 `AppleWebKit` 을 담고
  `Chrome`·`Safari` 는 안 담아 Monaco 가 이 환경을 **WebKit 웹뷰**로 읽고
  (`isWebkitWebView`) Safari 용 쓰기 우회를 켠다. 그 우회는 클릭마다
  `DeferredPromise` 를 만들어 `ClipboardItem` 에 넘기고 다음 클릭에서 앞의 것을
  취소하는데, `ClipboardItem` 이 없으면 그 거절을 아무도 안 받아 unhandled
  rejection 으로 튄다(테스트는 통과하는데 러너는 붉다).

  **UA 를 크롬처럼 위장해 그 경로를 끄는 안은 기각했다.** 실기기(WKWebView)가
  실제로 타는 경로를 테스트에서도 지나가게 두는 편이 정직하다. 없는 **브라우저
  API** 를 채웠다.

  ⚠️ 이 스텁은 `writable: true` 여야 한다. 여러 스위트가
  `Object.assign(navigator, { clipboard: { writeText } })` 로 자기 스파이를
  얹는데, 읽기 전용이면 그 대입이 조용히 무시돼 "복사했나" 를 보는 테스트
  5개가 죽는다 (실제로 죽여 봤다).

## 번들 — 청크 지도가 바뀌었다 {#bundle}

| | Phase 3 | Phase 4 |
|---|---:|---:|
| `DiscussionEditor` 청크 | 537.97 kB (gzip 186.37) | **8.77 kB** (gzip 3.35) |
| `CodeScreenV2` 청크 | 4,005.89 kB (gzip 1,042.77) | 134.28 kB (gzip 41.33) |
| 공유 Monaco 청크 | — | 3,871.14 kB (gzip 1,001.45) |

두 화면이 같은 Monaco 를 쓰게 되자 Rollup 이 그것을 **공유 청크**로 끄집어냈다
(이름은 우연히 `theme-*.js` — 청크 뿌리로 뽑힌 모듈이 `monaco/theme.ts` 다).

읽는 법: 앱 전체 페이로드는 **CodeMirror 538KB 만큼 줄었다.** 대신 논의 화면을
처음 여는 비용이 CodeMirror 538KB 에서 Monaco 3.87MB 로 올랐다 — 코드 화면을
이미 연 뒤라면 0 이다(같은 청크). 로컬 파일이라 네트워크는 없고, Phase 0 이 잰
"여는 지연 221ms" 가 이제 이 화면에도 적용된다. 실제 숫자는 Phase 6
`{#fin-perf}` 가 `05-performance.md` 에 남긴다.

## 게이트

`typecheck` · `test`(192파일 **2,476개**) · `lint` 6종 · `build` 전부 exit 0.
