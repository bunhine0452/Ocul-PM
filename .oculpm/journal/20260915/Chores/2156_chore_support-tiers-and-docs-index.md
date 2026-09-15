---
schema_version: 1
type: chore
slug: "support-tiers-and-docs-index"
status: done
difficulty: low
created_at: "2026-09-15T21:56:00+09:00"
session_id: "20260915-006"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "b3815c20-72e0-4071-ae92-8bfdd74b590b"
language: "ko"
verified_by_user: false
files_touched:
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
  - path: "landing/index.html"
    op: update
  - path: "landing/en/index.html"
    op: update
  - path: "landing/wiki-src/agents.md"
    op: update
  - path: "landing/wiki-src/en/agents.md"
    op: update
  - path: "landing/wiki/agents.html"
    op: update
  - path: "landing/wiki/en/agents.html"
    op: update
  - path: "landing/sitemap.xml"
    op: update
  - path: "docs/README.md"
    op: update
related: []
tags:
  - "docs"
  - "landing"
  - "astra-feedback"
  - "parallel-session"
  - "mcp-tool"
---
[x] 지원 등급표 — 「N개 에이전트 지원」을 코드에서 읽은 4등급으로 (README·랜딩·위키) + Astra 리뷰 docs 색인

## 작업 내용

Astra 리뷰 B45(§3.3) — 「지원한다」 한 줄에 서로 다른 약속 넷이 섞여 있었다. 병렬 세션 D1 이 worktree 에서 구현, 커밋 `b2c9738`·`a1a2e24`.

- 등급 넷: **1 규칙 호환**(규칙 파일만) · **2 구조화 기록**(MCP 도구 등록) · **3 세션 관측**(훅·Stop 배달 게이트·판정) · **4 앱 통합**(ACP). 등급은 문구가 아니라 코드에서 읽었다 — `oculpm/agents/mod.rs` 어댑터 표, `mcp/register.rs`·`mcp/codex.rs` 등록기, `plugin/*/hooks/hooks.json`+`claude_hooks.rs`, `acp/adapter.rs`.
- 결과: Claude Code·Codex = 4 / Claude Desktop = 2(훅·규칙 없음) / Gemini CLI·Cursor·Copilot·Windsurf·Cline·aider·Zed·Antigravity·pi = 1.
- **검증 열은 CHANGELOG·일지에 실측이 적힌 것만** — Claude Code v3.0.0·09-11(설치본 검수), Codex v2.37.0·09-03(ACP 세션 실측). 나머지는 `—` 에 출시 버전만 괄호. 일지 agent.id 집계가 claude-code 695·codex 3 뿐이라 1등급 에이전트의 실측 기록은 없다.
- 코드가 있어도 등급을 **올리지 않은** 것: Claude Desktop 실연결(미검증, #eyes-claude-integration 에 열려 있음) · Codex 도구 승인→파일 변경 흐름 · VS Code 확장의 Copilot/Cursor MCP 노출. 내장 터미널 OSC 133 감지는 시작·종료만이라 3등급 아님을 명시. 플랫폼 = macOS Apple Silicon 뿐임을 명시.
- 적용면: README ko/en 「지원 에이전트」 절 교체, 랜딩 ko/en FAQ 본문+JSON-LD 답변(질문 제목 불변), 위키 agents ko/en 의 옛 3행 「자동 기록의 등급」 표를 4등급 표로 교체, `build.mjs` 재빌드 산출물(wiki html·sitemap) 동승.
- `docs/README.md` 살아 있는 설계 표에 `docs/Astra feedback/` 한 행 — 외부 리뷰(2026-09-15, ebbeb1b), 수용 항목은 플랜 astra-feedback-round, 보류(B06·B09·B15)·기각(B21·B43·B47) 명시.

랜딩 배포는 안 했다 — #landing-deploy(머지 뒤 `cd landing && vercel --prod`).

## 검증

- `pnpm lint` 7게이트 exit 0. 문서 스캔 vitest(`landing_pages`·`extension_docs_surfaces`·`plugin_docs_sync`·`bump_version`·`landing_themes`) 119/119. 양쪽 랜딩 JSON-LD 재파싱 OK.
- 표의 셀마다 근거 파일을 D1 보고서에서 대조함(위 목록).