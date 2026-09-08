---
schema_version: 1
type: chore
slug: "deploy-wiki-from-main-worktree"
status: done
difficulty: low
created_at: "2026-09-08T15:35:40+09:00"
session_id: "20260908-004"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "e98f9c75-6f28-4cef-8beb-d157afce0a74"
language: "ko"
verified_by_user: false
files_touched:
  - path: ".oculpm/planner/v3-release.md"
    op: update
related:
  - ref: "20260908/Chores/1523_chore_document-macos-permission-prompts.md"
    kind: "followup"
tags:
  - "landing"
  - "deploy"
  - "vercel"
  - "git-worktree"
  - "docs"
  - "mcp-tool"
---
[x] 낡은 브랜치로 덮지 않고 위키만 배포했다 — main 기준 워크트리 경유

앞 일지가 "아직 배포하지 않았다"로 닫혔던 자리를 메운다. 그 판단의 근거는 그대로 유효했다 — 작업 브랜치 `feat/v3-release-round` 는 main 보다 27커밋 뒤이고 `landing/` 만 11개 파일이 낡아, 여기서 `vercel --prod` 를 돌리면 위키 2장을 얹는 대가로 **랜딩 전체가 v2.44.1 시절로 되돌아간다** (`changelog.html` 이 릴리스 96개·최신 v2.44.1 로 재생성되는 것으로 실측됐다).

## 어떻게 피했나

`git worktree add --detach <tmp> origin/main` 으로 **main 기준 트리를 따로 띄우고** 거기에 위키 소스 2장만 복사해 재빌드한 뒤 그 트리에서 배포했다. 워크트리는 자기 인덱스·HEAD 를 가지므로 병렬 세션이 쓰고 있는 공유 워킹트리를 건드리지 않는다 (`[[shared-git-index-parallel-sessions]]` 의 사고를 되풀이하지 않는 방법). `landing/.vercel` 은 gitignore 라 워크트리에 없어 원본에서 복사해 링크를 물렸다.

배포 전 워크트리의 변경이 정확히 5개(소스 .md 2 · 생성 .html 2 · sitemap 1)뿐인지 확인했고, 재빌드 로그가 `changelog.html (릴리스 98개, 최신 v2.45.1)` 로 나오는 것으로 main 기준임을 확증했다.

## 함께 처리한 것

`{#eyes-tcc-desktop}` 항목을 `v3-release` 플랜 「육안 확인 부채」에 신설했다 — 연동 탭을 열었을 때 아무것도 안 뜨는지, `[Desktop 확인]` 을 눌렀을 때**만** 묻는지. `tccutil reset SystemPolicyAppData com.kimhyunbin.ocul-pm` 로 승인을 지우고 봐야 하고, 설치본 2.45.1 에는 이 수정이 없으므로 **다음 릴리스 뒤**라야 의미가 있다. 코드 쪽은 회귀 테스트로 잠갔으니 남은 것은 프롬프트가 뜨는 순간뿐이다.

## 검증

배포 응답 `readyState: READY` · `target: production`. 도메인에서 직접 확인 — `oculpm.com/wiki/troubleshooting` 과 `/wiki/en/troubleshooting` 에 새 절이 목차·본문 양쪽에 있고, `oculpm.com/changelog` 가 **v2.45.1** 을 최신으로 보여 준다(= 낡은 랜딩으로 덮이지 않았다). 워크트리는 `git worktree remove` 로 정리했고 공유 워킹트리의 변경 목록은 그대로다.

## 메모

main 의 HEAD 가 `docs: 공증이 끝났다 — 무서명 시절의 문서를 정정한다` 라, 이 브랜치에서 고친 README ko·en 의 공증 문단은 main 이 이미 같은 취지로 고쳐 둔 자리다. 리베이스에서 충돌하지만 양쪽이 같은 방향이라 **브랜치 쪽을 택하면 된다** — 권한 프롬프트 문단이 얹혀 있는 상위집합이다.