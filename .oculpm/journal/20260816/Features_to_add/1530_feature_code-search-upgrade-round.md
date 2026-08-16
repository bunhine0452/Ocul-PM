---
schema_version: 1
type: feature
slug: "code-search-upgrade-round"
status: done
difficulty: medium
created_at: "2026-08-16T15:30:03+09:00"
session_id: "mcp-20260816-153003"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/search/SearchScreenV2.tsx"
    op: update
  - path: "src/features/search/CodeSnippet.tsx"
    op: update
  - path: "src/features/search/searchUtils.ts"
    op: create
  - path: "src/features/shell/ShellV2.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/styles/screens.css"
    op: update
  - path: "src/__tests__/search_utils.test.ts"
    op: create
  - path: "src/__tests__/tools_v2.test.tsx"
    op: update
related: []
tags:
  - "search"
  - "ux"
  - "highlight"
  - "race-condition"
  - "mcp-tool"
---
[x] 코드 검색 업그레이드 — 파일 그룹핑·매치 하이라이트·에디터 라인 점프 + 레이스 픽스

## 추가 기능

사용자 요청: 코드 검색 기능 업그레이드. 3 스코프(의미/심볼/정확)는 있었지만 결과가 "통짜 청크 나열"이라 매치 위치가 안 보였고, 결과에서 다음 행동(에디터로 이동)이 없었다.

- **정확 검색 재설계**: 파일별 그룹 카드(경로·N개 일치·열기 버튼) 아래에 히트별 블록. 각 히트는 첫 매치 라인 중심 ±5줄로 트리밍(`trimAroundMatch`, "전체 보기 (N줄)" 토글)되고, 스니펫 안 매치가 `<mark>` 로 표시된다. 하이라이트는 문자열 치환이 아니라 hljs 출력 HTML 의 **텍스트 노드만** DOMParser 로 순회해 감싸(`markMatchesInHtml`) 토큰 마크업/속성을 깨지 않는다.
- **에디터 라인 점프**: 모든 결과(의미/정확/심볼)에 열기 버튼 — `open_in_editor` 의 기존 `line` 인자를 처음으로 활용. `ShellV2` 가 `projectRoot` 를 새로 전달.
- **심볼 검색**: kind 필터 칩(function/class/… 결과에서 유도) + 이름 안 매치 하이라이트(`splitMatch`, JSX 세그먼트) + 펼침 에러가 원문 그대로 나오던 것을 `tError` 경유로.
- **최근 검색어**: `WorkspaceContext.searchRecent` 가 **선언만 있던 죽은 필드**였다 — 실제 배선. 성공(결과 ≥1) 검색만 최대 8개 저장, 입력이 비면 칩 표시, 클릭 = 즉시 재검색, 지우기 버튼.
- **결과 더 보기**: limit 20 고정 → 결과가 꽉 차면 +30 씩 상향 재검색.

## 동작 흐름

검색 실행 시 `seq` 를 찍고 응답 도착 때 최신 여부를 검사 → 결과 스냅샷에 `query` 를 함께 고정해, 이후 입력창을 수정해도 하이라이트/트리밍이 흔들리지 않는다. 정확 모드는 파일별 그룹핑(백엔드가 path 순 정렬), 의미 모드는 유사도순 flat + 점수 바 + 정렬/원본 토글(의미 전용으로 이동).

## 함께 잡은 버그

1. **검색 레이스**: 임베딩(의미) 검색이 느릴 때, 먼저 시작한 검색의 응답이 나중에 도착해 최신 결과를 덮어썼다 (스코프 전환 직후 특히). seq 가드로 마지막 요청만 반영.
2. **정확 검색의 라인 라벨 불일치**: 기본 formatted(prettier) 가 켜져 있어 표시 코드가 재배치되는데 헤더는 인덱스 라인 범위(L42–58)를 보여줬다. 정확 모드는 항상 원본으로 렌더하고 정렬/원본 토글을 의미 모드 전용으로 옮겨 해소.
3. 심볼 펼침 실패 에러가 번역 없이 원문 노출 → `tError`.

## 검증

- `pnpm typecheck` exit 0 / `pnpm test` 952개 전부 통과 (신규 `search_utils.test.ts` 12건: 트리밍 창 이동·케이스 무시·no-match 폴백, mark 다중 매치·태그/속성 비오염·빈 쿼리, splitMatch 세그먼트) / `pnpm lint` / `pnpm build` exit 0 직접 확인.
- 기존 `tools_v2.test.tsx` 심볼 어서션은 이름이 `<mark>` 로 쪼개지는 새 렌더에 맞춰 textContent 검증으로 갱신.