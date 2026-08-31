# 05 — 선언적 설정 · 플러그인 번들 · 딥링크 · 임포트 · 오프라인

> Phase 6 · 7 · 상위: [00-master-plan.md](00-master-plan.md)

---

## Phase 6

### 1. 선언적 설정 (`oculpm config export|plan|apply`)

Osaurus 의 Orchestrator 는 설정을 **원하는 상태(desired state)** 로 다룹니다.

```
osaurus config export > osaurus-config.yaml   # 시크릿 빼고 소스컨트롤에
osaurus config plan  osaurus-config.yaml      # 계산된 변경을 보여줌
osaurus config apply osaurus-config.yaml
```

그리고 결정적인 한 문장:

> UI · CLI · loopback HTTP API 가 **같은 planner 와 applier** 를 쓴다. 승인 카드는
> 계산된 변경을 먼저 보여주고, **완료 주장은 실제 apply 결과와 대조 검증된다.**

마지막 절이 ocul-pm 의 정직성 감사와 같은 계열입니다 — "했다고 말한 것" 과
"실제로 된 것" 을 대조하는 규율.

**ocul-pm 설계**

대상 표면 (시크릿 제외 — API 키는 OS 키체인, 절대 export 안 함):
```yaml
oculpm_config: v1
settings:            # SQLite settings 테이블 (키체인 값 제외)
  theme: nord
  content_language: ko
  core_provider: anthropic
  core_model: claude-haiku-4-5
project:
  oculpm:            # .oculpm/config.toml
    agents:
      active: [claude-code, cursor]
      auto_reconcile: true
    automation:
      schedules: true
      daily_run_budget: 20
  rules:             # .claude/rules/**  (경로 + 내용 해시)
    - path: typescript/coding-style.md
      sha256: "…"
  skills:            # .claude/skills/**
    - name: run-evals
      sha256: "…"
  automations:       # .oculpm/automation/**
    - id: weekly-dev-summary
      sha256: "…"
```

**구조**
- `config/planner.rs` — 현재 상태 읽기 + 목표 상태와 diff → `ConfigPlan`
- `config/applier.rs` — `ConfigPlan` 을 적용, 결과를 `ConfigApplyResult` 로 반환
- 진입점 3개가 **같은 두 모듈을 부릅니다**: Tauri 커맨드(UI) · CLI 서브커맨드 ·
  MCP 도구(`config_plan` / `config_apply`)

**승인 카드** — UI 에서 apply 전 반드시 보여줍니다:
```
설정을 이 상태로 맞춥니다
  + 규칙 typescript/coding-style.md 를 추가
  ~ core_model  claude-sonnet-5 → claude-haiku-4-5
  - 자동화 old-daily-digest 를 제거
  · 변경 없음 14건
                                    [취소]  [적용]
```
`useConfirm()` 이 아니라 전용 카드입니다 — 파괴 확인이 아니라 **계산 결과 검토**라
목록을 봐야 합니다.

**대조 검증**: `apply` 후 다시 `plan` 을 돌려 diff 가 비었는지 확인하고, 비지
않았으면 "일부만 적용됨" 으로 정직하게 보고합니다. "적용 완료" 를 apply 호출의
성공만으로 말하지 않습니다.

**CLI**: `--pty-host` 선례(same-exe 서브커맨드)를 따라 같은 실행 파일의
`oculpm config …` 서브커맨드로 붙입니다. 새 바이너리를 배포하지 않습니다.

### 2. Claude 플러그인 번들 임포트

Osaurus 는 `.claude-plugin/marketplace.json` 을 가진 GitHub 저장소를 통째로
들여옵니다.

| 아티팩트 | Osaurus 에서 | **ocul-pm 에서** |
|---|---|---|
| `skills/<n>/SKILL.md` | 스킬 | `.claude/skills/<n>/` (기존 스킬 화면) |
| `skills/<n>/references`·`assets` | 스킬 참조 | 동상 |
| `agents/<n>.md` | 스케줄(비활성) | **자동화 정의**(비활성) — Phase 1 저장소 |
| `commands/<n>.md` | 슬래시 명령 | `.claude/commands/<n>.md` |
| `.mcp.json` | MCP 프로바이더 | `.mcp.json` 병합 |
| `CLAUDE.md`·`README.md` | 참조 파일 | 규칙 허브에 참조로 |

ocul-pm 은 **Claude Code 를 구동하는 앱**이라 이 정합이 완벽합니다. Osaurus 는
번역해서 자기 형식으로 바꾸지만, 우리는 **Claude Code 가 그대로 읽는 자리에
그대로 놓습니다** — 번역 손실이 0 입니다.

**설치 단위**: 번들 id 로 묶어 설치·업데이트·제거가 한 단위입니다. 소유 표식은
기존 규약을 재사용합니다 — `rules.rs` 의 `MIRROR_MARKER_PREFIX` 처럼 우리가 놓은
파일만 갱신·삭제하고, **마커 없는 기존 파일은 절대 덮어쓰지 않습니다**(conflict 보고).

**검증** (Osaurus 의 임포트 가드를 그대로):
- 크기·파일 수·경로 깊이 상한
- 아카이브 루트 밖으로 나가는 경로 거부 (zip slip)
- 기존 것 위에 설치할 때는 **명시적 교체 확인**
- 하나가 깨져도 전체가 중단되지 않고, 마지막에 건너뛴 것을 요약

**GitHub 레이트 리밋**: 비인증 60/시간. 초과 시 "언제 풀리는지" 를 보여줍니다.

### 3. "선언됐지만 아직 이행하지 않음" 고지

Osaurus 가 가장 잘한 UX 입니다. 지원하지 않는 매니페스트 섹션(`hooks`,
`lspServers`, `outputStyles`, `channels`, `bin/`)을 **조용히 무시하지 않고**
상세 화면에 *"declared but not yet honored"* 로 적어 둡니다 — "놀라지 않게."

ocul-pm 도 같게 합니다. 그리고 이 규약을 **번들 임포트에만 두지 않고 일반화**합니다:

| 자리 | 고지 |
|---|---|
| 플러그인 상세 | 감지했지만 실행하지 않는 아티팩트 목록 |
| AGENTS.md 템플릿 | 템플릿 버전이 요구하지만 이 앱 버전이 아직 모르는 필드 |
| 자동화 에디터 | 이 빈도/티어에서 지원하지 않는 옵션 |

정직성 감사(honesty-audit)의 UI 판입니다.

### 4. `oculpm://` 딥링크

지금 `grep "oculpm://"` 는 무소득입니다 — 웹에서 앱으로 오는 길이 없습니다.

```
oculpm://skill/install?source=<owner/repo>&name=<skill>
oculpm://theme/install?url=<https…json>
oculpm://plugin/install?source=<owner/repo>
oculpm://open?project=<path>&view=journal&entry=<path>
```

**보안 규약** (딥링크는 외부 입력입니다):
- 딥링크는 **절대 조용히 실행하지 않습니다.** 항상 앱을 포커스하고 설치 확인
  시트를 띄웁니다 (무엇을, 어디서, 무엇이 바뀌는지).
- `source` 는 GitHub `owner/repo` 형태만. 임의 URL 실행 금지.
- `theme/install` 의 `url` 은 https 만 + 크기 상한 + 토큰 화이트리스트 검증
  ([03](03-themes.md) §3).
- `open` 은 **이미 등록된 프로젝트**만 엽니다. 경로로 새 프로젝트를 추가하지 않습니다.

Tauri 쪽은 `tauri.conf.json` 의 deep-link 플러그인 + `capabilities/default.json`
권한 추가. 앱이 이미 떠 있으면 기존 창으로 라우팅합니다.

---

## Phase 7

### 5. 대화 임포트

Osaurus 는 ChatGPT `conversations.json` · Claude export · Grok · Gemini Takeout ·
Open WebUI · 일반 `conversations[].messages[]` 를 들여옵니다. ZIP64 대용량 포함.

ocul-pm 은 이미 Claude Code **transcript** 를 읽습니다(`transcript.rs`,
`firing_ledger.rs` — 이 저장소 기준 293MB 를 증분 스캔). 없는 것은 **웹/앱 쪽
대화**입니다. 그것까지 들어오면 "AI 가 한 일 전부" 가 한 곳에 모입니다.

**설계**
- 대화를 채팅으로 저장하지 않습니다. **일지 후보**로 변환합니다 — ocul-pm 의
  산출물은 일지입니다.
- 임포트 → 후보 목록(날짜·제목·길이·추정 타입) → 사용자가 고른 것만 Core Model
  로 규격 일지화 → `verified_by_user: false` 로 저장.
- 원본 날짜 보존. `session_id` 는 `<원본workday>-iNN` (R2 규약).
- 안정 id 로 재임포트 스킵(중복 없음).
- **하나가 깨져도 나머지는 들어옵니다.** 마지막에 건너뛴 것을 요약합니다.
- 진행률 라이브 갱신. 파일 여러 개는 독립 처리.

지원 포맷 1차: **Claude export JSON** + Claude Code transcript(기존) + 일반
`conversations[].messages[]`. ChatGPT/Gemini/Grok 은 같은 어댑터 인터페이스로
후속 확장 (`import/adapters/*.rs`).

### 6. 오프라인 폴백

Osaurus: *"연결 상태가 모델 가용성을 자동으로 결정한다. 네트워크가 끊기면 원격
모델이 피커에서 사라지고 영향받는 대화는 온디바이스 모델로 폴백한다. **에이전트의
클라우드 기본값은 덮어쓰지 않는다.**"*

마지막 문장이 핵심입니다. 지금 ocul-pm 의 failover 체인(`fallbackModels`)은
**폴백은 하지만 복귀 규약이 없습니다.**

**규칙**
- 폴백은 **그 호출 한 번**에만 적용됩니다. 설정의 기본 프로바이더/모델을
  절대 쓰지 않습니다.
- 폴백이 발동하면 UI 가 말합니다 — 조용한 모델 교체는 금지. 답변 상단에
  `⚠ <원래모델> 실패 → <대체모델> 로 답했습니다` 배지.
- 연결이 없으면 모델 선택기에서 원격 항목을 **흐리게** 하고 사유를 툴팁으로.
  숨기지 않고 흐리게 하는 이유: 사라지면 "설정이 날아갔나" 로 읽힙니다.
- 자동화(Phase 1·2)는 오프라인이면 실행을 **연기**합니다 — 실패로 기록하지
  않습니다. 다음 기회에 따라잡기([01](01-automation.md) §1.2) 규칙을 탑니다.

## 7. 테스트

| 대상 | 방식 |
|---|---|
| plan/apply 멱등 | 같은 YAML 두 번 apply → 두 번째 diff 비어 있음 |
| 대조 검증 | applier 를 일부 실패하게 주입 → "완료" 대신 "일부만 적용됨" |
| 시크릿 배제 | export 결과에 키체인 값·API 키 문자열 0 |
| zip slip | `../` 경로가 든 번들 → 거부 |
| 마커 없는 파일 | 기존 사용자 파일 위 설치 → 덮어쓰지 않고 conflict 보고 |
| 부분 실패 | 아티팩트 5개 중 2개 깨짐 → 3개 설치 + 요약 2건 |
| 딥링크 | 확인 없이 설치되는 경로 0 · 임의 URL 거부 |
| 임포트 재실행 | 같은 export 두 번 → 중복 0 |
| 폴백 복귀 | 폴백 후 설정 값 불변 · 배지 노출 |
| 오프라인 자동화 | 연기로 기록, 실패 0 |
