---
schema_version: 1
type: bug
slug: "today-counts-ring-scale-and-now"
status: done
difficulty: high
created_at: "2026-09-07T21:20:44+09:00"
session_id: "20260907-003"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "b2e235a0-7801-4870-9780-7b970cc85e65"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/today/ringScale.ts"
    op: create
  - path: "src/features/today/TodayActivityRing.tsx"
    op: update
  - path: "src/features/today/useTodayBrief.ts"
    op: update
  - path: "src/features/today/useTodayActivity.ts"
    op: create
  - path: "src/features/today/TodayActivity.tsx"
    op: create
  - path: "src/features/today/TodayScreenV2.tsx"
    op: update
  - path: "src/features/today/PluginSetupCard.tsx"
    op: update
  - path: "src/lib/settings.ts"
    op: update
  - path: "src-tauri/src/config/schema.rs"
    op: update
  - path: "src/styles/primitives.css"
    op: update
  - path: "src/lib/oculpmLog.ts"
    op: update
  - path: "package.json"
    op: update
related: []
tags:
  - "today"
  - "ui"
  - "measurement"
  - "v3-release"
  - "mcp-tool"
---
[x] 파일을 고유하게 세고, 링이 상한에 붙지 않고, 지금 하는 일을 말한다

## 발생 원인

**과대 계수** — Today 의 「변경된 파일」이 `Σ files_count`, 즉 파일 **터치 횟수**였다. 같은
파일을 여러 번 건드리면 그만큼 부풀려진다. 실측: 이 저장소 최근 14 워크데이에서 0~105%
과대(중앙값 ~50%, 2026-09-03 은 262 vs 실제 128).

**링 포화** — `k=400` 은 눈금이 아니라 벽이었다. 링이 실제로 세는 자료(`.oculpm/index/diffs/**`
사이드카의 patch)를 워크데이별로 합산하니 8월 이후 **26 워크데이, 중앙값 15,400줄, 범위
65~41,790**. `k=400` 의 상한이 4,081줄이라 **26일 중 22일이 상한에 붙어** 서로 구별되지 않았다.

## 해결 방법

고유 파일 수는 오늘 엔트리의 상세를 걷어 `files_touched[].path` **합집합**으로 센다. 제
자리는 백엔드(`COUNT(DISTINCT file_path)`)지만 그 파일이 다른 레인 소유라 프런트에서 했고,
비용은 캐시가 갚는다(키가 `프로젝트|경로|갱신시각`이라 새 일지 한 건만 읽는다). **상세를
못 읽은 엔트리는 빼고 센다** — `files_count` 로 때우면 고치려던 부풀림이 그대로 돌아온다.

링은 `k=4000` 으로 올렸다. 문턱이 40,807줄이 되어 상한에 붙는 날이 26일 중 **1일**로 줄고
중앙값이 0.79 에 앉는다. 상한이 사라지는 건 아니므로 **양쪽 다** 했다 — `RingArc.capped` 를
값으로 내보내 호버 라벨이 「상한」을 말한다. `files` 링은 이 저장소에서 여전히 상한에
붙지만(고유 110개/일 vs 문턱 ~80) 저장소 하나로 모든 사용자의 하루를 정할 수 없어 눈금은
안 건드리고 화면이 그 사실을 말하게 뒀다. `c844555` 의 반지름별 클램프는 로직 그대로
`ringScale.ts` 로 옮겼고 기존 기하 테스트가 통과한다.

**「지금 하는 일」** — Today 에 그 표면이 아예 없었다(「활동 시간」은 지난 일의 합이다).
어휘를 새로 만들지 않고 `seatActivity()` + `ActivityLine`(kind+detail)을 그대로 부른다.
정직성 3단: 세션 0개면 카드는 남고 그렇게 말한다 · 세션은 있는데 원장이 아는 일이 없으면
「조용함」(돌고 있다고 지어내지 않는다) · **원장을 못 읽으면 아무 말도 안 한다**(모름은
0이 아니다).

**플러그인 카드 닫기** — 새 백엔드 커맨드 없이 기존 settings 경로로 됐다.
`plugin_card_dismissed` 는 `LOCAL_ONLY_KEYS` 에 넣었다: 그 카드는 **이 기기에** Claude Code
가 깔렸는지로 뜨므로, 문서가 실어 나르면 아직 설치 안 한 기기에서도 숨어 버린다.

곁들여 `.empty-hint` 호출부가 0이 되어 `primitives.css` 의 정의와 죽은 CSS 를 지웠고,
eslint 래칫을 50 → 47 로 내렸다(`no-console` 규칙이 설정에 아예 없어 처음부터 무의미했던
지시문 3줄 제거 + 죽은 커맨드가 데리고 있던 경고).

## 검증

`pnpm test` 190파일 / 2,463건 · `pnpm typecheck` · `pnpm lint` · `pnpm build` ·
`cargo test`(30 스위트) · `cargo clippy -D warnings` 전부 exit 0. 링 스케일은 순수
함수(`ringScale.ts`)로 빼고 테스트 6건을 붙였다.

**육안 미확인** — 링 눈금과 새 카드는 실제로 띄워 봐야 한다(육안 대장 세션 A·G).