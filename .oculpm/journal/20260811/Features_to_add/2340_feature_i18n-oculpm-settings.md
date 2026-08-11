---
schema_version: 1
type: feature
slug: "i18n-oculpm-settings"
status: done
difficulty: medium
created_at: "2026-08-11T23:40:00+09:00"
session_id: "mcp-20260811-234000"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/settings/OculpmSettings.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "scripts/check-no-hardcoded-korean.mjs"
    op: update
related: []
tags:
  - "i18n"
  - "phase2"
  - "설정"
  - "mcp-tool"
---
[x] ocul-pm 설정 탭 영어화 (146건) — 설정 화면 전체 완료

## 추가 기능

`OculpmSettings.tsx` 146건 영어화. 사전 키 119개. 이로써 **설정 화면 전체**(SettingsPanel 8탭 + ocul-pm 하위 5탭)가 끝났다. allowlist 93 → 92.

기록 · 에이전트 · 자동화 · 연동 · 로그 5개 하위 탭 — Workday/Session 정책, git·watcher 설정, 어댑터 동기화, 자동 화해·일지 초안 경고문, Claude 훅·MCP·Desktop 연동, 셸 통합, 로그 안내까지.

## 이 파일에서 어려웠던 것 — 마크업이 섞인 산문

다른 화면과 달리 설명문이 길고 `<code>`(경로)·`<strong>`(강조)가 문장 중간에 박힌 여러 줄 JSX 였다. 예:

```
프로젝트 <code>.mcp.json</code> 에 로컬 stdio 서버를 등록합니다.
에이전트가 … 대신 <strong>구조화 도구</strong>로 …
```

처리 원칙을 둘로 나눴다:

- **경로·명령어를 감싼 `<code>`** — 유지한다. 그게 정보다. 문장을 prefix/suffix 키로 쪼개고 `<code>` 를 사이에 둔다 (`op.mcp.desc1` + `<code>.mcp.json</code>` + `op.mcp.desc2`).
- **강조용 `<strong>`** — 버린다. 장식이라 문장을 쪼갤 값어치가 없고, 쪼갤수록 번역이 어색해진다. 문단 전체를 키 하나로 옮겼다.

## 도중에 잡힌 것

`SUB_TABS.map((t) => …)` 에서 또 `t` 섀도잉. 이번 라운드에서 여섯 번째다 — 전부 typecheck 가 잡았다.

`KNOWN_AGENTS` 는 대부분 고유명사(Claude Code · Cursor · Windsurf)라 번역 대상이 아닌데 `agents-md` 하나만 "AGENTS.md (권장)" 로 한글이 섞여 있었다. 전부 키로 바꾸면 고유명사까지 사전에 들어가 무의미하게 부풀어서, 그 항목만 `labelKey` 를 얹고 렌더에서 `"labelKey" in agent ? t(...) : agent.label` 로 갈랐다.

`session_resume_grace_minutes` 가 optional(`?: number`)이라 보간에 그대로 넣으면 타입 에러 — `?? 0` 으로 좁혔다. 기존 템플릿 리터럴에서는 `undefined` 가 조용히 문자열로 찍히던 자리다.

## 검증

게이트 4종 전부 exit 0 직접 확인 — typecheck / vitest(54파일 649건) / lint / build.

## 남은 일

92파일. skillsGallery 112 · SkillsScreenV2 89 · RetroScreenV2 72 · TrayPopover 70 · RulesTab 63 · DiscussionScreenV2 58 · GreenfieldWizard 56 · AiPanelScreenV2 50 · skillsCatalog 50 · ProjectManager 39 등. 테스트 20여 개와 Rust 사용자 노출 에러 ~130곳도 미착수.