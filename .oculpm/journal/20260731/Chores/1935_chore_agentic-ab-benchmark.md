---
schema_version: 1
type: chore
slug: agentic-ab-benchmark
status: done
created_at: 2026-07-31T19:35:00+09:00
session_id: "manual-20260731-193500"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - { path: benchmarks/agentic/README.md, op: create }
  - { path: benchmarks/agentic/run-bench.sh, op: create }
  - { path: benchmarks/agentic/score.mjs, op: create }
  - { path: benchmarks/agentic/target-template/tickets.json, op: create }
  - { path: benchmarks/agentic/results/2026-07-31-agentic.md, op: create }
  - { path: .gitignore, op: update }
related: []
tags: [benchmark, agentic, ab-test, ponytail]
difficulty: medium
---

[x] 에이전틱 A/B 벤치마크 (B2) — 하네스 구축 + 본실행 24세션 + 리포트

ponytail 방법론 이식: 합성 TS 타깃(티켓 6 — bug2·feature2·refactor1·chore1, 결정적 판정) × 2팔(A=순정 / B=AGENTS.md v8+플러그인) × n=2, 헤드리스 `claude -p --output-format json`. 오염 격리 `--setting-sources project,local`(+스모크 프로브로 실증: A 팔 TOOLS-NO). B 스캐폴드는 실제 제품 경로(oculpm-mcp project_init). 준수 채점기(§2 frontmatter 10항목·files_touched↔diff 겹침) 포함.

**실측 (results/2026-07-31-agentic.md)**:
- 품질·비용 무손상: 성공률 100%=100%, 턴 8.7 vs 7.8, cost $0.182 vs $0.177 — 규칙 주입이 과제를 해치지 않음 (차이는 노이즈로 명시).
- **헤드리스 단발 세션 기록 준수 0/12** — 도구·규칙이 주입돼도 print 모드는 기록을 생략. transcript 일지 초안(PR-CI1)의 존재 이유를 수치로 확보. 대화형 준수율과 혼용 금지를 리포트에 명시.

## 검증

24/24 세션 success, A 팔 raw oculpm 언급 0(격리), 채점기는 실제 journal_write 산출물로 거짓 실패 없음 검증. 총 비용 ≈ $4.3.
