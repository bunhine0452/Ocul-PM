# W4-PR8 — 이벤트 → 토스트 매핑 + CommandPalette 8 명령

> **목표**: 백엔드의 6 이벤트를 사용자가 보는 토스트로 변환하고, CommandPalette 에 ocul-pm 명령 8개를 추가. 본 PR 으로 비로소 사용자가 "왜 자동 갱신이 안 됐지?" 같은 의문을 안 가지게 됨.
> **선행**: W4-PR4 (drift 이벤트), W4-PR2 (sync 명령), W4-PR5 (compare_layers), W4-PR6 (DiffVsNarrative), W4-PR7 (Settings).
> **참조**: [`../phases/W4-agents-dual-layer.md`](../phases/W4-agents-dual-layer.md) §W4-PR8, [`../02-frontend.md`](../02-frontend.md) §12 (CommandPalette 명령 목록).
> **상태**: ⬜

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

## 3. 테스트 (계획)

페이즈 §3 / §4 의 일부:

- [ ] 6 이벤트 각각이 의도된 토스트 (또는 무토스트) 표시. mock event emit → toast call 검증.
- [ ] CommandPalette 의 8 명령 모두 검색 + 실행 가능.
- [ ] drift 토스트의 [무시] 클릭 → 5분 쿨다운 (PR4 의 sessionStorage 와 협조).
- [ ] [동기화] 클릭 실패 시 destructive 토스트 + drift 미해결 유지.

수동 QA (페이즈 §4 #5, #12, #13):

- [ ] `.cursor/rules/ocul-pm.mdc` 외부 편집 → drift 토스트 → "동기화" → 원상복귀.
- [ ] integrity_warning: 잘못된 frontmatter 파일 → 토스트 + 노란 dot (W3-PR7 destructive 카드와 협조).
- [ ] CommandPalette 의 새 명령 8개 동작.

---

## 4. DoD

- [ ] 6 이벤트 모두 의도된 토스트 (또는 무토스트).
- [ ] CommandPalette 의 8 새 명령 동작.
- [ ] W3 의 ad-hoc `alert()` 호출 사이트 (PR5 의 handleManualEntry 등) 토스트로 교체.
- [ ] drift 5분 쿨다운 검증.

---

## 5. 실행 노트 (작업 중 갱신)

### 의사결정 후보

1. **토스트 라이브러리** — `sonner` (production-ready, shadcn 친화) vs 자체 구현 vs `react-hot-toast`. **`sonner` 추천** (zero deps, 작음).
2. **이벤트 listener 위치** — App.tsx 글로벌 mount vs 각 화면별. 글로벌 mount + projectId 필터가 깔끔. 이미 W3-PR4 의 WorkspaceContext 가 일부 listener 보유 → 본 PR 에서 토스트 측면만 추가.
3. **session_started/ended 디폴트 off** — 잡음 우려. Settings 에서 사용자가 켜기.
4. **CommandPalette 명령 검색어** — 한국어 + 영어 양쪽. 사용자가 "today" 또는 "오늘" 둘 다 검색 가능해야.
5. **integrity_warning 의 dedup** — 같은 파일에 대해 연속 emit 가능 → 첫 토스트만 + 30초 dedup.

### 발견된 함정 / 변경

(작성 중)

### 다음 PR 로 넘기는 메모

- PR9 의 자동 dogfooding 중 실제 LLM 작업이 일어날 때 본 PR 의 `journal_added` 토스트가 사용자에게 가시화 → "지금 LLM 이 기록 중이구나" 인지 가능.
- W5 의 마이그레이션 도중 발생하는 이벤트도 본 PR 의 토스트 시스템 reuse.
- W6 의 ULTRA stabilize 에서 토스트 텍스트 한/영 i18n 정리.
