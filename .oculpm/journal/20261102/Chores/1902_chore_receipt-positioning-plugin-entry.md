---
schema_version: 1
type: chore
slug: "receipt-positioning-plugin-entry"
status: done
difficulty: medium
created_at: "2026-11-02T19:02:56+09:00"
session_id: "20261102-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "f482aad9-ea44-4824-af3f-378db8a5a057"
language: "ko"
verified_by_user: false
files_touched:
  - path: "landing/index.html"
    op: update
  - path: "landing/en/index.html"
    op: update
  - path: "landing/home.css"
    op: update
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
  - path: "landing/banner.png"
    op: update
  - path: "landing/banner-en.png"
    op: update
  - path: "landing/og.png"
    op: update
  - path: "landing/og-en.png"
    op: update
  - path: "landing/social-preview.png"
    op: update
  - path: "scripts/landing-images/banner-ko.html"
    op: update
  - path: "scripts/landing-images/banner-en.html"
    op: update
  - path: "scripts/landing-images/og-ko.html"
    op: update
  - path: "scripts/landing-images/og-en.html"
    op: update
  - path: "scripts/landing-images/social.html"
    op: update
  - path: ".impeccable/surfaces/landing-index-html.md"
    op: update
  - path: "DESIGN.md"
    op: update
related: []
tags:
  - "랜딩"
  - "landing"
  - "readme"
  - "positioning"
  - "mcp-tool"
---
[x] 랜딩: 첫 문장을 영수증으로, 입구는 플러그인

## 무엇을 했나
외부 평가 뒤 사용자가 고른 결정 둘(계획 `direction-20261102` 의 `#position` · `#entry-plugin`)을 바깥 면에 옮겼다.
- **첫 문장**: 「AI와 어제 어디까지 작업했는지, 오늘 다시 설명하지 마세요」(claude-mem 의 「기억」 자리)를 「「다 됐습니다」 대신, 영수증을 받으세요.」 / 「Not "all done" — a receipt.」로 바꿨다. 사용자가 세 안 중 골랐다.
  - 바꾼 곳: 랜딩 ko/en 의 title · meta description · og · twitter · JSON-LD description · h1 · lede, README ko/en 의 머리 h3 · 소개 문단 · 배너 alt.
- **입구**: 히어로와 마지막 칸의 주 동작을 플러그인 두 줄 복사(`.cmd.is-primary`: 초록 테 · 초록 「복사」 표)로 바꿨다. 내려받기는 보조 버튼으로, 윗줄 「내려받기」도 보조로 내렸다. 한 화면에 초록 채움은 하나라는 규칙 그대로다.
  - README 소개 바로 아래에 플러그인 두 줄 블록과 「화면으로 보고 싶으면 앱」 한 줄을 넣었다.
- **이미지**: `scripts/landing-images/*.html` 원본의 헤드라인을 고쳐 다시 찍었다. 배너 ko/en 2400×750, og ko/en 1200×630, social 1280×640.
- **설계 기록**: 랜딩 surface brief 의 Action · FIRST VIEWPORT, DESIGN.md 의 Primary · Command copy 를 새 주 동작에 맞췄다.

## 검증
- 로컬 정적 서버 + CDP 로 랜딩 ko(1440) · en(1440) · ko 휴대폰(390)을 찍었다.
  - 가로 넘침 0, 오류 0. 히어로 CTA 순서는 `cmd two is-primary` → `btn` 이다.
  - JSON-LD 두 블록 모두 `json.loads` 를 통과했다.
- 배너 · og 이미지를 눈으로 확인했다(크기 2400×750 · 1200×630).
- `pnpm test`: 1000 passed. `pnpm lint` 0.
- 남은 것: GitHub 저장소 설정의 소셜 미리보기 이미지(social-preview.png)는 손으로 올려야 한다. 바깥 문구의 「판정」 같은 내부 용어 걷기(`#jargon`)는 머리말만 했다.