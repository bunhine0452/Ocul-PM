---
schema_version: 1
type: chore
slug: "trim-session-skill-context"
status: done
difficulty: verylow
created_at: "2026-09-21T23:47:54+09:00"
session_id: "20260921-001"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "846285f5-1d44-44f8-99a6-0e94eb21fa59"
language: "ko"
verified_by_user: false
files_touched:
  - path: ".claude/settings.local.json"
    op: update
  - path: ".claude/skills/project-inception/SKILL.md"
    op: delete
  - path: ".claude/skills/run-evals/SKILL.md"
    op: delete
  - path: ".claude/skills/self-audit/SKILL.md"
    op: delete
  - path: ".claude/skills/tdd-workflow/SKILL.md"
    op: delete
related: []
tags:
  - "skills"
  - "plugins"
  - "context-budget"
  - "claude-code"
  - "mcp-tool"
---
[x] 세션 스킬 컨텍스트 정리 — vercel 플러그인 프로젝트 한정 비활성 + 플러그인과 중복된 로컬 스킬 4개 삭제

## 동기

`/skill-doctor`(이제 Stats 탭) 표를 실제 파일과 대조했다. 매 턴 시스템 프롬프트에 실리는 스킬 한 줄 목록 기준으로 낭비 두 덩어리가 확인됐다.

- **vercel 플러그인** (사용자 스코프, 33 스킬 + 4 커맨드) — 목록만 **약 3,300 토큰/턴**, 거기에 `mcp__plugin_vercel_vercel__*` 지연 도구 이름 250여 개가 매 세션 또 실린다. 이 저장소에서 vercel 이 필요한 건 `cd landing && vercel --prod` 한 줄 — CLI 이지 플러그인이 아니다. 100일 쓰임(deploy 4×, status 1×)도 전부 landing 배포.
- **프로젝트 로컬 스킬 4개** (`project-inception`·`run-evals`·`self-audit`·`tdd-workflow`) — `plugin/oculpm/skills/*` 와 `diff -q` 로 **바이트 동일**. 8/31 에 플러그인 설치 전에 복사해 둔 잔재라 `tdd-workflow` / `oculpm:tdd-workflow` 처럼 같은 스킬이 두 번 실리고 있었다 (~200 토큰).

## 변경 요약

- `.claude/settings.local.json` 에 `"enabledPlugins": {"vercel@claude-plugins-official": false}` 추가 — 사용자 스코프 설치는 그대로 두고(다른 프로젝트는 계속 씀) 이 프로젝트에서만 끈다. `.claude/` 는 gitignore 라 남한테 영향 없음.
- 로컬 중복 스킬 4 디렉터리 삭제 (삭제 직전 플러그인 소스와 동일성 재검사 후 `rm`). 플러그인 쪽 `oculpm:*` 가 그대로 제공.

## 두기로 한 것

- `diagnosing-bugs`·`grilling`·`writing-for-agents` — 9/7 에 의도적으로 이식한 것(`20260907/Chores/1751_chore_import-external-skills-and-git-guard.md`). 모델 트리거형이라 0× 여도 합쳐 ~140 토큰. 한 달 더 0× 면 그때 뺀다.
- claude.ai 동기 스킬 13종(~3,000 토큰, 전부 0×) — 로컬 삭제는 다음 sync 에 되살아나므로 claude.ai 설정에서 사용자가 직접 꺼야 한다.
- `~/.claude/plugins/cache/oculpm/oculpm/` 옛 버전 11개 — 다른 프로젝트들이 버전별로 붙잡고 있어 손대지 않음.

## 발견 (미조치)

이 저장소에 붙은 oculpm 플러그인이 **2.46.0** — 저장소 소스 3.3.0, 다른 프로젝트 3.2.1 보다 10버전 뒤. 의도가 아니면 `/plugins` 업데이트.

## 검증

`settings.local.json` 은 `python3 -c json.load` 로 유효 JSON 확인. `.claude/skills/` 잔존 3개(diagnosing-bugs·grilling·writing-for-agents)만 남은 것 `ls` 로 확인. 플러그인 비활성은 세션 재시작 후 목록에 `vercel:*` 가 빠지는지로 확인해야 한다.