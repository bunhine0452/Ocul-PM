# 02. AGENTS.md "문제 해결" 규칙 + 귀속 + AI 참여의 경계

> 위상: [`00`](./00-master-plan.md) §3 의 "외부 에이전트 작성 경로" 와 "누가 썼나" 를 규정. 그리고 **in-app AI 참여를 명시적으로 다음 라운드로 분리**하는 경계를 못박는다.
> 선행: `src-tauri/src/oculpm/agents/` (템플릿 + `mod.rs` 동기화, drift 파이프라인), `AGENTS.md` 생성.
> 선례: [`../planner-upgrade/02-agents-protocol-and-attribution.md`](../planner-upgrade/02-agents-protocol-and-attribution.md).

---

## 1. AGENTS.md 에 추가되는 "문제 해결 문서" 규칙

일지·플래너 규칙과 같은 managed block(`<!-- oculpm:begin v1 -->`)에 *문제 해결* 하위 절을 추가. 마스터는 `master_ko.md.tpl`, 에이전트별 템플릿이 상속. **template_version 4 로 bump.**

### 1.1 핵심: "언제 쓰는가" 가 다르다

일지·플래너는 *작업을 끝낼 때마다* 강제로 쓴다(5 trigger). 문제 해결 문서는 **그렇지 않다 — 사용자가 토의/탐색을 요청할 때만.** 외부 에이전트가 모든 미결정마다 문서를 남기면 노이즈가 된다. 따라서 규칙은 *조건부·요청 기반*이다.

### 1.2 규칙 본문 (요지 — 실제 문안은 master_ko.md.tpl 에)

```markdown
### 문제 해결 문서 (작업일지·플래너와 별개)

작업일지가 "무엇을 했나"(회고), 플래너가 "무엇을, 어디까지"(결정 후 계획)라면,
문제 해결 문서(.oculpm/discussion/<slug>/discussion.md)는 그 **앞** 단계다 —
"이게 문제인가? 어떤 안들이 있나? 무엇을 할까?" 를 결정하기 전에 정리하는 회의록.

**언제 쓰는가 (요청 기반 — 매 작업마다가 아님):**
- 사용자가 "이 문제 같이 정리/토의해보자", "큰 계획을 세우자", "옵션을 비교하자"
  라고 명시적으로 요청할 때.
- 한 세션에 결정되지 않는 사안을 여러 세션에 걸쳐 다듬어야 할 때.
- 그 외 일반 작업에는 쓰지 말 것 — 작업이 끝나면 일지·플래너가 정답.

**어떻게 쓰는가:**
1. .oculpm/discussion/<slug>/discussion.md 를 연다(없으면 생성). slug=영문 kebab.
2. 맨 위는 반드시 YAML frontmatter (id/title/status: open/created/owner).
3. ## 문제 정의 를 먼저 채운다(필수·최상단). 정의 없는 토의 금지.
4. ## 후보 해결 방안 에 ### 제목 {#opt-id} 로 옵션을 나열(장/단/비용).
5. 토의 내용은 ## 토의 / 메모 의 managed block 표에 **한 줄 append**:
   | <ISO 시각> | <너의 agent_id> | <내용> |
6. 결론이 서면 ## 결론 을 쓰고, ## 다음 단계 에 - [ ] 항목 {#next-id} 를 적는다.
   그리고 frontmatter status 를 resolved 로 바꾼다(사용자가 플래너로 승격한다).

금지:
- 진척(progress)을 추적하지 말 것 — 그건 플래너(.oculpm/planner/)의 일이다.
- 결론이 난 작업의 실행 기록은 일지에. 문제 해결 문서에 실행 로그를 쌓지 말 것.
- resolved/archived 문서는 수정하지 말 것(사용자가 닫은 것).
- secrets/키를 본문·첨부 텍스트에 넣지 말 것(감지 시 거부).
```

### 1.3 에이전트별 템플릿 delta

| 템플릿 | 변경 |
|---|---|
| `master_ko.md.tpl` | 위 규칙 본문의 **마스터**(§8 신규 절). 나머지는 상속/번역 |
| `claude_code.md.tpl` | `@AGENTS.md` 상속 — 문제 해결 절 자동 포함. agent_id=`claude-code` |
| `gemini.md.tpl` | 동일 + agent_id=`gemini-cli` |
| `cursor.mdc.tpl` | `.mdc` 포맷 제약에 맞춘 요약 + agent_id=`cursor` |
| `antigravity.md.tpl` / `pi` | AGENTS.md 만으로 지원(패키지 불필요, 기존 정책) + agent_id 명시 |

`agents/mod.rs` 의 `sync_active`/drift 검사(`oculpm_agent_state`, migration 013)는 *그대로* — 문제 해결 절은 같은 managed block 안이라 기존 해시·drift 파이프라인이 자동 커버. **추가 동기화 코드 0**(template_version 만 4 로). 가드 테스트 `master_template_carries_discussion_rules` 추가.

---

## 2. 귀속(Attribution) 모델

### 2.1 정체성 — 일지·플래너와 단일화

`작성자`(토의 로그) / `owner`(frontmatter) 는 일지·플래너와 **동일한 `agent_id` 값 공간**:

| agent_id | 출처 | 라벨/색 |
|---|---|---|
| `user` | 사람이 앱 에디터에서 작성 | 중립색 |
| `claude-code` / `gemini-cli` / `cursor` / `antigravity` / `pi` | 외부 에이전트(.md 직접 편집) | AgentBreakdown 매핑 재사용(`agentColor.ts`) |
| `inapp:anthropic` … | **(다음 라운드)** in-app AI 토의 참여 | inapp prefix 로 외부와 구분 |

> Today/일지/플래너의 `agentColor.ts` 가 이미 agent_id→색을 가짐. 문제 해결 토의 로그의 작성자 칩은 *같은 매핑* 을 import → 4개 기능 귀속 시각 일관.

### 2.2 입자(granularity)
- 문서-level `owner` = 최초 작성자 1명(frontmatter).
- 토의-level `작성자` = 토의 로그 행별(누가 무슨 말을 했나) — `oculpm_discussion_log.author`.
- 플래너처럼 항목별 상태 귀속은 *없다* — 문제 해결은 진척을 추적하지 않으므로(불변식 §2-2).

### 2.3 신뢰 모델
로컬 우선·단일 사용자. `agent_id` 는 자기신고(AGENTS.md 가 "네 id 를 쓰라"). 위조 방지보다 *구분·가독* 이 목적. 토의 로그는 append-only 표기, git 이 최종 audit.

---

## 3. AI 참여의 경계 (v1 vs 다음 라운드) — 명시적 분리

> 사용자 결정: **v1 = 채팅 없는 수동 문서.** 이 절은 "지금 안 하는 것" 과 "그래도 미리 맞춰둔 것" 을 못박아, 다음 라운드 진입 시 포맷 재설계가 없도록 한다.

| 항목 | v1 (이번 라운드) | 다음 라운드 |
|---|---|---|
| 사람이 앱에서 작성 | ✅ `discussion_write` | ✅ |
| 외부 에이전트가 파일 직접 편집 | ✅ AGENTS.md 규칙 | ✅ |
| in-app AI 가 문서 안에서 대화 | ❌ | ✅ `chat_stream` → 토의 로그 append |
| in-app AI 가 옵션/결론 제안 | ❌ | ✅ (aiActions 패턴 재사용) |
| AI 가 "플래너로 승격" 제안 | ❌ (승격은 수동 버튼) | ✅ 제안→승인 |

**forward-compat 설계(지금 박아두는 것):**
- 토의 로그 표에 `작성자` 열을 처음부터 둔다 → 다음 라운드 AI 발언은 `inapp:<provider>` 행 append 만, 표 구조 변경 0.
- `## 후보 해결 방안` / `## 결론` 섹션 구조를 고정 → AI 제안이 같은 섹션을 채우면 됨.
- LLM 엔진(`llm.rs chat_stream`, provider 어댑터)·컨텍스트 조립(`aiContext.ts`)·액션 제안(`aiActions.tsx`)은 *이미 존재* → 다음 라운드는 *배선*만, 신규 엔진 0.

---

## 4. 충돌·안전
- 외부 에이전트 .md 편집 + 앱 `discussion_write` 동시성 → 기존 `.oculpm/.lock`(lock.rs) + atomic_io 임시파일-교체로 직렬화(플래너 `plan_write_lock` 패턴 검토).
- managed block(토의 로그) 경계 훼손 시 파서가 ⚠ + 마지막 정상 투영 유지(침묵 손실 금지).
- 첨부 경로는 `secure_discussion_join` 으로 discussion 폴더 밖(`../`) 거부.
- redact.rs(시크릿 마스킹)는 `problem`/`log.body` 투영에 적용. 첨부 바이너리는 본문이 아니므로 마스킹 대상 아님(사용자 git 판단 — AGENTS 규칙으로 시크릿 첨부 금지 명시).
