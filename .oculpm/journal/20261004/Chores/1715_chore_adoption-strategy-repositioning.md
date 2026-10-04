---
schema_version: 1
type: chore
slug: "adoption-strategy-repositioning"
status: done
difficulty: medium
created_at: "2026-10-04T17:15:14+09:00"
session_id: "20261004-002"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ff953333-de21-4236-80e6-db91a04ad7fa"
language: "ko"
verified_by_user: false
files_touched: []
related:
  - ref: "20260921/Chores/1815_chore_adoption-barrier-audit.md"
    kind: "followup"
tags:
  - "product-direction"
  - "adoption"
  - "strategy"
  - "mcp-tool"
---
[x] "많이 쓰는 AI 도구로" 전략 수립 — 실측 기반 진단 + 재포지셔닝 제안

## 실측 (2026-10-04, gh api)

- 저장소 순방문자 14일 **15명**(리퍼러 github.com 7 · 외부 1). 클론 710 uniques 는 CI 체크아웃이 섞여 해석 불가.
- 릴리스 112개 누적 설치 파일 다운로드 **51**, 자동 업데이트 파일(.tar.gz)은 릴리스당 1~4 — 계속 켜 두는 설치본이 본인 포함 몇 대 수준.
- 스타 7 · 포크 2. 9월 커밋 583 · 릴리스 30.
- `docs/launch/channels.md`(07-31) 7채널 중 실행된 것은 토픽·Product Hunt 뿐. Anthropic 커뮤니티 카탈로그·awesome-claude-plugins 에 oculpm 없음 확인. GeekNews·Show HN·Reddit 기록 없음.

## 포지셔닝 충돌

현재 README 첫 문장("어제 어디까지 했는지 다시 설명하지 마세요")과 9/21 보고서의 권고("AI가 지난 작업을 기억하고 이어가게")는 **claude-mem(95.7k★, `npx claude-mem install` 한 줄, 다중 에이전트, 다음 세션 자동 주입, 호스팅 유료 플랜)** 과 같은 자리다. basic-memory(4.1k★) 태그라인도 "Never re-explain your project to your AI again". 9/21 보고서는 경쟁 비교를 하지 않았다고 스스로 밝혔다. 비교군: Taskmaster 28.1k · vibe-kanban 28.3k · opcode 22.4k · ccusage 18.9k · Backlog.md 6.9k — 공통점은 한 문장 가치 + 한 줄 설치 + 공유되는 결과물.

## 제안 (사용자 결정 대기)

"AI를 위한 기억" → **"사람을 위한 AI 작업 기록·영수증"**(일지+diff+적지 않은 변경 감사 → 주간보고·PR 설명). 거점 가설 = 한국에서 회사 업무로 Claude Code/Codex 를 쓰는 개발자. 입구는 플러그인, 첫 5분 보상은 git 이력으로 즉시 만드는 보고서. IDE 계열 화면은 신규 투자 동결(삭제 아님). 홍보 채널 목록을 새 메시지로 실행. 6주 판단 기준 포함.

`first-record-loop` 의 `{#p3-intro}`(README·랜딩 편집)는 이 포지셔닝 결정 뒤에 해야 한다 — 지금 메시지로 편집하면 claude-mem 의 자리를 더 굳힌다.

## 검증

수치는 전부 이번 세션의 `gh api`(repos·releases·traffic·경쟁 저장소) 응답에서 읽었다. 사용자 행동 관찰은 없다 — 거점 가설은 인터뷰로 확인 전까지 가설이다. 코드 변경 없음.