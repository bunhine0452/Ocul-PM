> 2026-07-31 웹 실확인 조사 — 발사 글 본문은 [launch-post.md](launch-post.md).

# Claude Code 플러그인 알리기 — 제출 채널 조사 (2026-07 기준, 웹 실확인)

## 1. 실존 확인된 채널

### A. Anthropic 공식 커뮤니티 마켓플레이스 — `anthropics/claude-plugins-community` ✅ 확인
- **URL**: https://github.com/anthropics/claude-plugins-community (read-only 미러, 내부 리뷰 파이프라인에서 매일 밤 sync)
- **제출 방법**: **PR 불가 — 직접 연 PR 은 자동으로 닫힘.** 제출은 폼으로만:
  - 개인 개발자: **https://platform.claude.com/plugins/submit** (Console 폼 — Team/Enterprise 조직이 아닌 개인 저자용으로 공식 문서가 명시)
  - Team/Enterprise 조직: https://claude.ai/admin-settings/directory/submissions/plugins/new
  - 단축 URL `clau.de/plugin-directory-submission` → 공식 문서 [Submit your plugin](https://code.claude.com/docs/en/plugins#submit-your-plugin-to-the-community-marketplace) 섹션으로 302 리다이렉트되는 것을 확인함.
- **요구사항/조건** (공식 문서 원문 근거):
  1. 제출 전 `claude plugin validate ./plugin/oculpm` 로컬 통과 (리뷰 파이프라인이 동일 검사 + 자동 보안 스크리닝 실행. `--strict` 로 경고까지 잡아두면 안전)
  2. 승인되면 **커밋 SHA 에 핀** 되어 [`marketplace.json` 카탈로그](https://github.com/anthropics/claude-plugins-community/blob/main/.claude-plugin/marketplace.json)에 등재, 이후 푸시는 CI 가 핀을 자동 갱신
  3. 승인→카탈로그 반영은 nightly sync 라 지연 있음. 설치는 `/plugin marketplace add anthropics/claude-plugins-community` 후 `@claude-community`
- **Ocul-PM 특이사항**: 현재 `plugin/oculpm` 의 description 이 한국어 + "v1 은 macOS 전용" — 제출 전 **영문 description 병기와 macOS-only 명시**를 권장 (자동 스크리닝·리뷰어가 영어 기준일 가능성 높음). 훅이 로컬 append 뿐이고 네트워크 없음 + `06-plugin-contract.md` 안전 계약 문서는 심사에 유리한 재료.

### B. `anthropics/claude-plugins-official` ✅ 확인 — 단, 신청 불가
- **URL**: https://github.com/anthropics/claude-plugins-official
- 공식 문서 원문: *"The official marketplace … is curated separately. Anthropic decides which plugins to include at its discretion. **There is no application process**, and the submission form does not add plugins to the official marketplace."* → 커뮤니티 마켓플레이스에서 성과를 내는 것이 유일한 경로. 목표가 아니라 결과로 취급할 것.

### C. `composio-community/awesome-claude-plugins` ✅ 확인 (★1,849, 기본 브랜치 `master`)
- **URL**: https://github.com/composio-community/awesome-claude-plugins
- **제출 방법**: 표준 GitHub PR. Contributing 원문: "Fork → add your plugin folder → update README → PR". 폴더 추가가 원칙처럼 쓰여 있으나 **외부 repo 링크 엔트리가 이미 다수 확립된 관행** (kaggle-skill, CCHub, context-mode, backlog 등 — 특히 **CCHub 는 "Tauri v2 데스크톱 앱" 엔트리라 Ocul-PM 의 직접 선례**).
- **엔트리 형식** (실제 라인 확인): `- [name](https://github.com/...) - 한 줄 설명.` / 적합 섹션: **Developer Productivity**
- **조건**: 실사용 사례, 기존 기능 비중복, 테스트됨.

### D. `hesreallyhim/awesome-claude-code` ✅ 확인 — 이슈 폼 전용
- **URL**: https://github.com/hesreallyhim/awesome-claude-code
- **제출 방법**: **PR 금지. `recommend-resource.yml` 이슈 폼을 웹 UI 로만** (gh CLI 제출 금지, **"사람이 직접 제출" 을 명시적으로 요구** — 에이전트 대리 제출 불가이므로 이 채널은 김현빈 님이 직접 폼을 채워야 함).
- **폼 필드** (템플릿 실확인): Display Name / Category(드롭다운 — Ocul-PM 은 "Observability & Monitoring" 또는 "Agent Orchestration" 적합) / Link(GitHub repo 선호) / Author Name / Author Link / Description.
- **조건**: 매우 선별적. 설명은 **한 줄, 사실 서술, 세일즈 문구·이모지 금지**. 메인테이너가 "리스트 등재를 1차 홍보 전략으로 삼지 말고, 트랙션 생긴 뒤 제출하라"고 명시 → 우선순위 낮게, 다른 채널 이후에.

### E. 자동 인덱싱 디렉터리 — 제출 폼 없음, GitHub 신호로 등재
- **claudemarketplaces.com** ✅ 사이트 실존 (자칭 "The #1 directory", 비공식). 공개 제출 폼 없음 — GitHub 스타·설치 수·활동 기반 큐레이션. **실행 가능한 액션 = repo 토픽 추가**: 현재 Ocul-PM 토픽에 `claude-code` 는 있으나 [`claude-code-plugins-marketplace`](https://github.com/topics/claude-code-plugins-marketplace) · `claude-code-plugins` · `claude-plugins` · `mcp` 가 **없음**. 이 토픽들이 인덱서들의 수집 축.
- **claudepluginhub.com** — 사이트는 검색 결과에 실존하나 제출 메커니즘 **미확인**.
- **ananddtyagi/cc-marketplace** ✅ 실존 — 단 제출 경로가 claudecodecommands.directory/submit (커맨드) / subagents.cc (에이전트) 로 **개별 커맨드·에이전트 지향**이라 풀 플러그인인 Ocul-PM 과는 부적합. 제외 권장.

## 2. 알림(발표) 채널 관례

| 채널 | 관례 (확인 근거) |
|---|---|
| **Show HN** (news.ycombinator.com/showhn.html) | "만든 것 + 바로 써볼 수 있어야" 함 — 랜딩페이지·리스트만은 불가. 가입 등 장벽 없이 체험 가능해야 유리. **계정은 회사명 말고 개인 이름**. 제목에 과장 금지, 첫 댓글로 제작 배경 설명이 관례. Ocul-PM 의 각도: 앱(.dmg, 공증 전 xattr 필요)이 아니라 **"두 줄 플러그인 설치"를 체험 진입점으로 내세우면** 장벽 문제가 해소됨 |
| **r/ClaudeAI** (회원 100만+) | **"Built with Claude" 플레어** 관례 확인: 무엇을 만들었나 + 어떻게 + 스크린샷/데모 + **실제 사용한 프롬프트 1개 이상**. 전체 사이드바 규칙 세부는 **미확인** — 게시 전 사이드바 확인 필요. (r/ClaudeCode 서브레딧은 이번 조사에서 **미확인**) |
| **GeekNews Show GN** (https://news.hada.io/show) ✅ 확인 | "개발자·창작자가 자기 서비스·오픈소스를 알리고 피드백 받는" 공식 섹션. 회원 가입 후 누구나 등록, **원문 링크 + 한국어 요약** 형식. 일정 점수 이상이면 X/페이스북/슬랙 봇 자동 공유. 한국어 README 인 Ocul-PM 의 홈그라운드 |
| Product Hunt 등 | 이번 조사 범위 밖 — **미확인** |

## 3. 추천 우선순위

1. **repo 토픽 추가** (5분, 무료) — `claude-code-plugins`, `claude-code-plugins-marketplace`, `claude-plugins`, `mcp` → 자동 인덱서 유입.
2. **Anthropic 커뮤니티 마켓플레이스 제출** (Console 폼) — 유일한 "인앱 발견" 경로. 사전에 ① `claude plugin validate ./plugin/oculpm --strict` ② 영문 description ③ macOS-only 명시.
3. **composio-community/awesome-claude-plugins PR** — 선례(CCHub) 있고 통과 확률 높음. ★1,849 의 상시 유입.
4. **GeekNews Show GN** — 한국어 제품에 최적, 즉시 게시 가능.
5. **r/ClaudeAI "Built with Claude"** — 데모 GIF 준비 후.
6. **Show HN** — 리치 최대지만 1회성 카드. 플러그인-우선 프레이밍으로 macOS 앱 장벽을 우회하되, 가급적 공증(로드맵 항목) 후 권장.
7. **hesreallyhim/awesome-claude-code 이슈 폼** — 트랙션(스타·다운로드) 쌓인 뒤, **본인이 직접** 웹 폼 제출.

## 4. 채널별 제출물 초안

### 4-1. Anthropic Console 폼 (영문 description 초안)
> **Ocul-PM** — Local-first work journal for AI coding agents. The plugin wires up a hook bridge (session start/stop signals, local file append only — no network), 4 MCP tools (`journal_write` / `plan_status` / `plan_update` / `plan_create`) that write structured markdown journals and plans into your project's `.oculpm/` directory, and 5 skills (journaling spec, project-inception, self-audit, run-evals, tdd-workflow) plus `/oculpm:standup`. Works only in repos already tracked with `.oculpm/`; creates nothing elsewhere (full read/write contract in `docs/claude-integration/06-plugin-contract.md`). Optional macOS companion app (Tauri 2, MIT) renders the journals as timelines, diffs and retros. Free forever for individuals; team plan in the works.
- Repo: `https://github.com/bunhine0452/Ocul-PM` / 사전 체크: `claude plugin validate ./plugin/oculpm` (경로 실확인: 플러그인 소스는 `plugin/oculpm`, 마켓플레이스 매니페스트는 `.claude-plugin/marketplace.json`)

### 4-2. composio-community/awesome-claude-plugins PR
- **추가 파일 없음** — `README.md` 의 `### Developer Productivity` 섹션에 1행 추가 (알파벳순 아님, 말미 추가가 관행):
```markdown
- [oculpm](https://github.com/bunhine0452/Ocul-PM) - Local-first work journal for AI coding agents. Hook bridge + 4 MCP tools + 5 skills auto-record what Claude Code does as markdown journals and living plans in `.oculpm/`, with planner dispatch and 3-depth plans. Optional macOS companion app (Tauri 2) for timelines, diffs and retros. ([Website](https://oculpm.com))
```
- **PR 제목**: `Add oculpm — local-first work journal plugin for coding agents`
- **PR 본문 요지**: real use case(에이전트 작업 기록·검증), 비중복(저널링+플래너 결합은 기존 목록에 없음 — backlog 는 task 관리, CCHub 는 생태계 관리 앱이라 상보적), 테스트됨(플러그인 계약을 문서+테스트로 고정), 설치 두 줄.

### 4-3. GeekNews Show GN (한국어)
- **제목**: `Show GN: Ocul-PM — AI 코딩 에이전트가 일하는 동안 작업 일지를 대신 쓰는 로컬-우선 PM (Tauri 2, MIT)`
- **요약 초안**: Claude Code·Cursor·Gemini CLI 가 코드를 쓰는 동안 "지난주에 뭘 왜 건드렸는지"가 증발하는 문제에서 시작했습니다. 프로젝트에 규칙 파일 하나를 심으면 에이전트가 작업 단위마다 `.oculpm/` 에 마크다운 일지를 남기고, 앱이 타임라인·변경 diff·회고로 보여줍니다. 서버 없음, 데이터는 전부 로컬(마크다운이 원본, SQLite 는 캐시). v2.5 부터는 앱 없이도 Claude Code 에서 두 줄이면 시작됩니다: `/plugin marketplace add bunhine0452/Ocul-PM` → `/plugin install oculpm@oculpm` (훅+MCP 도구 4종+스킬 5종). 개인 영구 무료(Free forever for individuals), 팀 플랜 준비 중. 피드백 환영합니다.

### 4-4. r/ClaudeAI ("Built with Claude" 플레어)
- **제목**: `I built a local-first "work journal" that makes Claude Code document everything it does — installs as a plugin in 2 lines`
- **본문 골격**: ① 문제(코드는 남고 맥락은 안 남음) ② 두 줄 설치 코드블록 ③ 스크린샷: 타임라인/플래너 ▶실행/메뉴바 ④ **실제 사용 프롬프트 1개** (예: 플래너 디스패치가 조립하는 프롬프트 원문 — 규칙 충족용) ⑤ 프라이버시(훅=로컬 append 한 줄, 네트워크 없음) ⑥ "이 repo 자체가 자기 자신으로 추적됨(도그푸딩)" ⑦ Free forever for individuals, team plan coming.

### 4-5. Show HN (준비되면)
- **제목**: `Show HN: Ocul-PM – Local-first work journal for AI coding agents (Tauri, MIT)`
- **첫 댓글 초안**: I kept losing the "why" behind what Claude Code did last week — code survives, context doesn't. Ocul-PM plants one rules file in your repo; agents then write a markdown journal entry per unit of work into `.oculpm/`, and the app renders timelines, per-entry diffs and retros. Everything is plain markdown you can commit — the app is optional. Easiest way to try (no download): two lines inside Claude Code (`/plugin marketplace add …` → `/plugin install …`). macOS app is Tauri 2 (<60MB dmg), all data local, MIT. Free forever for individuals. Known gaps: Apple Silicon only, not notarized yet.

### 4-6. awesome-claude-code 이슈 폼 (본인 직접 제출용 값)
- Display Name: `Ocul-PM` / Category: `Observability & Monitoring` / Link: `https://github.com/bunhine0452/Ocul-PM` / Author: `bunhine0452` + `https://github.com/bunhine0452` / Description(한 줄·무광고): `Local-first desktop app and Claude Code plugin that records agent work as markdown journals with per-entry diffs, living plans, and retrospectives.`

## 미확인으로 남은 것
- claudepluginhub.com 의 등재 경로 / r/ClaudeAI 전체 사이드바 규칙 세부 / r/ClaudeCode 서브레딧 / Product Hunt·기타 런치 플랫폼 / Console 폼의 정확한 입력 필드(로그인 뒤라 폼 내부는 열람 불가 — 프로세스는 공식 문서로 확인).

Sources: [claude-plugins-community](https://github.com/anthropics/claude-plugins-community) · [claude-plugins-official](https://github.com/anthropics/claude-plugins-official) · [공식 플러그인 문서(제출 섹션)](https://code.claude.com/docs/en/plugins#submit-your-plugin-to-the-community-marketplace) · [community marketplace.json](https://github.com/anthropics/claude-plugins-community/blob/main/.claude-plugin/marketplace.json) · [awesome-claude-plugins](https://github.com/composio-community/awesome-claude-plugins) · [awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) · [claudemarketplaces.com](https://claudemarketplaces.com/) · [claude-code-plugins-marketplace 토픽](https://github.com/topics/claude-code-plugins-marketplace) · [cc-marketplace](https://github.com/ananddtyagi/cc-marketplace) · [Show HN 가이드](https://gist.github.com/tzmartin/88abb7ef63e41e27c2ec9a5ce5d9b5f9) · [HN 런치 가이드](https://www.markepear.dev/blog/dev-tool-hacker-news-launch) · [GeekNews Show](https://news.hada.io/show) · [GeekNews About](https://news.hada.io/about)
