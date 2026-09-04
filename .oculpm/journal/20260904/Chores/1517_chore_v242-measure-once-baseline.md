---
schema_version: 1
type: chore
slug: "v242-measure-once-baseline"
status: done
difficulty: high
created_at: "2026-09-04T15:17:46+09:00"
session_id: "20260904-008"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "a7a49ff0-edf2-49a1-a1f7-e2c9be2e746a"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/tests/perf_baseline.rs"
    op: create
  - path: "src/lib/perfProbe.ts"
    op: create
  - path: "docs/20260904_v242-load-bearing/perf-baseline.md"
    op: create
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/main.tsx"
    op: update
related: []
tags:
  - "perf"
  - "measurement"
  - "v2.42.0"
  - "watcher"
  - "indexer"
  - "mcp-tool"
---
[x] 추정을 측정으로 바꿨다 — 두 개가 죽고, 하나가 6.4초였다

## 동기

`v3-round` 감사는 **앱을 한 번도 실행하지 않고** 코드만 읽어서 나왔다. 그래서 플랜
`v242-load-bearing` 의 성능 주장은 전부 **구조적 추정**이었다 — "이런 조건에서 비용이
선형/곱으로 는다"는 코드 판정이지 "느리다"는 관찰이 아니다.

그래서 측정을 Phase 0 으로 두고, 고칠 것을 정하기 전에 **고칠 값어치가 있는지**부터
정했다.

## 변경 요약

측정 하니스 둘을 만들었다. 둘 다 일회용이 아니라 `{#measure-after}` 와 다음 라운드가
같은 방법으로 다시 잴 수 있는 모양이다.

- `src-tauri/tests/perf_baseline.rs` — 전부 `#[ignore]`. 측정은 게이트가 아니다(러너
  부하에 값이 흔들리고, 흔들린다고 CI 가 붉어질 이유가 없다).
  `cargo test --release --test perf_baseline -- --ignored --nocapture`
- `src/lib/perfProbe.ts` — WKWebView 초기 페인트를 dev 빌드에서 **사람 손 없이** 잰다.
  프로덕션 번들에서는 `import.meta.env.DEV` 로 호출부와 모듈이 통째로 지워진다.

`indexer`·`ast` 를 `pub` 으로 연 것은 하니스가 근사가 아니라 **실제 코드**를 재게 하기
위해서다.

## 죽은 추정 둘

- **`screens.css`(142 KB) 파싱** — 프로젝트 창 초기 CSS 284 KB 전부 합쳐 **7.6 ms**
  (그중 `screens.css` 몫 4.0 ms). 한 프레임의 절반이 안 된다. 파일을 쪼개도 파싱 총량은
  그대로다.
- **단일 연결 DB 액터 큐** — **0.05 ms/op**. 브랜치 전환이 만든 고유 경로 418개를 전부
  실어도 21 ms 다. 플랜 서두의 "3.0 이 확장하면 전부 단일 DB 큐를 지난다"는 걱정은
  **현재 규모에서 근거가 없다.**

## 크기를 잘못 잡은 곳 둘

- `{#classify-blocking}` 은 생각보다 **작다** — 체크아웃당 33 ms, 최악의 단일 파일 36 ms.
  런타임 워커에서 파일 IO 를 도는 것은 고쳐야 할 위생이지만 성능 수정이 아니다.
- `{#index-project-blocking}` 은 생각보다 **크다** — `walk`+`read`+blake3+tree-sitter 가
  워커 1개를 **6,411 ms** 통째로 점유한다. 이 라운드의 최대 발견이다.

## 확정된 것

- **`{#watcher-bounded}`** — `git checkout` 한 번(378파일)이 **한 배치에 1,058 이벤트**를
  unbounded 채널에 붓고, 소비자가 비우는 데 **4,272 ms** 가 걸린다(체크아웃 자체는 149 ms).
  게다가 채널은 **gitignore 필터 이전**이다 — 판정은 `handle_event` 안에서 일어나므로
  `target/`(지금 55,663 파일)·`node_modules/` 쓰기도 전부 큐에 먼저 들어온다.
- **`{#workspace-full-consumers}`** — `useWorkspace()` 는 네 방향 **전부** 5/5 재렌더,
  조각 훅은 자기 조각에서만. 상시 마운트된 세 소비자가 합친 겉면을 쓰므로 터미널 탭을
  하나 고를 때마다 16화면 라우터가 다시 그려진다.
- **`{#settings-slider}`** — 20프레임 = IPC 20 + `setZoom` 20 + 재렌더 20, 그리고
  `SettingsChanged` 가 전 창 브로드캐스트라 **창마다 설정 테이블 전체조회**가 더 붙는다.
  다만 플랜이 적은 네 갈래 중 **"구독 재무장"은 사실이 아니다** — 그 구독의 deps 는
  안정적인 `reload` 하나다.

## 확인 못 함

- **WKWebView 의 실제 초기 페인트.** CSS·렌더 수치는 Chromium 이다. 프로브는 심었지만
  이 라운드에서 앱을 띄우지 않았으므로 **값이 없다.**
- **PTY 청크 실측률과 동시에 열린 웹뷰 수** — `{#pty-broadcast-scope}` 의 곱셈 인자 둘.
- **`target/` 실제 churn** — 채널이 필터 이전이라는 **구조**만 확인했고, `cargo build`
  한 번이 55,663 중 몇 개를 건드리는지는 세지 않았다.

## 검증

`pnpm typecheck` · `pnpm lint`(6종) · `pnpm test`(170 파일 2,256 테스트) · `pnpm build` ·
`cargo fmt --check` 각각 exit 0 을 직접 확인. `perf_baseline` 3 테스트 릴리스 프로필에서
13.09 s 에 통과.