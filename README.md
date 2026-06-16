<div align="center">

<img src="https://raw.githubusercontent.com/bunhine0452/Ocul-PM/main/landing/og.png" alt="Ocul-PM — 코딩 에이전트용 AI 프로젝트 매니저" width="460" />

<h1>Ocul-PM</h1>

<p><b>코딩 에이전트가 코드를 쓰는 동안, 당신은 기록·관리·검증만 합니다.</b><br/>
Local-first <b>AI project manager (AI PM)</b> for AI coding agents — Claude Code · Cursor · Gemini CLI.</p>

[![Latest release](https://img.shields.io/github/v/release/bunhine0452/Ocul-PM?color=12a06b&label=%E2%AC%87%20download&style=for-the-badge&cacheSeconds=3600)](https://github.com/bunhine0452/Ocul-PM/releases/latest)
[![Website](https://img.shields.io/badge/oculpm.com-12a06b?style=for-the-badge&logo=vercel&logoColor=white)](https://oculpm.com)

[![Downloads](https://img.shields.io/github/downloads/bunhine0452/Ocul-PM/total?color=12a06b&cacheSeconds=3600)](https://github.com/bunhine0452/Ocul-PM/releases)
[![Platform](https://img.shields.io/badge/macOS-Apple%20Silicon-111?logo=apple)](https://github.com/bunhine0452/Ocul-PM/releases/latest)
[![Built with Tauri 2](https://img.shields.io/badge/Tauri-2-24C8A0?logo=tauri&logoColor=white)](https://tauri.app)
[![Rust](https://img.shields.io/badge/Rust-000?logo=rust&logoColor=white)](https://www.rust-lang.org)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Stars](https://badgen.net/github/stars/bunhine0452/Ocul-PM?icon=github&color=12a06b&label=stars)](https://github.com/bunhine0452/Ocul-PM/stargazers)

**[🌐 oculpm.com](https://oculpm.com)** · **[⬇️ 다운로드](https://github.com/bunhine0452/Ocul-PM/releases/latest)** · **[📋 변경 이력](CHANGELOG.md)** · **[🐛 이슈](https://github.com/bunhine0452/Ocul-PM/issues)**

</div>

---

외부 AI 코딩 에이전트는 빠르지만, 며칠이 지나면 **무엇이 왜 바뀌었는지** 추적이 끊깁니다.
어제 Claude 에게 시킨 리팩토링이 어떤 파일을 건드렸는지, Cursor 가 "고쳤다"는 코드가 실제로 도는지 — 매번 다시 확인해야 하죠.

**Ocul-PM 은 이 간극을 메웁니다.** 에이전트가 코드를 쓰고, Ocul-PM 이 **그들이 한 일을 사람이 읽을 수 있는 기록으로** 남깁니다. 변경을 로컬 diff 로 즉시 검증하고, 오늘 무엇이 바뀌었는지 한눈에 보여줍니다. **클라우드도, 계정도, 텔레메트리도 없습니다.**

> AI 에게 빼앗긴 *"내가 이걸 왜 만들었더라"* 의 답을, 다시 손에 쥐는 도구.

<br/>

## ✨ 핵심 기능

| | |
|---|---|
| 📓 **자동 작업 일지** | 에이전트가 작업을 끝낼 때마다 규칙(`AGENTS.md`)에 따라 markdown 한 개를 남깁니다. 버그·기능·리팩토링·에러·잡일 — **5종 트리거 자동 분류.** 플랫 파일 SSOT, DB lock-in 없음, git 친화. |
| 📊 **Today 일일 브리프** | 오늘 무엇이 바뀌고, 어제 무엇을 끝냈고, 다음은 무엇인지 — **워크데이 경계**로 정리. 새 작업이 기록되면 실시간 갱신. |
| 🔍 **변경 diff (로컬)** | 에이전트가 "수정했다"는 모든 파일을 **네트워크 없이** 즉시 비교. 할루시네이션 1차 방어선. 일지별 diff 를 그 시점 그대로 영구 보관. |
| 🧭 **시맨틱 코드 검색** | 의미(임베딩) · 심볼(AST) · 정확(텍스트) **3 모드.** `tree-sitter` + 로컬 임베딩 — **임베딩이 외부로 나가지 않습니다.** |
| ⌨️ **내장 터미널** | `portable-pty` + `xterm.js` 풀스크린 터미널. 창 전환 없이 같은 앱에서 에이전트를 돌리며 일지가 쌓이는 걸 옆에서 봅니다. |
| ✨ **멀티-LLM AI 패널** | Anthropic · OpenAI · Gemini 를 한 인터페이스로. API 키는 **OS 키체인에만** 저장. |
| 🧩 **통합 Planner** | goal → 서브태스크 → journal entry 3단 위계로, AI 의 분 단위 작업을 사람의 주 단위 목표에 묶습니다. |

<br/>

## ⬇️ 다운로드 / 설치

**[→ 최신 릴리스에서 받기](https://github.com/bunhine0452/Ocul-PM/releases/latest)** — macOS (Apple Silicon)

1. `Ocul-PM_x.y.z_aarch64.dmg` 를 받아 열고, **Ocul-PM** 을 `Applications` 로 드래그합니다.
2. 처음 열 때 **"손상되었기 때문에 열 수 없습니다"** 가 뜨면 — 공증(notarization) 전 빌드라 macOS 가 격리 표시를 붙인 것입니다(실제 손상 아님). 터미널에 한 줄:

   ```bash
   xattr -dr com.apple.quarantine /Applications/Ocul-PM.app
   ```

> 🔄 한 번 설치하면 다음 버전부터는 **앱 안에서 자동 업데이트**됩니다.
> 첫 의미 검색/인덱싱 때 임베딩 모델(~135MB)을 1회 자동으로 내려받습니다(이후 오프라인).

<br/>

## 🔭 이렇게 동작해요

```
1. 프로젝트 폴더 추가        →  Ocul-PM 이 에이전트용 규칙(AGENTS.md)을 심습니다
2. 평소처럼 에이전트로 코딩   →  규칙에 따라 에이전트가 작업 일지를 남깁니다
3. 자동으로 기록·정리        →  일지·변경 diff·통계가 Today 화면에 실시간으로 모입니다
```

<br/>

## 🧱 기술 스택

**네이티브 데스크톱 앱입니다. Electron 이 아닙니다.**

| 계층 | 기술 |
|---|---|
| 셸 | [Tauri 2](https://tauri.app) — Rust 백엔드 + 시스템 웹뷰 |
| 백엔드 | Rust 2021 · `tokio` · `rusqlite` · `sqlite-vec` |
| 코드 분석 | `tree-sitter` (Rust/TS/JS/Py/Go) · `fastembed` (로컬 임베딩) · `blake3` |
| 터미널 / 보안 | `portable-pty` · `xterm.js` · `keyring` (네이티브 키체인) · `rustls` |
| 프론트엔드 | React 19 · TypeScript 5.8 · Vite 7 · Tailwind 4 |

전체 데이터는 프로젝트의 **`.oculpm/` 디렉토리 + 로컬 SQLite** 에 머뭅니다. 외부로 나가는 건 — 당신이 직접 호출한 LLM API 와 새 버전 확인, 그것뿐입니다.

<br/>

## 🔒 왜 로컬-우선인가

- **소유권** — 일지는 markdown 파일. 앱이 망해도 데이터는 그대로. `git clone` 으로 옮기면 그대로 동작합니다.
- **개인 정보** — 코드·임베딩·작업 기록 어느 것도 우리 서버로 가지 않습니다. **우리 서버가 없기 때문입니다.**
- **속도** — 콜드 스타트 1.5초 미만. 검색은 디스크 I/O 가 한계.
- **오프라인** — LLM 호출을 빼면 전부 오프라인.

<br/>

## 🗺️ 로드맵

- [x] macOS (Apple Silicon) 빌드 + 인앱 자동 업데이트
- [ ] macOS (Intel) · **Windows** 빌드
- [ ] 팀 클라우드 동기화 (옵트인)
- [ ] Apple 공증(notarization)

<br/>

## 🛠️ 소스에서 빌드

```bash
git clone https://github.com/bunhine0452/Ocul-PM
cd Ocul-PM
pnpm install
pnpm tauri dev      # 개발 실행
pnpm tauri build    # 배포 번들 (.dmg / .app)
```

요구사항: Node 18+ · pnpm · Rust (stable) · (macOS) Xcode Command Line Tools.

<br/>

## ⭐ 응원하기

이 도구가 마음에 든다면 **[Star](https://github.com/bunhine0452/Ocul-PM/stargazers) 한 번**이 큰 힘이 됩니다.
버그·아이디어는 [이슈](https://github.com/bunhine0452/Ocul-PM/issues)로, 개선은 PR 로 언제든 환영합니다.

## 📄 라이선스

[MIT](LICENSE) © 2026 Kim Hyunbin
