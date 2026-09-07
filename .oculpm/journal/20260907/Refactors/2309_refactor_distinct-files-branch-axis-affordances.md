---
schema_version: 1
type: refactor
slug: "distinct-files-branch-axis-affordances"
status: done
difficulty: high
created_at: "2026-09-07T23:09:00+09:00"
session_id: "20260907-003"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "b2e235a0-7801-4870-9780-7b970cc85e65"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/cache/files.rs"
    op: update
  - path: "src-tauri/src/oculpm/cache/distinct_files_tests.rs"
    op: create
  - path: "src-tauri/src/commands/oculpm.rs"
    op: update
  - path: "src-tauri/src/oculpm/index/branch/mod.rs"
    op: update
  - path: "src-tauri/src/git.rs"
    op: update
  - path: "src/features/today/useTodayBrief.ts"
    op: update
  - path: "src/features/today/ringScale.ts"
    op: update
  - path: "src/features/chat/conversation/AcpToolbar.tsx"
    op: update
  - path: "src/features/oculpm/EntryDetailView.tsx"
    op: update
  - path: "src/api/acp.ts"
    op: update
tags:
  - "today"
  - "branch"
  - "measurement"
  - "v3-release"
---
[x] 고유 파일 수를 백엔드가 답하고, 브랜치 축이 중첩 저장소를 안 놓친다

## 동기

지난 라운드가 급히 프런트에 얹은 계산을 제 자리로 옮기고, 브랜치 축의 세 한계를 재고,
살려 둔 두 커맨드에 화면을 붙인다.

## 변경 요약

### 고유 파일 수 {#distinct-files-backend}

**마이그레이션이 필요 없었다** — `oculpm_journal_files` 가 012 부터 이미 그 자료를 들고 있고
기존 인덱스를 그대로 탄다. `COUNT(DISTINCT f.file_path)` 를 캐시에 넣고 `WorkdayBrief` 에
한 칸을 실었다. 프런트에서는 엔트리마다 상세를 걷던 `Promise.all` 과 `경로|갱신시각` 캐시,
그리고 그 캐시를 다시 세우던 로직을 **통째로 지웠다**(−71/+18, `oculpmApi` import 자체가
이 훅에서 사라졌다).

**실측 대조** — 라이브 캐시에서 44 워크데이 전부에 대해 옛 프런트 합집합과 새 SQL 을 비교해
**차이나는 행 0**. 오늘은 고유 156개(터치 181회 — 옛 방식이면 16% 부풀었다).

지난 라운드의 "상세를 못 읽은 엔트리는 빼고 센다" 규칙은 **필요 없어졌다**. 그 규칙은 IPC 가
실패했을 때 `files_count` 로 때우지 말라는 것이었는데, 백엔드에는 per-entry IPC 가 없다.

### `files` 링 눈금 {#files-ring-scale}

`lines` 때와 같은 방법으로 쟀다. 워크데이별 고유 파일 수 분포(44일): 중앙값 55, p75 100,
p90 170, max 209. 8월 이후 26일로 좁히면 중앙값 81.

`k=8` 의 상한 문턱은 108개라 **44일 중 9일이 상한**에 붙었다. `k=20` 이면 문턱이 271개로
올라가 상한에 붙는 날이 **0**, 중앙값 채움이 0.73(8월 창 0.80)으로 `lines` 의 0.79 와 같은
자리에 앉는다. k=15 도 조건은 만족하지만 최댓날이 상한에 눌린다.

> 플랜 문구의 "고유 110개/일 · 문턱 약 80개" 는 둘 다 틀렸다 — 실측은 중앙값 81, 문턱 108.

### 브랜치 축 세 한계 {#branch-axis-limits}

**진짜 버그를 하나 찾아 고쳤다.** `read_branch_git` 이 git 이 주는 **저장소 상대** 경로를
프로젝트 루트 기준으로 되맞추지 않았다 — `uncommitted_changes` · `changes_in_range` 는 이미
되맞추는데 이 축만 빠져 있었다. 저장소 루트 ≠ 프로젝트 루트인 배치에서 `Files` 귀속이
**조용히 0건**이 되고 `.oculpm/journal/**` 판정도 빗나간다. `git.rs` 에 `root_relative()` 를
두고(기존 두 소비자도 그걸로 리팩터, 동작 불변) 브랜치 축이 그 문을 지나게 했다. 중첩 배치
회귀 테스트를 붙였다.

`Files` 겹침 과잉 귀속은 **그대로 뒀다** — 저장 기반 제외 손잡이는 이 모듈의 설계 원칙(귀속은
저장하지 않는다, 브랜치는 리베이스로 움직이는 좌표라 저장한 값은 곧 거짓)과 충돌한다. 대신
툴팁이 겹침이 배타적이지 않다는 사실을 매번 밝힌다.

300 커밋 상한은 **재고 그대로 뒀다**: 이 저장소(791커밋) ~60ms, 합성 8,000커밋 <10ms,
50,000커밋에서도 <10ms — `-n300` 은 앞에서 300개만 훑고 멈추므로 비용이 저장소 크기와 무관한
상수다. 캡을 없애도 5만 커밋에서 0.5초 미만. 그 수치를 코드에 적어 다음 사람이 다시 재지
않게 했다.

### 살려 둔 두 커맨드에 화면 {#acp-stop-ui} {#entry-open-affordance}

`acp_stop` 은 지난 라운드에 죽은 커맨드 17개 중 유일하게 살려 둔 것이다. ACP 상단바에
「어댑터 내리기」를 붙였다 — 파괴적이라 공용 `useConfirm` 을 거치고, 내린 뒤에는 기존
`AgentGoneNotice` 경로로 이어 죽은 어댑터를 살아 있는 것처럼 그리지 않는다.

`openEntryInEditor` 는 누출이 아니라 미구현 어포던스였다. `EntryDetailView` 에 「파일로 열기」
를 붙이되 **반드시 그 래퍼를 거친다** — 우회가 opener-scope 회귀 3번을 만든 원인이고, 이
래퍼가 존재하는 이유다.

## 검증

`cargo test` 31 스위트 · `clippy -D warnings` · `cargo fmt --check` · `pnpm typecheck` ·
`pnpm lint` · `pnpm test`(190파일) · `pnpm build` 전부 exit 0.

**육안 미확인** — 링 눈금과 두 새 손잡이는 띄워 봐야 한다.
