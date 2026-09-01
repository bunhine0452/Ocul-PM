---
title: Claude Code 연동
desc: 앱 안 Claude Code 와 터미널 Claude Code 의 차이, 플러그인(훅 브리지) 설치, /plugin·/mcp 가 앱 안에서 안 되는 이유.
order: 9
updated: 2026-08-16
---

Ocul-PM 에서 Claude Code 를 쓰는 길은 **둘**입니다. 이 구분을 알면 나머지가 전부 풀립니다.

| | 앱 안 Claude Code (사이드바) | 터미널 Claude Code |
|---|---|---|
| 구동 방식 | ACP (Agent Client Protocol) | CLI 그대로 |
| 일지 기록 | **자동** — 내장 MCP 도구가 세션에 물려 있음 | AGENTS.md 규칙 (플러그인 설치 시 자동) |
| `/plugin` `/mcp` `/login` | **안 됨** (아래 설명) | 됨 |
| 로그인 | 터미널에서 한 번 로그인한 자격을 그대로 씀 | `claude` 실행 후 로그인 |

## 앱 안 Claude Code — 설치 없이 기록됩니다

사이드바의 **Claude Code** 화면은 진짜 `claude` 를 앱 안에서 구동합니다. 이때 앱이 두 가지를 자동으로 챙깁니다:

- 세션마다 **ocul-pm 의 기록 도구(MCP)** 를 직접 물려 줍니다 — 에이전트가 `journal_write` 로 일지를 쓰고 플래너를 갱신할 수 있습니다
- 프로젝트의 **AGENTS.md 규칙**이 "작업을 마치면 기록하라"고 알려 줍니다

즉 **앱 안에서 쓰는 한, 따로 설치할 것이 없습니다.** 처음 실행할 때 어댑터가 자동 설치되는 몇 분(npm, 버전 고정)만 기다리면 됩니다.

:::warn
단, 앱에는 로그인 화면이 없습니다. Claude Code 를 한 번도 로그인한 적 없는 컴퓨터라면 먼저 터미널에서 `claude` 를 실행해 로그인해 두세요 — 앱은 그 자격을 그대로 씁니다. (앱 안에서도 툴바의 터미널 버튼으로 바로 열 수 있습니다.)
:::

## 왜 앱 안에서 `/plugin` `/mcp` 가 안 되나요

앱 안 Claude Code 는 ACP 라는 프로토콜로 대화합니다. 이 프로토콜은 프롬프트·도구 호출·승인 같은 **에이전트 작업**을 나르지만, `/plugin` `/mcp` `/login` `/remote-control` 처럼 **CLI 가 자기 화면(TUI)에 그리는 대화형 명령**은 나를 수 없습니다 — 그 명령들의 UI 는 터미널에만 존재하기 때문입니다.

그래서 앱은 **터미널 탈출구**를 둡니다: Claude Code 화면 우상단의 터미널 버튼을 누르면 같은 프로젝트에서 진짜 `claude` 가 열립니다. CLI 전용 명령은 거기서 실행하면 됩니다. (`/remote-control` 을 입력하면 앱이 알아서 터미널로 보내 줍니다.)

## 터미널 Claude Code — 플러그인을 설치하세요

터미널에서 Claude Code 를 주로 쓴다면 상황이 다릅니다. AGENTS.md 규칙만으로도 일지를 남기지만, 그건 **모델이 규칙을 따라 주는 만큼**입니다 — 긴 세션 끝에 잊고 넘어갈 수 있습니다. **oculpm 플러그인**을 설치하면 훅 브리지가 붙어 기록이 규칙이 아니라 **구조**가 됩니다.

설치는 터미널의 `claude` 안에서 두 줄입니다:

```
/plugin marketplace add bunhine0452/Ocul-PM
/plugin install oculpm@oculpm
```

:::tip
이 명령은 앱의 **설정 → ocul-pm → 연동** 탭에도 복사 버튼과 함께 있습니다. Claude Desktop 용 MCP 설정 스니펫도 같은 곳에서 복사합니다.
:::

플러그인이 설치되면:

- **훅 브리지** — 세션이 끝날 때 자동으로 기록을 남기도록 공식 훅이 연결됩니다
- **MCP 도구 5종** — `journal_write` · `plan_status` · `plan_update` · `plan_create` · `project_init`
- **스킬 5종** — `/oculpm:standup`, `/oculpm:next` 같은 워크플로 스킬

전부 `~/.claude` 전역에 설정되므로 **모든 프로젝트에서** 동작합니다. 앱 없이 플러그인만 먼저 써도 됩니다 — 기록은 `.oculpm/` 마크다운으로 쌓이고, 앱은 나중에 설치해도 그 기록을 그대로 읽습니다. 자세한 것은 [플러그인 페이지](/plugin)에.

## 정리 — 무엇을 설치해야 하나요

- **앱 안에서만 쓴다** → 설치할 것 없음. 로그인만 확인.
- **터미널에서도 쓴다** → 위 두 줄로 플러그인 설치. 이걸 안 하면 터미널 세션의 기록이 빠질 수 있습니다.
- **Claude Desktop 도 쓴다** → 설정 → ocul-pm → 연동에서 MCP 스니펫 복사.
