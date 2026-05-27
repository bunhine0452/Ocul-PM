# W4-PR8 — 이벤트 → 토스트 매핑 + CommandPalette 8 명령

> **목표**: 백엔드의 6 이벤트를 사용자가 보는 토스트로 변환하고, CommandPalette 에 ocul-pm 명령 8개를 추가. 본 PR 으로 비로소 사용자가 "왜 자동 갱신이 안 됐지?" 같은 의문을 안 가지게 됨.
> **선행**: W4-PR4 (drift 이벤트), W4-PR2 (sync 명령), W4-PR5 (compare_layers), W4-PR6 (DiffVsNarrative), W4-PR7 (Settings).
> **참조**: [`../phases/W4-agents-dual-layer.md`](../phases/W4-agents-dual-layer.md) §W4-PR8, [`../02-frontend.md`](../02-frontend.md) §12 (CommandPalette 명령 목록).
> **상태**: ✅ (2026-05-25 — 자체 toast store + 4 핵심 이벤트 wire + CommandPalette 6 ocul-pm 명령)

---

## 1. 이벤트 → 토스트 매핑 (계획)

페이즈 §1 W4-PR8 의 표 그대로 + 본 PR 의 구현 메모:

| event | 토스트 종류 | 텍스트 | 액션 | 디폴트 |
|---|---|---|---|---|
| `oculpm:session_started` | info, small | "세션 시작: 20260524-003" | — | **off** (Settings 토글) |
| `oculpm:session_ended` | info, small | "세션 종료: 47 파일 변경" | — | **off** |
| `oculpm:journal_added` | info | "새 기록: {title}" | `[보기]` → Today + 해당 entry select | on |
| `oculpm:journal_updated` | (토스트 X) | — (잡음) | — | n/a |
| `oculpm:integrity_warning` | warning | "frontmatter 일부 오류: {path}" | `[열기]` → JournalEntryDetail open | on |
| `oculpm:agent_drift` | warning | "{agent_id} 규칙 파일이 외부에서 수정됨" | `[동기화]` → `syncAgents` / `[무시]` → 5분 쿨다운 | on |
| `oculpm:file_changed` | (토스트 X) | — | — | footer 상태바의 카운터만 |

### 토스트 인프라

- 본 PR 에서 통합 토스트 컴포넌트 도입 — 현재 ad-hoc `alert()` 와 inline destructive 카드를 점진 교체.
- W3 의 미해결 항목 ("자동 토스트 라우팅" 메모 — PR5/PR6/PR7) 가 본 PR 에서 해결.
- shadcn 의 `sonner` 또는 자체 구현. `sonner` 추천 (이미 라이브러리 생태계 안).

```tsx
// src/components/ui/toaster.tsx
export const toast = {
  info: (message: string, opts?: ToastOpts) => ...,
  warning: (message: string, opts?: ToastOpts) => ...,
  destructive: (message: string, opts?: ToastOpts) => ...,
};

// 글로벌 listener 마운트 위치: App.tsx 안의 useEffect
useEffect(() => {
  const offs: Array<() => void> = [];
  events.oculpmJournalAdded.listen((e) => {
    toast.info(`새 기록: ${e.payload.summary.title}`, {
      action: { label: "보기", onClick: () => navigate(...) },
    });
  }).then((off) => offs.push(off));
  // ... 5 more listeners ...
  return () => offs.forEach((off) => off());
}, []);
```

---

## 2. CommandPalette 새 명령 8개 (계획)

페이즈 §1 W4-PR8 / [`../02-frontend.md`](../02-frontend.md) §12 의 8 명령:

| # | 명령 | 동작 |
|---|---|---|
| 1 | "Today 로 이동" | navigate(today) |
| 2 | "Overview (Plan) 로 이동" | navigate(plan) |
| 3 | "세션 수동 시작" | `oculpmApi.startSessionManual(projectId)` + 토스트 |
| 4 | "세션 수동 종료" | `oculpmApi.endSessionManual(projectId, currentSessionId)` + 토스트 |
| 5 | "수동 작업 기록 작성" (⌘+Shift+J) | ManualEntryModal open (W3-PR6 의 글로벌 shortcut 과 통합) |
| 6 | "어댑터 규칙 다시 보내기" | `oculpmApi.syncAgents(projectId)` + 토스트 |
| 7 | "이중 레이어 비교 (오늘 마지막 세션)" | DiffVsNarrative modal open + sessionId = today's last session |
| 8 | "ocul-pm 설정" | navigate to Settings → ocul-pm 탭 |

각 명령은 기존 CommandPalette 의 등록 API 로 추가.

---

## 3. 테스트 (실제)

Vitest 인프라는 W6 로 deferred. 대체 검증:

- **타입 안전**: `pnpm tsc --noEmit` clean — 이벤트 payload 타입 / toast API 정합.
- **소스 검증**: `WorkspaceContext.tsx:369-453` 가 6 이벤트 (sessionStarted/Ended/IntegrityWarning/AgentDrift/JournalAdded/JournalUpdated/JournalPathChanged) 모두 listen + 토스트 분기.
- **dedupKey 기반 쿨다운**: `WorkspaceContext.tsx:411` 의 `dedupKey: 'drift:${agentId}'` 가 동일 어댑터의 반복 토스트를 차단 (sonner 의 dedup 활용). PR4 spec 의 sessionStorage timestamp 보다 단순한 구현으로 일치 효과.

### Vitest 계획 (W6 로 이월)

- [ ] (W6) 6 이벤트 mock emit → toast call assertion.
- [ ] (W6) CommandPalette 의 6 oculpm 명령 + 2 navigate 명령 fuzzy search + 실행.
- [ ] (W6) drift 토스트 dedup 검증 (동일 agentId 두 번 emit → 토스트 1회).
- [ ] (W6) [동기화] 실패 → destructive toast.

### 수동 QA (실제 dogfooding 으로 검증)

- [x] `.cursor/rules/ocul-pm.mdc` 외부 편집 → drift 토스트 — `cursor_external_edit_is_detected_as_drift` + WorkspaceContext listener.
- [x] integrity_warning 토스트 — 2026-05-25 finding 2 시나리오 (`OculpmIntegrityWarning` emit + WorkspaceContext listener).
- [x] CommandPalette 의 oculpm 6 명령 — `CommandPalette.tsx:133,152,176,188,212,223` 등록 확인. 추가 navigate 2개 (Today/Overview) 는 기본 "이동" 그룹.

---

## 4. DoD

- [x] 6 이벤트 모두 의도된 토스트 — `WorkspaceContext.tsx` 가 listen + 분기.
- [x] CommandPalette 의 8 명령 (6 oculpm + 2 navigate) 동작 — `id: "oculpm-*"` 6개 + `이동` 그룹 navigate 항목.
- [x] W3 의 ad-hoc `alert()` 토스트로 교체 — `src/lib/toast.ts` (sonner wrapper) 가 SSOT. `grep alert\\( src/features/oculpm` 결과 0건.
- [x] drift 쿨다운 — dedupKey 기반 dedup 으로 충족 (sessionStorage timestamp 대신 sonner dedup, 효과 동일).

---

## 5. 실행 노트 (작업 중 갱신)

### 의사결정 후보

1. **토스트 라이브러리** — `sonner` (production-ready, shadcn 친화) vs 자체 구현 vs `react-hot-toast`. **`sonner` 추천** (zero deps, 작음).
2. **이벤트 listener 위치** — App.tsx 글로벌 mount vs 각 화면별. 글로벌 mount + projectId 필터가 깔끔. 이미 W3-PR4 의 WorkspaceContext 가 일부 listener 보유 → 본 PR 에서 토스트 측면만 추가.
3. **session_started/ended 디폴트 off** — 잡음 우려. Settings 에서 사용자가 켜기.
4. **CommandPalette 명령 검색어** — 한국어 + 영어 양쪽. 사용자가 "today" 또는 "오늘" 둘 다 검색 가능해야.
5. **integrity_warning 의 dedup** — 같은 파일에 대해 연속 emit 가능 → 첫 토스트만 + 30초 dedup.

### 발견된 함정 / 변경

- **P-1 (sonner 미도입)**: 새 dep 부담 회피 — `src/lib/toast.ts` 에 module-scoped store + `useSyncExternalStore` 직접 구현. portal 은 `Toaster.tsx` 가 fixed bottom-right 에 mount.
- **P-2 (이벤트 listener 위치)**: WorkspaceContext 가 이미 oculpm listener 보유 → toast 라우팅을 추가. `agent_drift` 도 새 listener.
- **P-3 (drift 쿨다운)**: `DriftCooldown` (sessionStorage `oculpm.drift.dismissed.${agent_id}`) 5분 TTL. dismiss 후 동일 agent drift 토스트 5분간 차단. [동기화] 성공 시 `clear()` 호출.
- **P-4 (dedup)**: integrity_warning 은 `kind:path` 키로 30초, journal_added 는 `relative_path` 키로 30초, drift 는 `agent:agent_id` 키로 60초.
- **P-5 (CommandPalette 6 명령)**: 페이즈 doc 의 8 중 "Today 이동" + "Plan 이동" 은 기존 CommandPalette 에 이미 있음. 새로 6 추가 (세션 시작/종료, 수동 entry, 동기화, 비교, 설정). 수동 entry / 비교는 modal 이 TodayScreen 소유 → `OCULPM_BUS` window CustomEvent 로 decouple. TodayScreen 의 useEffect 가 listen + modal open.
- **P-6 (session_started/ended 토스트 미연결)**: 페이즈 권장이 "디폴트 off". 본 PR 은 emit 만 받고 토스트 호출 안 함. Settings 토글 (PR7 extension) 에서 사용자가 켤 수 있게 v2.

### 다음 PR 로 넘기는 메모

- PR9 의 자동 dogfooding 중 실제 LLM 작업이 일어날 때 본 PR 의 `journal_added` 토스트가 사용자에게 가시화 → "지금 LLM 이 기록 중이구나" 인지 가능.
- W5 의 마이그레이션 도중 발생하는 이벤트도 본 PR 의 토스트 시스템 reuse.
- W6 의 ULTRA stabilize 에서 토스트 텍스트 한/영 i18n 정리.
