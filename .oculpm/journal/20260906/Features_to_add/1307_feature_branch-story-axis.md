---
schema_version: 1
type: feature
slug: "branch-story-axis"
status: done
difficulty: superhigh
created_at: "2026-09-06T13:07:28+09:00"
session_id: "20260906-002"
agent:
  id: "claude-code"
  session: "b2e235a0-7801-4870-9780-7b970cc85e65"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src-tauri/src/oculpm/index/branch/mod.rs"
    op: create
  - path: "src-tauri/src/oculpm/index/branch/tests.rs"
    op: create
  - path: "src-tauri/src/commands/branch.rs"
    op: create
  - path: "src-tauri/src/git.rs"
    op: update
  - path: "src-tauri/src/commands/export.rs"
    op: update
  - path: "src-tauri/src/lib.rs"
    op: update
  - path: "src/features/branch/BranchScreenV2.tsx"
    op: create
  - path: "src/features/branch/BranchPanels.tsx"
    op: create
  - path: "src/features/branch/useBranchStory.ts"
    op: create
  - path: "src/api/oculpm.ts"
    op: update
related: []
tags:
  - "v3-surface"
  - "branch"
  - "git"
  - "index"
  - "rust"
  - "mcp-tool"
---
[x] 브랜치의 이야기 — 일지·플랜·커밋·파일을 한 좌표로, 저장하지 않고 파생한다

기둥 2(`v3-surface`)의 유일한 신기능 — `{#branch-index}` `{#branch-story-view}` `{#branch-digest}`. `v3-round` 의 경계 결정은 **"안 넘는다"** 였다: 팀·원격·서명은 기각하고 브랜치 축만 채택했다.

## 추가 기능

이 저장소의 기록 축은 **날짜 + 타입 폴더**다. 브랜치는 어디에도 축이 아니고 스냅샷에 값으로만 잡혀 있었다(`spec.rs:294`). 그래서 `feat/x` 에서 사흘간 만든 일지 5건·플랜 7개를 「이 브랜치의 이야기」로 읽을 자리가 없었다. git 은 이미 로컬에 있고 `git.rs` 가 읽으므로, **새 저장 형식도 네트워크도 없이** 가능한 유일한 신기능이었다.

## 동작 흐름

**귀속은 저장하지 않고 파생한다.** `git log <base>..<branch> --name-status` + `merge-base` + `status --porcelain` 으로 브랜치의 커밋·바뀐 파일·날짜 창을 읽고, 그 창의 일지를 기존 `JournalCache::range_entries` 에서 꺼내 **두 근거**로 붙인다 — 일지 `.md` 파일 자체가 브랜치 변경 목록에 있으면 `Entry`, 일지가 적은 파일이 브랜치가 바꾼 파일과 겹치면 `Files`. **근거가 없으면 붙이지 않는다.**

**마이그레이션을 일부러 만들지 않았다.** 캐시에 `branch` 컬럼을 더해도 리베이스·체리픽·머지 한 번에 거짓이 된다 — 브랜치는 움직이는 좌표다. 저장하는 순간 그 값은 "언젠가 틀릴 값"이 되므로, 매번 git 에게 다시 묻는 편이 옳다. frontmatter·`schema_version`·디스크 형식 무변경, 유출 원장 무변화.

**화면.** 통계 4칸(커밋·일지·바뀐 파일·**기록률**) + 기록·플랜·커밋(날짜별 접이식)·파일(접이식 + "기록 없는 것만" 토글). 회고 `SignalsPanel` 의 어휘(`.card card-pad` · `.stat` · 한 줄 = 한 사실)를 그대로 빌려 **새 CSS 파일이 0** 이다. `screens.css` 는 손대지 않았다(같은 라운드의 방언 수렴 레인 소유).

**내보내기.** `oculpm_export_digest` 가 이미 갖고 있던 저장 대화상자 + 원자적 쓰기를 `save_markdown()` 으로 추출해 재사용했다. 제목·근거·커밋·**기록되지 않은 변경** 목록을 마크다운 한 장으로 낸다. 내보내기만 한다 — 동기화·업로드·원격 호출은 없다.

## 검증

`cargo test`(백엔드 1,357 + 신규 브랜치 단위 11) · `cargo fmt --check` · `cargo clippy -D warnings` · `pnpm typecheck` · `pnpm test`(2,321) · `pnpm lint` · `pnpm build` 전부 exit 0. `bindings.ts` 재생성·커밋(+111줄).

## 남은 것 — 정직하게

**실행 확인이 0이다.** 설치본이 도는 중에는 dev 빌드를 띄우지 않는 규율을 지켰다. 툴바 브랜치 선택기 폭 · `.stat` 4칸 · 접이식 카드 · 빈 상태 · **네이티브 저장 대화상자**가 전부 미확인이다.

**중첩 저장소에서 직접 링크가 사라진다.** git 저장소가 프로젝트 루트 *아래*에 있으면 `.oculpm/journal/**` 가 git 출력에 안 나와 `Entry` 근거가 통째로 없어지고 `Files` 겹침만 남는다. 오작동은 아니지만 **조용히 약해진다** — 코드에 명시 주석이 없다.

**`Files` 겹침은 과잉 귀속한다.** 같은 창에 두 브랜치가 같은 파일을 건드리면 양쪽에 잡힌다. 행마다 근거를 밝히지만 배제할 손잡이는 없다.

**기준 없는 브랜치.** `main` 자신처럼 기준 후보가 없으면 최근 300 커밋을 본다 — 기록률이 아주 긴 구간을 덮게 된다. `truncated` 배너로 정직하게 말하지만 성능은 미측정이다.