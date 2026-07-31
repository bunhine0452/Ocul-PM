# Ocul-PM 발사 글 (v2.5.x 라운드)

> 2026-07-31 작성 — 초안 2종(문제 서사 / 기술 설계)을 심사·합성한 최종본.
> 채널별 변형·제출 절차는 [channels.md](channels.md) 참조.

## 헤드라인

- ko: 코드는 남는데 맥락은 안 남아서 만들었습니다 — 에이전트의 일을 기록·검증하는 로컬-퍼스트 PM, Ocul-PM (MIT · 개인 영구 무료)
- en: Code survives, context doesn't — Ocul-PM records and verifies what your AI agents do, as plain markdown (MIT, free forever for individuals)

## 한국어 (GeekNews Show GN 등)

코드는 남는데, 맥락은 사라집니다.

에이전트에게 일을 맡기는 날이 늘수록 이상한 비용이 하나 생깁니다. 지난주 Claude Code 가 어떤 파일을 왜 건드렸는지, "고쳤다"던 버그가 진짜 고쳐졌는지를 매번 git log 와 기억으로 다시 캐내는 일. 에이전트는 코드를 남기지만, 판단의 맥락은 어디에도 남지 않습니다.

Ocul-PM 은 그 빈칸을 파일로 메웁니다. 에이전트가 작업 하나를 끝낼 때마다 프로젝트의 `.oculpm/` 폴더에 사람이 읽을 수 있는 마크다운 일지가 남고, 앱은 그것을 타임라인·일일 브리프·회고로 보여줍니다. 일지마다 그 시점의 diff 가 붙어 "고쳤다"는 말을 코드로 확인할 수 있고, 바꿔놓고 일지에 안 적은 파일은 정직성 감사가 잡아냅니다. 쌓인 기록은 스탠드업·PR 본문·주간 보고로 돌아오고, Notion 으로도 내보냅니다. 플래너 항목의 ▶실행을 누르면 항목과 연결 일지가 조립된 프롬프트로 터미널에 프리필되고, Enter 한 번에 Claude Code 실세션이 그 항목을 잡습니다.

설계는 세 가지로 요약됩니다. 서버 없음 — 데이터는 프로젝트 폴더와 로컬 SQLite 캐시뿐. 파일이 원본(SSOT) — SQLite 는 언제든 파일에서 재구성되는 파생 캐시고, 원본이 마크다운이라 코드와 함께 커밋됩니다. 기록은 흉내가 아니라 도구로 — MCP 도구 4종이 frontmatter 규격을 서버 쪽에서 보장하고, 훅은 네트워크 없는 로컬 append 한 줄입니다.

시작은 Claude Code 에서 두 줄:

```
/plugin marketplace add bunhine0452/Ocul-PM
/plugin install oculpm@oculpm
```

훅 브리지·MCP 도구 4종·스킬 5종이 함께 구성됩니다. MIT 공개, 개인 영구 무료(Free forever for individuals) — 팀 플랜 준비 중. 앱(macOS)은 [oculpm.com](https://oculpm.com) 에서.

## English (r/ClaudeAI · Show HN 등)

The code stays. The context vanishes.

The more work you hand to agents, the more you pay a strange tax: digging through git log and your own memory to figure out which files Claude Code touched last week and why — or whether the bug it "fixed" was actually fixed. Agents leave code behind, but the reasoning behind it is recorded nowhere.

Ocul-PM fills that gap with files. Every time an agent finishes a unit of work, a human-readable markdown journal lands in the project's `.oculpm/` folder, and the app turns those into a timeline, a daily brief, and retrospectives. Each journal carries the diff from that moment, so "fixed it" can be checked against actual code — and an honesty audit catches files the agent changed but never wrote down. The accumulated record comes back as standups, PR descriptions, and weekly reports, and exports to Notion. Hit ▶Run on a planner item and a prompt assembled from the item and its linked journals is prefilled into the terminal; one Enter puts a live Claude Code session on it.

The design boils down to three decisions. No server — your data lives only in the project folder and a local SQLite cache. Files are the source of truth — SQLite is a derived cache that can always be rebuilt from disk, and since journals are markdown, they commit alongside your code. Recording goes through tools, not format mimicry — four MCP tools enforce the frontmatter spec server-side, and the hooks are a single network-free local append.

Getting started is two lines in Claude Code:

```
/plugin marketplace add bunhine0452/Ocul-PM
/plugin install oculpm@oculpm
```

That sets up the hook bridge, four MCP tools, and five skills. MIT open source, free forever for individuals — a team plan is in the works. The macOS app is at [oculpm.com](https://oculpm.com).

---

*합성 기준: 초안 A 의 문제-서사 골격을 채택(첫 두 문장의 스크롤 정지력과 설치 두 줄까지의 흐름이 우수)하고, A 의 약점인 신뢰 근거를 B 의 설계 결정 중 3가지(서버 없음·파일 SSOT·MCP 구조화 기록+무네트워크 훅)만 한 문단으로 압축 이식했습니다. B 의 3-depth 롤업·토큰 60% 압축·inception 스킬은 발사 글 분량 대비 과한 디테일로 제외했습니다. 헤드라인은 KO 는 B-2 의 빌더 보이스를 채택, EN 은 A-1 과 B-2 를 합성 재작성했으며, 모든 주장은 README/CHANGELOG 에서 grep 으로 재확인했습니다.*
