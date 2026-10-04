---
schema_version: 1
type: chore
slug: "unique-asset-agent-report-card"
status: done
difficulty: medium
created_at: "2026-10-04T18:12:01+09:00"
session_id: "20261004-002"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ff953333-de21-4236-80e6-db91a04ad7fa"
language: "ko"
verified_by_user: false
files_touched: []
related:
  - ref: "20261004/Chores/1715_chore_adoption-strategy-repositioning.md"
    kind: "followup"
tags:
  - "product-direction"
  - "adoption"
  - "strategy"
  - "mcp-tool"
---
[x] 기능 단위 차별점 대조 + 저장소 자체 데이터 집계

## 기능 대조 (gh api)

a2a 임대·우편함은 **mcp_agent_mail(2.2k★, "advisory file leases" + inboxes)** 이 같은 것을 한다. 파일 기반 계획은 planning-with-files(27.3k★)·Taskmaster(28.1k★). 기억은 claude-mem(95.7k★). 우리 임대도 자발 호출이다(플러그인 훅에 PreToolUse 없음, `a2a/leases.rs` 는 claim 시 겹침 거절만). 결론: 기능 하나로는 독점이 없다.

남는 것: ① 한 기록 안에 일지(말)·entry_diffs(실제 변경)·unrecorded 감사·임대가 같이 있어 **서로 대조할 수 있는 위치** ② 소급 불가능한 이 저장소의 실제 데이터.

## 저장소 데이터 (`.oculpm/journal` frontmatter + git log 집계)

- 일지 789건, files_touched 6,398 — agent.id 784 claude-code · 5 codex.
- status done 787 중 `verified_by_user: true` **8건(1%)**. 단 이 값은 "확인 버튼을 눌렀나"이지 "사람이 확인했나"가 아니다.
- 2026-05-19 이후 커밋에 나온 파일 2,261 중 **638(28%)** 은 어떤 일지 files_touched 에도 없다 — 일지 도입(05-31) 전 기간·문서 포함이라 상한.
- bug/error 189 중 164 가 직전 14일 안에 feature/refactor 일지가 바꾼 파일을 다시 건드렸다 — i18n 같은 공용 파일이 부풀린 거친 근사.

## 제안

ccusage 선례(로컬 transcript 를 읽어 숫자 하나 → 스크린샷 공유)를 따라 **"에이전트 성적표"**: git + Claude Code transcript + (있으면) 일지로 완료 주장·검증 흔적·기록 안 된 변경·반복 수정 구역을 한 장으로. 설치 0 · 일지 0건에서도 첫 실행에 결과. 도구 전에 이 저장소 성적표 한 장을 글로 먼저 올려 반응을 본다.

## 검증

수치는 이번 세션의 python 집계(frontmatter 정규식)와 `git log --name-only` 에서 나왔다. 정의가 거친 지표 둘(28%·164건)은 발표 전에 기준을 다시 잡아야 한다. 코드 변경 없음.