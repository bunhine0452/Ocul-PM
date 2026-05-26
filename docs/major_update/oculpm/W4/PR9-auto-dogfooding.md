# W4-PR9 — 자동 dogfooding 전환 + 3일치 회고

> **목표**: PR1~PR8 의 모든 코드 작업이 끝난 뒤, **실제 LLM (Claude Code 등) 이 본 프로젝트 (ai-pm) 안에서 자동으로 journal 을 작성하기 시작**. 작성률 / 정확도 / mismatch 분포를 매일 회고. W3-PR9 와 마찬가지로 **코드 PR 이 아닌 운영 전환**.
> **선행**: W4-PR1~PR8 모두 ✅. W3 의 dogfooding 회고 (`_dogfooding-w3.md`).
> **참조**: [`../phases/W4-agents-dual-layer.md`](../phases/W4-agents-dual-layer.md) §W4-PR9 + §0 ("자동 dogfooding 시작").
> **상태**: 🟡 (2026-05-25 — 운영 전환 준비 완료, 사용자 손작업으로 시작 대기) · 🔧 **PostFix 2026-05-25**: 직접 dogfooding 1차에서 4건 일괄 수정.

> **인간 작업**: Claude Code 가 본인의 작업을 어댑터 규칙에 따라 자동으로 `.oculpm/journal/` 에 쓰는지 매일 확인 + 부족하면 마스터 템플릿 강화.
> 회고는 [`../phases/_dogfooding-w4.md`](../phases/_dogfooding-w4.md) 에 작성.

> 📌 **Post-dogfooding addendum (2026-05-25)** — 사용자 직접 dogfooding 1차에서 4건 발견 (AGENTS.md 누락, 세션 중복 생성, opener 권한, LayerComparison 모달 UX) → 같은 날 일괄 수정 + 문서화. 발견·조치 상세는 [`../phases/_dogfooding-w4.md`](../phases/_dogfooding-w4.md) §2026-05-25 두 섹션 참조. 영향 PR: PR2 (agents-md 어댑터 추가), PR6 (인라인 패널), PR7 (resume grace 슬라이더), 백엔드 SessionConfig (resume 메커니즘).

---

## 1. 전환 절차 (계획)

1. **PR1~PR8 모두 main 머지 + 본 프로젝트 (ai-pm) 에서 `pnpm tauri dev` 실행**.
2. Settings → ocul-pm 탭 → Agents 섹션 → **Claude Code 활성화** (다른 어댑터는 1개씩 추가하며 작성률 비교).
3. `.claude/CLAUDE.md` 의 관리 블록에 ocul-pm 규칙이 들어갔는지 `cat` 으로 확인.
4. Claude Code 로 본 프로젝트의 실제 작업 1건 진행 (예: W5 의 첫 마이그레이션 작업).
5. 작업 끝나면 즉시 `.oculpm/journal/<오늘>/<TypeFolder>/...md` 가 자동 생성됐는지 확인.

---

## 2. 매일 회고 — `_dogfooding-w4.md`

위치: `docs/major_update/oculpm/phases/_dogfooding-w4.md` (페이즈가 SSOT).

각 날 기록:

```markdown
## 2026-MM-DD

### 작성률
- 오늘 의도한 작업 단위: N건 (대략 PR/이슈 단위로 카운트)
- 자동 기록된 entries: M건
- 작성률: M/N = XX%

### frontmatter 오류율
- 자동 생성 entries 중 frontmatter parse error: K건
- 가장 흔한 오류 유형: (예: created_at tz 누락 / files_touched.op 잘못된 enum / agent.id 누락)

### 본문 헤더 누락률
- bug/error entries 중 "## 발생 원인" 헤더 없음: ...
- refactor entries 중 "## 동기" 헤더 없음: ...

### mismatch 발생률 (PR5 의 LayerComparison)
- 오늘 종료된 sessions: S건
- severity 분포: Ok=..., Warning=..., Critical=...
- 가장 큰 mismatch session 1개의 only_in_index / only_in_journal 샘플

### 발견된 함정
- (자유 기술)

### 마스터 템플릿 강화 후보
- (예: "기록 시점이 모호함 → 마스터에 '⌘+Shift+J 단축키로 즉시 기록' 강조 추가")
```

---

## 3. 작성률 < 60% 일 때 조치 (계획)

페이즈 §1 W4-PR9 의 표 그대로:

1. 마스터 템플릿의 "언제 기록하는가" 섹션을 더 명확히. 회고에서 "기록 안 한 작업의 공통 특징" 추출 → 그 특징을 trigger 로 추가.
2. 단일 작업 완료 시 explicit reminder 를 사용자 (= 너) 가 한 번 입력해보고, 어떤 trigger 가 효과적인지 학습:
   - "작업 끝났어. ocul-pm 에 기록해줘" 같은 명시적 요청이 효과적이었는지.
   - 또는 `⌘+Shift+J` 단축키로 사용자가 보충 기록한 entries 비율.
3. 어댑터 다른 후보 활성화 (예: Claude Code 대신 Cursor) → 같은 마스터 규칙에 대한 LLM 별 준수율 비교.

---

## 4. DoD

- [ ] `_dogfooding-w4.md` 가 W4 종료 시점에 **최소 3일치** 데이터.
- [ ] 작성률 ≥ 60% (낮으면 W6 의 stabilize 에 추가 개선 항목으로 인계).
- [ ] frontmatter 오류율 ≤ 20%, 본문 헤더 누락률 ≤ 30% (대략).
- [ ] mismatch 분포에서 Critical 비율 ≤ 30%.
- [ ] 본 dogfooding 중 발생한 마스터 템플릿 강화 PR (있다면) W4-PR1 로 backport 또는 별 PR.

---

## 5. 실행 노트 (작업 중 갱신)

### 매일 측정 항목 자동화 후보

회고를 손으로 쓰는 게 번거롭다면 다음 helper 추가 검토 (본 PR 또는 W6):

```rust
// 가설: oculpm_dogfooding_stats(project_id, workday) -> Stats
pub struct Stats {
    pub entries_count: u32,
    pub frontmatter_error_count: u32,
    pub section_missing_count: u32,
    pub sessions_count: u32,
    pub severity_distribution: HashMap<MismatchSeverity, u32>,
}
```

→ CLI / Settings 화면에서 일 단위 stats 출력. v1 은 수동 카운트.

### 발견된 함정 / 변경

(작성 중)

### W6 로 넘기는 메모

- 작성률 < 60% 인 trigger 유형을 W6 의 "마스터 템플릿 v2" 로 인계.
- 본 dogfooding 중 발견된 토스트 / UI 마찰은 W6 의 stabilize PR 후보.
- 본 dogfooding 데이터는 W6 의 회고 입력 + 외부 발표/문서화 자료.

- **W4 종료 게이트**: 위 §4 DoD 5 항목 모두 ✅ 시 W4 종료 선언 + W5 (마이그레이션) 진입 가능.
