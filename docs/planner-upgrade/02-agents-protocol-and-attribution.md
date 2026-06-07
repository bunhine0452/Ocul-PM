# 02. AGENTS.md Planner 규칙 + 귀속(Attribution) 모델

> 위상: [`00`](./00-master-plan.md) §3 의 "외부 에이전트 작성 경로" 와 "누가 갱신했나" 를 규정.
> 선행: `src-tauri/src/oculpm/agents/` (템플릿 5종 + `mod.rs` 동기화), `AGENTS.md` 생성 파이프라인.

---

## 1. AGENTS.md 에 추가되는 "Planner 갱신 규칙" 섹션

일지 규칙과 같은 managed block(`<!-- oculpm:begin v1 -->`)에 *Planner* 하위 절을 추가. 마스터는 `.oculpm/agents/_template.md`(= `master_ko.md.tpl`), 에이전트별 템플릿이 이를 상속.

### 1.1 규칙 본문(요지 — 실제 문안은 master_ko.md.tpl 에)

```markdown
### Planner 갱신 (작업 일지와 별개)

작업 일지가 "무엇을 했는지" 의 기록이라면, Planner(.oculpm/planner/*.md)는
"무엇을, 어디까지" 의 현재 계획이다. 한 단위 작업을 끝내고 일지를 쓸 때,
대응하는 Planner 항목도 함께 갱신한다.

1. 관련 plan 파일을 연다 (.oculpm/planner/<slug>.md). 없고 새 목표면 생성.
2. 해당 항목의 상태 글리프를 바꾼다:
   [ ] todo · [~] 진행중 · [x] 완료 · [!] 막힘 · [>] 이월 · [-] 폐기
3. **갱신 로그(managed block <!-- oculpm:plan-log … -->)에 한 줄 append**:
   | <ISO 시각> | #<항목id> | <너의 agent_id> | <from>→<to> | <방금 쓴 일지 경로 또는 빈칸> | <메모> |
4. 너의 agent_id 는 이 파일 상단 규칙에 명시된 값을 그대로 쓴다(위조 금지).
5. 항목 id(`{#…}`)와 managed block 경계는 보존한다. 글리프만, 로그는 append만.
6. 새 항목엔 안정 id 를 직접 부여한다(예: {#search-scopes}).
7. 결정이 생기면 "## 결정" 에 ### Decision 블록으로 잠근다(근거 + 영향 항목).

금지: 일지 내용을 Planner 에 복붙하지 말 것(중복). Planner 는 일지를 *참조* 만 한다.
```

### 1.2 에이전트별 템플릿 delta (5종)

| 템플릿 | 변경 |
|---|---|
| `master_ko.md.tpl` | 위 규칙 본문의 **마스터**. 나머지는 이를 상속/번역 |
| `claude_code.md.tpl` | `@AGENTS.md` 상속 — Planner 절 자동 포함. agent_id=`claude-code` 명시 확인 |
| `gemini.md.tpl` | 동일 규칙 + agent_id=`gemini` |
| `cursor.mdc.tpl` | `.mdc` 포맷 제약에 맞춰 규칙 요약 + agent_id=`cursor` |
| `antigravity.md.tpl` | 동일 규칙 + agent_id=`antigravity` |

`agents/mod.rs` 의 `sync_active`/drift 검사(`oculpm_agent_state`, migration 013)는 *그대로* — Planner 절은 같은 managed block 안이라 기존 해시·drift 파이프라인이 자동 커버. 추가 동기화 코드 0.

---

## 2. 귀속(Attribution) 모델

### 2.1 정체성(identity) — 일지와 단일화

`agent_id` 는 일지(`oculpm_journal.agent_id`)와 **동일한 값 공간**:

| agent_id | 출처 | 라벨/색 |
|---|---|---|
| `claude-code` | 외부 에이전트(.md 직접 편집) | AgentBreakdown 매핑 재사용 |
| `gemini` / `cursor` / `antigravity` | 외부 에이전트 | 〃 |
| `inapp:anthropic` `inapp:openai` `inapp:gemini` `inapp:nim` | 인앱 AI 패널의 "계획 갱신" 커맨드 | 인앱 prefix 로 외부와 구분 |
| `user` | 사람이 앱에서 편집 | 중립색 |

> Today 의 `agentColor.ts`/AgentBreakdown 이 이미 agent_id→색 매핑을 가짐. Planner 귀속 칩은 *같은 매핑* 을 import → 일지·Planner 귀속 시각 일관.

### 2.2 입자(granularity) — 항목별 · 갱신별

plan-level "마지막 편집자" 가 아니라 **항목별 갱신 로그**(`oculpm_plan_item_updates`). 이유:
- 한 plan 은 수개월간 여러 에이전트가 갱신 → plan 단위 귀속은 무의미.
- 항목별이라야 "이 항목은 누가 완료시켰나" 를 답함.
- 진척 변화의 책임 추적(audit) 가능.

### 2.3 UI 노출(요약은 [`03`](./03-ui-screen-spec.md))
- 항목 행: 마지막 갱신 에이전트 아바타 + 상대시간("claude-code · 2시간 전").
- 항목 클릭: 전체 갱신 이력(타임라인 — 누가/언제/무엇을→무엇으로/연결 일지).
- plan 헤더: 기여 에이전트 칩 묶음(distinct agent_id).

### 2.4 신뢰 모델
로컬 우선·단일 사용자 도구. agent_id 는 *자기신고*(AGENTS.md 가 "네 id 를 쓰라"). 위조 방지보다 *구분·가독* 이 목적. plan-log 는 append-only 표기로 이력 보존(편집 시 managed block 재작성은 watcher 가 재투영하되, git 이 최종 audit).

---

## 3. "스스로 업데이트" 의 실제 동작(시퀀스)

```
에이전트가 코드 한 단위 작업 완료
   │
   ├─(기존) 일지 작성: .oculpm/journal/<날>/<범주>/HHMM_type_slug.md
   │
   └─(신규, AGENTS.md 규칙) 대응 Planner 항목 갱신:
        1. .oculpm/planner/<slug>.md 의 #항목 글리프 [~]→[x]
        2. plan-log append: | ts | #항목 | claude-code | ~→x | <그 일지 경로> | … |
   │
watcher: journal/** 와 planner/** 둘 다 감지
   ├─ journal → oculpm_journal 인덱싱(기존)
   └─ planner → plan_* 재투영(신규)
   │
앱: Today(일지 라이브) + Planner(항목 [x] + 귀속 칩 갱신) 동시 반영
```

핵심: **일지 쓰는 흐름에 "2단계" 한 스텝을 더한 것** — 별도 도구·API 없이, 파일 한 줄·로그 한 줄. 인앱 AI 경로는 `plan_apply_edit` 커맨드가 같은 두 변경을 대행.

---

## 4. 충돌·안전
- 외부 에이전트 .md 편집 + 앱 `plan_apply_edit` 동시성 → 기존 `.oculpm/.lock`(lock.rs) + atomic_io 임시파일-교체로 직렬화.
- managed block 경계 훼손 시 파서가 ⚠ + 마지막 정상 투영 유지(침묵 손실 금지).
- redact.rs(시크릿 마스킹)는 planner 파싱에도 적용(일지와 동일 — 계획에 키가 섞이면 마스킹).
