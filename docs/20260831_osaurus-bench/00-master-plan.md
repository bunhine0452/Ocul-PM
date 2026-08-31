# Osaurus 벤치마크 라운드 — 마스터 플랜

> 작성 2026-08-31 · 기준 v2.25.0 · **이 디렉토리가 이 라운드의 SSOT**
>
> 하위 문서: [01-automation.md](01-automation.md) · [02-provenance.md](02-provenance.md) · [03-themes.md](03-themes.md) · [04-context-economy.md](04-context-economy.md) · [05-config-plugins-import.md](05-config-plugins-import.md) · [06-landing.md](06-landing.md)
>
> 플래너: [`.oculpm/planner/osaurus-bench-round.md`](../../.oculpm/planner/osaurus-bench-round.md)

## 0. 이 문서는 무엇인가

[Osaurus](https://osaurus.ai) (Dinoki Labs, Swift/MLX, MIT, macOS 15.5+) 를 조사해
ocul-pm 이 가져올 만한 설계를 골라낸 결과와 그 구현 계획입니다.

Osaurus 는 **범용 로컬 AI 비서**이고 ocul-pm 은 **AI 가 한 일의 기록기**입니다.
정체가 다르므로 기능을 그대로 옮기지 않습니다 — *구조와 UX 규약만 가져와
기록기 맥락으로 번역*합니다. 예를 들어 Osaurus 의 "Obsidian 볼트 감시 → 편집이
멎으면 자동 커밋" 은 ocul-pm 에서 "작업 폴더 감시 → 손이 멎으면 일지 초안" 이
됩니다. 같은 기계, 다른 산출물입니다.

조사 원문 근거는 <https://docs.osaurus.ai> 의 watchers / schedules / memory /
skills / themes / claude-plugins / orchestrator / projects / chat 문서입니다.

## 1. 확정된 범위 (2026-08-31 사용자 승인 — 전부 채택)

| # | 항목 | Osaurus 원본 | ocul-pm 번역 | Phase |
|---|---|---|---|---|
| 1 | 시간 자동화 | Schedules (cron·8빈도·Run Now·History) | 주간 회고 / 아침 브리핑 / 스탠드업 자동 생성 | 1 |
| 2 | 반응성 티어 | Watcher Responsiveness 6단 | 디바운스를 "손이 멎으면 발동" 정책으로 승격 | 2 |
| 3 | 감시 자동화 | Watcher → 에이전트 위임 | 폴더 감시 → 일지 초안 / 플랜 화해 | 2 |
| 4 | 출처 배지 | 세션 소스 배지 8종 + 필터 레일 | 일지·세션의 발동 출처를 눈에 보이게 | 3 |
| 5 | 활성 행 | Running… / Needs your input + 인라인 Stop | ACP 세션 목록에서 열지 않고 중단 | 3 |
| 6 | 테마 파일화 | 테마 JSON + import/export + 에이전트 바인딩 | 테마 JSON + **프로젝트별 테마** | 4 |
| 7 | 매니페스트 | capabilities_discover/load + 세션 시작 시 동결 | 규칙·스킬 목록만 주입, 본문은 온디맨드 | 5 |
| 8 | 회상 게이트 | 메모리 4층 + ≤800토큰 + 관련도 감쇠 | 일지=에피소드. 게이트·감쇠·관리 화면 신설 | 5 |
| 9 | Core Model | 배경 작업 전용 소형 모델 슬롯 | 자동 화해·일지 초안·요약이 공유하는 슬롯 | 0 |
| 10 | 선언적 설정 | `config export\|plan\|apply` + 승인 카드 | 팀 간 규칙·스킬·자동화 동기화 | 6 |
| 11 | 플러그인 번들 | Claude 플러그인 통째 임포트 + 미이행 고지 | 같은 것 (ocul-pm 은 Claude Code 구동 앱) | 6 |
| 12 | 딥링크 | `osaurus://plugins-install?tool=` | `oculpm://` 스킴 (스킬·테마·플러그인) | 6 |
| 13 | 대화 임포트 | ChatGPT/Claude/Grok/Gemini/OpenWebUI | Claude 웹 export → 일지 흡수 | 7 |
| 14 | 오프라인 폴백 | 원격 숨김 + 온디바이스 폴백, 기본값 미덮어씀 | failover 체인에 "복귀 시 원상" 규약 | 7 |
| 15 | 랜딩 표면 | /changelog · /themes · /skills · /which-model | /changelog · /themes · /skills · /automation | 8 |

## 2. 범위 밖 — 의도적으로 따라가지 않는 것

| 안 하는 것 | 이유 |
|---|---|
| Alpine VM 샌드박스 · Seatbelt 격리 | ocul-pm 은 코드를 **실행**하지 않는다. 실행은 Claude Code/터미널의 일 |
| secp256k1 암호학적 identity · relay · secure channel | 로컬 단일 사용자. 네트워크 신원이 필요한 지점이 없다 |
| 이미지 생성 · computer-use · 음성/TTS | 기록기 정체성 밖. 넣으면 "AI 비서 하나 더"가 된다 |
| 로컬 추론 서버 (OpenAI/Ollama API 호환) | ocul-pm 은 LLM 클라이언트지 서버가 아니다 |
| 텔레메트리 (Aptabase/Sentry) | **"아무것도 나가지 않는다"** 약속과 정면 충돌 |
| 전역 오버레이 채팅 (⌘;) | 2026-07-16 에 의도적으로 은퇴시킨 표면. [D5](#decision-5--오버레이-채팅은-복원하지-않는다) 참조 |

다만 Osaurus 의 **텔레메트리 서술 방식**은 가져옵니다 — *무엇을 절대 안 보내는지*
(대화·프롬프트·출력·키)를 못박고 로컬 빌드는 아예 초기화되지 않는다고 쓰는 방식.
ocul-pm 은 "안 보낸다" 를 주장만 하고 목록으로 못박지 않았습니다 → [06-landing.md](06-landing.md) §4.

## 3. 왜 이 순서인가

```
Phase 0  자동화의 토대        Core Model 슬롯 · 발동 출처 · 잡 러너 · 033 마이그레이션
                               ↓ (1·2 가 이 위에 얹힌다)
Phase 1  Schedules            시간 자동화 — 가장 큰 사용자 가치, 백로그 C1 의 답
Phase 2  Watchers + 티어       "손이 멎으면" — 자동 일지의 락 문제를 우회하는 열쇠
                               ↓ (0~2 가 만든 새 발동원을 보이게 해야 한다)
Phase 3  Provenance           소스 배지 · 활성 행 · 닥터 자동화 섹션
─────────────────────────────  여기까지가 한 덩어리. 아래는 서로 독립 ─────────
Phase 4  테마 파일화          토큰화가 끝나 있어 가장 싼 Phase (병렬 가능)
Phase 5  컨텍스트 경제학       매니페스트 · 회상 게이트 · 메모리 화면
Phase 6  선언적 설정 · 번들     config plan/apply · Claude 플러그인 · 딥링크
Phase 7  임포트 · 오프라인      대화 임포트 · failover 복귀 규약
Phase 8  랜딩                 앞 Phase 들이 만든 것을 팔 표면 (반드시 마지막)
```

**Phase 0→1→2→3 은 순차**입니다. 0 이 만드는 잡 러너·발동 출처 위에 1·2 가 얹히고,
3 은 1·2 가 만든 새 발동원(스케줄·워처)을 화면에 드러내는 일이라 앞이 없으면 그릴
게 없습니다.

**Phase 4·5·6·7 은 서로 독립**이라 병렬 세션이면 동시에 가도 됩니다. 충돌 면:
- 4 는 `styles/` + `SettingsContext` + 027 project_appearance
- 5 는 `aiContext.ts` + `rules.rs` + `commands/skills.rs`
- 6 은 `spec.rs`(config) + `commands/config.rs` + 신규 CLI
- 7 은 `commands/export.rs` + `llm/`

**Phase 8 은 반드시 마지막**입니다. 랜딩은 5면 릴리스 체크리스트의 한 면이고
(`docs/RELEASE.md`), 없는 기능을 미리 광고하면 그 자체가 정직성 위반입니다.

## 4. 릴리스 매핑 (권장 — 하드 커밋 아님)

| 버전 | Phase | 한 줄 |
|---|---|---|
| v2.26.0 | 0 + 1 | 정해진 시각에 스스로 돌아본다 — 스케줄 자동화 |
| v2.27.0 | 2 | 손이 멎으면 기록한다 — 반응성 티어 · 감시 자동화 |
| v2.28.0 | 3 | 누가 시켰는지 보인다 — 출처 배지 · 활성 행 |
| v2.29.0 | 4 | 테마를 파일로 · 프로젝트마다 다른 색 |
| v2.30.0 | 5 | 필요할 때만 꺼내 쓴다 — 능력 매니페스트 · 회상 게이트 |
| v2.31.0 | 6 | 설정을 코드로 · Claude 플러그인 통째로 |
| v2.32.0 | 7 | 지난 대화를 들여온다 · 끊겨도 이어간다 |

각 릴리스는 [`docs/RELEASE.md`](../RELEASE.md) 의 **5면**(버전 3파일 · CHANGELOG ·
README ko/en · landing 5곳)을 전부 채워야 끝납니다.

## 5. 위험과 이미 아는 함정

### R1 — 자동화가 워처 증폭 루프를 만든다
스케줄/워처가 일지를 쓰면 → 워처가 그 쓰기를 보고 → 다시 발동. `watcher.rs` 의
self-suppress 는 `.oculpm/index/` · `.lock` · 로그 · `*.tmp` 만 막고 **`journal/` 은
이벤트를 emit** 합니다(`watcher.rs` 헤더 주석 2번 항목). 자동화 트리거 판정은
`journal/` · `planner/` 쓰기를 **원인에서 제외**해야 합니다 → [01](01-automation.md) §2.4.

### R2 — session_id 형식 제약
`IndexWriter` 는 session_id 첫 8자가 workday 숫자일 것을 강제합니다. 새 발동원의
합성 id 는 `<workday>-sNN`(schedule) / `<workday>-wNN`(watcher) 형태여야 합니다.
`SessionId` 뉴타입(polish-round `#session-id-newtype`)에 변형을 추가하는 방식으로만
확장합니다.

### R3 — 과금이 조용히 발생한다
자동화는 전부 LLM 을 부릅니다. `auto_reconcile` · `auto_journal_draft` 가 이미 옵인
기본 off 인 선례를 따릅니다. 추가로 **Core Model 이 설정되지 않으면 자동화 자체가
성립 불가**로 두어(Osaurus 와 동일) "몰랐는데 돈이 나갔다" 를 구조적으로 막습니다.

### R4 — 락 경합
`plan_write_lock` 공유락 · `try_lock` 동시 1건 규약(auto-reconcile N4)이 이미 있습니다.
잡 러너는 이 규약을 **재사용**하고 새 락을 만들지 않습니다. 자동 일지 초안이
"보류" 로 남아 있던 이유가 락 공유 미설계였으므로, Phase 0 의 잡 러너가 그 부채를
갚는 자리입니다.

### R5 — 설치본과 dev 빌드 동시 실행
번들 id 공유로 app-data·SQLite·`.oculpm` 락이 경합합니다. 자동화는 백그라운드로
도니 이 라운드에서 특히 위험합니다 — 육안 확인은 앱을 끈 뒤 몰아서 합니다.

### R6 — 마이그레이션 번호가 병렬 Phase 에서 충돌한다
Phase 4~7 을 병렬 가능하다고 했는데(§3) 마이그레이션 번호는 전역 단조 증가입니다.
두 세션이 각자 "다음 번호" 를 붙이면 같은 번호 두 개가 나옵니다.

**계획 시점에 예약합니다** — 구현 시점에 고르지 않습니다.

| 번호 | 파일 | Phase |
|---|---|---|
| 033 | `033_automation.sql` | 0 |
| 034 | `034_project_theme.sql` | 4 |
| 035 | `035_context_recall.sql` | 5 |

Phase 6·7 은 현재 신규 테이블이 없습니다. 필요해지면 **이 표에 먼저 추가**하고
쓰십시오. 번호는 이미 비연속입니다(010·025 결번) — 연속성이 아니라 **유일성**만
지키면 됩니다.

### R7 — 스코프 팽창
15개 항목 8 Phase 는 이 저장소 기준 큰 라운드입니다. Phase 경계에서 반드시
릴리스하고(§4), 다음 Phase 착수 전에 플래너 글리프를 정리합니다.

## 6. 결정

### Decision 1 — 자동화의 SSOT 는 온디스크 마크다운 {#decision-1}
**잠금** 2026-08-31 · claude-code

스케줄·워처 정의는 `.oculpm/automation/{schedules,watchers}/<id>.md` 에 둡니다
(frontmatter + 지시문 본문). SQLite 는 **런타임 상태만** — `next_run_at`,
`last_run_at`, `last_status`, 스캔 오프셋.

근거: `.oculpm` 전체가 "온디스크가 SSOT, SQLite 는 파생 캐시" 규약이고,
지시문은 사람이 읽고 고치고 git 에 올릴 사용자 콘텐츠입니다. Osaurus 는
전부 SQLite 에 넣지만 그건 그쪽이 파일 SSOT 규약이 없기 때문입니다.

영향: `#automation-store` `#schedule-crud` `#watcher-automation`

### Decision 2 — Core Model 없이는 자동화가 돌지 않는다 {#decision-2}
**잠금** 2026-08-31 · claude-code

`llm.core_model` 슬롯(프로바이더+모델)을 신설하고, 배경 작업(자동 화해 · 일지 초안 ·
스케줄 · 워처 · 세션 요약)은 **전부** 이 슬롯을 씁니다. 미설정이면 자동화 UI 는
"배경 모델을 먼저 고르세요" 로 잠깁니다.

근거: 과금 투명성(R3). 그리고 "값싸고 빠른 모델로 배경을 돌린다" 는 것 자체가
옳은 기본값입니다 — 지금은 배경 작업이 메인 대화용 모델을 그대로 씁니다.

영향: `#core-model` `#schedule-run` `#watcher-automation` `#reconcile-core-model`

### Decision 3 — 테마 JSON 은 CSS 변수 이름을 그대로 쓴다 {#decision-3}
**잠금** 2026-08-31 · claude-code

Osaurus 처럼 `colors.primaryText` 같은 별도 이름 체계를 만들지 않고,
`tokens.css` 의 `--bg-window` · `--text-2` · `--accent-soft` 를 **키 이름 그대로**
JSON 에 씁니다. 내장 프리셋 5종도 같은 스키마로 표현해 "내장이 곧 예제" 가 되게
합니다.

근거: polish-round 에서 디자인 토큰 564곳을 이미 치환해 `tokens.css` 가 단일
SSOT 입니다. 이름을 한 겹 더 만들면 매핑 표를 영원히 관리해야 합니다.

영향: `#theme-schema` `#theme-io` `#theme-editor`

### Decision 4 — 자동화는 전부 옵인, 기본 off {#decision-4}
**잠금** 2026-08-31 · claude-code

`config.toml` 의 `[automation]` 섹션은 `#[serde(default)]` 로 기존 파일이
전부 off 로 파싱되게 합니다. `.oculpm/automation/` 은 **신규 디렉터리**라
기존 온디스크 스펙이 불변이고 `schema_version` 을 올리지 않습니다.

영향: `#automation-config` `#automation-store`

### Decision 5 — 오버레이 채팅은 복원하지 않는다 {#decision-5}
**잠금** 2026-08-31 · claude-code

Osaurus 의 ⌘; 전역 오버레이는 "앱 밖 어디서나 물어본다" 는 비서 UX 입니다.
ocul-pm 은 2026-07-16 에 ⌘\ 오버레이 채팅 스택을 의도적으로 은퇴시켰고
`AiPanelScreenV2` 가 유일한 채팅 표면입니다. 이 결정을 뒤집지 않습니다.

대신 전역 단축키가 필요하면 **퀵 캡처**(지금 한 일을 한 줄로 남기는 창)로만
검토합니다 — 이 라운드 범위 밖, 별도 라운드.

### Decision 6 — 텔레메트리를 도입하지 않는다 {#decision-6}
**잠금** 2026-08-31 · claude-code

Osaurus 는 Aptabase 익명 분석 + Sentry 크래시(옵트아웃 기본값)를 씁니다.
ocul-pm 은 도입하지 않습니다. 대신 Osaurus 가 잘한 **서술 방식**만 가져와
"무엇을 절대 보내지 않는가" 를 목록으로 못박습니다 ([06](06-landing.md) §4).

## 7. 신규 의존성

이미 있는 것: `serde_yaml 0.9`(선언적 설정) · `uuid 1`(테마 id) ·
`notify 6.1` + `notify-debouncer-full 0.3`(워처) · `chrono-tz`(빈도 계산).

**새로 넣어야 하는 것 3개** — 각각 그 Phase 에서 추가합니다.

| 크레이트 | 용도 | Phase |
|---|---|---|
| `cron` | 빈도 표현식 파싱 · 다음 시각 계산 | 1 |
| `zip` | 플러그인 번들 · 대화 export 아카이브 (ZIP64) | 6·7 |
| `tauri-plugin-deep-link` | `oculpm://` 스킴 | 6 |

`tauri-plugin-deep-link` 는 `tauri.conf.json` 스킴 등록과
`capabilities/default.json` 권한 추가가 함께 필요합니다.

## 8. 완료 기준

이 라운드는 다음이 전부 참일 때 끝납니다.

1. 플래너 `osaurus-bench-round` 의 Phase 0~8 항목이 `[x]` 또는 명시적 `[-]`/`[>]`
2. 각 Phase 경계에서 `pnpm typecheck` · `pnpm test` · `pnpm lint` · `pnpm build` ·
   `cargo test` · `cargo clippy -- -D warnings` · `cargo fmt --check` 가 exit 0

   `pnpm lint` 는 세 게이트입니다 — 이 라운드의 모든 신규 코드가 지켜야 합니다:
   - `lint:i18n` — **UI 문자열은 전부 `t()`**. 새 화면(자동화 탭·컨텍스트 탭·
     테마 에디터)이 한글을 직접 쓰면 여기서 막힙니다. LLM 프롬프트 본문만
     `i18n-ignore-next-line` 예외입니다.
   - `lint:bindings` — 프런트는 `bindings.ts` 를 직접 import 하지 않고 `call`
     래퍼를 씁니다. 백엔드 신규 커맨드는 `AppError{code, detail}` 로 실패하고
     **에러 문자열에 UI 언어를 넣지 않습니다** (polish-round `#error-convention`).
   - `lint:storage` — `localStorage` 는 `WorkspaceContext` 만. 테마·자동화 상태를
     여기에 넣고 싶어지겠지만 금지입니다.
3. §4 의 릴리스가 태그까지 나가고 5면이 전부 채워짐
4. 새 기능마다 일지 1건 + 플래너 글리프 갱신 (AGENTS.md §1·§4)
