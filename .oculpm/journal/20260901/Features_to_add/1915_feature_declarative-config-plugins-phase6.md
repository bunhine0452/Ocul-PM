---
schema_version: 1
type: feature
slug: declarative-config-plugins-phase6
status: done
difficulty: hard
created_at: 2026-09-01T19:15:00+09:00
session_id: manual-20260901-191500
agent:
  id: claude-code
  version: Opus 5 (1M context)
language: ko
verified_by_user: false
files_touched:
  - path: src-tauri/src/config/schema.rs
    op: create
  - path: src-tauri/src/config/planner.rs
    op: create
  - path: src-tauri/src/config/applier.rs
    op: create
  - path: src-tauri/src/config/cli.rs
    op: create
  - path: src-tauri/src/config/mod.rs
    op: create
  - path: src-tauri/src/commands/declarative_config.rs
    op: create
  - path: src-tauri/src/plugins/archive.rs
    op: create
  - path: src-tauri/src/plugins/manifest.rs
    op: create
  - path: src-tauri/src/plugins/install.rs
    op: create
  - path: src-tauri/src/plugins/store.rs
    op: create
  - path: src-tauri/src/plugins/source.rs
    op: create
  - path: src-tauri/src/plugins/mod.rs
    op: create
  - path: src-tauri/src/commands/plugins.rs
    op: create
  - path: src-tauri/src/deeplink.rs
    op: create
  - path: src-tauri/src/oculpm/agents/mod.rs
    op: update
  - path: src-tauri/src/oculpm/manager/agents_sync.rs
    op: update
  - path: src-tauri/src/commands/oculpm.rs
    op: update
  - path: src-tauri/src/main.rs
    op: update
  - path: src-tauri/src/lib.rs
    op: update
  - path: src-tauri/tauri.conf.json
    op: update
  - path: src-tauri/capabilities/default.json
    op: update
  - path: src-tauri/Cargo.toml
    op: update
  - path: src/api/declarativeConfig.ts
    op: create
  - path: src/api/plugins.ts
    op: create
  - path: src/api/deeplink.ts
    op: create
  - path: src/features/settings/config/planView.ts
    op: create
  - path: src/features/settings/config/DeclarativeConfigSection.tsx
    op: create
  - path: src/features/settings/plugins/NotHonoredNotice.tsx
    op: create
  - path: src/features/settings/plugins/PluginBundlesBlock.tsx
    op: create
  - path: src/features/deeplink/deepLinkPlan.ts
    op: create
  - path: src/features/deeplink/DeepLinkSheet.tsx
    op: create
  - path: src/features/settings/automation/automationModel.ts
    op: update
  - path: src/features/settings/automation/AutomationEditor.tsx
    op: update
  - path: src/features/settings/OculpmSettings.tsx
    op: update
  - path: src/features/settings/tabs/DataTab.tsx
    op: update
  - path: src/windows/ProjectTab.tsx
    op: update
  - path: src/__tests__/declarative_config.test.tsx
    op: create
  - path: src/__tests__/plugin_bundles.test.tsx
    op: create
  - path: src/__tests__/deep_link.test.tsx
    op: create
related:
  - .oculpm/planner/osaurus-bench-round.md
tags:
  - config
  - plugins
  - deeplink
  - phase6
---

[x] 선언적 설정 · 플러그인 번들 임포트 · 미이행 고지 · `oculpm://` 딥링크

## 배경

Osaurus 라운드 Phase 6. 설계는 [05-config-plugins-import.md](../../../../docs/20260831_osaurus-bench/05-config-plugins-import.md).

세 덩어리가 한 주제로 묶인다 — **바깥에서 들어오는 설정**. YAML 한 장,
남의 플러그인 번들, 웹에서 오는 링크. 셋 다 "받아들이기 전에 무엇이
바뀌는지 보여 준다" 는 같은 규약을 쓴다.

## 한 일

### 선언적 설정 (`config/`)

`planner.rs`(계획·순수) + `applier.rs`(적용) 두 모듈을 **UI 와 CLI 가 같이**
부른다. 진입점은 I/O 만 한다.

- 승인 카드는 `useConfirm()` 이 아니라 전용 카드다 — 파괴 확인이 아니라
  계산 결과 검토라 목록을 봐야 한다.
- **대조 검증**: apply 뒤 다시 계획해 남은 diff 가 0 일 때만 「적용 완료」.
  남으면 「일부만 적용됨」이다. apply 호출의 성공을 완료로 말하지 않는다.
- `ocul-pm config export|plan|apply` — `--pty-host` 선례의 same-exe
  서브커맨드. 일부만 적용됨은 종료 코드 3 (CI 가 초록으로 지나치지 못한다).
- 시크릿은 두 겹으로 막았다 — 키체인 값은 애초에 `settings` 표에 없고,
  키 모양(`*_api_key`·`*token*`…)으로 export/apply 양쪽에서 거절한다.

### 플러그인 번들 임포트 (`plugins/`)

Claude Code 가 읽는 자리에 **그대로** 놓는다 — 번역 손실 0.
`skills/`→`.claude/skills/` · `commands/`→`.claude/commands/` ·
`agents/`→`.claude/agents/` + 비활성 자동화 정의 · `.mcp.json` 병합.

- 가드가 본체다: zip slip 거부 · 크기/개수/깊이 상한 · 헤더가 거짓말하는
  아카이브를 위해 **읽기 자체를 자른다** · 엔트리를 디스크에 풀지 않고
  메모리로 검증한 뒤 목적지를 우리가 계산한다.
- 소유 마커 `<!-- oculpm:bundle <id> -->` 를 마크다운 **끝**에 붙인다
  (앞에 붙이면 frontmatter 가 깨진다). **마커 없는 파일은 절대 덮지 않고**
  conflict 로 보고한다.
- 미리보기와 설치가 **같은 함수**다 (`dry` 만 다르다) — 미리 본 판정과
  일어난 판정이 갈라질 길이 없다.
- 이미 설치된 번들 위에는 명시적 확인 없이 아무것도 쓰지 않는다.
- 제거는 우리가 놓은 것만 가져가고, 사용자가 이어받은(마커를 지운) 파일은
  남긴다.

### 「선언됐지만 아직 이행하지 않음」 — 일반화

한 컴포넌트를 세 자리가 쓴다.

1. 플러그인 상세 — `hooks/`·`bin/` 등 감지했지만 실행하지 않는 것
2. AGENTS.md 템플릿 — **디스크 템플릿이 이 앱보다 새로울 때**.
   `master_upgrade_available` 은 `from < to` 만 보므로 이 방향은 여태
   조용히 무시됐다. `master_ahead_of_app` 을 새로 만들어 말한다
3. 자동화 에디터 — 빈도를 바꿔 남은 값(`weekly`→`daily` 인데 `weekday`
   가 남음). 러너가 안 읽는 필드를 적는다

### `oculpm://` 딥링크

**무확인 실행 0 은 정책이 아니라 구조다** — 백엔드는 URL 을 파싱해
이벤트로 넘기기만 하고, 승인 시트를 지나지 않는 코드 경로가 없다.

- `source` 는 `owner/repo` 만. 번들 임포트와 **같은 파서**를 쓴다
- 테마 `url` 은 https + 호스트 화이트리스트. `https://oculpm.com@evil.test/…`
  같은 자격증명 트릭도 막는다
- `open` 은 등록된 프로젝트만 — 링크가 새 프로젝트를 추가하지 못한다

## 검증

`cargo test`(1076 + 통합 스위트 전부 통과, `bindings.ts` 재생성) ·
`cargo fmt --check` · `cargo clippy --all-targets -D warnings` ·
`pnpm typecheck` · `pnpm test`(141 파일 / 1722 통과, 신규 24건) ·
`pnpm lint` · `pnpm build` 전부 exit 0.

테스트가 실제 결함 하나를 잡았다: `strip_single_root` 가 "최상위 폴더가
하나면 벗긴다" 로 되어 있어 `skills/` 만 든 정상 번들의 `skills/` 를
벗겨 버렸다. 번들 최상위로 쓰이는 이름은 래퍼로 보지 않도록 고치고
회귀 테스트를 남겼다.

## 메모

D11(아티팩트 절은 읽기 전용)·D12(MCP 진입점 폐기)를 플랜에 기록했다.
Phase 7(대화 임포트·오프라인)과 Phase 8(랜딩)이 남았고, 릴리스는
Phase 7 뒤 v2.30.0 로 묶는다. 실기기 확인(설치본에서 딥링크 클릭 ·
GitHub 번들 실제 다운로드)은 사용자 몫으로 남는다 — 딥링크 스킴 등록은
번들된 `.app` 에서만 OS 에 반영된다.
