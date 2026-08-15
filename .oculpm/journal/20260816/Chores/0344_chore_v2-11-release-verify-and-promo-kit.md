---
schema_version: 1
type: chore
slug: "v2-11-release-verify-and-promo-kit"
status: done
difficulty: medium
created_at: "2026-08-16T03:44:05+09:00"
session_id: "mcp-20260816-034405"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "CHANGELOG.md"
    op: update
  - path: "landing/index.html"
    op: update
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
related: []
tags:
  - "release"
  - "verification"
  - "promo"
  - "acp"
  - "mcp-tool"
---
[x] v2.11.0 릴리스 검증 · 패키징 .app 실기기 확인 · 키노트 홍보 킷 제작

## 작업 내용

**릴리스 v2.11.0 (커밋 74715d7, 태그 단독 푸시).** RELEASE.md 절차 완주: 버전 5파일 → 게이트(plugin_manifest 동기 포함) → CHANGELOG → README ko/en → landing 5곳+featureList+FAQ+벤토 셀 → 커밋·태그 → `release.yml` 빌드(≈20분) → 랜딩 `vercel deploy --prod`.

**검증 결과** — 릴리스 노트 1,839자(빈 본문 아님), 에셋 4개(.dmg · .app.tar.gz · .sig · latest.json), oculpm.com 라이브 `softwareVersion 2.11.0`.

**패키징 .app 실기기 확인** — 릴리스 아티팩트(.app.tar.gz)로 /Applications 교체 후 `open -a` (LaunchServices 경유 = Finder 실행과 같은 빈약 PATH 조건). 어댑터 자동 스폰·세션 생성·프롬프트 스트리밍 전부 동작 → **acp1-pkg 해소**. v2.11 신기능도 실기기에서 전부 확인: 승인 카드에 diff(신규 파일 +3 초록 / 교체 −quietly +beautifully 빨강·초록)와 실행 명령 IN 표시, 도구 카드 ±통계·경과 초(3s·6s), 사이드바 승인 대기 배지 "1", 턴 영수증 "도구 4 · 2분 14초", MCP journal_write 승인 카드에 일지 본문 페이로드 표시까지. 데모 잔여물(demo-note.md·데모 일지 엔트리)은 정리.

**홍보 킷** — 실기기 캡처 8장(오늘 현황·작업 일지·변경 diff·코드맵·터미널 도크·승인 카드 2종·턴 영수증)을 넣어 잡스 키노트 문법의 제품 소개 페이지 제작·발행 (비공개 아티팩트, "에이전트 시대의 기억"). 부록으로 X 스레드 ko/en · GeekNews 소개글 복사 킷 동봉.

## 한계

- UI 자동화는 합성 키 입력이 웹뷰에서 깨져(스페이스→마침표 치환·글자 유실) 클립보드 경유로 우회 — 재현 시 참고.
- 자동 업데이트 경로(latest.json → 인앱 업데이터)는 이번에 안 탔다 — 아티팩트 수동 교체로 검증. 다음 릴리스에서 인앱 업데이트 배너로 자연 검증됨.

## 검증

- `gh release view v2.11.0` — notes 1839 · assets 4. `curl oculpm.com` — 2.11.0.
- 패키징 앱에서 ACP 실세션 1회 완주 (승인 3회 · 편집 2건 · MCP 일지 1건).