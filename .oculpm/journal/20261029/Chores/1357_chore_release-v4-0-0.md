---
schema_version: 1
type: chore
slug: "release-v4-0-0"
status: done
difficulty: low
created_at: "2026-10-29T13:57:00+09:00"
session_id: "20261029-010"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "1988da80-1607-4657-878d-b0a97d938c26"
language: "ko"
verified_by_user: false
files_touched: []
related:
  - ref: "20261029/Bugs/1302_bug_v4-prerelease-defects.md"
    kind: "followup"
tags:
  - "v4"
  - "release"
  - "mcp-tool"
---
[x] v4.0.0 릴리스 — 태그 단독 push, 릴리스 run 전 단계 초록(macOS · Windows · Linux 공개)

## 무엇을

사용자 승인: 「결함들 해결하고 태그 올려」. 순서는 이렇다.

1. 태그 전 결함 셋을 PR #119 로 고쳤다.
2. main `124ac0ae` 의 CI(ci.yml)가 success 인 것을 `gh run view` 로 확인했다.
3. `v4.0.0` 태그를 그 커밋에 달고 **단독으로** push 했다(`git push origin v4.0.0`, `--tags` 아님).

## 결과

- 릴리스 run 40818745181 이 하나만 떴다. 중복 실행은 없었다.
- 모든 잡이 success 다: 준비 · 게이트 · macOS(빌드·서명·검증) · Windows/Linux 번들 · 설치 스모크 · 설치본 E2E · 공개. v3.16·v3.17 은 비-mac 단계에서 run 이 붉었는데, 이번에는 처음으로 끝까지 초록이다.
- 공개됐다(`draft=false`, 2026-10-29T04:56:15Z). `releases/latest` 가 v4.0.0 을 가리킨다.
- `latest.json` 은 version 4.0.0 이고 다섯 키가 이 판의 실제 자산을 가리킨다: darwin-aarch64 · darwin-aarch64-app · windows-x86_64 · windows-x86_64-nsis · linux-x86_64-appimage.
- 자산: dmg · app.tar.gz(+sig) · AppImage(+sig) · deb · setup.exe(+sig)

## 남은 것

- **랜딩 배포.** `vercel --prod` 를 자동 모드 분류기가 「Production Deploy」로 막았다. 사용자가 `!` 로 실행할 몫이다. worktree `wt/fix/landing/.vercel/project.json` 은 복사해 두었다.
- **설치본 육안 확인.** 계획 `terminal-v4-20261029` 의 `ship-eyes` 와 확인 날 받은함이 그 몫이다.

## 검증

- `gh run view 40818745181` → `completed success`, 잡 11개 중 10개 success(드라이런 정리는 skipped)
- `gh api repos/bunhine0452/Ocul-PM/releases/latest` → `v4.0.0 draft=false`
- `gh release download v4.0.0 -p latest.json` → `version: 4.0.0`, 플랫폼 키 5개 모두 `v4.0.0/` 자산