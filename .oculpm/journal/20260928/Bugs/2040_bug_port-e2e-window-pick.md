---
schema_version: 1
type: bug
slug: "port-e2e-window-pick"
status: done
difficulty: medium
created_at: "2026-09-28T20:40:51+09:00"
session_id: "20260928-001"
agent:
  id: "claude-code"
  version: "Opus 5.5"
  session: "ed4447b7-7384-4a70-82ba-26748d6773e1"
language: "ko"
verified_by_user: false
files_touched:
  - path: "e2e/scenario.mjs"
    op: update
related: []
tags:
  - "cross-platform"
  - "windows"
  - "e2e"
  - "ci"
  - "mcp-tool"
---
[x] Windows E2E 기동 간헐 실패 — 본 창을 주소가 실린 뒤 고르도록 (PR #50)

## 발생 원인

Windows E2E 는 첫 단계 「기동 — 세션 생성 · 첫 화면」 에서 간헐적으로 떨어졌다. 최근 12회 가운데 2회였고, PR #47 에서는 4회 중 3회였다. 떨어질 때의 모양은 이렇다.

- launch 는 늘 그렇듯 `DevToolsActivePort` 로 실패했고, attach 폴백이 CDP 를 잡았다. 웹뷰 창은 2개였다.
- 그 뒤 「웹뷰 문서 로드」 는 통과했는데 첫 실행 마법사가 60초 안에 `null` 이었다.
- 한 단계가 떨어지면 뒤의 60단계가 전부 건너뛰어진다. 비-mac 공개 스위치를 켜면 release.yml 의 설치본 E2E 가 그 판에서 Windows 를 빼 버린다.

가설: 창 선택 루프가 **지금 창**의 `location.search` 에 `tray=1` 이 있는지만 봤다. attach 순간 드라이버가 주소를 싣기 전(about:blank)의 트레이 팝오버를 잡으면 「트레이 아님」 으로 읽고 거기 머문다. 트레이 화면에도 `#root` 가 있어 문서 로드는 통과하고, 마법사만 없다.

## 해결 방법

`e2e/scenario.mjs` 에 `pickMainWindow` 를 넣었다. 창 목록을 돌며 각 창의 주소를 읽고, 주소가 실린(http·tauri) 비-트레이 창을 찾을 때까지 최대 60초 다시 고른다. 고른 창·지나친 창·시도 횟수는 단계 비고에 남긴다.

## 검증

- 수정본 Windows E2E 4회(브랜치 1 + 같은 커밋 ref 3개 수동 실행) 모두 초록. PR #50 전 체크 pass, rebase 병합(6b5e8a86).
- 4회 모두 첫 핸들은 이미 주소가 실린 트레이(`index.html?tray=1`)였고 새 로직이 건너뛰었다. **about:blank 경합 자체는 이 4회에 나타나지 않았다.** 그러니 이 가설이 원인이라는 결정적 증거는 아니다. 재발하면 비고의 창 기록이 원인을 가른다.