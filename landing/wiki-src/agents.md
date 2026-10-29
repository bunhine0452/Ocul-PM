---
title: 다른 에이전트 연동
desc: Codex·Cursor·Gemini CLI·Copilot·Windsurf·Cline·Zed·aider·Antigravity — AGENTS.md 하나로 도는 구조, 규칙 파일 목록, 지원 등급.
order: 10
updated: 2026-10-29
---

Ocul 은 Claude Code 전용이 아닙니다. **`AGENTS.md` 를 읽는 에이전트라면 무엇이든** 일지를 남길 수 있고, 그 파일을 안 읽는 에이전트를 위해서는 각자의 규칙 파일에 얇은 위임 stub 을 깔아 둡니다.

## 왜 AGENTS.md 가 중심인가

프로젝트를 추가하면 루트에 `AGENTS.md` 가 생깁니다. 여기에 기록 규칙 **본문 전체**가 들어갑니다 — 언제 기록하는지, 파일을 어디에 어떤 이름으로 두는지, 머리말에 무엇이 필요한지.

Claude Code·Codex CLI·Gemini CLI 를 비롯한 다수의 에이전트가 이 파일을 **네이티브로** 읽습니다. 그래서 별도 설치 없이도 규칙이 전달됩니다.

:::note
초기에는 규칙 원본을 `.oculpm/agents/_template.md` 에만 두었는데, 외부 LLM 들이 그 파일을 자발적으로 읽지 않는다는 것이 도그푸딩에서 드러났습니다. 그래서 루트 `AGENTS.md` 를 1차 표면으로 삼고, 나머지 어댑터는 `@AGENTS.md` 를 가리키는 stub 으로 줄였습니다.
:::

## 지원하는 규칙 파일

`AGENTS.md` 는 기록을 켜면 항상 깔립니다. 나머지는 프로젝트의 `.oculpm/config.toml` 의 `[agents] active` 목록(예: `["agents-md", "cursor"]`)으로 켭니다 — 켜면 해당 경로에 파일이 생기고, 규칙이 바뀌면 함께 갱신됩니다. 4.0 의 설정 화면에는 어댑터를 하나씩 켜는 칸이 없습니다.

| 에이전트 | 규칙 파일 |
|---|---|
| 공용 (Claude Code · Codex CLI 등) | `AGENTS.md` |
| Claude Code | `.claude/CLAUDE.md` |
| Cursor | `.cursor/rules/ocul-pm.mdc` |
| Gemini CLI | `GEMINI.md` |
| GitHub Copilot | `.github/copilot-instructions.md` |
| Windsurf | `.windsurf/rules/ocul-pm.md` |
| Cline | `.clinerules/ocul-pm.md` |
| Zed | `.rules` |
| aider | `CONVENTIONS.md` |
| Antigravity | `.agent/rules/ocul-pm.md` |

## 여러분이 쓴 내용은 지켜집니다

규칙 파일 중에는 **여러분도 같이 쓰는 파일**이 있습니다 — `AGENTS.md`, `.claude/CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `CONVENTIONS.md`, `.rules` 가 그렇습니다.

이 파일들에서 앱은 **마커로 감싼 블록만 소유**합니다:

```
<!-- oculpm:begin v1 -->
… 앱이 관리하는 규칙 …
<!-- oculpm:end -->
```

블록 **바깥**에 적은 내용은 규칙을 갱신해도 그대로 보존됩니다. 여러분의 코딩 컨벤션과 앱의 기록 규칙이 한 파일에서 공존할 수 있습니다.

:::warn
반대로 `.cursor/rules/ocul-pm.mdc` · `.windsurf/rules/ocul-pm.md` · `.clinerules/ocul-pm.md` · `.agent/rules/ocul-pm.md` 는 앱 전용 파일이라 **통째로 덮어씁니다.** 이 경로에는 개인 규칙을 적지 마세요.
:::

## 규칙 원본 고치기

규칙 문구 자체를 바꾸고 싶다면 `.oculpm/agents/_template.md` 를 고칩니다. 이게 마스터고, 저장하면 켜 둔 어댑터 전부로 자동 전파됩니다 — 한 곳만 고치면 Cursor 도 Claude Code 도 새 규칙을 받습니다.

특정 에이전트에게만 다른 문구를 주려면 `.oculpm/agents/per-agent/` 아래에 그 에이전트용 파일을 두면 됩니다. 규칙 템플릿의 언어는 `config.toml` 의 `[agents] template_language`(`ko` · `en`)가 정합니다.

## 규칙이 오래됐을 때

앱을 업데이트하면 규칙 규격(템플릿 판)이 올라갈 수 있습니다. 설정 → **이 프로젝트**의 규칙 파일 줄에 「v19 — 새 판 v20」 처럼 뜨면 **「올리기」** 를 누릅니다. 4.0 의 템플릿 v20 은 「완료 조건은 결과로 · 판정은 네가 아닌 것이 · 원재료와 전문가의 도구 · 어려운 숫자 목표는 정상 · 실패도 기록」 다섯 줄을 작업 규율로 싣습니다.

## 지원 등급

같은 「일지를 남긴다」라도 약속의 세기가 다릅니다. 등급은 코드에서 읽었습니다 — 규칙 파일 어댑터 표, MCP 등록기, 훅. (앱 안 구동이던 4등급은 2026-10-28 에 화면과 함께, Claude Desktop 의 MCP 원클릭 등록은 4.0 에서 걷었습니다.)

| 등급 | 뜻 |
|---|---|
| **1 · 규칙 호환** | 앱은 그 에이전트가 읽는 규칙 파일만 씁니다. 일지는 모델이 규칙을 지키는 만큼만 남습니다 |
| **2 · 구조화 기록** | 에이전트가 `oculpm` MCP 서버의 도구(`journal_write` · `plan_update` …)를 부를 수 있습니다. 등록은 플러그인이 하거나(Claude Code) 안내합니다(Codex) |
| **3 · 세션 관측** | 세션 시작·종료를 훅으로 받고, 일지 없이 끝난 대화를 가려냅니다 (Stop 배달 게이트 · `sessions.json`) |

| 에이전트 | 등급 | 하는 일 | 검증 |
|---|---|---|---|
| Claude Code | **3 세션 관측** | oculpm 플러그인(훅 · MCP 도구 · 커맨드) · `AGENTS.md` + `.claude/CLAUDE.md` 블록 | v3.0.0 · 2026-09-11 |
| Codex | **3 세션 관측** | Codex 플러그인(훅 · `~/.codex/config.toml` MCP 등록 안내) · `AGENTS.md`(네이티브) | v2.37.0 · 2026-09-03 |
| Gemini CLI | 1 규칙 호환 | `AGENTS.md` + `GEMINI.md` 블록 | — |
| Cursor | 1 규칙 호환 | `.cursor/rules/ocul-pm.mdc` | — |
| GitHub Copilot | 1 규칙 호환 | `.github/copilot-instructions.md` 블록 | — (v2.0.0 출시) |
| Windsurf | 1 규칙 호환 | `.windsurf/rules/ocul-pm.md` | — (v2.0.0 출시) |
| Cline | 1 규칙 호환 | `.clinerules/ocul-pm.md` | — (v2.0.0 출시) |
| aider | 1 규칙 호환 | `CONVENTIONS.md` 블록 | — (v2.0.0 출시) |
| Zed | 1 규칙 호환 | `.rules` 블록 | — (v2.0.0 출시) |
| Antigravity | 1 규칙 호환 | `.agent/rules/ocul-pm.md` | — (v1.11.0 출시) |
| pi | 1 규칙 호환 | `AGENTS.md` 만 | — (v1.11.0 출시) |

**검증** 열은 저장소의 `CHANGELOG.md` 와 작업 일지에 그 등급이 **실제로 돌았다**고 적힌 마지막 근거(앱 버전 · 날짜)입니다. `—` 는 코드는 있지만 실측 기록이 없다는 뜻이고, 괄호의 「출시」는 CHANGELOG 에 실린 버전입니다.

:::note
위 표의 검증 근거는 macOS 빌드에서 나왔습니다. Windows · Linux 는 베타입니다 — Windows 에서는 Claude Code 플러그인의 훅은 돌지만 MCP 서버가 뜨지 않아, 에이전트가 기록 규격대로 파일을 직접 씁니다.
:::

1등급이라면 **오늘 화면의 [기록 없는 변경](/wiki/journal)** 을 가끔 확인하세요. 빠뜨린 변경이 있으면 거기 뜹니다.

:::tip
Claude Code 를 쓴다면 플러그인 설치가 가장 큰 차이를 만듭니다 — [Claude Code 연동](/wiki/claude-code)의 두 줄이면 끝납니다.
:::

## 여러 에이전트를 섞어 쓸 때

문제 없습니다. 일지 머리말에 `agent.id` 와 모델명이 함께 적히므로, 나중에 누가 무엇을 했는지 구분됩니다.

## 스킬은 플러그인이 맡습니다

3.x 의 「스킬·규칙」 화면(스킬 편집 · 추천 스킬 설치 · 발동 배지 · 규칙 허브)은 4.0 에서 걷었습니다 — Claude Code 설정 관리자에 가까웠고, 스킬은 플러그인이 맡습니다. 이미 깔아 둔 `.claude/skills/` · `.claude/rules/` 파일은 Claude Code 가 그대로 읽고, 앱은 건드리지 않습니다. 플러그인이 싣는 커맨드와 도구는 [Claude Code 연동](/wiki/claude-code)에.

## 다음 걸음

- Claude Code 를 쓴다면 → [Claude Code 연동](/wiki/claude-code)
- 규칙이 잘 도는지 확인하려면 → [작업 일지](/wiki/journal)의 기록 없는 변경
