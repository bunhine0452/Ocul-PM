---
schema_version: 1
type: refactor
slug: "diff-file-list-grouping"
status: done
difficulty: medium
created_at: "2026-08-20T23:18:00+09:00"
session_id: "manual-20260820-231800"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/diff/DiffFileList.tsx"
    op: create
  - path: "src/features/diff/changeGroups.ts"
    op: create
  - path: "src/lib/filePath.ts"
    op: create
  - path: "src/features/diff/DiffScreenV2.tsx"
    op: update
  - path: "src/features/oculpm/EntryDetailView.tsx"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/diff_v2.test.tsx"
    op: update
related:
  - "journal/20260820/Refactors/2240_refactor_entry-detail-file-nav.md"
tags: ["ui", "diff", "file-list", "grouping", "claude-code"]
---

[x] 변경 diff — 일지가 쌓일수록 무너지던 변경 파일 목록

## 동기

일지가 넷만 돼도 왼쪽 pane 이 난잡해졌다. 원인은 네 가지가 겹친 것이었다.

1. **그룹이 전부 펼쳐진 채 세로로 이어 붙었다.** 접는 수단이 없어 파일 20여 개가 한 줄씩 쌓이면 목록이 화면 두 배 길이가 됐고, 아래쪽 일지를 보려면 위쪽 파일을 전부 스크롤로 지나야 했다.
2. **경로가 뒤에서 잘렸다.** `.dfile-name` 이 전체 경로를 한 덩어리로 흘려 `text-overflow: ellipsis` 가 **끝**을 먹었다 — `src/contexts/WorkspaceCont…`. 정작 알아야 할 파일명이 사라지고, 아는 정보(디렉터리)만 남았다.
3. **제목에 원문 마크다운이 묻어났다.** 일지·플랜 제목은 파일에 적힌 그대로라 `# ◎ ACP 에이전트 패널`, `대화 여러 개를 **` 처럼 문법 기호를 달고 왔다. 한 줄로 줄면 닫는 `**` 가 잘려 나가 더 지저분했다. 플랜 칩은 줄바꿈해 두세 줄을 먹었고, `.tag::before` 의 해시태그 `#` 가 ◎ 아이콘 앞에 하나 더 붙었다.
4. **찾는 수단이 없었다.** 파일이 스물이면 스크롤 말고는 방법이 없었다. 바로 옆 화면(작업 일지 디테일)은 오늘 낮에 필터·경로 접기를 붙였는데(→ 2240) 이쪽은 그대로였다.

## 변경 요약

pane 을 **머리글 · 스크롤 본문 · 키 힌트** 세 층으로 갈랐다. 예전엔 pane 전체가 하나로 스크롤해 제목과 힌트가 같이 밀려 올라갔다.

- **경로를 두 조각으로.** `commonRoot`/`splitPath` 를 `EntryDetailView` 에서 `src/lib/filePath.ts` 로 올려 두 화면이 같은 규칙을 쓴다. 폭이 모자라면 **디렉터리부터** 줄고 파일명은 끝까지 남는다. 공통 루트 제거는 diff 화면에선 쓰지 않는다 — 저장소 전역을 훑는 목록이라 `src-tauri` 냐 `docs` 냐가 정보다.
- **그룹 접기.** 머리글의 화살표로 개별 토글, 머리글 오른쪽 `모두 접기/펼치기` 로 일괄. 그룹이 셋 이상이면 처음부터 하나만 펼친다(지금 보는 파일이 든 그룹, 없으면 최신 일지). 접힌 머리글은 파일 수와 검토 진행도(`3/5`, 다 끝나면 ✓)를 대신 말해 준다.
- **선택은 항상 보인다.** 일지 카드 → diff 핸드오프처럼 선택이 접힌 그룹으로 넘어가면 그 그룹을 자동으로 편다. 사용자가 활성 그룹을 직접 접는 건 존중한다 — 이 효과는 선택이 바뀔 때만 돈다.
- **파일 필터**(8개부터 노출, `f` 로 포커스). 필터가 걸리면 접힘을 무시하고 일치가 0 인 그룹은 목록에서 빠진다 — 접힌 그룹 안의 일치가 사라지면 필터가 거짓말을 하는 셈이라.
- **머리글 정리.** `cleanTitle` 이 `#`·목록표·체크박스·`**` 를 걷어낸다(짝 없는 `**` 포함). 일지 유형 아이콘(버그/기능/리팩터…)을 색으로 붙였고, 날짜는 **바로 위 그룹과 같은 날이면 지운다** — 대부분이 오늘 것이라 `8. 20.` 이 그룹마다 붙어 좁은 제목 폭만 갉아먹었다. 머리글은 sticky 라 스크롤 중에도 어느 일지 안인지 보인다.
- **플랜 칩**은 한 줄 ellipsis + 최대 2개(나머지는 `+N`), `.tag::before` 의 `#` 제거, 인셋 pill 로 형태를 줬다.
- 폭 260 → 284px. 영향 받는 파일 절은 인라인 style 더미를 `.dfl-impact*` 클래스로 옮기고 접을 수 있게 했다.

## 구조

`DiffScreenV2` 는 925 → 736 줄. 왼쪽 pane 을 `DiffFileList.tsx` 로, 접힘·필터 규칙을 순수 모듈 `changeGroups.ts`(`buildGroupViews`/`visiblePathsOf`/`cleanTitle`/`collapsePlanRefs`)로 뺐다.

**파일 이동 키(j/k/f)의 소유권도 함께 옮겼다.** 이동 순서는 화면에 보이는 순서와 같은 소스여야 하는데, 접힘·필터를 아는 건 목록 쪽이다. diff 본문 검색(`/`·n·N)은 `DiffScreenV2` 가 계속 가진다 — 두 핸들러가 겹치는 키가 없다.

## 검증

- `pnpm test` 1075 통과(신규 12). 순수 모델 6개는 접힘이 j/k 순서에서 빠지는지·필터가 접힘을 이기는지·진행도가 필터와 무관한지·날짜 중복 제거·마크다운 정리를 단언하고, 렌더 6개는 자동 접힘·화살표 토글·필터 왕복·경로 두 조각·안내 문구·axe 를 본다.
- typecheck·lint·build 각각 exit 0.
- 실제 CSS(tokens/base/primitives/screens)에 대표 마크업을 얹은 정적 프리뷰를 브라우저에서 밝게/어둡게 확인했다 — `.tag::before` 의 `#` 는 이 눈검사에서만 잡혔다(jsdom 은 의사 요소를 그리지 않는다).

## 메모

`.diff-files-head` 는 작업 일지 디테일과 공유하는 표면이라 손대지 않았다 — 이 화면의 추가분은 전부 `.dfl-*` 로 가뒀다. `.dfile-dir`/`.dfile-base` 도 `.diff-files` 스코프로만 새로 정의해 `.entry-filelist` 쪽 규칙과 부딪히지 않는다.
