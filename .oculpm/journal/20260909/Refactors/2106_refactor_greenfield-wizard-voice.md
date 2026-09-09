---
schema_version: 1
type: refactor
slug: "greenfield-wizard-voice"
status: done
difficulty: low
created_at: "2026-09-09T21:06:47+09:00"
session_id: "20260909-001"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
  session: "c997b348-9e50-41e9-845f-4681b1fda66a"
language: "ko"
verified_by_user: false
files_touched: []
related: []
tags:
  - "i18n"
  - "onboarding"
  - "design"
  - "mcp-tool"
---
[x] 한 마법사 안에서 제목 모양이 갈리고, 없는 화면 이름을 부르고 있었다

## 동기

`gf.*`(새 프로젝트 마법사) 54개가 사전 전체의 이상치를 독차지하고 있었다. 같은 온보딩 여정의 `welcome.*`(첫 실행 마법사)와 나란히 놓으면 다른 손이 쓴 게 뚜렷하다.

```
welcome.*   "반갑습니다." · "눈에 편한 쪽으로." · "첫 프로젝트를 불러오세요."
gf.*        "어떤 앱을 만들까요?" · "만들고 싶은 앱이나 프로젝트를 자유롭게
             설명해주세요." · "AI 가 생성한 초기 목표를 확인하고 수정할 수 있습니다."
```

**가장 큰 결함은 감사가 짚지 않은 것이었다** — 다섯 스텝 제목의 모양이 한 마법사 안에서 갈려 있었다.

```
step1 "어떤 앱을 만들까요?"   ← 물음표 문장
step2 "누가 사용하나요?"      ← 물음표 문장
step3 "기술 스택 선택"        ← 명사구
step4 "프로젝트 위치"         ← 명사구
step5 "초기 목표 확인"        ← 명사구
```

## 변경 요약

**제목 다섯을 `welcome.step.*` 규격(짧은 명사구)으로** — 아이디어 · 사용자 · 기술 스택 · 위치와 이름 · 첫 목표. 설명은 `welcome.*.sub` 처럼 짧고 구체적으로 옮겼다.

```
만들고 싶은 앱이나 프로젝트를 자유롭게 설명해주세요.
  → 무엇을 만들 건지 한두 줄로 적으세요.

AI 가 생성한 초기 목표를 확인하고 수정할 수 있습니다.
  → AI 가 잡은 첫 목표입니다. 마음에 안 들면 고치세요.
```

사전 유일의 과장어("자유롭게")가 여기서 사라졌다.

**없는 화면 이름** — "Today 탭"·"Today 화면" 이라 부르고 있었는데 정식 명칭은 `nav.today` = 「오늘 현황」이다. `gf.trackHint2Suffix` 둘, `home.how3Body`, `err.code.not_initialized` 까지 넷을 고쳤다.

**미번역 도메인어** — "narrative" 2건(`gf.trackHint1` · `op.git.forbiddenHint`) → "작업 서술".

## 남긴 것

`GreenfieldWizard.tsx:753` 이 `.btn` 프리미티브 대신 raw Tailwind 체인을 쓰는 것은 손대지 않았다 — 온보딩 흐름의 시각적 변화라 눈으로 확인할 수 없는 상태에서 바꾸지 않는다. `{#unify-toolbar-vocab}` 에 속한다.

## 검증

게이트 둘 추가(총 21개) — 미번역 "narrative" 금지 · 값 안의 영문 "Today" 금지.

영어 렌더 테스트가 옛 제목("What are we building?")을 찾고 있어 새 제목으로 옮겼다.

`pnpm typecheck` · `pnpm lint`(6게이트) · `pnpm test`(195 파일 2,543개) · `pnpm build` 각 exit 0.