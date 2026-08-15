<div align="center">

<img src="https://raw.githubusercontent.com/bunhine0452/Ocul-PM/main/landing/og.png" alt="Ocul-PM" width="440" />

<h1>Ocul-PM</h1>

<p><b>AI 코딩 에이전트가 코드를 쓰는 동안, 그 기록은 Ocul-PM 이 남깁니다.</b><br/>
Claude Code · Codex · Cursor · Gemini CLI 와 함께 쓰는 로컬-우선 프로젝트 매니저</p>

[![Latest release](https://badgen.net/github/tag/bunhine0452/Ocul-PM?icon=github&label=download&color=12a06b)](https://github.com/bunhine0452/Ocul-PM/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/bunhine0452/Ocul-PM/total?color=12a06b&label=downloads&cacheSeconds=3600)](https://github.com/bunhine0452/Ocul-PM/releases)
[![Platform](https://img.shields.io/badge/macOS-Apple%20Silicon-111?logo=apple)](https://github.com/bunhine0452/Ocul-PM/releases/latest)
[![Built with Tauri 2](https://img.shields.io/badge/Tauri-2-24C8A0?logo=tauri&logoColor=white)](https://tauri.app)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[oculpm.com](https://oculpm.com) · [키노트](https://oculpm.com/keynote) · [위키](https://oculpm.com/wiki) · [다운로드](https://github.com/bunhine0452/Ocul-PM/releases/latest) · [변경 이력](CHANGELOG.md) · [이슈](https://github.com/bunhine0452/Ocul-PM/issues)

한국어 · [English](README.en.md)

</div>

---

에이전트한테 일을 시키는 날이 늘수록 이상한 비용이 하나 생깁니다. 지난주에 Claude Code 가 어떤 파일을 왜 건드렸는지, Cursor 가 고쳤다는 버그가 진짜 고쳐졌는지를 매번 git log 와 기억에 의존해 다시 캐내는 일입니다. 코드는 남는데 맥락은 남지 않기 때문입니다.

Ocul-PM 은 프로젝트 폴더에 규칙 파일(`AGENTS.md`) 하나를 심는 것으로 시작합니다. 에이전트는 작업 하나를 끝낼 때마다 이 규칙대로 `.oculpm/journal/` 에 마크다운 일지를 남기고, 앱은 그것을 읽어 타임라인과 일일 브리프, 변경 diff, 회고로 보여줍니다. 원본이 전부 마크다운 파일이라 코드와 함께 커밋할 수 있고, 앱이 없어도 그냥 읽힙니다.

서버는 없습니다. 데이터는 프로젝트의 `.oculpm/` 폴더와 로컬 SQLite 캐시에만 있고, 밖으로 나가는 것은 직접 부른 LLM API 호출과 새 버전 확인이 전부입니다.


<img src="landing/shots/08-receipt.jpg" alt="Ocul-PM — 앱 안의 Claude Code 가 편집 diff 와 턴 영수증을 남긴 실제 화면" />
<p align="center"><i>실제 화면 — 앱 안의 Claude Code 가 파일을 고치고, diff 로 보여 주고, 스스로 작업 일지를 남긴 턴입니다.</i></p>

## 세 가지처럼 보이지만, 하나의 앱입니다

### 📓 기록장 — 기록은 공짜여야 합니다

에이전트가 일을 마치는 순간 일지는 이미 쓰여 있습니다. 버그·기능·리팩토링으로 분류되고, 어느 에이전트가 어느 모델로 했는지가 붙습니다. 아침의 Today 브리프가 어제를 정리하고, 스탠드업·PR 본문·주간 보고·회고가 버튼 하나로 나옵니다 — 백미러가 핸들이 됩니다.

<img src="landing/shots/02-journal.jpg" alt="자동 작업 일지 — 에이전트·모델별로 분류된 일지 타임라인" />

### 🔍 검증대 — 믿지 말고 보십시오

에이전트가 만졌다는 파일을 커밋 전에 앱 안에서 줄 단위 diff 로 확인합니다. 일지와 나란히 — "말한 것"과 "실제로 바뀐 것"을 붙여 놓고 봅니다. 코드 맵은 "이 파일을 바꾸면 N개 파일에 영향"을 고치기 전에 알려 줍니다.

<img src="landing/shots/03-diff.jpg" alt="변경 diff — 에이전트가 만든 변경의 줄 단위 로컬 diff" />

### 🖥️ 콘솔 — 에이전트를 안으로

진짜 `claude` 가 앱 안에서 구동됩니다 (Agent Client Protocol). 도구 호출이 카드로 흐르고, 편집 diff 가 카드에 그대로 그려지고, 승인 카드에는 실행될 명령과 바뀔 내용이 실립니다 — 제목만 보고 허용을 누르지 않습니다. 턴이 끝나면 "도구 4 · 2분 14초" 영수증이 남습니다.

<img src="landing/shots/s2.jpg" alt="승인 카드 — 바뀔 내용의 diff 가 카드 안에 보이는 모습" />

<table><tr>
<td width="50%"><img src="landing/shots/04-graph.jpg" alt="코드 맵 — 의존성 그래프와 변경 영향 분석" /><p align="center"><i>코드 맵 — 의존이 보이면 두려움이 줄어듭니다</i></p></td>
<td width="50%"><img src="landing/shots/05-terminal.jpg" alt="⌘J 터미널 도크" /><p align="center"><i>⌘J — 어느 화면에서든 터미널</i></p></td>
</tr></table>

## 🚀 v2.11.0 — 고치는 내용이 보인다, 블라인드 승인의 끝

- **편집 diff 가 화면에** — Claude Code 가 파일을 고칠 때 지운 줄(빨강)·넣은 줄(초록)이 도구 카드에 그대로 그려지고, 줄에는 `+12 −3` 규모가 붙습니다. 그동안 이 정보는 통째로 버려지고 있었습니다.
- **승인 카드에 내용이 실립니다** — 편집이면 diff, 명령 실행이면 실행될 명령이 카드 안에 보입니다. 제목만 보고 허용을 누르던 블라인드 승인의 끝. 실행·삭제 승인은 낯빛부터 다릅니다.
- **승인 대기가 사이드바에** — 다른 화면에 있어도 깜빡이는 배지가 "눌러야 풀리는 멈춤"을 알립니다.
- **한글 조합 Enter 전송 버그 수정** — 마지막 글자를 확정하는 Enter 가 문장을 전송하던 지뢰를 제거했습니다.
- **대화면 마찰 일소** — 입력창 자동 확장 · ↑/↓ 지시 되부르기 · 파일 드래그&드롭 첨부 · 세션별 초안 보존 · 대기열 오배송 차단 · 턴 영수증("도구 7 · 파일 3 · 1분 12초") · 답변/출력 복사 · 오류 「다시 보내기」 · 죽은 프로세스 감지와 「다시 연결」.

<details>
<summary><b>지난 버전 하이라이트</b> — v2.5 부터 v2.10.3 까지</summary>

- **v2.10.3** — 타이틀바 더블클릭은 창 크기만 · 화면 한 조각의 오류가 창 전체를 지우지 못하게 (범용 렌더 경계)
- **v2.10.2** — 터미널 도크 오른쪽 자리 · 분리 창 드래그 · macOS 창 분할 단축키(⌃⌥←→↑↓) 복구
- **v2.10.1** — ⌘J 터미널 도크 · 창으로 분리해도 셸 유지 · Claude Code 할 일 목록 · 한도 초과·모델 폴백이 대화에 기록
- **v2.10.0** — Claude Code 를 앱 안에서 직접 구동 (Agent Client Protocol)
- **v2.9** — 프로젝트를 창과 탭으로 — 크롬식 탭 · 떼어내기 · 프로젝트별 상태 기억
- **v2.8** — 화면 언어 English · 스킬 샵 (검증된 제3자 스킬 25종) · 터미널 정리
- **v2.6 – v2.7** — 시작 화면이 크로스 프로젝트 콕핏으로 · 회고 화면 (7·14·30일 신호)
- **v2.5** — Claude Code 플러그인 (아래 섹션) · 플래너 ▶실행 디스패치 · 3단계 계획 · project-inception 스킬 · AGENTS.md 토큰 60% 다이어트
- 메뉴바 상주(v2.3) · Claude 직접 연동(v2.2) — 전체 이력은 [CHANGELOG](CHANGELOG.md)

</details>

## 화면 구성

- **Today** — 오늘 무엇이 바뀌었는지 워크데이 기준으로 모아 보여줍니다. 커밋 그래프, 미커밋 변경, 에이전트가 고쳐놓고 일지에 안 적은 파일 감지(정직성 감사)까지. "스탠드업 복사"를 누르면 어제~오늘 한 일이 공유용 텍스트로 클립보드에 담깁니다.
- **작업 일지** — 에이전트가 남긴 기록의 타임라인. 어떤 에이전트가 어떤 모델로 작업했는지 표시되고, 일지마다 그 시점의 변경 diff 를 함께 보관합니다. 일지 없이 쌓여 온 저장소는 git 히스토리에서 한 번에 백필할 수 있습니다.
- **문제 해결** — 무엇을 할지 정하기 *전* 단계의 토의 문서. 문제 정의부터 후보안 비교, 결론까지 정리하고, 결론이 서면 버튼 한 번으로 플래너 계획이 됩니다.
- **Planner** — 살아있는 계획 문서. 항목마다 관련 일지가 링크되고, 원하면 새 일지가 들어올 때 계획이 따라 갱신되는 자동 화해(옵트인)도 켤 수 있습니다.
- **변경 diff** — 에이전트가 수정한 파일을 네트워크 없이 바로 비교합니다. `j`/`k` 로 파일을 오가고 `/` 로 diff 안을 검색합니다. 바뀐 파일이 코드 그래프에서 어디까지 영향을 주는지도 계산해 줍니다.
- **회고** — 최근 7·14·30일 동안 무엇을 출시했고 어디서 막혔는지, 노력이 어느 파일에 몰렸는지를 신호로 보여줍니다. AI 회고 생성, PR 본문·주간 보고 산출물, 기간 일지 `.md` 내보내기가 여기 있습니다.
- **코드 검색** — 의미(로컬 임베딩) · 심볼(AST) · 텍스트(FTS5 전문 인덱스) 세 가지 모드.
- **코드 맵** — import 만이 아니라 호출·상속·구현 관계까지 그래프로 그립니다. 파일을 고르면 "이 파일을 바꾸면 N개 파일에 영향"이 먼저 보입니다.
- **문서** — 프로젝트의 `docs/` 폴더를 위키처럼 탐색합니다.
- **터미널** — 앱 안 PTY 터미널. 에이전트를 여기서 돌리면 일지가 옆 화면에 쌓입니다. **⌘J 로 어느 화면에서나 도크로 띄우거나(아래·왼쪽·오른쪽) 별도 창으로 떼어낼 수 있고**, 셸은 그대로 이어집니다. `/plugin`·`/mcp` 처럼 CLI 자체 대화형 화면에만 사는 기능을 쓰는 탈출구이기도 합니다.
- **Claude Code** — 진짜 `claude` 를 앱 안에서 에이전트로 구동합니다(Agent Client Protocol). 도구 호출·권한 승인·Effort/모드가 전부 대화 안 카드로 오고, 세션은 탭으로 관리됩니다. 시키는 화면입니다.
- **AI 패널** — 코드 검색·일지·플래너·git 맥락을 아는 채팅. Anthropic · OpenAI · Gemini · OpenRouter 를 지원하고, 호출이 실패하면 폴백 체인으로 다음 모델을 시도합니다. 물어보는 화면입니다.
- **스킬·규칙** — Claude Code 스킬(`.claude/skills/`)과 규칙(`.claude/rules/`, `CLAUDE.md`)을 프로젝트별로 관리합니다. GUI 에서 만들고 편집하고, 프로젝트 ↔ 전역(`~/.claude/skills`)으로 복사합니다. 끄면 지워지는 게 아니라 `.disabled/` 로 옮겨 로드에서만 빠집니다. **샵 탭**에서는 스택에 맞는 검증된 제3자 스킬 25종을 골라 한 번에 설치합니다.

⌘1~⌘0 으로 화면을 오가고, ⌘K 팔레트에서 일지·계획·토의·문서를 제목으로 검색해 바로 엽니다. ⌘P 는 프로젝트 전환, ⌘⇧M 은 프로젝트 관리 화면입니다. 창과 탭은 ⌘T 새 탭 · ⌘W 탭 닫기 · ⇧⌘N 새 창 · ⇧⌘W 창 닫기 · ⌃Tab · ⌘⌥←→ 로 다룹니다.

화면 언어는 설정 → 모양에서 **한국어 · English** 중에 고릅니다. AI 가 쓰는 문서(일지·회고·플래너)의 언어는 따로 지정할 수 있고, 지정하지 않으면 화면 언어를 따라갑니다.

## 지원 에이전트

`AGENTS.md` 를 읽을 수 있는 에이전트라면 무엇이든 동작합니다.

- 별도 설정 없이: **Claude Code · Codex CLI · Gemini CLI · Antigravity · pi**
- 설정 → Agents 에서 규칙 파일을 켜면: **Cursor · Windsurf · GitHub Copilot · aider · Cline · Zed**
- **Claude Code · Claude Desktop** 은 여기서 한 단계 더 — 훅(정확한 세션 감지)과 MCP 도구(구조화 기록·플랜 질의)로 직접 연동됩니다 (v2.2.0). Claude Code 는 **Claude Code 화면**에서 앱 안 에이전트로 직접 구동까지 됩니다 (v2.10.0, Agent Client Protocol)

git 백필 시에는 커밋 서명으로 에이전트를 구분합니다.

## Claude Code 플러그인 — 앱 없이도 시작

터미널 Claude Code 에서 두 줄이면 기록이 시작됩니다:

```
/plugin marketplace add bunhine0452/Ocul-PM
/plugin install oculpm@oculpm
```

플러그인 하나로 전 프로젝트에 구성되는 것:

- **훅 브리지** — 세션 시작·종료가 실시간 신호로 기록됩니다 (로컬 파일 append 한 줄, 네트워크 없음).
- **MCP 도구 5종** — `journal_write` · `plan_status` · `plan_update` · `plan_create` · `project_init`(사용자 확인 시 새 프로젝트 추적 시작). 에이전트가 마크다운 규격을 흉내 내는 대신 구조화 도구로 기록해 frontmatter 오류가 원천 차단됩니다.
- **스킬 5종 + `/oculpm:standup`** — 기록 규격 · project-inception(설계 시드) · self-audit · run-evals · tdd-workflow.
- `.oculpm` 이 있는 추적 프로젝트에서만 동작하고, 비추적 저장소에는 아무 파일도 만들지 않습니다 — [무엇을 읽고 쓰는지 전체 계약](docs/claude-integration/06-plugin-contract.md).
- 앱 설정의 프로젝트별 훅·MCP 등록과는 **택일**입니다 (동시에 켜면 설정 화면이 경고합니다).

> 앱 안의 **Claude Code 화면**은 이 플러그인 없이도 기록합니다 — 앱이 세션마다 기록 도구(MCP)를 직접 물려 주기 때문입니다. 앱 안 ACP 세션에서는 `/plugin`·`/mcp` 같은 CLI 대화형 명령이 동작하지 않으므로, 플러그인 설치는 터미널에서 합니다. 이 구분은 [위키의 Claude Code 연동](https://oculpm.com/wiki/claude-code) 문서에 정리돼 있습니다.

## 설치

[최신 릴리스](https://github.com/bunhine0452/Ocul-PM/releases/latest)에서 `Ocul-PM_x.y.z_aarch64.dmg` 를 받아 `Applications` 로 드래그하면 끝입니다. macOS(Apple Silicon)용이고, 한 번 설치하면 이후 버전은 앱 안에서 자동으로 업데이트됩니다.

아직 Apple 공증 전이라 처음 열 때 "손상되었기 때문에 열 수 없습니다"가 뜰 수 있습니다. 실제 손상이 아니라 macOS 의 격리 표시 때문이니, 터미널에서 한 줄이면 됩니다:

```bash
xattr -dr com.apple.quarantine /Applications/Ocul-PM.app
```

첫 의미 검색 때 임베딩 모델(약 135MB)을 한 번 내려받습니다. 이후에는 오프라인으로 동작합니다.

앱 설치 없이 기록만 먼저 시작하려면 위의 **Claude Code 플러그인**으로도 됩니다 — 일지·플랜이 `.oculpm/` 마크다운으로 쌓이고, 앱은 나중에 설치해도 그 기록을 그대로 읽습니다.

막히는 게 있으면 [위키](https://oculpm.com/wiki)에 흔한 문제와 해법을 모아 두었습니다.

## 데이터는 어디에 있나

```
your-project/
├── AGENTS.md          # 에이전트가 읽는 기록 규칙 (앱이 심고 버전 관리)
└── .oculpm/
    ├── journal/       # 작업 일지 — 원본(SSOT)
    ├── planner/       # 계획 문서
    ├── discussion/    # 토의 문서
    └── index/         # 앱이 관리하는 캐시 · diff 보관
```

SQLite 는 화면을 빨리 그리기 위한 파생 캐시일 뿐이라 언제든 파일에서 다시 만들 수 있습니다. 일지와 diff 에 실수로 섞여 들어간 API 키·토큰은 저장 전에 자동으로 가려집니다(`[REDACTED]`).

## 기술

Tauri 2 네이티브 앱입니다. Electron 이 아니라서 dmg 가 60MB 를 넘지 않고 콜드 스타트가 1.5초 안에 끝납니다. 백엔드는 Rust(tokio · rusqlite · sqlite-vec), 프론트는 React 19 + TypeScript. 코드 분석은 tree-sitter(Rust · TS · JS · Python · Go), 임베딩은 fastembed 로 전부 로컬에서 돌고, API 키는 DB 가 아니라 OS 키체인에 저장합니다.

## 소스에서 빌드

```bash
git clone https://github.com/bunhine0452/Ocul-PM
cd Ocul-PM
pnpm install
pnpm tauri dev      # 개발 실행
pnpm tauri build    # .dmg / .app 번들
```

Node 18+, pnpm, Rust stable 이 필요하고 macOS 는 Xcode Command Line Tools 도 있어야 합니다.

## 로드맵

- [ ] macOS (Intel) · Windows 빌드
- [ ] Apple 공증
- [ ] 팀 동기화 (옵트인)

## 그리고

이 저장소 자체가 Ocul-PM 으로 추적됩니다. `.oculpm/journal/` 을 열면 이 앱을 만드는 동안 에이전트들이 남긴 일지가 그대로 들어 있습니다. 버그와 아이디어는 [이슈](https://github.com/bunhine0452/Ocul-PM/issues)로, 마음에 들면 Star 하나 눌러 주세요.

## 라이선스와 약속

[MIT](LICENSE) © 2026 Kim Hyunbin

**지금 이 저장소에 있는 기능은 영원히 무료·MIT 입니다.** 개인 사용은 회사 안에서든 밖에서든 영구 무료(Free forever for individuals)이고, 유료화는 앞으로 만들 팀 기능(동기화 서버·팀 뷰 — 별도 모듈)에만 적용됩니다. 코어 기능을 유료 모듈로 옮기는 일은 없습니다.

기여는 CLA 없이 [DCO(sign-off)](CONTRIBUTING.md)로 받습니다 — 코어가 영원히 MIT 로 남기 때문에 저작권을 모아둘 이유가 없습니다.
