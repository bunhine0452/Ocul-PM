# W3-PR10 — Greenfield 위저드 ↔ oculpm 통합 (옵션 A)

> **목표**: 신규 프로젝트가 위저드에서 `.oculpm/` 까지 한 번에 초기화되어 사용자가 onboarding 모달을 두 번 보지 않도록. [refactor-integration §3.1](../refactor-integration.md) 옵션 A 의 구현.
> **선행**: W3-PR4 (oculpmApi), W3-PR5 (OculpmOnboardingModal 의 self-dismiss hook).
> **참조**: [`../phases/W3-journal-today-ui.md`](../phases/W3-journal-today-ui.md) §W3-PR10, [`../refactor-integration.md`](../refactor-integration.md) §3.1.

> **번호 주의**: W3-PR9 (dogfooding) 보다 먼저 들어가야 dogfooding 의 첫 entry 가 "Greenfield → Today 흐름" 을 기록할 수 있음. README 의 의존 그래프 참조.

---

## 1. 변경 파일 (계획)

| 파일 | 변경 |
|---|---|
| `src-tauri/src/commands/greenfield.rs` | `create_greenfield_project` 시그니처에 `init_oculpm: bool` 추가 + manager 호출 |
| `src/features/onboarding/GreenfieldWizard.tsx` | Step 4 에 체크박스 1개 + state |
| `src/features/projects/OculpmOnboardingModal.tsx` | mount 시 `.oculpm/` 이미 존재하면 즉시 dismiss |
| `bindings.ts` | specta 자동 — `init_oculpm: boolean` 가 createGreenfieldProject 시그니처에 자동 추가 |

---

## 2. 백엔드 변경 (계획)

```rust
pub async fn create_greenfield_project(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    name: String,
    root_path: String,
    scaffold_cmd: Option<String>,
    scaffold_args: Option<Vec<String>>,
    blueprint_id: Option<u32>,
    init_oculpm: bool,                  // NEW — 프론트가 디폴트 true 로 보냄
) -> Result<GreenfieldResult, String> {
    // ... 기존 1~3단계 (폴더, 스캐폴드, create_project) ...

    // 3b. ocul-pm 초기화 (옵션 A)
    if init_oculpm {
        let root = PathBuf::from(&root_path);
        if let Err(e) = manager.init_project(project_id, &root).await {
            // Non-fatal: 프로젝트는 만들어졌고, 사용자는 EmptyToday V1 에서 재시도 가능
            tracing::warn!(project_id, error = %e, "oculpm init during greenfield failed");
        } else {
            // 어댑터 sync (config 의 active 디폴트 — W4 전이라면 빈 set 일 수 있음)
            if let Err(e) = manager.sync_agents(project_id).await {
                tracing::warn!(project_id, error = %e, "agent sync during greenfield failed");
            }
        }
    }

    // 4. blueprint cleanup ...
}
```

**핵심 결정**: `manager.init_project` / `sync_agents` 실패는 **non-fatal**. tracing::warn 만 남기고 프로젝트는 정상 생성. 사용자는 EmptyToday V1 의 "활성화" 카드로 재시도 가능.

### `manager.sync_agents` 미구현이면

W4-PR1 전이라 `sync_agents` 가 아직 없을 수 있다. 본 PR 의 백엔드에서는 stub (Ok(())) 만 호출하거나 조건부로 skip — W4 에서 실제 sync 로직 들어올 때 본 호출 지점이 활성화.

---

## 3. 프론트 변경 — GreenfieldWizard Step 4 (계획)

생성 버튼 위에 1줄:

```tsx
<label className="flex items-center gap-2 text-sm">
  <Checkbox
    checked={initOculpm}
    onCheckedChange={setInitOculpm}
    aria-label="ocul-pm 으로 이 프로젝트 추적"
  />
  <span>
    ocul-pm 으로 이 프로젝트 추적 <span className="text-muted-foreground">(권장)</span>
  </span>
  <button
    type="button"
    onClick={openOculpmExplainer}
    className="text-xs text-muted-foreground underline"
    aria-label="ocul-pm 이 무엇인지 보기"
  >
    이게 뭔가요?
  </button>
</label>
```

- `initOculpm` state 디폴트 `true`.
- "이게 뭔가요?" 클릭 → 작은 popover 로 1줄 설명 + "자세히 보기" 링크.
- `commands.createGreenfieldProject` 호출 시 `init_oculpm: initOculpm` 전달.

### Explainer popover 내용 (계획)

> ocul-pm 은 이 프로젝트의 파일 변경과 작업 narrative 를 자동 기록하는 도구입니다. 활성화하면 `.oculpm/` 디렉토리가 생기고, 외부 LLM (Claude Code, Cursor 등) 의 작업이 자동으로 Today 탭에 정리됩니다.
> [자세히 보기](docs link)

---

## 4. 프론트 변경 — OculpmOnboardingModal 의 자동 dismiss (계획)

```tsx
useEffect(() => {
  if (!projectId) return;
  (async () => {
    const status = await oculpmApi.getStatus(projectId);
    if (status.initialized) {
      // 이미 init 됨 (Greenfield 흐름 통해서). 모달 안 띄움.
      onClose?.({ reason: "already_initialized" });
    }
  })();
}, [projectId]);
```

PR5 의 자동 dismiss 와 통합 — 한 곳에만 구현. PR5 가 먼저 짜이면 PR10 은 검증만.

---

## 5. 테스트 (계획)

### 단위 (Vitest + Rust)

- [ ] **Rust**: `create_greenfield_project` 가 `init_oculpm=true` + 성공 경로 → `manager.init_project` 호출 + `oculpm_settings.initialized=1`.
- [ ] **Rust**: `init_oculpm=false` → `.oculpm/` 부재 + 프로젝트 정상 생성.
- [ ] **Rust**: `init_oculpm=true` + `manager.init_project` 가 Err → 프로젝트는 정상 생성 (graceful), warn 로그 출력 (tracing capture).
- [ ] **Vitest**: Step 4 체크박스 디폴트 ON.
- [ ] **Vitest**: 체크박스 OFF → `commands.createGreenfieldProject` 가 `init_oculpm: false` 로 호출.
- [ ] **Vitest**: OnboardingModal mount + `getStatus(initialized=true)` → 즉시 `onClose({reason:"already_initialized"})`.

### 통합 (수동 + tempdir 통합)

- [ ] **위저드 디폴트 (ON)** → 신규 프로젝트 진입 시 `.oculpm/` 존재 + onboarding 모달 미노출 + Today 정상.
- [ ] **위저드 OFF** → `.oculpm/` 부재 + EmptyToday V1 카드 노출 + "활성화" 클릭 가능.
- [ ] **백엔드 graceful degrade** — `manager.init_project` 가 mocked Err → `create_project` 는 성공.
- [ ] **통합**: tempdir 위에서 greenfield 흐름 끝-to-끝, `.oculpm/config.toml` 존재 검증.

---

## 6. DoD

- [ ] 위 4개 통합 테스트 통과.
- [ ] 위저드 Step 4 체크박스 a11y (focus, aria-label) OK.
- [ ] specta 가 `init_oculpm: boolean` 을 `commands.createGreenfieldProject` 시그니처에 자동 추가.
- [ ] OnboardingModal 의 자동 dismiss 가 PR5 의 mount-time 체크와 충돌 없음.
- [ ] `_dogfooding-w3.md` (PR9) 에 "Greenfield 흐름 → Today 진입" 동선 1회 수동 검증 기록 (PR9 의 시드 5개 중 하나).
- [ ] `cargo test`, `pnpm test`, `pnpm tauri build` 모두 green.

---

## 7. 실행 노트 (작업 중 갱신)

### 의사결정 후보

1. **`init_oculpm` 디폴트**: `true` (권장 ON) vs `false` (opt-in). → §3 의 설계대로 `true` 권장 — refactor-integration §3.1 옵션 A 와 정합.
2. **`sync_agents` 호출 시점**: W4 전이면 stub. W4 이후엔 본 PR 의 백엔드 변경이 그대로 활성화. → 본 PR 의 백엔드는 `if manager.sync_agents_available()` 분기 또는 단순 stub Ok.
3. **Explainer popover vs 풀 모달**: 위저드 안에서 풀 모달은 컨텍스트 깨짐. → popover + 외부 자세히 보기 링크 추천.
4. **백엔드의 manager State**: `OculpmManager` 가 lib.rs 에 등록됐는지 확인 (W1-PR7). 안 됐으면 본 PR 에서 등록.

### 발견된 함정 / 변경

(작성 중)

### 다음 PR 로 넘기는 메모

- PR9 dogfooding 의 시드 entry 중 1개는 본 PR 의 통합 흐름 ("위저드 ON → Today 자동 진입") 을 기록.
- W4 의 어댑터 sync 가 본 PR 의 `manager.sync_agents` 호출 지점을 그대로 사용 — 시그니처 stable.
- 옵션 A 실패 시 사용자 UX (EmptyToday V1 의 "활성화") 의 회복 동선이 PR5 의 시각과 일치하는지 PR9 회고에서 검증.
