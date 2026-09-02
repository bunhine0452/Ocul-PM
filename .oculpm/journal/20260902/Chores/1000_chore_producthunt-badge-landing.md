---
schema_version: 1
type: chore
slug: producthunt-badge-landing
status: done
difficulty: verylow
created_at: 2026-09-02T10:00:00+09:00
session_id: manual-20260902-095001
agent:
  id: claude-code
  version: Opus 5 (1M context)
language: ko
verified_by_user: false
files_touched:
  - path: landing/index.html
    op: update
  - path: landing/en/index.html
    op: update
  - path: landing/landing.css
    op: update
  - path: README.md
    op: update
  - path: README.en.md
    op: update
related:
  - 20260902/Chores/0950_chore_producthunt-badge-readme.md
tags: [landing, producthunt, badge]
---

[x] 랜딩 ko/en 히어로에 Product Hunt 배지 · README 는 테마 대응으로 승격

README 에 붙인 Product Hunt 배지를 랜딩에도 얹었다. 자리는 히어로의 마지막 줄
(`hero-fine` — "플러그인 두 줄로도 시작할 수 있습니다") 바로 아래, 스크린샷
(`hero-shot`) 위다. CTA 두 개 아래의 잔가지 자리라 다운로드 버튼의 시선을 뺏지 않으면서
스크롤 없이 보인다.

랜딩은 단일 다크 무대(`--stage: #0a0f0c`)라 배지도 `theme=dark` 변형을 쓴다. 임베드
파라미터를 실제로 확인했다 — `theme=light`/`dark`/`neutral` 모두 200 이고, dark 는
바탕 `#221D21` + 밝은 글자로 light(`#FF6154`)와 확실히 다른 파일이다. 확인하고 나니
README 도 light 고정으로 둘 이유가 없어져, `<picture>` + `prefers-color-scheme: dark`
소스로 승격했다(GitHub 이 지원하는 다크모드 이미지 스왑). 어제 README 커밋에서
"확인 안 한 파라미터를 쓰지 않는다"고 미뤄 둔 항목의 해소다.

CSS 는 `.hero-ph` 하나만 추가했다 — 250×54 고정, 평소 `opacity: .82`, hover 시 1.0.
무대 위에서 주황 로고가 튀지 않게 한 톤 죽인 것.

## 검증

`python3 -m http.server` 로 `landing/` 을 띄우고 크롬에서 ko(`/index.html`)·en
(`/en/index.html`) 두 히어로를 육안 확인 — 배지가 다크 바탕에 맞게 렌더되고 중앙
정렬·간격이 앞뒤 요소와 어긋나지 않는다. 랜딩 관련 vitest 3종
(`landing_pages` · `landing_themes` · `honesty_audit`) 54개 통과.

## 메모

랜딩 배포(`cd landing && vercel --prod`)는 하지 않았다 — git 연동이 없어 수동이고,
prod 배포는 사용자 승인 후.
