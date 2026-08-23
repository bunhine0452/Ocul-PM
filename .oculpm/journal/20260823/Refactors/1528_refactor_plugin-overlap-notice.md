---
schema_version: 1
type: refactor
slug: "plugin-overlap-notice"
status: done
difficulty: low
created_at: "2026-08-23T15:28:34+09:00"
session_id: "manual-20260823-152834"
agent:
  id: "claude-code"
  version: "Opus 5 (1M context)"
language: "ko"
verified_by_user: false
files_touched:
  - path: "src/features/settings/OculpmSettings.tsx"
    op: update
  - path: "src/i18n/ko.ts"
    op: update
  - path: "src/i18n/en.ts"
    op: update
  - path: "src/__tests__/mcp_settings.test.tsx"
    op: update
  - path: "src/__tests__/claude_hooks_settings.test.tsx"
    op: update
related:
  - "journal/20260823/Refactors/1520_refactor_settings-integration-scope-split.md"
tags: ["ui", "settings", "integration", "plugin", "claude-code"]
---

[x] 겹침 경고가 정작 겹치는 자리에는 없었다

## 동기

직전 작업(→ 1520)이 연동 탭을 「이 프로젝트」/「이 머신 전체」로 갈랐는데, 이중 설정 경고는 플러그인 블록에만 남겨 뒀다. 그래서 **경고가 사고 현장에 없다** — 프로젝트 섹션까지 스크롤해 훅을 켜거나 MCP를 등록하는 사용자는 그 문구를 지나쳐 온 뒤다. 경고를 읽어야 할 순간과 경고가 있는 자리가 어긋나 있었다.

원인은 상태의 소유권이었다. 플러그인 설치 여부를 `ClaudePluginBlock` 이 혼자 들고 있어서, 다른 두 블록은 그 사실을 알 방법이 없었다.

## 변경 요약

- **플러그인 상태를 body 로 올렸다.** `OculpmSettingsBody` 가 `claudePluginStatus()` 를 한 번 읽어 세 블록에 내린다 — `ClaudePluginBlock` 은 `plugin`, 나머지 둘은 `pluginInstalled`. 블록마다 읽으면 같은 디렉터리 스캔이 세 번 돌고, 무엇보다 두 섹션이 같은 사실을 봐야 한다.
- **고지가 상태에 따라 갈린다.** 켜져 있으면 실제 이중 적재라 경고(amber), 꺼져 있으면 "켤 필요 없다" 는 정보(muted). 같은 사실이지만 사용자가 지금 해야 할 일이 다르다 — 하나는 *끄세요*, 하나는 *두세요* 다. 색까지 나눈 이유가 이것이고, 테스트도 문구와 색을 함께 단언한다.
- **Desktop 은 반대 방향으로 안내한다.** 플러그인은 Claude Code 만 구성한다 — Desktop 은 설정 파일도 등록 경로도 다르다. "플러그인이 이미 한다" 를 여기까지 확대 적용하면 Desktop 을 영영 등록하지 않게 되므로, 겹치지 않으니 따로 등록하라고 명시한다.
- `pluginInstalled` 는 기본값 `false` 의 선택 prop 이라 두 블록의 단독 렌더(테스트)는 그대로 선다. `ClaudePluginBlock` 은 자체 fetch 를 잃고 `plugin: ClaudePluginStatus | null` 을 받는다 — `null` 이면 "확인 중…" 으로, 기존 동작과 같다.
- 신규 i18n 키 5종(ko/en).

## 검증

- `pnpm test` 1201 통과(신규 7). 훅 쪽 3개는 꺼짐→정보·켜짐→경고(+amber 클래스)·플러그인 미설치→고지 없음을, MCP 쪽 4개는 같은 갈림 + Desktop 별도 안내 + 미설치 시 침묵을 본다. `ClaudePluginBlock` 3개는 prop 기반으로 옮기고 `plugin={null}` 확인 중 케이스를 더했다.
- `pnpm typecheck` · `pnpm lint` · `pnpm build` 각각 exit 0. (직전 일지에서 typecheck 를 못 봤다고 적은 건 병렬 세션의 미완 상태 탓이었는데, 그쪽이 사전 항목을 채워 지금은 0건이다.)

## 메모

새 고지는 렌더링만 늘리고 동작은 안 바꾼다 — 훅·MCP·Desktop 어느 버튼도 플러그인 설치 여부로 비활성화하지 않았다. 겹침은 사용자가 알고 고를 문제지 앱이 막을 문제가 아니고, 실제로 플러그인 대신 프로젝트별 등록을 쓰고 싶은 경우(팀 공유 `.mcp.json` 등)가 있다.

여전히 새로고침은 없다 — 설정 패널을 연 채로 Claude Code 에서 플러그인을 설치하면 탭을 다시 열어야 반영된다. 직전과 같은 한계다.
