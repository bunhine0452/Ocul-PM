---
schema_version: 1
type: bug
slug: "diff-stats-drops-dash-content-lines"
status: done
difficulty: low
created_at: "2026-08-19T07:23:18+09:00"
session_id: "manual-20260819-072318"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/diff/DiffScreenV2.tsx"
    op: update
  - path: "src/features/diff/diffParse.ts"
    op: update
  - path: "src/__tests__/diff_parse_stats.test.ts"
    op: create
related: []
tags: ["diff", "stats", "unified-diff", "claude-code"]
---

[x] 변경 diff 의 +N/−M 배지가 `---`/`+++` 로 시작하는 내용 줄을 빠뜨리던 것

## 발생 원인

버그 헌팅 라운드(에이전트 4대 병렬 리뷰)에서 발견. `DiffScreenV2` 의 통계
카운터가 `+++`/`---` **파일 헤더를 접두 문자열로** 걸렀다 —
`line.startsWith("---")` 를 패치의 모든 줄에 적용. 그런데 내용이 `---` 인 줄
(YAML front-matter 구분선, 마크다운 가로줄)을 지우면 diff 줄은 `----` 가 되고,
이 역시 `startsWith("---")` 에 걸려 카운트에서 빠졌다. 그 삭제가 유일한 변경이면
`add===0 && del===0` 단락으로 **배지 자체가 사라졌다**. `++i` 줄 추가(`+++i`)도
같은 이유로 add 에서 누락. 렌더러(`classifyDiffLines`)는 `"--- "` 처럼 뒤 공백
까지 보므로 화면은 멀쩡했고 배지만 어긋났다.

## 해결 방법

카운터를 위치 기반 순수 함수 `countPatchStats` 로 추출(`diffParse.ts`) — `+`/`−`
는 `@@` 헌크 **안에서만** 세고, `diff ` 줄에서 헌크 상태를 리셋해 다중 파일
패치도 안전하다. 신규 파일의 합성 패치(헤더 없음, 전 줄 `+`)는 종전대로 줄 수를
+N 으로 집계.

## 검증

`src/__tests__/diff_parse_stats.test.ts` 5건 신규 — front-matter 삭제(`----`)가
del 1 로 잡히는 회귀 케이스, `+++i`, 다중 파일, 바이너리 안내문, 헌크 없는 패치.
diff_v2 기존 테스트 포함 20건 통과, 5대 게이트 전부 exit 0.
