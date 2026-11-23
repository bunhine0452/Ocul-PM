# Ocul 화면 하네스

실제 `src/main.tsx` 를 브라우저에서 통째로 띄우고, Tauri IPC 를 목업으로 바꿔 이 저장소의 **실제 `.oculpm` 일지 · 계획 · 최근 커밋 변경**으로 그린다. 화면을 바꿀 때마다 같은 42장을 전후로 찍어 「좋아졌다」를 주장이 아니라 영수증으로 남기려는 **개발 도구**다.

- 설치본이 돌고 있어도 안전하다 — 프런트만 뜨고 앱 데이터 · 단일 인스턴스 소켓을 건드리지 않는다.
- **앱에 닿지 않는다.** `harness.html` 은 Vite 빌드 입력(`index.html` 하나)이 아니라 dev 서버가 `/scripts/harness/harness.html` 로 낼 뿐이라 `dist` 에 안 들어간다. 앱 소스(`src/`)는 이 폴더를 불러오지 않고, 하네스는 네트워크에 나가지 않는다(egress 원장 밖). `src/__tests__/harness_kit.test.ts` 가 지킨다.
- **커밋되는 픽스처는 없다.** 픽스처(이 저장소 일지 본문이 든다)와 찍은 PNG 는 `scripts/harness/generated/` 에 실행 때 만들어지고 `.gitignore` 다.

## 쓰는 법

```bash
pnpm harness:shots                       # 픽스처 새로 뽑기 → dev 서버(1434) → 42장 → generated/shots/*.png + _report.json
pnpm harness:shots --out <폴더>          # 다른 곳에
pnpm harness:shots --only 05-diff,70-    # 이름 조각으로 일부만
pnpm harness:shots --strict              # 예외 · 핸들러 없는 명령 · 못 찾은 단추가 있으면 끝 코드 1
pnpm harness                             # 눈으로 보기: 서버만 띄우고 http://localhost:1434/scripts/harness/harness.html 을 연다
pnpm harness:fixtures                    # 픽스처만 다시 뽑기 (--days 8 · --repo <경로>)
```

Chrome 은 시스템 것을 쓴다(`CHROME_PATH` 로 지정). 한 바퀴 약 4분. 끝나면 띄운 서버와 Chrome 을 내린다 — `pnpm harness` 로 서버를 먼저 띄워 뒀으면 그것을 그대로 쓴다.

## 파일

| 파일 | 하는 일 |
|---|---|
| `harness.html` | dev 전용 진입점 — `entry.ts` 하나만 싣는다. |
| `entry.ts` | 시계 고정(마지막 작업일 18:20 KST, `now=`) · `localStorage.clear()`(`keep=1` 이면 둠) · `mockWindows("main")` + `mockIPC` 를 세운 **뒤에** 실제 `main.tsx` 를 불러온다. 부른 명령 `window.__ipcLog`, 핸들러 없는 명령 `window.__ipcMissing`, 던진 오류 `window.__ipcErrors`. |
| `handlers.ts` | 명령별 응답. 핸들러 표 `Typed`(`types.ts`)의 키는 `bindings.ts` 의 명령 이름, 값은 그 명령의 응답 타입이라 **백엔드 타입이 바뀌면 `pnpm typecheck` 가 문다**(`tsconfig.json` 의 `include`). 바인딩에 없는 `plugin:` 명령은 몇 개만 흉내 내고 나머지는 누락으로 센다. |
| `derive.ts` | 픽스처 → 응답 재료(일지 요약 · 오늘 digest · 변경 묶음). |
| `types.ts` | `Fixtures` 와, bindings 에서 「명령 → 응답」 표를 뽑는 타입. |
| `fixtures.mjs` | 픽스처 뽑기 — 일지 최근 8일 · 활성 계획 · 최근 커밋의 파일과 패치(「커밋 전 변경」 9개, 그중 일지에 안 적힌 2개). 키 모양 · 이메일 · 집 폴더 이름을 가린다. |
| `plan.mjs` | 찍기 계획 — 화면 × 밝게/어둡게 × 1280/760 × 빈 상태 · 영어 · 예외 · ⌘K. 열 일지 · 계획은 픽스처에서 고른다. |
| `shots.mjs` | 위를 묶는 실행기 — 시스템 Chrome 하나 + Node 내장 WebSocket CDP. 장마다 새 탭, 결과와 IPC 누락 · 예외 · 콘솔 오류 · 못 찾은 단추를 `_report.json` 에. |
| `audit.js` | 찍은 직후 DOM 측정 — 잘림(scrollWidth > clientWidth) · 가로 넘침 · 24px 미만 표적 · 채운 단추 · 대비(AA) · 글자 크기 분포. |

## URL 인자 (`harness.html?…`)

`theme=dark|light` · `lang=en|ko` · `start=1`(시작 창) · `empty=1`(새 프로젝트) · `wait=1`(Claude 기다림 + 질문) · `fail=1`(맨 위 계획 판정 ✗) · `pc=blue…`(프로젝트 색) · `accent=` · `now=<ISO>` · `keep=1`.
화면 이동: `window.dispatchEvent(new CustomEvent("oculpm:set-view", {detail: "diff"}))`, 항목 열기: `oculpm:open-entity` `{kind:"journal"|"plan", id}`.

## 새 명령이 생기면

`_report.json` 의 `ipcMissing`(또는 `pnpm harness:shots` 가 장마다 적는 「핸들러 없음 …」)에 이름이 뜬다. `handlers.ts` 의 표에 그 명령을 더한다 — 이름이 `bindings.ts` 에 있으면 응답 모양을 타입이 강제한다.

## 함정 (밟은 것)

- 첫 로드는 셸이 늦게 붙어 `set-view` 한 번이 씹힌다 → `plan.mjs` 의 `view()` 는 500ms 간격으로 세 번 쏜다.
- 같은 크롬 프로필은 장 사이에 localStorage(마지막 화면)를 넘긴다 → `entry.ts` 가 매 장 지운다.
- frontmatter 의 `related: []` · `tags: []` 를 문자열로 읽으면 `JournalRelated` 가 `explicit.map` 으로 깨진다(가짜 결함) → 픽스처는 배열로.
- 「기록 없는 변경」 은 `oculpm_compare_workday` 와 `oculpm_group_changes` 가 같은 파일(`fixtures.unrecorded`)을 말해야 한다 — 어긋나면 탭 배지는 2 인데 변경 화면에 「일지 없음」 묶음과 채운 단추가 없어 거짓 소견이 난다.
- 빈 상태(`empty=1`)에서도 `today_local_only` 는 「이 기기에만」 수를 돌려준다 — 빈 화면의 그 수는 하네스 탓.
- 증거 등급 정규식의 `\b` 는 JS 에서 ASCII 만 낱말로 쳐서 「검증」 뒤에서 안 선다(전 일지가 「검증 없음」 으로 나왔다) → 유니코드 룩어헤드.
- headless 는 `document.hasFocus()` 가 false 라 `data-app-inactive` 가 켜져 있고 첫 실행 투어도 안 뜬다.
- macOS 창 크롬(신호등)은 못 본다 — 윗줄 왼쪽 70px 빈자리는 정상.
- 「단추를 눌러 펼치는」 장(`71-` `72-` `73-`)은 한국어 UI 글자로 단추를 찾는다 — 못 찾으면 보고서에 「단추 못 찾음」 이 뜬다(문구가 바뀐 것).
- 응답 모양이 타입으로 막히는 건 **핸들러 쪽**뿐이다. `fixtures.mjs` 가 내는 JSON(계획 · 일지)은 타입 밖이니, 백엔드가 계획 항목 필드를 더하면 `types.ts` 의 `FixturePlan`(bindings 타입)에 맞춰 `fixtures.mjs` 도 고친다.
