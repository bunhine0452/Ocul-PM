---
schema_version: 1
type: chore
slug: "release-v4-1-0-docs"
status: done
difficulty: medium
created_at: "2026-10-30T02:49:39+09:00"
session_id: "20261030-002"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "abe7e685-ce99-4d66-afc9-6004c40ed267"
language: "ko"
verified_by_user: false
files_touched:
  - path: "CHANGELOG.md"
    op: update
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
  - path: "CLAUDE.md"
    op: update
  - path: "landing/index.html"
    op: update
  - path: "landing/en/index.html"
    op: update
  - path: "landing/plugin.html"
    op: update
  - path: "landing/en/plugin.html"
    op: update
  - path: "landing/wiki-src/today.md"
    op: update
  - path: "landing/wiki-src/en/today.md"
    op: update
  - path: "landing/wiki-src/screens.md"
    op: update
  - path: "landing/wiki-src/claude-code.md"
    op: update
  - path: "plugin/oculpm/skills/help/SKILL.md"
    op: update
  - path: "src-tauri/tests/plugin_manifest.rs"
    op: update
  - path: "package.json"
    op: update
  - path: "src-tauri/tauri.conf.json"
    op: update
related: []
tags:
  - "release"
  - "rename"
  - "docs"
  - "mcp-tool"
---
[x] v4.1.0 릴리스 준비 — 다섯 면 문서 · 이름 Ocul

## 한 일

사용자 결정(10-30): 「지금 바로 4.1.0 릴리스」. 확인 날 리듬의 예외라서 그 이유를 CHANGELOG 4.1.0 절 첫 줄에 적었다. `bump-version` 경고 두 개(육안 확인 25건 대기, 외부 리뷰 주기)도 함께 적었다.

릴리스 다섯 면:
- 버전 6파일과 Cargo.lock(`bump-version.mjs 4.1.0 --title-ko/--title-en`). 플러그인 문서 페이지 두 장의 `nav-ver` 는 스크립트가 안 고쳐서 손으로 올렸다.
- CHANGELOG v4.1.0: 이름 Ocul · Claude 가 기다리면 안다 · 묻고 답한다 · 보낸다 · 이동 · 처음 쓰는 법 · 화면 검사 · 덜어내기.
- README ko/en: v4.1 절을 새로 쓰고, v4.0 절은 「지난 릴리스」 한 줄로 접었다. 화면 구성은 4.1 화면 기준으로 고쳤고 터미널이 처음으로 들어갔다. 플러그인 설명은 훅에 Notification, MCP 도구 8종(ask_user)으로 고쳤다.
- 랜딩 ko/en:
  - 버전 6곳(스크립트), 변경 이력 `<li>`
  - featureList: 둘 고치고 넷 더함
  - FAQ 둘(이름 · ask_user)과 여러 프로젝트 FAQ 에 ⌥⌘1~9
  - 벤토 한 줄(셋)
  - plugin.html 의 ask_user 행
- 위키 원본과 `build.mjs` 재빌드: 오늘 페이지를 지금 배치(먼저 볼 것 → 검증 없이 끝난 일지 → 다음 → 내 차례 한 줄 → 지금 일하는 중 → 오늘 한 일)로 다시 썼다. 화면 · 단축키 · 작업 창 · 시작하기 · Claude Code · 일지 · 계획 페이지도 고쳤다.

**4.0 때부터 틀려 있던 문서**를 이번에 찾아 고쳤다.
- 「[프롬프트 복사] · [until-done 으로 복사]」「[기록 요청 복사]」「오늘 `c`」「시작 창 세 단계」「⌘1~⌘4」 같은 설명이 README · 랜딩 · 위키에 남아 있었다. 4.0 터미널 복귀와 ui-audit 이 버튼을 바꾼 뒤에도 그대로였다.
- 위키 claude-code 의 「앱이 터미널에 쓰는 길은 없다」는 틀린 문장이었다. 실제로 쓰는 경우(실행 · /goal · 보내기)를 적었다.
- CLAUDE.md 의 「앱이 터미널에 치는 유일한 줄」도 같은 이유로 고쳤다.

이름(#rename-docs): `Ocul-PM` 을 `Ocul` 로 바꾸는 규칙을 스크립트 하나로 고정했다.
- 바꾸지 않는 것: 저장소 주소(`/` 앞), 내려받는 파일 이름(`_` 뒤), `.app`, `cd Ocul-PM`, 메일 제목(`%5D`), keywords.
- 지난 판의 변경 이력 `<li>` 와 CHANGELOG 의 옛 절도 그대로 둔다. 그때의 이름이기 때문이다.
- JSON-LD 의 `alternateName` 에는 `Ocul-PM` 을 남겨 검색에서 이어지게 했다.
- 「Ocul 으로」는 「Ocul 로」로 고쳤다(ㄹ 받침 조사).

## 검증

- 릴리스 커밋은 로컬 게이트 없이 CI 로 간다(메모 「릴리스 때 로컬 테스트 금지」). 대신 바뀐 문서를 읽는 테스트를 미리 대조했다.
  - `landing_pages`: CHANGELOG 맨 위가 4.1.0 이고 첫 문장이 인용 블록이 아님
  - `plugin_manifest`: plugin.html 에 ask_user · v4.1.0 이 있음
- JSON-LD 는 `json.loads` 로 ko · en 둘 다 통과했다.
- `git diff` 의 + 줄에서 href/src/url 이 바뀐 곳은 0 이다(메일 링크 하나는 그대로).
- `node landing/wiki-src/build.mjs` 결과: 「built changelog.html (릴리스 133개, 최신 v4.1.0)」 · sitemap 35 urls.

## 남은 것

- main push 뒤 CI 가 초록이면 태그 v4.1.0 을 민다. release run(게이트 → macOS · 비-mac → 공개)도 확인한다.
- 랜딩 배포(`cd landing && vercel --prod`)는 사용자가 직접 한다.
- 설치본 눈 확인(ocul-next #eyes-installed)은 남는다.