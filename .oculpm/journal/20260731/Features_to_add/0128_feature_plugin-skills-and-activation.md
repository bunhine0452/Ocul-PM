---
schema_version: 1
type: feature
slug: "plugin-skills-and-activation"
status: done
difficulty: medium
created_at: "2026-07-31T01:28:50+09:00"
session_id: "mcp-20260731-012850"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "plugin/oculpm/skills/oculpm-journal/SKILL.md"
    op: create
  - path: "plugin/oculpm/skills/self-audit/SKILL.md"
    op: create
  - path: "plugin/oculpm/skills/run-evals/SKILL.md"
    op: create
  - path: "plugin/oculpm/skills/tdd-workflow/SKILL.md"
    op: create
  - path: "plugin/oculpm/commands/standup.md"
    op: create
  - path: "plugin/oculpm/hooks/hooks.json"
    op: update
  - path: "src-tauri/src/oculpm/readme.rs"
    op: create
  - path: "src-tauri/src/oculpm/manager.rs"
    op: update
  - path: "src-tauri/src/oculpm/mcp/tools.rs"
    op: update
  - path: "src-tauri/tests/plugin_manifest.rs"
    op: update
  - path: "src/__tests__/plugin_skills_sync.test.ts"
    op: create
related: []
tags:
  - "plugin"
  - "skills"
  - "activation-funnel"
  - "plugin-round"
  - "mcp-tool"
---
[x] 플러그인 스킬 동봉 + 퍼널 활성화 배선 — README 자동 생성·SessionEnd 안내·standup (A2)

## 추가 기능

plugin-round A2. 플러그인이 "설정 번들"에서 "방법론 캐리어 + 전환 퍼널"이 됨:

1. **스킬 4종 동봉** — `oculpm-journal`(풀 기록 규격 캐리어, en 트리거 — TK1 슬림 템플릿의 폴백 짝) + 갤러리 3종(self-audit/run-evals/tdd-workflow) 이관. 갤러리는 유지하되 **플러그인 파일이 SSOT** — vitest `plugin_skills_sync` 가 바이트 동일성을 강제(이중 소스 드리프트 시 게이트가 깨짐).
2. **`/oculpm:standup` 커맨드** — plan_status+오늘 일지로 스탠드업 조립, 말미에 앱 포인터(데모 순간).
3. **`.oculpm/README.md` 자동 생성** (`readme.rs`) — 저장소 방문자·팀원에게 디렉터리 정체+앱 링크를 설명(repo 자체를 발견 채널화). 앱 init_project 와 MCP journal_write 양쪽에서 lazy 생성, **있으면 절대 불변**(사용자 소유), 실패 무해.
4. **SessionEnd stderr 안내 1줄** — 플러그인 훅에만(세션당 1회). Stop 은 매 턴 발화라 안내 금지 — 이 구분을 매니페스트 테스트로 잠금. 앱 설치 훅은 불변(드리프트 마이그레이션 회피).

## 동작 흐름

플러그인 설치 → 추적 프로젝트에서 작업 → 훅이 세션 기록 + MCP 로 일지 → README 가 저장소에 커밋되어 팀원이 발견 → SessionEnd 안내·standup 이 앱으로 유도.

## 검증

- `--plugin-dir plugin details` 실측: Skills 5(커맨드 포함) 노출, **Always-on ~407 tok** (oculpm-journal description 압축 전 462→407. 추적 프로젝트에서 TK1 이 절감할 ~2,450 tok/세션 대비 순이익). 예산은 매니페스트 테스트(1,400 chars 상한)로 잠금.
- 신규 테스트: Rust 매니페스트(스킬 4종 고정·description 예산·SessionEnd 안내·Stop 무안내) + readme 2(생성/불변) + vitest 동기 3.
- cargo 전체 FAILED 0 · vitest 335/39파일 · typecheck/lint/build 그린.

## 메모

`.oculpm/README.md` 는 스펙 외 추가 파일(additive) — watcher 라우팅은 journal/planner 경로 기반이라 무영향, 실기기 확인은 A0d 에 동승. 갤러리 동봉으로 비추적 프로젝트에도 스킬 4종 description(~400 tok)이 상주하는 비용은 수용(방법론 캐리어 역할) — 향후 과하면 `defaultEnabled:false` 옵션 검토.