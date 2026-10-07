---
schema_version: 1
type: feature
slug: "compact-chrome-headers"
status: done
difficulty: medium
created_at: "2026-10-07T20:41:47+09:00"
session_id: "20261007-004"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "fdeb6d9e-9327-4e65-8f8a-4524621720ff"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/styles/tokens.css"
    op: update
  - path: "src/styles/shell.css"
    op: update
  - path: "src/styles/primitives.css"
    op: update
  - path: "src/components/Toolbar.tsx"
    op: update
  - path: "src/features/settings/settings.css"
    op: update
  - path: "src/features/onboarding/home.css"
    op: update
  - path: "src/features/discussion/discussion.css"
    op: update
related: []
tags:
  - "design"
  - "ui-v2"
  - "design-tokens"
  - "mcp-tool"
---
[x] 화면 머리를 크롬 크기로 — 툴바 52→44·제목 17→14·시트 모서리 20→12

## 추가 기능

사용자 판정: "모든 창의 이런 부분(편집기 화면의 머리 — 「편집기」 제목과 파일 경로)이 너무 커서 UI 가 전문적으로 보이지 않는다. 깔끔하고 전문적인 UI 를 공부하고 바꿔 달라."

조사한 기준: macOS 통합 툴바 일반 ~52pt·컴팩트 ~38pt, 창 제목·본문 13pt, 컨트롤 28pt(HIG + 실측 가이드) · VS Code 탭 바 35px·행 22px · Linear 라벨 13px/500, 촘촘한 메타 12~15px, 판·카드 8~12px. 결론 — 크롬은 본문(13px) 한 단 위의 **이름표**이고, 크게 서는 것은 화면 안의 문서(플랜·일지 제목)다. 9/9 {#hierarchy-by-weight-only} 가 툴바 제목을 15→17 로 올린 근거(위계를 무게 혼자 진다)는 본문의 것이었다.

- 툴바(16화면 공통): `--toolbar-h` 52→44 — 툴바 컨트롤은 30px 기본 단이라 위아래 7px. 좌우 22→16, 제목 17→14 semibold. 디자인 게이트가 검색칸·버튼 높이를 정의 자리 두 단으로만 허용하므로 컨트롤은 건드리지 않았다(40px 안은 위아래 5px 이라 답답했다 — 시제품 비교).
- 시트 모서리 20→12, 둥글기 램프 위쪽 두 단 l 14→12 · xl 20→14. 시트만 10 으로 줄이면 안의 카드(14)가 바깥보다 둥근 뒤집힘이 생겼다. 아래 단(s 컨트롤·m 메뉴 109곳)은 이미 그 자리라 그대로.
- 같은 결의 이름표: 사이드바 프로젝트 이름 17 bold → 15 semibold, 설정 섹션 제목 20→17(툴바 「설정」 아래 둘째 머리가 첫째보다 컸다), 시작 탭 「이어서 일하기」 이름 26→20.

## 동작 흐름

설치본이 돌고 있어 dev 빌드 없이 확인했다: 영어 순회 테스트를 복사해 한국어로 14화면 DOM 을 덤프 → `pnpm build` 산출 CSS 로 감싼 래퍼 → 로컬 http.server → **headless Chrome `--screenshot`**(브라우저 확장 없이)으로 1360×860 을 찍었다. 덮어쓰기 `<style>` 로 40px/44px 두 안을 먼저 찍어 고른 뒤 소스를 고쳤다.

## 검증

- 전후 스크린샷: 14화면 + 시작 탭 + 설정, 라이트·다크.
- `pnpm typecheck` · `pnpm test` 3270 · `pnpm lint` 7종(디자인 게이트·래칫) · `pnpm build` 통과. PR #71.
- 실기기 미확인 — 다음 릴리스 설치본에서 (`compact-chrome` {#eyes-compact-chrome}).