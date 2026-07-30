---
schema_version: 1
type: chore
slug: "landing-v2-5-0-redesign"
status: done
difficulty: medium
created_at: "2026-07-31T05:03:12+09:00"
session_id: "mcp-20260731-050312"
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
related: []
tags:
  - "landing"
  - "design"
  - "v2.5.0"
  - "plugin"
  - "conversion"
  - "mcp-tool"
---
[x] 랜딩(oculpm.com) v2.5.0 리뉴얼 — 설치 전환 강화 + 고급화

초기 출시 때 만든 화면을 v2.5.0 기준으로 업그레이드. 기존 디자인 정체성(초록 토큰 #12a06b · 라이트+딥그린 밴드 · 제품 목업)은 유지하고 그 위에 고급화:

- **히어로**: 어나운스 필 v2.5.0, ghost 버튼을 Windows 추후→"Claude Code 플러그인(두 줄로 시작)"으로 교체, `/plugin marketplace add` 인라인 스니펫+복사 버튼 추가
- **업데이트 밴드**: v2.2 Claude 연동 → v2.5.0 "계획이 구현을 끌고 갑니다"(플러그인·▶실행 디스패치·3-depth+inception·토큰 다이어트), 데모 카드를 플래너→터미널 디스패치 목업으로 교체
- **신규 "시작하기" 섹션(#install)**: 앱 경로(3단계) vs 플러그인 경로(명령 2줄 복사+MCP/스킬/계약 안내) 2단 카드
- **벤토**: 플러그인·디스패치·메뉴바 셀 3개 추가(12셀 4행 정렬), 플래너 셀 3-depth 갱신
- SEO: JSON-LD softwareVersion 2.5.0·featureList 확장·플러그인 FAQ 추가
- 폴리시: 복사 버튼(복사됨 툴팁), 마키 에지 페이드 마스크, focus-visible 아웃라인, path 카드 호버 리프트

## 검증

HTMLParser 태그 밸런스 검사 통과(unclosed/mismatch 0), 구버전 잔재(v2.2.0/v2.3.x/"v2.0 대규모") 제거 확인, copy-btn 4개 모두 data-copy 보유. 벤토 2-span 셀 12개=6컬럼 4행 정합.