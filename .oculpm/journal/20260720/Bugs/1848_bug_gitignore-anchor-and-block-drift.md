---
schema_version: 1
type: bug
slug: gitignore-anchor-and-block-drift
status: done
difficulty: medium
created_at: "2026-07-20T18:48:59+09:00"
session_id: "manual-20260720-184859"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - path: .gitignore
    op: update
  - path: plugin/oculpm/.mcp.json
    op: create
related:
  - 20260720/Chores/1607_chore_phase-a-runtime-verify.md
  - 20260720/Features_to_add/1828_feature_oculpm-plugin-skeleton.md
tags: ["gitignore", "secrets-risk", "plugin", "PR-CI2", "PR-CI8", "cross-session-review"]
---

[x] gitignore 두 건 — 앵커 없는 `.mcp.json` 이 플러그인 번들 삼킴 + 관리블록에서 hooks 유실

다른 세션 작업(PR-CI3~CI8) 검토 중 발견한 2건. 둘 다 `.gitignore` 문제지만 원인·영향이 다르다.

## 발생 원인

**(1) 앵커 없는 패턴 — 플러그인 배포 불능.** Phase A 확인 커밋(6cd6d34)에서 앱이 써 주는
루트 `.mcp.json`(머신 종속 경로)을 무시하려 `.mcp.json` 을 추가했는데, gitignore 는 슬래시
없는 패턴을 **모든 깊이**에 매칭한다. 이후 PR-CI8 이 만든 `plugin/oculpm/.mcp.json`
(플러그인이 배포하는 번들 파일)까지 무시돼 커밋되지 않았다 — `plugin.json` 의
`"mcpServers": "./.mcp.json"` 이 없는 파일을 가리키는, 클론하면 깨지는 플러그인.

**(2) 관리블록 드리프트 — 대화 내용 노출 위험.** 작업트리 `.gitignore` 의 oculpm 관리
블록에서 `.oculpm/hooks/` 줄이 사라져 있었다 (HEAD 에는 존재 — 커밋되진 않은 작업트리
드리프트). 인박스 `claude-events.jsonl` 에는 훅 payload 가 그대로 쌓이고 여기엔
`prompt`·`last_assistant_message`(대화 내용)이 포함될 수 있다. **공개 저장소에 커밋될 수
있는 상태**였다. 유력한 원인: 관리블록 쓰기는 "현재 바이너리의 블록 본문으로 덮어쓰기"라
`.oculpm/hooks/` 가 없던 **구버전 앱**(예: 설치된 v2.1.0 릴리스)으로 이 프로젝트를 한 번
열면 블록이 조용히 downgrade 된다.

## 해결 방법

1. 패턴을 루트 앵커로: `.mcp.json` → `/.mcp.json` (경고 주석 동반). 검증 — 루트는 무시
   유지, `plugin/oculpm/.mcp.json` 은 추적 가능. 해당 파일 커밋 동반.
2. 관리블록에 `.oculpm/hooks/` 복구 후 스테이징 diff 로 블록 손실 0 확인. 인박스가
   `git check-ignore` 로 무시됨을 확인.

## 검증

- `git check-ignore`: `/.mcp.json` → 루트만 매칭(플러그인 파일 비매칭), `.oculpm/hooks/
  claude-events.jsonl` → 매칭(무시).
- 스테이징 diff 가 앵커 수정 1건만 포함 — 관리블록 무손실.
- 부수 확인(플러그인 실로드): `claude --plugin-dir` 로 도구 3종
  `mcp__plugin_oculpm_oculpm__*` 노출, 훅 3건 발화, `.oculpm` 없는 프로젝트에선 무동작
  (가드 정상) — PR-CI8 형식(래퍼 없는 서버 맵)이 실측으로 맞음을 확인.

## 메모

- **후속 위험(미해결)**: 관리블록 sync 에 버전 인식이 없어 **구버전 앱이 블록을 downgrade**
  한다. gitignore 의 경우 downgrade = 민감 경로 노출이므로, 블록 병합을 union 으로 하거나
  블록에 버전 주석을 넣어 낮은 버전이 덮어쓰지 않게 하는 후속이 필요하다 (백로그 등재).
