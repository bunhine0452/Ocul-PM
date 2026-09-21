---
schema_version: 1
type: chore
slug: "release-v3-4-0"
status: done
created_at: "2026-09-22T04:17:27+09:00"
session_id: "20260922-002"
agent:
  id: "claude-code"
  version: "Fable 5.1"
  session: "11374f00-b5ac-48b5-baf8-a10f2cc343d9"
language: "ko"
verified_by_user: false
files_touched: []
related:
  - ref: "20260922/Chores/0233_chore_release-prep-v3-4-0.md"
    kind: "followup"
tags:
  - "release"
  - "v3.4.0"
  - "mcp-tool"
---
[x] v3.4.0 릴리스 — 태그·release.yml 통과·랜딩 배포 확인 (첫 기록 확인과 이어하기)

## 한 일

사용자 승인 뒤 `git tag v3.4.0 64255e88 && git push origin v3.4.0`(태그 단독 push) 과 `../ai-pm-release/landing` 에서 `vercel --prod --yes`.

## 확인

- release.yml run 35638272597: `게이트 — 태그 커밋의 CI 통과 확인` success → `build (macos-latest, aarch64)` success. 서명·공증·업데이터 검증을 지나 draft 해제됨.
- `gh release view v3.4.0`: draft=false · prerelease=false · 노트 2,025자(CHANGELOG `## v3.4.0` 그대로) · 자산 5개(`Ocul-PM_3.4.0_aarch64.dmg` · `Ocul-PM_aarch64.app.tar.gz` · `.sig` · `latest.json` · `ocul-pm-0.1.0.vsix`). `releases/latest` = v3.4.0, `latest.json.version` = 3.4.0.
- 랜딩: oculpm.com ko/en `softwareVersion 3.4.0`, `Get v3.4.0` 2곳, 플러그인 페이지 배지 v3.4.0, changelog `v3-4-0` 앵커 (111개).

## 메모

- 로컬 main 은 origin/main(64255e88)과 갈라진 채 남겨 두었다 — 작업 트리에 다른 세션의 미커밋 WIP 가 있고 claude 프로세스가 살아 있어서. 정리 뒤 `git rebase origin/main` 으로 맞추면 체리픽된 커밋은 자동 생략된다.
- 설치본 실기기 확인(`first-record-loop {#p1-verify}`)은 이 릴리스를 자동 업데이트로 받은 뒤 일지 0건 프로젝트에서 두 카드를 보는 것으로 닫을 수 있다.