---
schema_version: 1
type: feature
slug: "landing-stage-redesign-and-keynote"
status: done
difficulty: medium
created_at: "2026-08-16T04:02:01+09:00"
session_id: "mcp-20260816-040201"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "landing/index.html"
    op: update
  - path: "landing/landing.css"
    op: update
  - path: "landing/keynote.html"
    op: create
  - path: "landing/sitemap.xml"
    op: update
  - path: "landing/shots/s2.jpg"
    op: create
related: []
tags:
  - "landing"
  - "design"
  - "keynote"
  - "promo"
  - "mcp-tool"
---
[x] 랜딩 전면 재설계 — 무대 디자인 · 실기기 캡처 · /keynote 정식 페이지

## 추가 기능

사용자 요청: "키노트도 랜딩에 올리고, 랜딩을 레퍼런스 토대로 수준급으로 갈아엎어라." 키노트의 무대 언어(초록-검정 무대 · 종이빛 활자 · 동심원 링 · 앱 초록 단일 악센트)를 사이트 문법으로 확장해 index 를 통째로 재작성했다 (79KB → 27KB). CSS 목업을 전부 걷어내고 **v2.11.0 실기기 캡처 7장**이 제품을 말한다.

- **index**: 히어로(diff 카드+턴 영수증 실샷) → 문제 제기(3,000 vs 0) → 3막(기록장·검증대·콘솔, 텍스트/샷 교차) → 벤토 그리드(6칸 c-span2 규격 유지) → 키노트 배너 → 변경 이력(상위 4 + 접힘 14) → 로컬-우선 선언 → FAQ → CTA.
- **/keynote 신설**: "에이전트 시대의 기억" — 잡스 문법 7슬라이드 + 실기기 캡처 + SNS 카피 킷(복사 버튼). 클로즈는 ₩0 을 버리고 "시작하는 데 필요한 것은 — **없습니다.**" (one-more-thing 의 없음×3 콜백). 사용자가 다시 찍어 준 diff·⌘J 스크린샷으로 교체. 아티팩트 판도 동일 내용으로 재발행.

## 동작 흐름

빌드는 파이썬 조립: 기존 head(메타·OG·JSON-LD 2종) 바이트 보존 → 변경 이력 li 18건을 구판에서 추출·이식 → **FAQ 아코디언은 JSON-LD FAQPage 에서 생성**해 화면과 구조화 데이터가 어긋날 수 없다. 릴리스 계약(RELEASE.md §4)의 버전 5면(softwareVersion · ap-new · 변경사항 li · "vX.Y.Z 받기" · CTA eyebrow)과 data-version 동기 스크립트·Vercel analytics 유지. cleanUrls 에 맞춰 내부 링크 /keynote·/plugin 통일, sitemap 갱신. HTML 파서로 태그 짝 검증 후 `vercel deploy --prod` 2회(링크 정리 포함).

## 한계

- 시각 확인은 curl 구조 검증까지 — 브라우저 실기 확인(모바일 폭·리빌 모션)은 사용자 몫으로 남음.
- 캡처에 개발 세션 제목 등 실데이터가 보인다 — 공개 페이지이므로 사용자가 훑어보고 문제 시 교체 필요.
- og.png 는 구판 그대로 — 새 디자인 톤의 OG 이미지는 후속 후보.

## 검증

- https://oculpm.com/ 200 · `softwareVersion 2.11.0` · /keynote 200 · shots/*.jpg 200.
- HTML 태그 짝 검증 0 오류, 버전 5면 grep 확인. 커밋 1f84116 푸시 (랜딩 배포는 vercel --prod 로 완료).