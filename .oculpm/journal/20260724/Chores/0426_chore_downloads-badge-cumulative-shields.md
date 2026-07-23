---
schema_version: 1
type: chore
slug: "downloads-badge-cumulative-shields"
status: done
difficulty: verylow
created_at: "2026-07-24T04:26:27+09:00"
session_id: "mcp-20260724-042627"
agent:
  id: "claude-code"
  version: "Opus 4.8 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
related: []
tags:
  - "readme"
  - "badge"
  - "correction"
  - "mcp-tool"
---
[x] 다운로드 배지를 누적 총합(shields /total)으로 되돌림 — badgen 은 최신 릴리스만 세었음

## 동기

직전 라운드에서 shields 토큰 풀 오류를 피하려 다운로드 배지를 badgen `assets-dl` 로 바꿨는데, `assets-dl` 은 **최신 릴리스 1건**만 카운트해서 13 으로 표시됐다. 사용자가 원한 것은 **전 릴리스 누적 총합**(GitHub API 합산 = 410).

## 변경 요약

- **README.md · README.en.md** — 다운로드 배지를 badgen `assets-dl` → shields.io `github/downloads/OWNER/REPO/total` 로 되돌림. 누적 총합을 주는 배지는 사실상 shields 뿐(badgen 엔 누적 옵션 없음).
- `cacheSeconds=3600` 추가 — shields 재조회(cache-miss) 빈도를 줄여 "Unable to select next GitHub token from pool" 토큰 풀 오류 노출 창을 축소.
- 오류는 간헐적이며(직접 3회 요청 시 1회만 실패), 실제 GitHub README 는 이미지가 Camo 캐시를 거쳐 한 번 성공한 값(410)이 한동안 고정되어 체감 영향이 작다.

## 검증

- `gh api …/releases --paginate` 합산 = **410** (누적 총합 실측).
- shields `/total` 성공 응답 시 `downloads: 410` 확인.
- 이전 일지([[changelog-readme-v2-3-1-backfill]])의 badgen 전환 결정을 이 항목이 대체한다.