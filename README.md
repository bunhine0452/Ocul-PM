<div align="center">

<img src="https://raw.githubusercontent.com/bunhine0452/Ocul-PM/main/landing/og.png" alt="Ocul-PM" width="440" />

<h1>Ocul-PM</h1>

<p><b>AI 코딩 에이전트가 코드를 쓰는 동안, 그 기록은 Ocul-PM 이 남깁니다.</b><br/>
Claude Code · Codex · Cursor · Gemini CLI 와 함께 쓰는 로컬-우선 프로젝트 매니저</p>

[![Latest release](https://badgen.net/github/tag/bunhine0452/Ocul-PM?icon=github&label=download&color=12a06b)](https://github.com/bunhine0452/Ocul-PM/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/bunhine0452/Ocul-PM/total?color=12a06b&label=downloads)](https://github.com/bunhine0452/Ocul-PM/releases)
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

## 🚀 v2.3.0 — 메뉴바 상주

Ocul-PM 이 macOS 상단바에 삽니다. **RunCat × Docker Desktop** 컨셉:

- **아이콘이 상태 표시기** — 에이전트 세션이 활성이면 브랜드 로고의 동심원 호가 **회전**합니다 (훅 기반 실시간 신호, 유휴 시 전력 0). 감사 경고가 있으면 주의 점이 붙습니다.
- **클릭 한 번에 5초 브리핑** — 활성 세션(누가·몇 분째) → 오늘 일지·변경 파일 → 최근 일지 → 활성 플랜("다음: …" 포함). **일지 본문도, 플랜 체크리스트도 팝오버 안에서 바로 읽습니다.** 새 일지가 생기면 목록이 실시간 갱신되고, 스탠드업 복사도 그 자리에서.
- **옵션으로 알림·상주** — 새 일지 macOS 알림, 창 닫기(⌘W)=메뉴바로 최소화, Dock 숨김. 기본값은 전부 기존 동작 그대로.

> v2.2.0 의 Claude 직접 연동(MCP 서버·훅·규칙 플라이휠)은 [CHANGELOG](CHANGELOG.md)에서.

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
- **터미널** — 앱 안 PTY 터미널. 에이전트를 여기서 돌리면 일지가 옆 화면에 쌓입니다.
- **AI 패널** — 코드 검색·일지·플래너·git 맥락을 아는 채팅. Anthropic · OpenAI · Gemini · OpenRouter 를 지원하고, 호출이 실패하면 폴백 체인으로 다음 모델을 시도합니다.
- **스킬** — Claude Code 스킬(`.claude/skills/`)을 프로젝트별로 관리합니다. GUI 에서 만들고 편집하고, 프로젝트 ↔ 전역(`~/.claude/skills`)으로 복사합니다. 끄면 지워지는 게 아니라 `.disabled/` 로 옮겨 로드에서만 빠집니다.

⌘1~⌘0 으로 화면을 오가고, ⌘K 팔레트에서 일지·계획·토의·문서를 제목으로 검색해 바로 엽니다. ⌘P 는 프로젝트 전환입니다.

## 지원 에이전트

`AGENTS.md` 를 읽을 수 있는 에이전트라면 무엇이든 동작합니다.

- 별도 설정 없이: **Claude Code · Codex CLI · Gemini CLI · Antigravity · pi**
- 설정 → Agents 에서 규칙 파일을 켜면: **Cursor · Windsurf · GitHub Copilot · aider · Cline · Zed**
- **Claude Code · Claude Desktop** 은 여기서 한 단계 더 — 훅(정확한 세션 감지)과 MCP 도구(구조화 기록·플랜 질의)로 직접 연동됩니다 (v2.2.0)

git 백필 시에는 커밋 서명으로 에이전트를 구분합니다.

## 설치

[최신 릴리스](https://github.com/bunhine0452/Ocul-PM/releases/latest)에서 `Ocul-PM_x.y.z_aarch64.dmg` 를 받아 `Applications` 로 드래그하면 끝입니다. macOS(Apple Silicon)용이고, 한 번 설치하면 이후 버전은 앱 안에서 자동으로 업데이트됩니다.

아직 Apple 공증 전이라 처음 열 때 "손상되었기 때문에 열 수 없습니다"가 뜰 수 있습니다. 실제 손상이 아니라 macOS 의 격리 표시 때문이니, 터미널에서 한 줄이면 됩니다:

```bash
xattr -dr com.apple.quarantine /Applications/Ocul-PM.app
```

첫 의미 검색 때 임베딩 모델(약 135MB)을 한 번 내려받습니다. 이후에는 오프라인으로 동작합니다.

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

## 라이선스

[MIT](LICENSE) © 2026 Kim Hyunbin
