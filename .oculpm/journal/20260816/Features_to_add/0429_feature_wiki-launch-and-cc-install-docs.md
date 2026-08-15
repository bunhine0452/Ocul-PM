---
schema_version: 1
type: feature
slug: "wiki-launch-and-cc-install-docs"
status: done
difficulty: medium
created_at: "2026-08-16T04:29:48+09:00"
session_id: "mcp-20260816-042948"
agent:
  id: "claude-code"
  version: "Fable 5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "landing/wiki-src/build.mjs"
    op: create
  - path: "landing/wiki-src/claude-code.md"
    op: create
  - path: "landing/wiki-src/troubleshooting.md"
    op: create
  - path: "landing/wiki.css"
    op: create
  - path: "landing/index.html"
    op: update
  - path: "landing/sitemap.xml"
    op: update
related: []
tags:
  - "wiki"
  - "docs"
  - "landing"
  - "onboarding"
  - "mcp-tool"
---
[x] 위키 신설 (/wiki 6편) — ACP 의 /plugin 불가와 플러그인 설치 경로 문서화

## 추가 기능

사용자 지적에서 출발: 앱 속 Claude Code 는 ACP 라 `/plugin`·`/mcp` 가 안 되므로, 처음 온 사용자가 플러그인(훅 브리지) 설치 경로를 모른 채 터미널 Claude Code 를 쓰면 기록이 빠질 수 있다. 이 구분(앱 안=내장 MCP 로 자동 기록 / 터미널=플러그인 필요)을 포함해 사용자 불편 전반을 **oculpm.com/wiki** 로 문서화했다.

- **문서 6편**: 홈 · 시작하기 · **Claude Code 연동**(두 경로 비교표, ACP 가 CLI 대화형 명령을 못 나르는 이유, 터미널 탈출구, 설정 → ocul-pm → 연동의 두 줄 설치) · **문제 해결** 11항목(일지 안 쌓임 체크리스트, 런타임 준비, 로그인 없음, 승인 대기 배지, 사용량, 업데이트 중 대화, 어댑터 사망, 첫 인덱싱, 빈 세션 미표시 …) · 데이터와 파일 구조(SSOT=md, index/ 금지, 백업=폴더 복사, 밖으로 나가는 것 3가지) · 단축키.
- **갱신이 쉬운 구조**: `wiki-src/*.md` (front-matter title/desc/order/updated) → `build.mjs` (의존성 0 의 md 부분집합 렌더러 — 제목/목록/표/코드펜스/콜아웃 :::note·tip·warn) → `wiki/*.html` 정적 출력. 사이드바·페이지 목차·이전/다음·"이 문서 고치기"(GitHub 소스 링크)는 빌더가 생성.
- **디자인**: landing.css 토큰 위에 wiki.css 레이어 — 스티키 사이드바(모바일은 칩), 720px 본문, 콜아웃/표/코드 스타일. 네비·푸터에 위키 링크, sitemap 9 URL.

## 동작 흐름

문서 갱신 = ① md 수정 ② `node landing/wiki-src/build.mjs` ③ `cd landing && vercel deploy --prod --yes`. 빌더가 front-matter 누락을 에러로 막고, HTML 파서 검증으로 태그 짝 확인.

## 한계

- 렌더러는 md 부분집합(우리가 소스를 쓰므로) — 중첩 2단 목록·이미지 문법은 미지원, 필요 시 확장.
- 문서 내용 중 "규칙 다시 보내기" 위치(설정 → ocul-pm → 에이전트 탭)는 UI 기억 기반 — 화면 문구가 바뀌면 위키도 따라 고칠 것.
- 앱 안에서 위키로 가는 링크(설정·오류 문구)는 아직 없음 — 후속 후보.

## 검증

- 6페이지 전부 https://oculpm.com/wiki* 200, 태그 짝 검증 0 오류, 설치 명령 렌더 확인. 커밋 0c5c388 푸시 + vercel --prod 배포.