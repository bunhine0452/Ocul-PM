---
schema_version: 1
type: chore
slug: readme-landing-v2-refresh
status: done
difficulty: low
created_at: "2026-07-11T09:34:00+09:00"
session_id: "20260711-m01"
agent:
  id: claude-code
  version: "Fable 5"
language: ko
verified_by_user: false
files_touched:
  - path: README.md
    op: update
  - path: landing/index.html
    op: update
  - path: landing/landing.css
    op: update
  - path: landing/sitemap.xml
    op: update
related: []
tags: ["docs", "landing", "v2.0", "readme"]
---

[x] README·랜딩(oculpm.com) v2.0 내용 반영 — 둘 다 v1.0~1.7 시절 내용에 머물러 있던 것을 현행화

## 변경 요약

**README.md** — 전면 재작성. 이모지 섹션 헤더·기능 표 나열을 걷어내고 문단 중심으로.
현행화된 내용: 11개 화면(내비 순서 그대로), ⌘K/⌘1~0/⌘P, 에이전트 11종(코어 5 + 설정 토글 6),
git 백필·정직성 감사·자동 화해·회고 산출물(스탠드업/PR 본문/주간 보고)·코드 맵·FTS5,
`.oculpm/` 디렉토리 레이아웃, redaction. 로드맵에서 완료 항목(자동 업데이트) 제거.

**landing/index.html** — 메타 description/keywords(신규 에이전트·산출물·코드 맵 키워드),
OG 설명, JSON-LD(softwareVersion 2.0.0 + featureList 11항목), FAQ(에이전트 목록 갱신 + 산출물
문항 추가), nav 버전 폴백 v2.0.0, 히어로 서브카피("스탠드업·PR 본문·회고로 되돌려줍니다"),
히어로 프리뷰에 에이전트·모델 표기(Claude Code · Opus 4.8 등), 기능 벤토 7→11셀(회고·산출물,
코드 맵, 문제 해결, ⌘K 팔레트 신설 / 기존 셀 카피 현행화), 지원 에이전트 칩 스트립 신설,
스택 표(FTS5·코드 맵·redaction 행), 대상·CTA 카피 갱신.

**landing/landing.css** — 신규 미니 비주얼 스타일(.agents-row/.agent-chip, .mini-report,
.mini-steps, .mini-palette, .mini-graph, .mini-cap, .mini-plan .auto). 기존 팔레트·디자인 언어
유지(초록 토큰, 벤토 그리드 — 디자인 원칙 메모리 준수).

**landing/sitemap.xml** — lastmod 2026-07-11.

## 검증

- python html.parser 로 index.html 태그 짝 검사 + JSON-LD 2블록 json.loads 통과.
- 벤토 그리드 배치 확인: span3×2 + span2×9 = 3열 3행, 기존 브레이크포인트 규칙에 그대로 맞음.
- 앱 코드(src/, src-tauri/) 무변경 — 게이트(typecheck/test/lint/build) 영향 없음.

## 메모

- 커밋·배포는 사용자 결정 대기 (Vercel 은 push 시 자동 배포).
- 스크린샷/실기기 렌더 확인은 하지 않음 — 신규 CSS 는 기존 컴포넌트 패턴의 변형이라 위험 낮음.
