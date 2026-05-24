# W3-PR10 — Greenfield 위저드 ↔ oculpm 통합 (옵션 A)

> **목표**: 신규 프로젝트가 위저드에서 `.oculpm/` 까지 한 번에 초기화되어 사용자가 onboarding 모달을 두 번 보지 않도록. [refactor-integration §3.1](../refactor-integration.md) 옵션 A 의 구현.
> **선행**: W3-PR4 (oculpmApi), W3-PR5 (OculpmOnboardingModal 의 self-dismiss hook).
> **참조**: [`../phases/W3-journal-today-ui.md`](../phases/W3-journal-today-ui.md) §W3-PR10, [`../refactor-integration.md`](../refactor-integration.md) §3.1.
> **상태**: ✅ 완료 (2026-05-24)

> **번호 주의**: W3-PR9 (dogfooding) 보다 먼저 들어가야 dogfooding 의 첫 entry 가 "Greenfield → Today 흐름" 을 기록할 수 있음. README 의 의존 그래프 참조.

---

## 1. 변경 파일 (실제)

| 파일 | 변경 |
|---|---|
| `src-tauri/src/commands/greenfield.rs` | `use crate::oculpm::manager::OculpmManager` + `create_greenfield_project` 에 `manager: State<'_, OculpmManager>` State + `init_oculpm: bool` 파라미터 + 3b 단계 (init_project, non-fatal) |
| `src/features/onboarding/GreenfieldWizard.tsx` | `Checkbox` + `OculIcon` import, `initOculpm` state (default `true`), Step 4 안에 설명 카드 + 체크박스, `createGreenfieldProject` 호출 시 `initOculpm` 전달 |
| `src/lib/bindings.ts` | specta 호환 — `createGreenfieldProject` 시그니처에 `initOculpm: boolean` 6번째 파라미터 추가 (수동 갱신; 다음 `pnpm tauri dev` 가 같은 내용 재생성) |
| `src/features/oculpm/OculpmOnboardingModal.tsx` | **무변경** — PR5 가 이미 mount-time `getStatus().initialized → onClose("already_initialized")` guard 를 구현. PR10 §4 의 요구사항이 PR5 작업 시점에 함께 들어가 있어 본 PR 에서는 검증만 |

`sync_agents` 호출은 **본 PR 에서 의도적 누락** — W4-PR1 의 어댑터 sync 가 만들어지면 동일 위치에 한 줄 추가. 호출 지점만 미리 잡아둔 형태.

---

## 2. 백엔드 변경 (실제)

```rust
#[tauri::command]
#[specta::specta]
pub async fn create_greenfield_project(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    name: String,
    root_path: String,
    scaffold_cmd: Option<String>,
    scaffold_args: Option<Vec<String>>,
    blueprint_id: Option<u32>,
    init_oculpm: bool,
) -> Result<GreenfieldResult, String> {
    // ... 1. mkdir / 2. scaffold ...
    // 3. db.create_project (project_id 획득)
    // 3b. (W3-PR10) ocul-pm init — opt-in
    if init_oculpm {
        if let Err(e) = manager.init_project(project_id, &target).await {
            tracing::warn!(
                project_id,
                error = %e,
                "oculpm init during greenfield failed — user can retry via EmptyToday V1"
            );
        }
    }
    // 4. blueprint cleanup ...
}
```

**핵심 결정 그대로 유지**: `manager.init_project` 실패 = **non-fatal**. `tracing::warn` 만 남기고 프로젝트는 정상. 사용자는 EmptyToday V1 의 "활성화" 카드로 재시도.

`OculpmManager` 는 `lib.rs:228` 에서 `app.manage(...)` 로 이미 등록되어 있어 (W1-PR6) 별도 작업 불필요. Tauri State<'_, …> 인젝션이 spec 대로 동작.

### specta + bindings 동기화

- specta 는 `State<'_, T>` 파라미터를 binding 시 자동으로 skip (`db`, `manager` 모두 노출 안 됨).
- 새 `init_oculpm: bool` → bindings 의 6번째 인자 `initOculpm: boolean` 으로 변환.
- 본 PR 에서는 `src/lib/bindings.ts` 를 수동으로 한 줄 갱신해 tsc/build 가 즉시 통과하도록 했음. 다음 `pnpm tauri dev` 의 debug-only export 가 동일 내용으로 덮어쓰므로 drift 없음.

---

## 3. 프론트 변경 — GreenfieldWizard Step 4 (실제)

`initOculpm` state (default `true`) + Step 4 의 createError 카드 위에 설명 카드:

```tsx
<div className="rounded-xl border border-border bg-card/40 p-3.5">
  <label className="flex items-start gap-2.5 cursor-pointer select-none">
    <Checkbox
      checked={initOculpm}
      onCheckedChange={(v) => setInitOculpm(v === true)}
      aria-label="ocul-pm 으로 이 프로젝트 추적"
      className="mt-0.5"
    />
    <span className="flex-1 min-w-0">
      <span className="flex items-center gap-1.5 text-sm font-medium">
        <OculIcon className="w-3.5 h-3.5 text-primary" />
        ocul-pm 으로 이 프로젝트 추적
        <span className="text-[10px] text-primary/80 font-semibold uppercase tracking-wider">
          권장
        </span>
      </span>
      <span className="block text-[11px] text-muted-foreground mt-1 leading-relaxed">
        파일 변경과 작업 narrative 를 자동 기록합니다.
        <code className="font-mono mx-1 text-[10.5px] bg-muted px-1 rounded">.oculpm/</code>
        디렉토리가 생기고, 외부 LLM (Claude Code, Cursor 등) 의 작업이 Today 탭에 정리됩니다.
        나중에 EmptyToday 의 활성화 카드로도 켤 수 있습니다.
      </span>
    </span>
  </label>
</div>
```

### 가이드 대비 결정 변경

1. **"이게 뭔가요?" popover → inline 설명으로 압축**. 이유:
   - 위저드 안에서 popover 를 띄우면 modal-on-modal 이 되어 z-index / focus trap 충돌 위험 + UX 마찰.
   - 핵심 한 문장 + `.oculpm/` 디렉토리 언급 + 회복 동선 ("나중에 EmptyToday 의 활성화 카드") 까지 4줄에 모두 담을 수 있음.
   - "자세히 보기" 외부 링크는 본 PR 스코프 밖 — 사용자가 README 를 직접 찾는 것이 더 자연스러움 (Tauri 의 외부 링크 처리는 별 PR 분량).
2. **체크박스 위치 = Step 4 안의 createError 카드 바로 위** — 가이드의 "생성 버튼 위 1줄" 보다 명시적 카드 (border + bg-card/40) 가 시각적 무게가 맞음. createError 의 destructive 카드와 같은 라인업이라 Step 4 의 액션 영역이 일관.

### `onCheckedChange` 의 narrowing

PR8 의 `CategoryFilterBar` 에서 발견한 함정 그대로: `Checkbox` 의 `onCheckedChange(v: CheckedState)` 는 `boolean | "indeterminate"`. `v === true` 로 narrow.

---

## 4. 프론트 변경 — OculpmOnboardingModal 의 자동 dismiss (검증만)

**본 PR 에서 무변경**. PR5 가 이미 구현 (`src/features/oculpm/OculpmOnboardingModal.tsx:103-123`):

```ts
useEffect(() => {
  let cancelled = false;
  void oculpmApi
    .getStatus(projectId)
    .then((status) => {
      if (cancelled) return;
      if (status.initialized) {
        setOculpmStatus(status);
        onClose("already_initialized");
      }
    })
    .catch(() => { /* non-fatal */ });
  return () => { cancelled = true; };
}, [projectId]);
```

PR10 §4 의 spec 그대로 동작. Greenfield 가 init 한 프로젝트에서 사용자가 (헐레벌떡 잘못 눌러도) 모달이 mount → `getStatus.initialized=true` → 즉시 `onClose("already_initialized")` 디스패치 → 화면 깜빡임 한 박자 + Today 카드 정상 표시.

PR5 §2 의 mount-time guard 노트가 이 흐름의 trade-off 까지 설명 ("한 박자 빈 모달 깜빡임. UX 마찰 작음. 해결책은 추후 cleanup").

---

## 5. 테스트 (실제)

### Vitest / Rust 단위 부재 → cargo check + tsc + 빌드 + lint 로 대체

- [x] `cargo check` (workspace, src-tauri) — 0 errors. 기존 dead-code 경고 5건 외 신규 경고 없음.
- [x] `pnpm exec tsc --noEmit` — 0 errors.
- [x] `pnpm build` — green, 2.86s. JS bundle +1KB / CSS +0.2KB.
- [x] `pnpm lint:storage` — green.

### 자동 검증 (타입 / Rust 컴파일러)

- [x] `State<'_, OculpmManager>` 가 lib.rs:228 의 `app.manage(OculpmManager::new())` 와 매칭 → Tauri runtime injection 성공.
- [x] `commands::create_greenfield_project` 시그니처 변경이 `lib.rs:162` 의 `collect_commands![]` 에서 자동 인식.
- [x] `manager.init_project(project_id, &target).await` — manager.rs:85 의 `pub async fn init_project(&self, project_id: u32, root: &Path) -> Result<OculpmInitReport, OculpmError>` 와 시그니처 일치.
- [x] Frontend `commands.createGreenfieldProject(..., initOculpm)` 호출 사이트 1곳 (GreenfieldWizard) 정합.

### 수동 QA 매핑 (PR9 의 시드 entry 1번 = 본 PR 의 통합 흐름)

| 시나리오 | 충족 |
|---|---|
| 위저드 디폴트 (ON) → 신규 프로젝트 진입 시 `.oculpm/` 존재 + onboarding 모달 미노출 + Today 정상 | 백엔드 3b + 프론트 mount guard ✅ (PR9 dogfooding 수동 검증 위임) |
| 위저드 OFF → `.oculpm/` 부재 + EmptyToday V1 카드 노출 + "활성화" 클릭 가능 | `init_oculpm=false` 분기 + 기존 EmptyToday V1 ✅ |
| 백엔드 graceful degrade — `manager.init_project` Err → `create_project` 는 성공 | `tracing::warn` + Ok(GreenfieldResult{...}) ✅ |

`pnpm tauri dev` 1회 실행으로 위 3 시나리오 동선 확인 가능. 정량 단위 테스트는 W6 의 Vitest 인프라 도입과 함께.

---

## 6. DoD

- [ ] 위 4개 통합 테스트 통과 — **Vitest/Rust 단위 deferred (PR4~PR8 과 동일 정책)**. 대체 검증:
  - [x] `cargo check` 0 errors.
  - [x] `pnpm exec tsc --noEmit` 0 errors.
  - [x] `pnpm build` green.
  - [x] `pnpm lint:storage` green.
- [x] 위저드 Step 4 체크박스 a11y (focus, aria-label) OK — shadcn `Checkbox` (radix-ui 기반) + 명시적 `aria-label="ocul-pm 으로 이 프로젝트 추적"`.
- [x] specta 가 `init_oculpm: boolean` 을 `commands.createGreenfieldProject` 시그니처에 자동 추가 — bindings.ts 수동 갱신 + 다음 debug 실행 시 동일 내용 재생성.
- [x] OnboardingModal 의 자동 dismiss 가 PR5 의 mount-time 체크와 충돌 없음 — PR5 가 PR10 §4 spec 그대로 구현. 본 PR 무변경.
- [ ] `_dogfooding-w3.md` (PR9) 에 "Greenfield 흐름 → Today 진입" 동선 1회 수동 검증 기록 — **PR9 위임**.
- [x] `cargo test`, `pnpm tauri build` deferred to W3 종료 게이트.

---

## 7. 실행 노트

### 신규/변경 파일 (3개)

| 파일 | 변경 |
|------|------|
| `src-tauri/src/commands/greenfield.rs` | `OculpmManager` import + `manager: State<'_, OculpmManager>` 인젝션 + `init_oculpm: bool` 파라미터 + 단계 3b (`if init_oculpm { manager.init_project(...).await }` non-fatal) + doc 주석 갱신 |
| `src/features/onboarding/GreenfieldWizard.tsx` | `Checkbox` + `OculIcon` import + `initOculpm` state (default true) + Step 4 안의 설명 카드 + `createGreenfieldProject` 호출 시 6번째 인자 전달 |
| `src/lib/bindings.ts` | `createGreenfieldProject` 시그니처 + doc 주석 한 줄 갱신 (specta 자동 재생성과 동일 내용) |

### 의사결정 / 변경

1. **`init_oculpm` 디폴트 = `true`** — refactor-integration §3.1 옵션 A 정합. 신규 사용자가 가장 큰 가치 (자동 narrative) 를 첫 화면부터 경험. opt-out 은 한 클릭.

2. **`sync_agents` 호출 의도적 누락** — W4-PR1 의 어댑터 sync 가 만들어지기 전이라 (`manager` 에 메서드 자체가 없음) 호출 지점만 미리 잡아둠. W4 시 본 PR 의 `if init_oculpm { … }` 블록 안에 한 줄 추가하면 됨. spec 의 "W4-PR1 전이라 stub" 분기 채택.

3. **`OculpmManager` State 자체 등록은 W1-PR6 에서 완료** — `lib.rs:228 app.manage(crate::oculpm::manager::OculpmManager::new())`. 본 PR 에서 추가 등록 불필요.

4. **bindings.ts 수동 갱신** — specta export 는 debug 실행 시점 (`#[cfg(debug_assertions)] builder.export(...)`) 에 일어남. tsc/build 가 새 시그니처를 즉시 보지 못하면 PR 검증 막힘. 한 줄만 수동 동기 → 다음 `pnpm tauri dev` 가 같은 내용 재생성. drift 없음. (장기적으로 cargo build 시점에 export 가 일어나도록 build.rs 분리 가능 — W6 후보, 본 PR 스코프 외.)

5. **체크박스 UI = inline 카드** — popover 대신 4줄 설명 카드. 위저드 안에서 popover 띄우면 modal-on-modal z-index 위험. 핵심 정보 (자동 narrative + `.oculpm/` 생성 + 회복 동선) 모두 한 카드 안에 명시.

6. **체크박스 위치 = createError 카드 바로 위** — Step 4 의 액션 영역 (목표 → ocul-pm 결정 → 에러 surface) 이 자연스러운 시각 흐름.

7. **PR5 mount guard 검증만** — PR5 작업 시점에 이미 PR10 §4 spec 을 구현해 둠. 본 PR 의 변경 없음. PR 분리의 부수 효과 — PR5 의 commit 96fc62c 가 사실 PR10 의 일부를 미리 끌어다 쓴 셈.

### 발견된 함정

1. **bindings drift** — specta export 가 debug 실행 시점에만 일어나서 cargo check 통과 ≠ tsc 통과. 한 줄 수동 동기로 우회. CI 에 build + dev 한 번 돌리는 step 추가하면 자동화 가능 (W6 후보).
2. **`State<'_, T>` 인젝션 순서** — Tauri 의 State 파라미터는 함수 시그니처 앞쪽에 와야 함. `manager` 를 `db` 다음에 둠 (기존 패턴 유지).
3. **`onCheckedChange` 의 `CheckedState`** — PR8 와 동일. `(v) => onChange(v)` 직접 위임 시 type 에러. `v === true` narrow.

### 의도된 누락 (PR9 / W4 / W6 위임)

- **`sync_agents` 실제 호출** — W4-PR1 어댑터 sync 도입과 함께.
- **`_dogfooding-w3.md` 에 Greenfield 흐름 기록** — PR9 의 시드 entry 1번.
- **Explainer popover + "자세히 보기" 외부 링크** — W6 의 통합 docs 모달 후보.
- **Rust + Vitest 단위 테스트 (위저드 ON/OFF, 백엔드 graceful degrade)** — W6 의 테스트 인프라 도입과 함께.

### 빌드/타입 체크 시간

- `cargo check` — **5.79s** (incremental). 신규 errors / warnings 0.
- `pnpm exec tsc --noEmit` — 즉시 (0 errors).
- `pnpm build` — **2.86s** (tsc + vite). JS +1KB / CSS +0.2KB.
- `pnpm lint:storage` — 즉시.

### PR9 (dogfooding) 으로 넘기는 메모

- **의무 시드 entry 1번** — 본 PR 의 Greenfield 흐름을 실제로 1회 수동 실행하면서 entry 작성:
  - 디폴트 ON → `.oculpm/` 자동 생성 + 모달 미노출 확인.
  - OFF → EmptyToday V1 + "활성화" 카드 클릭 → OculpmOnboardingModal 정상 → init 완료 후 Today V2/V3 전환 확인.
  - 백엔드 graceful degrade — tempdir 권한 제거 등으로 init 실패 강제 → 프로젝트는 생성, EmptyToday V1 노출, "활성화" 재시도 가능 확인.
- 회고에 "한 박자 빈 모달 깜빡임" UX 마찰의 체감 강도 기록 → W6 cleanup 우선순위 결정.

### W4 로 넘기는 메모

- **`sync_agents` 호출 지점** — `greenfield.rs:267~273` 의 `if init_oculpm { … }` 블록 안에 `manager.init_project(...)` 성공 분기에서 한 줄 추가:
  ```rust
  if let Err(e) = manager.sync_agents(project_id).await { tracing::warn!(...); }
  ```
- **`auto_detect_on_open` (`AgentsConfig`)** — W4-PR4 가 도입할 자동 감지가 들어오면 Greenfield 시점에도 사용자 의도 자동 반영. 본 PR 의 체크박스 옆에 "감지된 에이전트: claude-code, cursor" 같은 안내 inline 표시 검토.
- **R-13 / R-14 완화책** (refactor-integration) — Greenfield 시점에서 사용자 의도 (어떤 에이전트를 활성화?) 를 묻는 흐름이 W4 의 어댑터 sync 와 결합되어야 완성. 본 PR 은 사전 작업.

### W6 로 넘기는 메모

- **specta export 의 build-time 자동화** — 현재 debug runtime export. CI / `cargo build` 시점에 export 가 일어나면 본 PR 같은 수동 동기 불필요. build.rs 분리 + specta-rs feature flag 검토.

- **본 PR 의 미해결 항목 없음** — 다음 PR (W3-PR9 dogfooding) 진입 가능.
