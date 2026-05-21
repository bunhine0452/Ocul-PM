# W1 ~ W6 페이즈 가이드라인 — 인덱스

> 참조: [`../00-spec.md`](../00-spec.md) · [`../01-backend.md`](../01-backend.md) · [`../02-frontend.md`](../02-frontend.md) · [`../03-rollout.md`](../03-rollout.md)

각 파일은 **그 주에 무엇을, 어떤 PR 단위로, 어떻게 검증하며 완성하는가** 만 다룬다. 데이터 스펙·타입·UI 구조 같은 변하지 않는 약속은 위 4문서가 SSOT 이고, 페이즈 가이드는 시간 축으로 그것들을 어떻게 배달하는지를 다룬다.

---

## 0. 위임받은 3개 결정 (확정)

### 0.1 Dogfooding 시점

- **W3 종료 직후: 수동 dogfooding 시작.** 사용자(나)가 `.oculpm/journal/<오늘>/` 에 직접 `.md` 를 떨궈 넣으면서 frontmatter 포맷·파서·UI 를 굴려본다. 이 시점에 발견한 포맷 이슈는 W4 의 어댑터 템플릿(`.oculpm/agents/_template.md`)에 그대로 반영된다.
- **W4 종료 직후: 자동 dogfooding 전환.** 어댑터가 살아나면서 외부 LLM 이 같은 포맷으로 쓰기 시작. 그 시점부터 W5, W6 작업 자체가 곧 ocul-pm 의 첫 자동 trace.
- **근거**: 어댑터 템플릿을 만들 때 LLM 의 자연스러운 출력 분포 vs 우리가 요구하는 분포의 격차를 사람이 한 번 굴려본 채로 박는 게, LLM 부터 굴리고 사후에 고치는 것보다 격차가 작다.

### 0.2 `forbid_journal_for_paths` 디폴트 (보수적)

`config.toml` 의 `[git].forbid_journal_for_paths` 초기값:

```toml
forbid_journal_for_paths = [
  # 환경 변수 / 비밀
  ".env",
  ".env.*",
  "**/.env",
  "**/.env.*",
  "**/*secret*",
  "**/*credential*",
  "**/*password*",
  "**/*token*",
  "**/*apikey*",
  "**/*api_key*",
  "**/*private_key*",

  # 인증서 / 키
  "**/*.pem",
  "**/*.key",
  "**/*.p12",
  "**/*.pfx",
  "**/*.crt",
  "**/*.cer",
  "**/id_rsa",
  "**/id_ed25519",

  # 시스템 비밀 디렉토리
  "**/.ssh/**",
  "**/.gnupg/**",
  "**/.aws/credentials",
  "**/.aws/config",
  "**/.netrc",
  "**/.npmrc",
  "**/.pypirc",
  "**/.docker/config.json",

  # macOS / Windows
  "**/Keychain*",
  "**/keychain*",
]
```

이 셋에 매치되는 경로가 `files_touched` 에 들어오면:
1. journal 작성 자체를 거부 (`OculpmError::ForbiddenJournalPath`).
2. 사용자에게 토스트: "민감 경로 변경은 narrative 에 기록되지 않습니다 — index 에는 hash 만 남습니다."
3. `index/` 의 ndjson 에는 hash 없이 `op` 와 path 의 패턴 마스킹된 형태만 기록 (`bytes` 만, path 는 `**redacted/sensitive**` 토큰).

### 0.3 TodayScreen 시안

`W3-journal-today-ui.md` 의 §6 안에 **컴포넌트 트리 + ASCII 와이어 + 상태별 인터랙션 표** 형태로 포함. 별도 시안 파일을 만들지 않는다. 이유: 구현자가 W3 진행 중 한 파일만 펴두면 되도록.

---

## 1. 페이즈별 파일

| 파일 | 페이즈 | 한 줄 요약 |
|---|---|---|
| [`W1-foundation.md`](./W1-foundation.md) | W1 | `.oculpm/` 디렉토리·config·lock·atomic IO·부트스트랩 |
| [`W2-watcher-session.md`](./W2-watcher-session.md) | W2 | 파일 워처 + 세션 상태 머신 + 스냅샷 + crash recovery |
| [`W3-journal-today-ui.md`](./W3-journal-today-ui.md) | W3 | journal 파서·SQLite 캐시·Today UI 골격 + 수동 dogfooding 시작 |
| [`W4-agents-dual-layer.md`](./W4-agents-dual-layer.md) | W4 | 4개 어댑터 동기화 + DiffVsNarrative + 자동 dogfooding 전환 |
| [`W5-migration-overview.md`](./W5-migration-overview.md) | W5 | SQLite→.oculpm 마이그레이션 + Overview 재포지셔닝 |
| [`W6-stabilize-dogfood.md`](./W6-stabilize-dogfood.md) | W6 | 통합 테스트·성능 점검·회고·1.0 릴리스 |

---

## 2. 모든 페이즈에 공통으로 적용되는 규칙

### 2.1 PR 단위

- 한 PR = **하나의 의미있는 변경, 하나의 머지 가능한 상태**. `cargo check` 와 `pnpm tauri build` 가 통과해야 한다.
- 각 페이즈는 평균 5–10개의 PR 로 쪼개진다. PR 번호: `W{N}-PR{M}`.
- PR 제목은 conventional commits. 예: `feat(oculpm): add WorkdayResolver and tests`, `chore(oculpm): wire OculpmManager into bootstrap`.

### 2.2 Definition of Done (PR 레벨)

- [ ] 신규 코드에 대한 단위 테스트가 있고 통과
- [ ] specta 가 새 타입을 export 하는 경우 `pnpm tauri dev` 한 번 돌려 `src/types/` 가 갱신된 상태로 커밋
- [ ] 회귀 없음: 기존 changelog/overview/today/code/chat UI 가 깨지지 않음
- [ ] 사용자 노출 텍스트 (토스트, 모달, 라벨) 는 한국어. 식별자·로그·코드 주석은 영어 (기존 코드 컨벤션)
- [ ] frontmatter / config / 파일 경로 같은 SSOT 항목을 바꿀 때는 `00-spec.md` 를 먼저 고치고 코드는 그걸 인용

### 2.3 Definition of Done (페이즈 레벨)

각 페이즈 가이드의 마지막 섹션 **"Definition of Done"** 에 정의된 E2E 체크리스트가 전부 ✅ 면 종료.

### 2.4 회귀 방지

페이즈가 진행될수록 기존 UI 가 영향을 받는다. 매 페이즈 종료 시 다음 스모크 테스트를 수동으로 한다:

1. 프로젝트 만들기 → 닫기 → 다시 열기 (정상 동작)
2. 기존 Changelog 화면 진입 → 기존 데이터 보임 (W5 까지는 SQLite 가 살아있어야 함)
3. AiWorkbench 의 Chat / QuickEdit 모드 토글 동작
4. CommandPalette 열고 닫기

### 2.5 페이즈 간 잠금 (lock-in)

페이즈 종료 후 다음 페이즈가 시작되면, 이전 페이즈의 공개 인터페이스 (Tauri 커맨드, 파일 포맷, DB 스키마) 는 **freeze**. 변경 시 schema_version 또는 명시적 마이그레이션 PR 필요.

### 2.6 커밋 메시지 컨벤션 (기존 git log 관찰)

기존 레포의 커밋 스타일:
```
feat: consolidate AI features into a unified workbench with integrated model selection
feat: include untracked files in changelogs, fix timezone-based daily brief filtering
feat: implement project overview system with automatic refresh
```

→ `feat:` / `fix:` / `chore:` / `refactor:` prefix. 본문은 1줄 요약 + 필요 시 빈 줄 + 상세.

oculpm 작업은 모두 `feat(oculpm): ...`, `fix(oculpm): ...` 처럼 스코프를 박는다.

---

## 3. 다음 페이즈로 무엇을 넘기는가 (Handoff Contract)

각 페이즈 가이드의 §끝 에 "다음 페이즈로 넘기는 것" 섹션이 있고, 그 다음 페이즈의 §처음 "선행 조건" 과 1:1 대응한다. 이게 어긋나 보이면 둘 중 하나가 잘못된 것이니 PR 들어가기 전에 정정.

```
W1 ──넘김──► W2 (lock 가능 상태의 .oculpm/, paths, atomic_io, OculpmManager 골격)
W2 ──넘김──► W3 (file_changes.ndjson, sessions.json 이 실시간으로 채워지는 상태)
W3 ──넘김──► W4 (수동 작성된 journal 이 Today 에 표시되는 상태 + dogfooding 시작)
W4 ──넘김──► W5 (어댑터로 자동 작성된 journal + 이중 레이어 검증 UI)
W5 ──넘김──► W6 (마이그레이션 가능 + Overview 재포지셔닝 + 1주일 dogfooding 데이터)
W6 ──넘김──► 1.0 (안정화 + 회고 + 릴리스 노트)
```

---

## 4. 작업 시작 직전 체크

페이즈 N 을 시작하기 전 30분짜리 체크:

1. 직전 페이즈의 Definition of Done 이 진짜로 다 ✅ 인가? 아닌 항목은 N 으로 이월하지 말고 직전 페이즈로 hotfix.
2. 이번 페이즈의 §1 "선행 조건" 이 만족되는가?
3. SSOT 4문서 중 이번 페이즈와 관련된 챕터를 한 번 더 훑었는가?
4. `git status` 가 깨끗한가?

이게 다 만족돼야 PR 첫 줄을 친다.
