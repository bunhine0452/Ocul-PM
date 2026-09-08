---
schema_version: 1
type: chore
slug: "document-macos-permission-prompts"
status: done
difficulty: low
created_at: "2026-09-08T15:23:01+09:00"
session_id: "20260908-004"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "e98f9c75-6f28-4cef-8beb-d157afce0a74"
language: "ko"
verified_by_user: false
files_touched:
  - path: "README.md"
    op: correct
  - path: "README.en.md"
    op: correct
  - path: "landing/wiki-src/troubleshooting.md"
    op: update
  - path: "landing/wiki-src/en/troubleshooting.md"
    op: update
  - path: "landing/wiki/troubleshooting.html"
    op: update
  - path: "landing/wiki/en/troubleshooting.html"
    op: update
  - path: "landing/sitemap.xml"
    op: update
related:
  - ref: "20260908/Bugs/1516_bug_desktop-mcp-status-tcc-prompt-on-mount.md"
    kind: "followup"
tags:
  - "docs"
  - "macos"
  - "tcc"
  - "wiki"
  - "readme"
  - "landing"
  - "mcp-tool"
---
[x] macOS 권한 프롬프트를 문서화하고, README 의 낡은 공증 안내를 걷었다

앞선 일지가 이월로 남긴 문서 몫이다 — 내장 터미널이 앱의 TCC 신원을 물려준다는 사실이 사용자 눈에는 "왜 이 앱이 남의 데이터를?" 로 읽힌다.

## 변경 요약

**위키 「문제 해결」에 항목 신설** (ko·en). 두 관문을 먼저 가른다 — 공증은 "실행해도 되는가", 권한 프롬프트는 "저 데이터를 읽어도 되는가"이고 공증했다고 사라지지 않는다. 그 위에 세 가지를 적었다: ① 프로젝트가 데스크탑·문서·다운로드 안에 있으면 묻는다 ② **내장 터미널에서 돌린 명령·에이전트의 파일 접근을 macOS 가 명령이 아니라 앱에 귀속시킨다** (VS Code·iTerm 동일) ③ 업데이트 뒤 다시 묻는 것은 서명이 바뀐 버전에서 한 번뿐이다 (승인 기록이 코드 서명에 묶여 있어서 — 키체인도 같은 이유). 마지막으로 **앱이 먼저 묻지는 않는다**는 것을 새 계약과 함께 적었다: Claude Desktop 칸은 `[Desktop 확인]` 을 누를 때만 조회한다.

**README ko·en 의 낡은 문단을 걷었다.** 이 브랜치는 main 보다 27커밋 뒤라 설치 문단이 아직 "아직 Apple 공증 전이라 … `xattr -dr com.apple.quarantine`" 을 안내하고 있었다 — 서명·공증이 v2.45.x 로 이미 나갔으므로 **거짓이자 해로운 안내**다. 현행 문장으로 바로잡고, 권한 프롬프트 한 문단과 위키 링크를 붙였다.

## 하지 않은 것과 이유

`landing/index.html` 의 FAQ·JSON-LD 에는 넣지 않았다. 두 가지 이유가 겹친다 — ① 그 FAQ 는 제품 능력을 묻는 마케팅 면("무엇을 하나요")이지 문제 해결 면이 아니다 ② 이 브랜치는 그 파일을 한 번도 건드리지 않아 순수하게 뒤처져 있고, 여기서 고치면 낡은 바탕 위에 쓰는 셈이라 리베이스에서 충돌을 만든다. 문제 해결 내용의 제 자리는 위키이고, README 가 이미 그리로 보낸다.

## 검증

`node landing/wiki-src/build.mjs` 재빌드 — 34페이지, 생성물 diff 가 troubleshooting ko·en 두 장과 sitemap 의 `lastmod` 두 줄뿐이다(`changelog.html`·`themes.html` 은 브랜치의 낡은 버전으로 재생성되지 않았는지 확인 — 무변경). 렌더된 HTML 에서 새 절이 목차와 본문 양쪽에 들어간 것을 확인했다. `pnpm test` exit 0 (190파일 2469케이스).

**남은 것**: 랜딩 배포는 git 연동이 없어 수동이다 (`cd landing && vercel --prod`) — 아직 배포하지 않았다.