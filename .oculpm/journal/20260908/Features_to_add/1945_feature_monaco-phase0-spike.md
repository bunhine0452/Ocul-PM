---
schema_version: 1
type: feature
slug: "monaco-phase0-spike"
status: done
difficulty: high
created_at: "2026-09-08T19:45:11+09:00"
session_id: "20260908-005"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "5b0cd752-7a72-41db-9cea-80e0b20c6a6d"
language: "ko"
verified_by_user: false
files_touched:
  - path: "docs/20260908_monaco-editor/01-spike.md"
    op: create
  - path: "docs/20260908_monaco-editor/00-master-plan.md"
    op: correct
related:
  - ref: "20260908/Refactors/1835_refactor_remove-retro-and-docs-screens.md"
    kind: "followup"
tags:
  - "monaco"
  - "editor"
  - "spike"
  - "ime"
  - "wkwebview"
  - "bundle"
  - "mcp-tool"
---
[x] Monaco 이관 Phase 0 스파이크 — 네 위험을 실측해 초록 판정

## 추가 기능

CodeMirror → Monaco 이관의 Phase 0 스파이크. "이관해도 되는가"만 답하고 Phase 1 코드는
쓰지 않는 자리다. R1(WKWebView) · R2(한국어 IME) · R3(워커·Vite) · R5(번들) 넷을 실측해
**셋 초록, 하나 노랑 → 이관 진행** 으로 판정했다.

스파이크는 저장소 밖 스크래치패드의 **독립 Tauri 앱**으로 만들었다 —
번들 id 를 `com.oculpm.monaco-spike` 로 따로 줘서, 돌고 있는 설치본 Ocul-PM 과
app-data · SQLite · `.oculpm` 락을 다투지 않게 했다. 저장소에 남는 것은 문서 하나뿐이다.

## 동작 흐름

**R1 WKWebView — 초록.** 2021년 실패 사례(#2457 · #2432 · #1255)를 노렸는데 하나도
재현되지 않았다. #1255("마지막 줄만 클릭됨")는 보이는 줄마다 중앙 좌표를 만들어
`getTargetAtClientPoint()` 와 `elementFromPoint()` 를 둘 다 물어 확인했다 — **26/26 일치**.
폴딩 · 검색 · 다중커서 · 괄호매칭 · 미니맵이 전부 살아 있고 `foldAll` 이 보이는 마지막
줄을 29→2 로 접었다.

**R2 한국어 IME — 초록 (판정 기준을 한 번 갈아엎고 나서).** 1라운드에서 S2 `한그ㄹ` ·
S3 `간` 이 기대값과 어긋나 붉게 나왔다. 그런데 Escape 가 `isComposing=false` 로
들어온 것을 보고 — 키가 페이지에 닿기 전에 IME 가 이미 조합을 끝냈다는 뜻이다 —
**내 기대값을 의심**했다. 조합 중 `←` 는 macOS IME 가 조합을 확정하는 키라
`한그ㄹ` 이 오히려 정상이었다. 도달 불가능한 기대값이었다.

그래서 판정 기준을 **"내 기대값과 같은가" → "현행 CodeMirror 보다 나쁜가"** 로 바꾸고,
같은 WKWebView 안에 **순수 `<textarea>` · CodeMirror 6 · Monaco 0.56** 셋을 나란히 놓았다.
결과가 완전히 동일했다 — 자모가 분리된 `안녕ㅎㅏ세요` 아티팩트조차 셋 다 똑같이 냈다.
Monaco 고유 결함이 아니라 **macOS 한국어 IME 의 동작**이고 현행도 이미 그렇다.

**R3 워커 — 초록.** `self.MonacoEnvironment.getWorker` + Vite `?worker` 직접 구현을
택했다(플러그인 계열과 섞지 않는다). ESM 판이 전역 `monaco` 를 안 만드는 것도
트레이스로 확인했다 — 우리는 모듈 임포트만 쓰므로 `globalAPI` 는 불필요.

**R5 번들 — 노랑.** D1 기준 메인 청크 3,864,710B(gzip 995,510) + CSS 157KB +
editor.worker 273KB. 여는 지연은 **221ms**(import 148 + create 71)로 작다.

## 실측이 뒤집은 것

- **D1 의 근거가 틀렸다(결론은 유지).** 마스터 플랜의 "언어 워커를 켜면 ~2MB 는다"는
  여는 청크 기준으로 **99KB(gzip 22KB)** 였다. 진짜 차이는 워커 파일 쪽 **9.2MB**
  (`ts.worker` 혼자 7.03MB)이고 그마저 지연 로드다. D1 이 사는 이유는 번들이 아니라
  ①`lsp_*` 17커맨드와의 **공급자 이중화** ②`.dmg` 페이로드 9.2MB 다.
- **"현재 청크 335KB" 도 반쪽이었다.** CodeMirror 코어는 코드 화면 청크가 아니라
  **공유 청크 `index-CUwV-cLG.js` 606KB** 에 있다(논의 화면과 공유). 코드 화면을 열면
  둘이 함께 온다.
- **`editor.api` 만 임포트하면 빈 껍데기다.** 0.56 에는 `editor.all.js` 가 없고 기여
  목록이 `editor.main.js` 안에 인라인으로 있다. 처음 잰 2.65MB 는 폴딩도 검색도 없는
  편집기였고 그 숫자는 버렸다. 올바른 D1 = `editor.api` + 기여 74개 + Monarch 언어,
  `languages/features/*` 만 제외.
- **0.56 은 임포트 경로가 통째로 바뀌었다.** exports map 이 `esm/vs` 를 뿌리로 잡아
  모든 튜토리얼과 `vite-plugin-monaco-editor` 가 쓰는 `monaco-editor/esm/vs/...` 가
  죽었다. 최상위 `.css` 임포트도 막힌다.
- **JSON·TOML 강조가 D1 에서 사라진다.** Monarch 84종에 `json` 이 없고(워커 서비스
  전용) `toml` 은 아예 없다. 지금은 둘 다 강조되므로 회귀다.
- **sticky 는 살아 있되 모델이 필요하다.** 기본 `outlineModel` 은 0줄,
  `indentationModel` 은 정확히 렌더. 원인은 WKWebView 가 아니라 DocumentSymbolProvider
  미등록 — Phase 2 의 `stickyScroll.ts` 삭제는 그 등록을 함께 물어야 성립한다.
- **`minimumSystemVersion` 이 지금도 틀렸다.** Tauri 기본값 10.13 인데 Vite 7 기본
  타깃이 `safari16` 이라 **Monaco 와 무관하게** 이미 macOS 13 을 요구한다.

## 검증

`docs/20260908_monaco-editor/01-spike.md` 에 전 수치와 트레이스를 남겼다. R1 은 26/26
히트테스트와 contrib/action API 조회로, R2 는 3자 비교 하네스의 수렴 스냅샷
(`same=true`)으로, R5 는 두 변형의 빌드 산출물 바이트로 확인했다. 저장소 코드는
변경하지 않았다 — 스파이크는 전부 저장소 밖에서 돌았다.