---
schema_version: 1
type: refactor
slug: "entry-detail-file-nav"
status: done
difficulty: medium
created_at: "2026-08-20T22:40:00+09:00"
session_id: "manual-20260820-224014"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/oculpm/EntryDetailView.tsx"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/journal_v2.test.tsx"
    op: update
related: []
tags: ["ui", "journal", "entry-detail", "diff", "claude-code"]
---

[x] 작업 일지 디테일 — 파일이 많아질수록 무너지던 변경 파일 내비게이션

## 동기

파일 20여 개짜리 일지를 열면 오른쪽 pane 상단이 줄바꿈되는 **칩 벽**이 됐다. 파일 버튼이 네 줄까지 쌓여 diff 를 아래로 밀어냈고, 그 내용은 왼쪽 목록과 **완전히 같은 파일 집합**이었다 — 같은 것을 두 번, 그것도 한쪽은 난잡하게 보여주고 있었다.

왼쪽 목록도 길이에 대한 대비가 없었다. 파일명(basename)만 보여줘서 `route.ts` 가 다섯 줄 늘어서면 어느 것이 어느 것인지 알 수 없었고(`disambiguateLabels` 가 충돌할 때만 두 조각을 살렸다), `기록없음` 이 서식 없는 맨텍스트로 줄 끝에 붙어 노이즈였다. 결정적으로 왼쪽 pane 전체가 하나로 스크롤해서, 서술을 읽으려고 내리는 순간 파일 목록이 화면 밖으로 사라졌다 — 다음 파일을 열려면 매번 위로 되돌아가야 했다.

## 변경 요약

**역할을 갈랐다.** 왼쪽 목록이 유일한 파일 내비게이션, 오른쪽은 "지금 열린 파일" 한 줄.

- **칩 벽 제거** (`.entry-detail-tabs` · `.entry-detail-fname` 삭제). 대신 `.entry-file-bar` 한 줄 — `‹ ›` 앞뒤 이동 · 전체 경로(디렉터리 흐림 + 파일명 강조) · `15 / 22` 위치 배지. 세로 ~120px 를 diff 에 돌려줬다.
- **경로 접기** — `commonRoot()` 로 모든 행이 공유하는 앞 디렉터리를 걷어내고, `splitPath()` 가 뒤에서 2개 세그먼트만 `…/` 로 접어 보여준다 (`…/credits/me/route.ts`). 파일명은 `flex: none` 이라 좁아져도 절대 잘리지 않고 디렉터리부터 줄어든다. `disambiguateLabels` 는 이 규칙이 대체해 삭제.
- **목록 = 두 출처의 합집합** — `files_touched` ∪ 기록된 diff 경로(프론트매터가 빠뜨린 패치도 열 수 있게), 경로순 정렬. 패치 없는 행은 선택 불가 + `기록없음`/`삭제됨` 을 알약 배지로.
- **길이 대비** — 8개부터 필터 입력(`/` 로 포커스), 12개부터 자체 스크롤 + 위아래 실선(macOS 오버레이 스크롤바는 손대기 전엔 안 보인다).
- **왼쪽 pane 2영역화** — 메타+파일 목록은 제자리, 서술만 스크롤. 목록은 pane 의 52%를 넘지 않고 남는 높이는 서술에 넘긴다.
- **키보드** — `j`/`k` 로 기록된 파일 사이 이동, 활성 행 `scrollIntoView`. 변경 diff 화면과 같은 키다.

## 검증

- `pnpm test` 1046 통과(신규 5: 칩 벽 부재+파일 바 위치/앞뒤 이동, j/k, 필터 좁힘+빈 상태, 짧은 목록엔 필터 없음, 패치 없는 행 배지+비활성). typecheck·lint·build 각각 exit 0.
- 실제 CSS 를 링크한 정적 프리뷰(24파일)를 브라우저로 띄워 라이트/다크 양쪽 육안 확인 — 이 과정에서 아래 두 회귀를 잡았다.

## 메모

**클래스명 충돌로 한 번 무너졌다.** 처음에 목록을 `.entry-filelist` 가 아니라 `.entry-files` 로 지었는데, 그 이름은 이미 수동 일지 모달의 후보 칩 행(`flex-wrap: wrap; max-height: 108px`)이 쓰고 있었다. 세로 flex 에 `wrap` 이 얹히자 행들이 **오른쪽으로 열을 만들며** 화면 밖(x=3243)으로 나갔고, 보이는 건 3줄뿐이었다. 스크린샷만 봐서는 "왜 3줄이지" 로 끝났을 것이다 — `getBoundingClientRect` 로 마지막 행 좌표를 찍고서야 방향이 드러났다.

`.scroll` 도 같은 부류였다. `shell.css` 의 제네릭 `.scroll { flex: 1 }` 과 겹쳐서 수식자를 `.capped` 로 바꿨다. CLAUDE.md 가 경고하는 그 함정(`.card`/`.chip`/`.stat`/`.scroll`)에 그대로 빠진 셈이라, 새 선택자는 전부 `.entry-filelist*` / `.efb-*` 로 가뒀다. `.dfile*` 기본형은 변경 diff 화면과 공유하는 표면이므로 건드리지 않고 `.entry-filelist` 하위에서만 덮어썼다.
