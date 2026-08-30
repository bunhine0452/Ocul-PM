---
schema_version: 1
type: refactor
slug: design-tokens-and-primitives
status: done
created_at: 2026-08-30T16:51:00+09:00
session_id: "manual-20260830-165100"
agent:
  id: claude-code
  version: claude-fable-5
language: ko
verified_by_user: false
difficulty: medium
files_touched:
  - path: src/styles/tokens.css
    op: update
  - path: src/styles/primitives.css
    op: update
  - path: src/styles/index.css
    op: update
  - path: src/App.css
    op: update
  - path: src/styles/screens.css
    op: update
  - path: src/styles/agent.css
    op: update
  - path: src/styles/shell.css
    op: update
  - path: src/styles/tabs.css
    op: update
  - path: src/styles/base.css
    op: update
  - path: src/features/code/code.css
    op: update
  - path: src/features/discussion/discussion.css
    op: update
  - path: src/features/docs/docs.css
    op: update
  - path: src/features/graph/graph.css
    op: update
  - path: src/features/onboarding/home.css
    op: update
  - path: src/features/projects/projects.css
    op: update
  - path: src/features/skills/skills.css
    op: update
  - path: src/features/tray/tray.css
    op: update
  - path: src/features/oculpm/EntryDetailView.tsx
    op: update
  - path: src/features/oculpm/JournalCardV2.tsx
    op: update
  - path: src/features/settings/tabs/DoctorSection.tsx
    op: update
  - path: src/features/today/HonestyAudit.tsx
    op: update
  - path: src/features/today/JournalMissingCard.tsx
    op: update
  - path: package.json
    op: update
  - path: scripts/check-no-hardcoded-korean.mjs
    op: update
  - path: src/__tests__/design_tokens.test.ts
    op: create
related:
  - .oculpm/journal/20260830/Chores/1511_chore_dead-config-keys-and-undefined-tokens.md
tags: [design-tokens, css, primitives, polish-round]
---

[x] 상태색 `--ok/--warn/--danger/--info`(+text·soft, 라이트·다크) · 글자 7단·층 8단·이징 토큰으로 원시값 564곳 치환 · 아이콘 버튼 7벌·칩 11벌을 `.iconbtn`/`.chip` 바탕으로 흡수 + 프리미티브 전역 · 프로젝트 색·Claude 코랄 단일 정의 · App.css 죽은 토큰·클래스 108줄 + EB Garamond 제거

## 배경

완성도 감사의 디자인 렌즈. 상태색이 토큰 없이 `var(--ok, #12a06b)` 처럼 fallback 으로 24곳을 떠돌았고(같은 뜻에 hex 가 셋), 글자 크기 542곳·z-index 51곳·이징 40곳이 원시값이었다. 아이콘 버튼은 화면마다 이름만 다른 일곱 벌(같은 그리드·같은 hover), 칩은 열한 벌이었고, `.btn/.kbd` 프리미티브는 셸 청크 안에만 있어 시작 탭·트레이·전역 컴포넌트(ErrorCard·⌘/ 치트시트)에선 스타일 없이 그려졌다. 프로젝트 8색 팔레트는 카드·선택기·탭 스트립 세 곳에 복사돼 있었고, App.css 엔 옛 textarea 편집기·글래스모피즘·체인지로그 카테고리 토큰이 소비처 없이 남아 있었다. `@fontsource/eb-garamond` 는 2026-08-12 에 CSS 에서 빠졌지만 의존성은 남아 있었다.

## 변경

- **tokens.css**: `--ok/--warn/--danger/--info` × (본색·`-text`·`-soft`) 라이트·다크, `--claude`, `--fs-1..7`(10~13px), `--z-sticky/strip/panel/dock/menu/popover/modal/top`, 프로젝트 팔레트 `[data-pc="…"] { --pc; --pc-soft }` ×8 (+다크) — 속성 선언만이라 파일 규칙 안. 화면·CSS 의 fallback 24곳 → `var(--ok)` 류, 리터럴(discussion·code·agent 코랄) 정리.
- **스케일 치환**: font-size 479곳 → `var(--fs-n)`, z-index 24곳(전역 층만; 컴포넌트 안 0~6 은 지역 겹침이라 그대로) → `var(--z-*)`, 이징 61곳(`ease-out`·`ease-in-out`·bare `ease`·옛 cubic-bezier 3종) → 토큰. 계산값은 같다 — 다음부터 한 곳에서 바뀐다.
- **primitives.css**: `.iconbtn` 이 `--iconbtn-size` 로 sm/md/lg(26/28/32), 셀렉터 목록에 옛 이름 7벌(`.pln-iconbtn .pm-iconbtn .gr-iconbtn .home-iconbtn .sk-iconbtn .side-collapse-btn .code-tool-btn`)을 넣어 바탕·hover·disabled·danger 를 한 곳에서 — 각 화면 파일엔 차이(테두리·둥글기·색)만 남고 TSX 는 그대로. `.chip` 에 `sm/outline/accent/ok/warn/danger/info` 수정자, 칩 11벌이 공통 바탕(inline-flex·nowrap·flex:none)을 나눠 갖는다. `App.css` 가 primitives 를 전역으로 들이고 `index.css` 에서 뺐다(base.css 는 여전히 셸 전용).
- **App.css −108줄**: `--cat-*`·`--motion-*`·`--accent-recent-change`·`.glassy-*`·`.code-editor-textarea`·`--editor-*`/`.editor-*` 삭제(`--radius-*` 는 shadcn 이 읽어 유지). `pnpm remove @fontsource/eb-garamond`.

## 검증

`pnpm typecheck` · `lint`(3종) · `vitest`(124 파일 · 1493 — `design_tokens` 15케이스: 토큰 존재·팔레트 단일·fallback 0·hex 리터럴 0·프리미티브 수정자·전역 import·죽은 토큰 부재) · `build`(진입 CSS 133KB, "핵심 선택자 8개" 검사 통과) exit 0. 실기기 육안: 라이트/다크·프리셋 5종에서 상태색·칩·아이콘 버튼 — 앱 꺼진 뒤 몰아서.

## 한계 / 후속

- 프리셋(solarized·nord·…)은 상태색을 덮지 않는다 — 라이트/다크 값이 그대로 얹힌다. 프리셋마다 조정이 필요하면 `[data-preset]` 블록에 넉 줄씩.
- 지속시간(`0.12s` 류 ~30곳)은 손대지 않았다 — `--dur-1(90ms)` 로 바꾸면 체감이 달라져 육안 확인 뒤에.
- 아이콘 버튼·칩은 **흡수**했지 이름을 바꾸진 않았다 — TSX 가 `.iconbtn.sm` 을 직접 쓰기 시작하면 옛 셀렉터를 목록에서 하나씩 뺀다.
