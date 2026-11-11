---
schema_version: 1
type: bug
slug: "terminal-nerd-font-glyphs"
status: done
difficulty: low
created_at: "2026-11-11T09:00:00+09:00"
session_id: "manual-20261111-090000"
agent:
  id: "claude-code"
  version: "Opus 5.5"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/terminal/termStore.ts"
    op: update
related: []
tags:
  - "터미널"
  - "글꼴"
  - "windows"
---
[x] 터미널: 프롬프트 아이콘을 Nerd Font 로 그린다

## 발생 원인
Windows 앱 터미널에서 starship 프롬프트의 git 가지 · node 아이콘이 □ 로 나왔다. 이 글자들은 Nerd Font 의 사용자 영역(PUA) 글자라 웹뷰의 시스템 대체 글꼴이 찾지 못한다. 터미널 글꼴 스택(`Cascadia Mono, Consolas, DejaVu Sans Mono, D2Coding Term, …`)에 Nerd Font 가 하나도 없었다. 사용자 PC 에는 `JetBrainsMono NF/NFM` 이 깔려 있고 Windows Terminal 은 그것을 쓴다.

## 해결 방법
흔한 Nerd Font 이름(Symbols Nerd Font Mono · JetBrainsMono NFM · CaskaydiaCove · MesloLGS NF · Hack · FiraCode …)을 D2Coding Term 다음, 일반 대체 글꼴 앞에 넣었다(mac 스택 포함). 칸 폭은 맨 앞 라틴 글꼴이 정하니 격자는 그대로다. 한 칸짜리 Mono/NFM 을 먼저 둬 아이콘이 옆 칸을 덮지 않게 했다. Nerd Font 가 없는 PC 는 전과 같다.

## 검증
- `tsc --noEmit` → exit 0 · `eslint termStore.ts` → exit 0
- `vitest run src/__tests__ -t term` → Tests 75 passed
- 설치본 눈 확인은 남음 (프롬프트 아이콘이 보이는지)
