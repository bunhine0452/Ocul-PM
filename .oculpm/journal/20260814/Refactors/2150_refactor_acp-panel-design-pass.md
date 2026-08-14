---
schema_version: 1
type: refactor
slug: "acp-panel-design-pass"
status: done
difficulty: medium
created_at: "2026-08-14T21:50:42+09:00"
session_id: "mcp-20260814-215042"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/styles/agent.css"
    op: create
  - path: "src/styles/index.css"
    op: update
  - path: "src/features/chat/AcpConversation.tsx"
    op: update
  - path: "src/features/chat/AiPanelScreenV2.tsx"
    op: update
  - path: "src/features/chat/useDismiss.ts"
    op: create
  - path: "src-tauri/src/acp/session.rs"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/lib/bindings.ts"
    op: update
related: []
tags:
  - "acp"
  - "design"
  - "css"
  - "a11y"
  - "refactor"
  - "mcp-tool"
---
[x] 에이전트 화면 디자인 패스 — 인라인 스타일·네이티브 위젯을 앱 어휘로 교체

## 동기

사용자 지적: "디자인이 너무 아마추어 같다". 실제로 그랬다 — 기능을 빠르게 붙이느라 인라인 `style={{}}`, 임시 tailwind 유틸(`text-[11px]`), 네이티브 `<select>`, 텍스트 글리프(`●○◆◇`), `"name ✕"` 문자열 칩을 썼다. 앱의 나머지는 tokens/primitives/screens 로 짜인 성숙한 시스템인데 이 화면만 혼자 다른 물성을 갖고 있었다.

**새 미감을 발명하지 않았다.** 앱은 이미 따뜻한 종이 팔레트 + 초록 accent 라는 관점을 갖고 있고, 에이전트 화면이라고 다른 물성을 가질 이유가 없다. 프로덕션급은 여기서 "그 언어로 정확히 짜는 것"이다.

## 변경 요약

`src/styles/agent.css` 신설(screens.css 는 병렬 작업이 물려 있어 건드리지 않음). 토큰만 쓴다 — 새 색을 만들지 않았고, 사용한 커스텀 프로퍼티 22개가 전부 tokens.css 에 실재함을 확인했다(다크·프리셋에서 자동으로 따라간다).

- **행적(trace)** — 도구 호출은 채팅 말풍선이 아니라 **산문에 종속된 로그**로 그린다: 왼쪽 헤어라인 한 줄로 묶고, 작은 글자·흐린 색으로 눌렀다. 종류별 lucide 아이콘, 진행 중은 기존 `ai-pulse`, 실패는 `--t-bug`.
- **경로 생략** — 경로는 앞이 아니라 **끝(파일명)** 이 살아남아야 하므로 `direction: rtl` + `text-align: left`. 다만 여러 경로를 `·` 로 이으면 구분자가 반대편으로 튀어서, 하나만 보여 주고 나머지는 `+N` 으로 센다.
- **승인 카드** — 에이전트가 멈춰서 기다리는 유일한 순간이라 화면에서 가장 무거운 물체로. accent 링 + `--shadow-raise` + 스프링 진입 애니메이션. **어느 파일인지도 표시**하도록 백엔드 `Permission` 이벤트에 `locations` 를 추가했다("무엇을 허용하는가"의 절반은 경로다).
- **설정 노브** — 네이티브 `<select>` 를 앱의 팝오버 어휘(`.model-trigger`/`.model-option`)로 교체. OS 위젯은 이 화면에서 혼자 다른 물성을 갖는다.
- **모드 전환** — 버튼 두 개 → 진짜 세그먼트 컨트롤. 모드 전환은 "둘 중 하나"이지 "두 개의 액션"이 아니다.
- **신원 줄** — 컴포저 바닥의 raw npm 패키지명(`@agentclientprotocol/claude-agent-acp 0.67.0`)을 라이브 점 + 에이전트 이름 + 사용량으로 교체. 사용자가 알아야 하는 건 패키지가 아니라 누가 살아서 듣고 있는가다.
- **빈 상태** — 텅 빈 화면 대신 기존 `.ai-hero`/`.ai-suggest` 로 준비 상태 + 시작 제안 3개.
- **`@` 멘션** — 방향키·Enter·Tab·Escape 키보드 조작 추가. 목록이 떠 있는데 Enter 로 전송돼 버리면 고르려던 파일 대신 반쯤 쓴 문장이 날아간다.
- **DRY** — 팝오버 dismiss 로직이 AI 패널과 중복되어 `useDismiss.ts` 로 뺐다(AiPanelScreenV2 에 두면 AcpConversation 이 임포트하며 순환이 된다).

## 검증

게이트: typecheck 0 · 프런트 756건 · lint 0 · build 0 · 백엔드 569 유닛. 토큰 실재 여부는 스크립트로 전수 확인.

**픽셀은 직접 보지 못했다** — 구조·토큰·접근성 속성까지만 확인했고 실제 렌더는 사용자 확인이 필요하다.