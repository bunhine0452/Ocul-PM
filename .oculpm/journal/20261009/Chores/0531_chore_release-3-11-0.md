---
schema_version: 1
type: chore
slug: "release-3-11-0"
status: done
difficulty: low
created_at: "2026-10-09T05:31:38+09:00"
session_id: "20261009-003"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "4450d61f-8efa-44ff-b9ec-4e171492ed94"
language: "ko"
verified_by_user: false
files_touched:
  - path: "CHANGELOG.md"
    op: update
  - path: "README.md"
    op: update
  - path: "README.en.md"
    op: update
  - path: "landing/index.html"
    op: update
  - path: "landing/en/index.html"
    op: update
  - path: "landing/wiki-src/pages.mjs"
    op: update
  - path: "package.json"
    op: update
  - path: "src-tauri/tauri.conf.json"
    op: update
related:
  - ref: "20261009/Bugs/0502_bug_seeded-event-runtime-lifecycle.md"
    kind: "followup"
  - ref: "20261009/Bugs/0407_bug_code-exec-boundary-acp-git-plugin.md"
    kind: "followup"
tags:
  - "release"
  - "landing"
  - "mcp-tool"
---
[x] v3.11.0 릴리스 — 저장소 코드는 신뢰한 뒤에만

## 작업 요약

PR #79(코드 실행 경로 넷 · 공급망)과 #81(이벤트 경합 · 수명)을 v3.11.0 으로 냈다. 순서는 docs/RELEASE.md 그대로 따랐다.

1. `bump-version.mjs 3.11.0` 을 돌렸다. 6파일, 랜딩 ko·en 6곳, ap-new 제목이 바뀌었고, SECURITY.md 리뷰 이력의 「다음 릴리스」 가 v3.11.0 으로 채워졌다.
2. `plugin.html` ko·en 배지는 스크립트가 안 고치는 자리라 손으로 올렸다.
3. CHANGELOG `## v3.11.0` 은 증상 → 바뀐 것의 서술형으로 썼다. 앱 안 에이전트가 먼저 신뢰를 묻는 변화와, v3.10 에서 언어 서버를 이미 켠 프로젝트는 그대로 시작한다는 점을 맨 앞에 두었다.
4. README ko·en 에 🚀 절을 더하고 v3.10.1 절은 강등했다. 랜딩 변경 이력 `<li>` 도 ko·en 에 넣었다.
5. `node landing/wiki-src/build.mjs` 로 생성물을 다시 구웠다.
6. 게이트 다섯이 exit 0 이었다. 커밋 6661adb1 → 태그 v3.11.0 을 단독 push 했다. 릴리스 run 37839869263 이 떴다.
7. `cd landing && vercel --prod` 로 ocul-pm-landing 에 배포했다. oculpm.com ko·en 의 softwareVersion 이 3.11.0 인 것과, /privacy 의 「여섯 갈래」 를 확인했다.

## 실수와 정정

PR #81 에서 개인정보 문구를 생성물 `landing/privacy.html` 에 직접 고쳤다. 그래서 이번 재빌드가 그 문구를 옛것으로 덮었다. 원본은 `landing/wiki-src/pages.mjs` 다. 원본을 고쳐 다시 구웠고, 결과는 PR #81 의 문구와 같다(차이는 버전 배지뿐). 랜딩에서 build.mjs 가 굽는 면(위키 · changelog · themes · privacy)은 생성물을 고치지 말 것.

랜딩 배포 명령을 두 번 돌렸다. 첫 출력이 잘려 실패로 보였기 때문이다. 같은 내용이라 영향은 없다.

## 검증

typecheck · vitest 3,307 · lint · build · cargo test 2,029 모두 exit 0 이었다. 릴리스 run 의 meta 잡은 SHA 로 고정한 액션으로 통과했다. 공개·자산 10개 확인은 run 이 끝난 뒤 갱신한다.