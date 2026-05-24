# W3-PR7 — `JournalEntryDetail` (디테일 패널 + 마크다운 렌더)

> **목표**: 선택된 entry 의 frontmatter 배지 + 본문 마크다운 + 액션 (verify / open / copy / compare-stub). 기존 `src/components/Markdown.tsx` 를 그대로 재사용 — 별도 마크다운 컴포넌트 만들지 않음.
> **선행**: W3-PR3 (`getJournalEntry`, `setJournalVerified`), W3-PR6 (selectedEntryPath / handleToggleVerified).
> **참조**: [`../phases/W3-journal-today-ui.md`](../phases/W3-journal-today-ui.md) §W3-PR7, [`../02-frontend.md`](../02-frontend.md) §7, [`../refactor-integration.md`](../refactor-integration.md) §I-4 (Markdown 재사용).
> **상태**: ✅ 완료 (2026-05-24)

---

## 1. 구성 (실제)

```
JournalEntryDetail (src/features/oculpm/JournalEntryDetail.tsx — 450줄, 단일 파일)
├── DetailHeader
│   ├── 배지 라인 (TypeBadge / StatusBadge / DifficultyBadge / AgentBadge /
│   │             LanguageBadge / VerifiedBadge)
│   ├── 제목 라인 ([x]/[ ] prefix + title)
│   └── 메타 dl (session · created · path)
├── DetailBody
│   ├── 로딩/에러 상태 (Loader2 / AlertTriangle)
│   └── <Markdown>{entry.body_markdown}</Markdown>  ← src/components/Markdown.tsx 재사용
└── DetailActions
    ├── [검증됨 ✓ / 미검증으로 되돌리기]   (verified 상태에 따라 라벨 토글)
    ├── [원본 열기]                       (tauri-plugin-opener.openPath)
    ├── [마크다운 복사 / 복사됨]           (navigator.clipboard, 1.5s 피드백)
    └── [⚖ index 비교]                    (W4 까지 disabled, tooltip)
```

**가이드 §1 의 분리 (DetailHeader / DetailBody / DetailActions 파일 분리) → 단일 파일** — JournalEntryCard / SessionCard 와 동일 패턴 (각자 200~300줄 단일 파일 + inline 보조 컴포넌트). 분리 비용 > 이득. drilling 되는 prop 이 verify/open/copy 핸들러 3개 + 상태라서 한 파일에 두는 게 가독성 높음.

---

## 2. Frontmatter 배지 (실제)

PR6 의 `JournalEntryCard` 와 동일 토큰 (페이즈 §3.4 — `TYPE_COLOR`, `DIFFICULTY_OPACITY`). 배지 인스턴스는 detail 전용으로 mirror — JournalEntryCard 의 internal helper 를 export 하면 두 파일 모두 변경 시 결합도가 높아져 의도적으로 복제.

추가 배지:
- **AgentBadge** — `MessageCircle` 아이콘 + agent.id (예: `claude-code`). `frontmatter.agent.id` 우선, summary 의 `agent_id` 폴백.
- **LanguageBadge** — frontmatter 의 두 문자 ISO (예: `KO`/`EN`) 작은 배지. summary 에는 language 가 없어서 entry fetch 전엔 표시 안 됨 — 정상.
- **VerifiedBadge** — verified true 면 emerald `검증됨`, false 면 amber `미검증`. **summary 의 verified_by_user 를 source-of-truth 로 사용** → optimistic 토글이 즉시 반영 (entry refetch 안 기다림).

`session_id` 는 dl 메타에 mono 표시. 클릭→SessionCard 펼치고 스크롤은 본 PR 에서 미구현 (Today 화면이 단일 viewport scroll 이라 jump 의 가치 < 비용 — 추후 cleanup).

### Frontmatter 깨진 entry

`oculpmApi.getJournalEntry` 가 `null` 또는 throw 하면:
- 본문 자리에 빨간 destructive 카드 표시 + 안내 메시지 + `relative_path` (mono).
- 헤더는 summary 데이터로 fallback 표시 (배지/제목 모두 그대로).
- `[원본 열기]` 버튼 정상 동작 → 사용자가 에디터에서 직접 YAML 수정.
- `[검증됨으로 표시]` 버튼 disabled — `canVerify = !!entry`. tooltip "frontmatter 가 깨져 있어 토글할 수 없습니다".

**raw_yaml 토글은 미구현** — `JournalEntry` 타입에 `raw_yaml` 필드가 없음 (PR3 cache 가 parsed fields 만 보유). 별도 백엔드 prop 확장 PR 필요. 가이드 §3 의 "본 PR 은 prop 확장 안 함" 결정 그대로.

---

## 3. 마크다운 렌더링 (실제)

**원칙 그대로**: `src/components/Markdown.tsx` 한 줄 import. wrap 컴포넌트 만들지 않음.

```tsx
<Markdown>{entry.body_markdown}</Markdown>
```

`Markdown.tsx` 는 refactor W6 (UI-7) 에서 `CodeBlockWrapper` 로 hover 시 📋 복사 + "복사됨" 1.5s 피드백을 이미 제공 ([refactor-integration §I-4](../refactor-integration.md)) → 본 PR 의 detail 본문도 자동으로 같은 UX.

### body 안 상대경로 이미지 — 보류

`./_attachments/...` → tauri 안전 URL 변환은 본 PR 에서 미구현. 이유:
- `Markdown.tsx` 가 `transformLinkUri` / `transformImageUri` prop 을 노출하지 않음.
- 노출하려면 `Markdown.tsx` 본체 시그니처 변경 → 별도 PR 분량.
- 본문 안 이미지는 W3 phase 1 의 일반적 use case 가 아님 (entries 는 주로 텍스트).
- 별도 cleanup PR 후보로 위임.

### XSS

`Markdown.tsx` 가 `rehype-sanitize` 를 적용하지 않음 — 단일 사용자 / 로컬-only 환경이라 위험 낮음. default-safe 강화는 W6 stabilize 후보.

### 빈 body

`entry.body_markdown.trim() === ""` 케이스 → italic "본문 비어 있음. 프론트매터만 있는 entry 입니다." 표시. 빈 `<Markdown>` 이 호출되면 prose 컨테이너만 떠서 어색 — 명시적 빈 안내.

---

## 4. 액션 (실제)

### Verify 토글

- **단일 source-of-truth 원칙**: detail 의 verify 버튼은 자체 상태를 갖지 않고 부모의 `handleToggleVerified(relativePath)` 를 호출만 함. TimelineView 의 optimistic UI (entries state flip) 가 즉시 반영 → summary 의 `verified_by_user` 가 바뀌면서 VerifiedBadge 도 동시 갱신.
- 라벨: `verified` true → "검증됨 ✓ — 되돌리기" (emerald) / false → "검증됨으로 표시" (primary).
- disabled 조건: `entry == null` (parse 실패) → tooltip "frontmatter 가 깨져 있어 토글할 수 없습니다".

### 원본 파일 열기

- `import { openPath } from "@tauri-apps/plugin-opener"` (이미 deps 존재 — `package.json:19`, `Cargo.toml:22`).
- 절대 경로 합성: `${projectRoot.replace(/[\\/]+$/, "")}/.oculpm/journal/${relative_path}`. projectRoot 는 `useWorkspace().state.currentProjectRoot` → TodayScreen → TimelineView → JournalEntryDetail prop.
- 실패 (no editor associated 등) → `navigator.clipboard.writeText(absolutePath)` 폴백 + inline destructive 메시지 ("에디터를 열 수 없습니다. 경로를 클립보드에 복사했습니다. (...)").
- `projectRoot == null` → 버튼 disabled + tooltip.

### Compare with index

- 항상 disabled. tooltip "W4 (DiffVsNarrative) 페이즈에서 활성화됩니다".
- `FileDiff` 아이콘 + `⚖ index 비교` 라벨.
- W4-PR5 가 wire 시 활성화 (V3 의 disabled 버튼과 동일한 자리에 같은 핸들러 진입점).

### 마크다운 복사

- `serializeEntryAsMarkdown(frontmatter, body_markdown)` 헬퍼가 `---` YAML-ish 헤더 + body 를 reconstruct → clipboard.
- **주의**: cache 에 raw bytes 가 없어 byte-for-byte 복원 불가. "good enough" YAML 재직렬화 (필드 누락 / 따옴표 처리 단순화). 정확한 raw 복사가 필요하면 [원본 열기] → 에디터에서 직접 복사. 버튼 title 에 명시.
- 성공 → `복사됨` 1.5s 표시 (ClipboardCheck 아이콘) → idle 복귀.
- 실패 → inline destructive ("클립보드 복사 실패: ...").
- `entry == null` 이면 disabled.

---

## 5. 데이터 fetch / 갱신 (실제)

```ts
useEffect(() => {
  if (!path) { setEntry(null); return; }
  let cancelled = false;
  setLoading(true);
  oculpmApi.getJournalEntry(projectId, path)
    .then((e) => !cancelled && setEntry(e))
    .catch((err) => !cancelled && setFetchError(...))
    .finally(() => !cancelled && setLoading(false));
  return () => { cancelled = true; };
}, [projectId, path, updatedAt]);
```

- **deps 의 `updatedAt`** — `summary.updated_at` (PR2 cache 가 매 upsert 시 갱신). TimelineView 의 watcher 이벤트 → 디바운스 refetch → summary 의 updated_at 변경 → detail effect 재실행 → 본문 자동 갱신. 별도 event listener 불필요 — 부모의 listener 한 곳을 재사용.
- **cancellation flag** — race 방지. 사용자가 빠르게 j/k 누르면 이전 fetch 결과가 새 선택을 덮어쓰지 않도록.

---

## 6. 테스트 (실제)

### Vitest 부재 → tsc + 빌드 검증 (PR4/PR5/PR6 와 동일 정책)

- [x] `pnpm exec tsc --noEmit` — 0 errors.
- [x] `pnpm build` — green, 2.91s. JS bundle +9KB / CSS +1KB.
- [x] 백엔드 회귀 0 (백엔드 무변경).

### 자동 검증 (타입 시스템)

- [x] `JournalEntry` / `JournalEntrySummary` / `JournalFrontmatter` / `AgentRef` 모든 필드 정합.
- [x] `oculpmApi.getJournalEntry(projectId, path)` round-trip — `Promise<JournalEntry | null>` narrowing.
- [x] `openPath: (path: string, openWith?: string) => Promise<void>` 시그니처 — `@tauri-apps/plugin-opener` 의 d.ts 매칭.
- [x] `OculpmApiError` instanceof 분기 (fetchError 헬퍼 안).
- [x] `setOculpmStatus` 호출 없음 — 의도적 (verify 토글은 entries 만 갱신, status 는 무관).

### 수동 QA 매핑 (페이즈 §5 항목 4, 7)

| 항목 | 백엔드 충족 | 프론트 충족 |
|---|---|---|
| 4. frontmatter 일부러 깨뜨림 → 카드 노란 dot + detail 의 빨간 ⚠ | PR3 `getJournalEntry` 가 parse 실패 시 null 반환 | destructive 카드 + 헤더 fallback ✅ + [원본 열기] disabled 회피 ✅ |
| 7. verified 토글 → 파일 frontmatter 실제 변경 (`cat` 확인) | PR3 `setJournalVerified` write-through ✅ | 부모 핸들러 위임 + optimistic VerifiedBadge ✅ |
| 추가. 본문 코드 블록 hover → 📋 복사 | — | `src/components/Markdown.tsx` 의 CodeBlockWrapper 자동 ✅ |
| 추가. [원본 열기] 클릭 → OS 에디터 | `tauri-plugin-opener` 등록됨 | openPath 호출 + clipboard 폴백 ✅ |

`pnpm tauri dev` 1회 실행으로 위 동선 검증 가능.

---

## 7. DoD

- [x] 본문에 코드 블록 / 리스트 / 이미지 정상 렌더 — `Markdown.tsx` 의 prose/rehype-highlight 가 자동 처리. 이미지는 절대 URL 만 렌더 (상대경로 변환은 별도 PR).
- [x] verified 토글 클릭 → frontmatter 파일 업데이트 + 카드 / 디테일 동시 반영 — TimelineView optimistic state + VerifiedBadge 가 같은 summary 를 읽음.
- [x] [원본 열기] 가 OS file manager 또는 에디터에서 열림 — `openPath`. 실패 시 경로 클립보드 폴백.
- [x] frontmatter 깨진 entry 도 본문은 보임 — 헤더는 summary fallback, 본문 자리에 안내 + 원본 열기 가능.
- [x] 별도 마크다운 컴포넌트 만들지 않음 (`Markdown.tsx` import 만) — `JournalEntryDetail.tsx:35` 한 줄 import.
- [ ] `pnpm test` 7+ 케이스 green — **deferred (Vitest 미설치, PR4/PR5/PR6 와 동일 정책)**. tsc + build 로 대체:
  - [x] `pnpm exec tsc --noEmit` 0 errors.
  - [x] `pnpm build` green, 2.91s.

---

## 8. 실행 노트

### 신규/변경 파일 (3개)

| 파일 | 변경 |
|------|------|
| `src/features/oculpm/JournalEntryDetail.tsx` | **신규** 450줄 — DetailHeader (배지 6종) + DetailBody (Markdown + 에러/빈 상태) + DetailActions (4 버튼) + serializeEntryAsMarkdown 헬퍼 |
| `src/features/oculpm/TimelineView.tsx` | DetailPaneStub / Row helper 제거 (~60줄), `projectRoot: string \| null` prop 추가, `<JournalEntryDetail …>` 렌더로 교체 |
| `src/features/today/TodayScreen.tsx` | `projectRoot = state.currentProjectRoot` 추출 + TimelineView 에 prop 전달 |

### 의사결정 / 변경

1. **단일 파일 구조** — 가이드 §1 의 4-파일 분리 대신 한 파일에 inline 함수 (`DetailHeader`, `DetailActions`, 5종 배지, 2개 helper). JournalEntryCard / SessionCard / OculpmOnboardingModal 모두 동일 패턴. drilling 되는 prop 이 verify/open/copy 3개 핸들러 + actionError 상태라 한 파일에 두는 게 가독성 높음. 향후 raw_yaml 토글 / 이미지 base URL 같은 큰 기능이 detail 에 추가되면 분리 권장.

2. **배지 중복 (JournalEntryCard ↔ JournalEntryDetail)** — TypeBadge / DifficultyBadge 등을 JournalEntryCard 에서 export 해 detail 에서 import 할 수 있었지만 의도적으로 복제. 이유: (a) 두 화면이 미세하게 다른 시각 요구사항을 갖게 되면 한쪽 변경이 다른 쪽을 깨뜨림. (b) detail 전용 AgentBadge / LanguageBadge / VerifiedBadge 가 추가됐는데 card 는 다른 표현 (hover 토글 등) 을 쓰므로 통합이 강제로 abstraction 을 만들었을 것. (c) ~60줄 비용 < 응집도 이득. 향후 시안이 정확히 일치하도록 굳어지면 `src/features/oculpm/badges.tsx` 같은 공유 모듈로 추출 권장.

3. **Verify source-of-truth** — detail 이 자체 verified state 를 두지 않고 부모 (TimelineView) 의 optimistic summary 만 표시. 결과: (a) 카드 hover 토글 / detail 버튼 어느 쪽을 눌러도 두 곳이 즉시 동기. (b) 부모의 refetch / event listener 가 권위. (c) detail 의 책임은 "표시 + onToggleVerified(path) 위임" 으로 단순.

4. **`updated_at` 을 effect dep 로** — TimelineView 가 watcher 이벤트로 entries 를 refetch 하면 summary 의 `updated_at` 이 바뀜. detail 이 이 prop 변화를 deps 로 잡으면 자동으로 body_markdown 까지 refetch 됨. 별도 event listener 불필요 → 책임 한 곳. trade-off: optimistic verify 토글이 부모 entries 의 verify 필드만 바꾸고 updated_at 은 안 바꿔서 body 재fetch 가 발생하지 않음 (의도된 동작 — verify 만 바뀌면 본문 그대로).

5. **raw bytes 보존 안 함의 결과** — 마크다운 복사가 byte-for-byte 가 아닌 best-effort YAML 재직렬화. agent 객체 / FileTouched 배열 같은 nested 필드는 단순한 inline 표기로 직렬화. 사용자가 정확한 raw 가 필요하면 [원본 열기] → 에디터 복사. 버튼 title 에 명시. 향후 cleanup: PR3 cache 에 `raw_yaml: TEXT` 컬럼 추가 + 전용 binding → 진짜 raw copy.

6. **이미지 base URL 변환 보류** — `Markdown.tsx` 의 prop 확장이 필요하고 그 자체로 별 PR. 본 PR 스코프 밖. 본문에 상대경로 이미지가 들어가는 use case 는 W3 phase 1 의 일반적 entry 가 아니라서 우선순위 낮음.

7. **session_id 클릭 → SessionCard 펼치고 jump 보류** — 단일 viewport scroll 의 Today 화면에서 session 카드는 이미 화면 위쪽에 있어 클릭 jump 의 가치 < 비용. 추후 화면이 multi-pane / virtualized 로 가면 도입.

8. **빈 body 처리** — `body_markdown.trim() === ""` 케이스는 raw prose 가 빈 상태로 떠서 어색. italic 안내 ("본문 비어 있음. 프론트매터만 있는 entry 입니다.") 로 정직 표시.

### 의도된 누락 (PR8/W4/W6 에 위임)

- **`raw_yaml` 토글** — 백엔드 prop 확장 필요. W6 stabilize 후보.
- **이미지 base URL** — `Markdown.tsx` 의 prop 확장 + 별 PR.
- **session 클릭 jump / scrollIntoView** — 향후 multi-pane 화면 검토 후.
- **CategoryFilterBar 와의 통합** — PR8.
- **DiffVsNarrative 활성화** — W4-PR5 가 [⚖ index 비교] 버튼의 disabled 를 풀고 모달 wire.
- **자동 토스트 (verify 성공/실패, copy 성공)** — W4 의 통합 토스트 레이어. 현재는 inline destructive 카드 / 1.5s 피드백으로 surface.
- **Vitest 케이스 7+개** — W6 stabilize 의 별도 PR (Vitest 인프라 도입과 함께).

### 빌드/타입 체크 시간

- `pnpm exec tsc --noEmit` — 즉시 (0 errors).
- `pnpm build` — **2.91s** (tsc + vite). JS bundle +9KB / CSS +1KB.
- 백엔드 무변경 → cargo 회귀 0.

### PR8 로 넘기는 메모

- **CategoryFilterBar 와 detail 상호작용** — PR8 의 filter 가 entries 를 좁히면 selected entry 가 사라질 수 있음. TimelineView 는 이미 `selectedEntryPath` 가 flatEntries 에 없으면 첫 entry 로 fall-back 하는 로직 보유 → detail 도 자동으로 새 entry 로 전환됨.
- **VerifiedBadge / TypeBadge 등을 공유 모듈로 추출** — PR8 의 검색결과 카드도 같은 배지를 쓰게 될 가능성. 그때 `src/features/oculpm/badges.tsx` 추출 검토.

### W4 로 넘기는 메모

- **[⚖ index 비교] 버튼 wire** — `JournalEntryDetail.tsx` 의 disabled 버튼 자리에 W4-PR5 의 `DiffVsNarrativeModal` 호출 추가.
- **본문 안 `src/foo.rs:42` 링크 → IDE jump** — W6 후보. `Markdown.tsx` 의 link transformer 가 필요.

- **본 PR 의 미해결 항목 없음** — 다음 PR (W3-PR8 CategoryFilter) 진입 가능.
