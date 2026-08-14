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

[oculpm.com](https://oculpm.com) · [다운로드](https://github.com/bunhine0452/Ocul-PM/releases/latest) · [변경 이력](CHANGELOG.md) · [이슈](https://github.com/bunhine0452/Ocul-PM/issues)

한국어 · [English](README.en.md)

</div>

---

에이전트한테 일을 시키는 날이 늘수록 이상한 비용이 하나 생깁니다. 지난주에 Claude Code 가 어떤 파일을 왜 건드렸는지, Cursor 가 고쳤다는 버그가 진짜 고쳐졌는지를 매번 git log 와 기억에 의존해 다시 캐내는 일입니다. 코드는 남는데 맥락은 남지 않기 때문입니다.

Ocul-PM 은 프로젝트 폴더에 규칙 파일(`AGENTS.md`) 하나를 심는 것으로 시작합니다. 에이전트는 작업 하나를 끝낼 때마다 이 규칙대로 `.oculpm/journal/` 에 마크다운 일지를 남기고, 앱은 그것을 읽어 타임라인과 일일 브리프, 변경 diff, 회고로 보여줍니다. 원본이 전부 마크다운 파일이라 코드와 함께 커밋할 수 있고, 앱이 없어도 그냥 읽힙니다.

서버는 없습니다. 데이터는 프로젝트의 `.oculpm/` 폴더와 로컬 SQLite 캐시에만 있고, 밖으로 나가는 것은 직접 부른 LLM API 호출과 새 버전 확인이 전부입니다.

## 🚀 v2.10 — Claude Code 를 앱 안에서 직접 구동

그동안 AI 패널은 LLM 프로바이더에 붙은 채팅일 뿐이었습니다 — 실제 코딩은 전부 터미널 안 CLI 에서 일어났고, 앱은 파일 감시·훅으로 그 흔적만 주웠습니다. 이제 사이드바에 새 화면 **Claude Code** 가 생겼습니다. 여기서 시키면 진짜 `claude` 가 앱 안에서 파일을 고치고, 도구를 쓰고, 승인을 구합니다(Agent Client Protocol). 기존 구독 로그인을 그대로 쓰고, 어댑터는 첫 실행에 자동 설치됩니다.

- **세션 탭 · 도구 카드** — 상단바가 대화 탭 줄이 됩니다. 파일 수정·명령 실행 같은 도구 호출이 접고 펼 수 있는 카드로 오고, 도구를 쓰기 전 승인 요청도 카드로 옵니다.
- **Effort · 권한 모드를 한 트랙에서** — 사고 강도와 권한 모드(수동 승인 · 편집 자동승인 · 계획 · 무제한)를 함께 고릅니다. 최상위 단계 **울트라코드**는 설정이 아니라 프롬프트 키워드입니다.
- **이미지 붙여넣기 · 모델 전환 구분선 · 위젯형 `/usage`** — 스크린샷을 그대로 붙여 넣고, 모델을 바꾸면 대화에 구분선이 남고, `/usage` 는 대화 흐름 대신 전용 계기판으로 뜹니다.
- **터미널 탈출구** — `/remote-control` 처럼 CLI 자신의 화면에만 사는 기능은 진짜 터미널 탭에서 `claude` 를 띄워 그대로 씁니다. 터미널 화면의 글자 크기도 이제 px 를 직접 입력해 맞춥니다.
- **업데이트해도 대화가 안 끊깁니다** — 재시작을 미루고, 다시 뜨면 하던 대화로 돌아갑니다.

## v2.9 — 프로젝트를 창과 탭으로

- **한 창에서 프로젝트 여러 개를 탭으로** — 크롬과 같습니다. 탭을 끌어 순서를 바꾸고, 창 밖으로 떼어내면 새 창이 됩니다. 프로젝트마다 화면·필터·사이드바 상태를 따로 기억하고, **터미널 세션은 프로젝트에 묶여 있어** 탭이 창을 옮겨 다녀도 끊기지 않습니다.
- **새 탭 = 시작 탭** — `⌘T` 를 누르면 프로젝트 목록이 뜨고, 하나를 고르면 **그 자리에서** 프로젝트 탭으로 바뀝니다. `⌘W` 는 창이 아니라 **탭**을 닫습니다(탭이 하나면 창이 닫힘). 창 닫기는 `⇧⌘W`, 새 창은 `⇧⌘N`, 탭 이동은 `⌃Tab` · `⌃⇧Tab` · `⌘⌥←→`.
- **시작 화면을 다시 짰습니다** — 3단 벤토를 걷어내고 **등록된 프로젝트 전부를 한 화면 격자**에 폅니다. 카드는 이름뿐 아니라 어디를 눌러도 열리고, **프로젝트마다 색 8종 · 아이콘 10종**을 골라 탭과 카드에서 형태로 구분됩니다(고르지 않으면 이름에서 자동).
- **상단바가 추적 중인 프로젝트 전부를 감지합니다** — 그동안 파일 감시가 탭 수명에 묶여 있어 **탭을 열지 않은 프로젝트는 일지를 남겨도 알아채지 못했습니다**. 함께 고친 것: 상단바가 테마를 따라가고, "앱 열기" 가 실제로 고른 프로젝트를 열고, 아이콘이 더 이상 돌지 않습니다.

## v2.8 — 영어 지원 · 스킬 샵 · 터미널 정리

- **영어를 지원합니다 (v2.8.5)** — 설정 → 모양에서 화면 언어를 고르면 12개 화면 전체가 영어로 바뀝니다. 화면 문구뿐 아니라 **오류 메시지**, AI 가 쓰는 일지·회고·플래너 항목, 새 프로젝트에 심기는 `AGENTS.md` 까지 함께 따라갑니다. **화면 언어와 AI 작성 언어는 따로** 고를 수 있고(화면은 영어, 일지는 한국어), 이미 기록된 문서는 다시 쓰지 않습니다. ⌘K 팔레트는 양쪽 언어로 모두 찾힙니다.
- **스킬 샵 (v2.8.0)** — 스킬 화면의 **샵 탭**이 프로젝트 스택을 감지(매니페스트 기반, LLM·네트워크 0)해 **검증된 제3자 스킬 25종**(전부 MIT · 커밋 고정 사본 · 원문 무수정)을 추천합니다. 검색·태그 필터·본문 미리보기 후 원클릭으로 `.claude/skills/` 에 설치되고, Claude Code 네이티브 기능이라 플러그인 없이도 동작합니다. 전 목록은 [oculpm.com/plugin](https://oculpm.com/plugin). 함께 들어간 **배달 게이트**는 "코드는 바뀌었는데 일지가 없는" 세션을 세션당 한 번 잡아 에이전트에게 기록을 시킵니다.
- **프로젝트 관리 화면 (v2.8.1)** — `⌘⇧M` 으로 등록된 프로젝트가 **평면 표**로 펼쳐집니다. 이름·경로 검색(한글 초성), 마지막 활동·기록 수·이름 정렬, 체크박스로 **여러 개 한 번에 제거**. 폴더의 `.oculpm`·`AGENTS.md` 삭제 여부는 확인 단계에서 따로 고릅니다(기본 꺼짐 — 워크스페이스에서만 빠집니다).
- **내장 터미널 한국어·붙여넣기 수정 (v2.8.2 · v2.8.3)** — 한글만 영문보다 크게 보이던 문제, 한글 입력기가 켜져 있을 때 영문·스페이스가 두 번 입력되던 문제, 그리고 붙여넣은 내용이 두 번 들어가며 **각 줄이 명령으로 실행될 수 있던** 문제를 고쳤습니다.
- **서체와 속도 (v2.8.4)** — 본문 서체를 **Pretendard** 로 바꾸고, 지정한 대로 그려지지 않던 굵기 96군데를 바로잡았습니다. 변경 diff 의 문법 색칠 데이터는 화면을 열 때만 불러오고(진입 직후 로드량 266KB → 125KB), 첫 코드 인덱싱은 조각 기록을 묶어 처리합니다.

## v2.6 – v2.7 — 첫 화면과 회고

- **메인 화면 벤토 콕핏** — 이어서 일할 프로젝트의 다음 할 일·최근 기록·14일 활동 추이·마지막 에이전트가 한 자리에. 오늘의 흐름이 전 프로젝트 일지를 시간순으로 모아줍니다. 아무 데서나 타이핑하면 검색(한글 초성 지원), `↓↑⏎` 이동·열기, `⌘O` 폴더 · `⌘N` 새 프로젝트 · `⌘E` 이름 변경 · `⌘⌫` 제거.
- **미기록 세션 신호** — 일지 없이 끝난 Claude Code 세션을 감지해 Today 에 카드로 알립니다(사후 기록 시 자동 해소). 상태줄 배지와 `/oculpm:inception` · `/oculpm:next` 커맨드 추가.
- **회고 생성 [Claude Code 로]** — API 키·과금 없이 터미널 세션이 회고를 써서 `.oculpm/retro/` 마크다운으로 남깁니다. 반복되는 태그는 **스킬 후보**로 승격 제안되고, `project_init` 로 앱 없이 새 프로젝트 추적을 시작합니다(사용자 확인 필수).

## v2.5 — Claude Code 플러그인, 그리고 계획이 구현을 끌고 갑니다

**앱 없이도 기록이 시작됩니다.** Claude Code 에서 두 줄이면 끝:

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

**플래너가 백미러에서 핸들이 됩니다**

- **▶실행 (디스패치)** — 플랜 항목을 누르면 항목 내용 + 연결된 일지 + 갱신 지시가 조립된 프롬프트가 터미널에 프리필되고, Enter 한 번으로 Claude Code 실세션이 그 항목을 잡습니다.
- **3단계 계획** — 항목 아래 하위 작업 중첩. 부모 상태는 하위 롤업으로 자동 계산되고, 진행 카운트는 리프 기준으로 일관됩니다.
- **project-inception 스킬** — 웹 리서치로 환경을 먼저 탐색하고, 그 근거가 실린 선택지로 사용자와 사양을 확정해 문제 정의 → 3단계 상세 계획 → `EVALS.md` 완료 정의 → 초기 `.claude/rules` 로 시드합니다. Greenfield 마법사와도 연결됩니다.

**에이전트 토큰 60% 다이어트** — 모든 추적 프로젝트에 상시 주입되던 규칙(AGENTS.md)이 v7 에서 ≈2,900→≈1,150 토큰으로. 준수를 담보하던 규칙은 전부 유지됩니다.

> 메뉴바 상주(v2.3) · Claude 직접 연동(v2.2) 등 이전 버전과 전체 변경 이력은 [CHANGELOG](CHANGELOG.md)에서.

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
- **터미널** — 앱 안 PTY 터미널. 에이전트를 여기서 돌리면 일지가 옆 화면에 쌓입니다. `/plugin`·`/mcp` 처럼 CLI 자체 대화형 화면에만 사는 기능을 쓰는 탈출구이기도 합니다.
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

## 설치

[최신 릴리스](https://github.com/bunhine0452/Ocul-PM/releases/latest)에서 `Ocul-PM_x.y.z_aarch64.dmg` 를 받아 `Applications` 로 드래그하면 끝입니다. macOS(Apple Silicon)용이고, 한 번 설치하면 이후 버전은 앱 안에서 자동으로 업데이트됩니다.

아직 Apple 공증 전이라 처음 열 때 "손상되었기 때문에 열 수 없습니다"가 뜰 수 있습니다. 실제 손상이 아니라 macOS 의 격리 표시 때문이니, 터미널에서 한 줄이면 됩니다:

```bash
xattr -dr com.apple.quarantine /Applications/Ocul-PM.app
```

첫 의미 검색 때 임베딩 모델(약 135MB)을 한 번 내려받습니다. 이후에는 오프라인으로 동작합니다.

앱 설치 없이 기록만 먼저 시작하려면 위의 **Claude Code 플러그인**으로도 됩니다 — 일지·플랜이 `.oculpm/` 마크다운으로 쌓이고, 앱은 나중에 설치해도 그 기록을 그대로 읽습니다.

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
