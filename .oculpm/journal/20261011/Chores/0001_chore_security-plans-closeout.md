---
schema_version: 1
type: chore
slug: "security-plans-closeout"
status: done
difficulty: medium
created_at: "2026-10-11T00:01:03+09:00"
session_id: "mcp-20261011-000103"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "8ea7b9ae-c829-4853-a394-c185809e360d"
language: "ko"
verified_by_user: false
files_touched:
  - path: ".oculpm/planner/security-feedback-round.md"
    op: update
  - path: ".oculpm/planner/security-feedback-round-2.md"
    op: update
  - path: ".oculpm/planner/security-feedback-round-3.md"
    op: update
  - path: ".oculpm/planner/perf-security-audit-2026-10-08.md"
    op: update
  - path: ".oculpm/planner/review-2026-10-09.md"
    op: update
  - path: ".oculpm/planner/improvement-round-2026-09-14.md"
    op: update
  - path: ".oculpm/planner/external-review-2026-10-08.md"
    op: update
related:
  - ref: "20261008/Chores/1830_chore_perf-security-audit.md"
    kind: "followup"
  - ref: "20261008/Features_to_add/1906_feature_pause-animations-when-inactive.md"
    kind: "followup"
tags:
  - "security"
  - "performance"
  - "audit"
  - "mcp-tool"
---
[x] 남은 보안 플랜 5개 마무리 — 실측 2건 · 이월 3건 · 잠금

## 작업 요약
남은 보안 플랜(security-feedback-round 1~3차 · perf-security-audit-2026-10-08 · review-2026-10-09)의 미완 항목을 판정했다.
- 코드로 닫을 수 있는 5건은 병렬 worktree 레인 5개(Opus 5.5 둘 · Sonnet 5.5 셋)로 구현했다. 합류하며 git 부분 클론의 지연 fetch 문 등을 더 고쳤다. PR #83 로 머지하고 랜딩을 배포했다. 각 일지는 따로 있다.
- 나머지는 아래처럼 처리했다.

**실측으로 닫은 것**
- #idle-cpu-animations — 설치본 3.12.0(가동 1시간)이 비활성일 때 `top` 12표본(60초) 평균을 쟀다. WebContent 0.90% · UI 1.12% · GPU 0.29%, 합 2.3% 다. 감사 때(3.9.0)는 8.5 · 3.7 · 3.2, 합 15.4% 였다. 단서가 있다. 잴 때 화면이 잠겨 있었다(lsappinfo front = loginwindow). 창이 가려지면 WebKit 이 스스로 줄이는 몫이 섞였을 수 있다. 「보이지만 포커스 없는」 상태만 따로 잰 값은 아니다.
- #footprint-attribution 의 사전 실측 — `vmmap --summary` 로 UI footprint 를 쟀다. 604MB(peak 949MB) · Malloc Small 511M · Large 328M · 할당 835MB/144만 개다. 감사 때 933MB 보다 작지만 가동 시간이 다르다. 심볼이 없어 귀속은 여전히 못 한다.

**판정으로 닫은 것**
- external-review #next-review — 2026-10-09 보완점 리포트(v3.10.1 기준, 외부)가 「v3.9.0 이후」 범위의 다음 외부 리뷰였다. 이미 SECURITY.md 리뷰 이력에 v3.11.0 으로 올라 있다.
- improvement-round #csp(`csp: null` 이월) — v3.8.0 에서 CSP 를 켰고 e2e 위반 0 게이트가 지킨다. 이 항목은 낡았다.

**살아 있는 원장으로 옮긴 것** — 이월 규칙(carried-debt)을 따랐다.
- 실기기 3건과 Notion 실제 왕복 → improvement-round-2026-09-14 {#eyes-security}
- 메모리 귀속(설치본이 꺼진 때 심볼 빌드 + MallocStackLogging) → improvement-round-2026-09-14 {#footprint-attribution}
- release 환경 보호 → external-review-2026-10-08 {#release-env}. `gh api` 로 확인했다. 환경 `release` 는 있지만 보호 규칙 0 · 환경 비밀 0 이다. 서명 비밀 7개(APPLE_* 6 · TAURI_PRIVATE_KEY)는 release.yml 의 macos · bundle 잡만 쓴다. 값이 필요해서 옮기는 것은 사용자 몫이다. 비밀을 옮기지 않고 승인자만 두면 막는 것이 없다 — 태그 커밋의 워크플로가 environment 줄을 빼면 그만이다. 그래서 반쪽 설정은 하지 않았다.

**잠금**
- 다섯 플랜을 status: done 으로 잠갔다.

**용량 정리** — 사용자 요청
- 레인 하나가 공유 캐시를 안 타고 9GB target 을 따로 만들어 지웠다.
- 끝난 worktree 를 바로바로 지웠다.
- cargo 가 쉬는 틈에만 incremental 과 오래된 우리 산출물을 지우는 청소부를 4시간 돌렸다.
- 디스크 여유가 57GB(최저 33GB)에서 86GB 가 됐고, 공유 target 은 16GB 에서 5.2GB 가 됐다.

## 검증
- top · vmmap 수치는 이 세션에서 직접 잰 값이다. 원장 이동은 각 플랜 파일의 {#id} 항목으로 확인했다.
- release 환경 상태는 gh api 응답(protection_rules: [], 환경 비밀 0)으로 확인했다.