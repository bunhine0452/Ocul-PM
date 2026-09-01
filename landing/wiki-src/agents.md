---
title: 다른 에이전트 연동
desc: Cursor·Gemini CLI·Copilot·Windsurf·Cline·Zed·aider·Antigravity — AGENTS.md 하나로 도는 구조와 규칙 파일 목록.
order: 10
updated: 2026-08-21
---

Ocul-PM 은 Claude Code 전용이 아닙니다. **`AGENTS.md` 를 읽는 에이전트라면 무엇이든** 일지를 남길 수 있고, 그 파일을 안 읽는 에이전트를 위해서는 각자의 규칙 파일에 얇은 위임 stub 을 깔아 둡니다.

## 왜 AGENTS.md 가 중심인가

프로젝트를 추가하면 루트에 `AGENTS.md` 가 생깁니다. 여기에 기록 규칙 **본문 전체**가 들어갑니다 — 언제 기록하는지, 파일을 어디에 어떤 이름으로 두는지, 머리말에 무엇이 필요한지.

Claude Code·Codex CLI·Gemini CLI 를 비롯한 다수의 에이전트가 이 파일을 **네이티브로** 읽습니다. 그래서 별도 설치 없이도 규칙이 전달됩니다.

:::note
초기에는 규칙 원본을 `.oculpm/agents/_template.md` 에만 두었는데, 외부 LLM 들이 그 파일을 자발적으로 읽지 않는다는 것이 도그푸딩에서 드러났습니다. 그래서 루트 `AGENTS.md` 를 1차 표면으로 삼고, 나머지 어댑터는 `@AGENTS.md` 를 가리키는 stub 으로 줄였습니다.
:::

## 지원하는 규칙 파일

설정 → ocul-pm → 에이전트 탭에서 켜고 끕니다. 켜면 해당 경로에 파일이 생기고, 규칙이 바뀌면 함께 갱신됩니다.

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

특정 에이전트에게만 다른 문구를 주려면 `.oculpm/agents/per-agent/` 아래에 그 에이전트용 파일을 두면 됩니다.

## 규칙이 오래됐을 때

앱을 업데이트하면 규칙 규격이 올라갈 수 있습니다. 설정 → ocul-pm → 에이전트 탭의 **「규칙 다시 보내기」** 로 최신 규격을 다시 깔 수 있습니다. 감지 버튼을 누르면 이 프로젝트에서 쓰이는 것으로 보이는 에이전트를 추려 줍니다.

## 자동 기록의 등급

같은 "일지를 남긴다" 라도 확실성이 다릅니다:

| 방식 | 확실성 |
|---|---|
| 앱 안 Claude Code | **높음** — 기록 도구(MCP)가 세션에 직접 물려 있음 |
| 터미널 Claude Code + 플러그인 | **높음** — 세션 종료 훅이 구조적으로 걸림 |
| 그 외 에이전트 (규칙 파일만) | **보통** — 모델이 규칙을 기억해 주는 만큼 |

세 번째 등급이라면 **오늘 현황의 [정직성 감사](/wiki/journal)** 를 가끔 확인하세요. 빠뜨린 변경이 있으면 거기 뜹니다.

:::tip
Claude Code 를 쓴다면 플러그인 설치가 가장 큰 차이를 만듭니다 — [Claude Code 연동](/wiki/claude-code)의 두 줄이면 끝납니다.
:::

## 여러 에이전트를 섞어 쓸 때

문제 없습니다. 일지 머리말에 `agent.id` 와 모델명이 함께 적히므로, 나중에 누가 무엇을 했는지 구분됩니다. 회고의 **「에이전트 기여」** 카드가 그 분포를 보여 줍니다.

## 스킬·규칙 허브

사이드바의 **스킬·규칙** 화면은 위의 내용을 앱 안에서 만지는 곳입니다. 탭이 다섯입니다.

### 스킬

`SKILL.md` 파일 하나가 스킬 하나입니다. 에이전트가 상황에 맞는 스킬을 **스스로 발동**하는데, 그 기준이 되는 것이 frontmatter 의 `description` 입니다 — 그래서 설명을 잘 쓰는 게 중요합니다.

- **프로젝트 / 전역** — 이 프로젝트에만(`.claude/skills/`) 둘지, 모든 프로젝트에서 쓸지(`~/.claude/skills/`). 서로 복사할 수 있습니다
- **비활성화** — `.claude/skills/.disabled/` 로 옮겨 로드에서 뺍니다. **파일은 지워지지 않습니다**
- **편집** — 앱 안에서 바로 고치고 `⌘S` 로 저장
- **새 스킬** — 빈 스킬을 만들어 시작

### 샵 (추천 스킬)

검증 습관을 만들어 주는 스킬을 **원클릭으로 설치**합니다. `self-audit` 처럼 에이전트가 스스로를 점검하게 하는 것들입니다.

### 규칙

앞에서 다룬 어댑터별 규칙 파일을 켜고 끄고, 원본을 고치는 탭입니다.

### 훅

Claude Code 훅 연동입니다. **훅이 켜지면 세션의 시작·종료가 휴리스틱이 아니라 실측 신호로 기록됩니다** — 앱이 "파일이 조용해졌으니 끝났나 보다" 하고 추측하는 대신, 에이전트가 직접 알려 줍니다.

:::note
세션 종료 시의 **일지 자동 초안**(과금 있음)과 MCP 도구 등록은 이 탭이 아니라 설정 → ocul-pm → 에이전트 연동에서 관리합니다.
:::

### 플러그인

플러그인이 무엇을 깔아 주는지 — 커맨드·도구·스킬 목록을 확인합니다.

## 다음 걸음

- Claude Code 를 쓴다면 → [Claude Code 연동](/wiki/claude-code)
- 규칙이 잘 도는지 확인하려면 → [작업 일지](/wiki/journal)의 정직성 감사
