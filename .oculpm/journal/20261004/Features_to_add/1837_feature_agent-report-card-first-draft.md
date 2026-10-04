---
schema_version: 1
type: feature
slug: "agent-report-card-first-draft"
status: done
difficulty: medium
created_at: "2026-10-04T18:37:14+09:00"
session_id: "20261004-003"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ff953333-de21-4236-80e6-db91a04ad7fa"
language: "ko"
verified_by_user: false
files_touched:
  - path: "docs/launch/agent-report-card.py"
    op: create
  - path: "docs/launch/agent-report-card.md"
    op: create
related:
  - ref: "20261004/Chores/1812_chore_unique-asset-agent-report-card.md"
    kind: "followup"
tags:
  - "product-direction"
  - "adoption"
  - "strategy"
  - "mcp-tool"
---
[x] 이 저장소의 에이전트 성적표 초안 — 지표 기준 다듬기 → 집계 → 공유용 페이지 → GeekNews 초안

## 추가 기능

- `docs/launch/agent-report-card.py`: 일지 frontmatter·본문 + git log + Claude Code 대화 기록(`~/.claude/projects/<루트>/*.jsonl` + `subagents/`)을 읽어 JSON 으로 낸다. 루트는 `git rev-parse`, 지금 대화 제외는 `REPORT_CARD_EXCLUDE_SESSION`.
- `docs/launch/agent-report-card.md`: 지표 정의 표 · 2026-10-04 판독값 · 한계 · GeekNews Show GN 초안 · 게시 전 체크리스트.
- 공유용 페이지(claude.ai 아티팩트, 비공개): 랜딩 "무대" 토큰, 큰 숫자 넷 + 영수증 줄 + 막대.

## 지표를 다듬은 자리 (1차 집계에서 틀렸던 것)

- `verified_by_user`(8건, 1%)는 버튼이라 대표 지표에서 뺐다 → 검증 칸 안의 명령·결과 근거(664/788, 84%).
- "미확인" 판정을 검증 칸 안으로 좁혔다 — 본문 전체로 보면 원인 설명의 "확인하지 않아서" 까지 잡아 77 → 48.
- 대화↔일지 연결: `agent.session` 만 보면 일지에 대화 id 가 안 붙은 대화(bc2d2c4e 등)가 전부 누락으로 잡혔다 → `journal_write` 결과가 돌려준 저장 경로로도 잇는다. 누락 275 → 180.
- 다시 고친 버그: 공용 파일(일지 3% 이상, **45개** — 1차 출력이 12개에서 잘려 페이지에 12로 잘못 적었다가 고침)을 겹침에서 빼고 7일·14일 둘로. 원인 증명이 아니라고 페이지에 적었다.
- "빠진 파일은 대부분 테스트·CI" 라고 먼저 썼다가 세어 보니 소스 98 · 테스트 52 — 문구를 비율(테스트 44%, 소스 20%)로 바꿨다.

## 판독 중 찾은 결함 (미수정)

`journal_write` 가 `files_touched` 를 문자열 배열로 받으면 경고 없이 빈 목록으로 저장한다 — `src-tauri/src/oculpm/mcp/tools/mod.rs` 의 `filter_map` 에서 `f.get("path")?` 가 문자열 원소에 None. 09-04 이후 252회 중 4회, 경로 59개 유실, `warnings: []`. 예: `20260923/Bugs/1818_bug_bug-hunt-parallel-three-2026-09-22.md` 는 17개를 넘겼는데 `files_touched: []`.

## 검증

포터블 스크립트 재실행이 1차 스크래치 집계와 전 수치 일치(788/664/48/8 · 28/28 · 718/172/8 · 189/103/137 · 252/4/59 · 1185/1115). 페이지는 로컬 http.server + Chrome 1280px 로 한 번 봤다 — 한글 라벨의 고정폭 자간을 고쳐 재게시. 400px 창 조절이 적용되지 않아 모바일 폭은 미확인(≤640px 미디어 쿼리는 있음).