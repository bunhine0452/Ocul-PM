# W1-PR8 — `.gitignore` 관리 블록 자동 작성

> **목표**: `OculpmManager::init_project` 가 프로젝트 루트의 `.gitignore` 에 `.oculpm/index/`, `.lock`, `.schema-version`, `oculpm.log`, `.oculpm.backup-*/` 5 항목을 관리 블록으로 추가/갱신. 멱등.
> **선행**: W1-PR1~PR7 ✅ (특히 PR5 의 `managed_block_*` 함수)
> **참조**: [`../phases/W1-foundation.md`](../phases/W1-foundation.md) W1-PR8, [`../00-spec.md`](../00-spec.md) §1.2.

---

## 1. 관리 블록 본문

```
# oculpm:begin v1
.oculpm/index/
.oculpm/.lock
.oculpm/.schema-version
.oculpm/oculpm.log
.oculpm.backup-*/
# oculpm:end
```

CommentStyle: `Hash`. 본문은 `manager.rs` 의 `GITIGNORE_BLOCK_BODY` const 로 분리해 다른 PR (W3 의 Settings/Preview, W4 의 검사 도구) 에서 재사용 가능.

---

## 2. `init_project` 의 6단계에 통합

W1-PR7 까지 자리만 있던 단계 6 (manager.rs §`init_project`) 를 채움:

```rust
// 6. .gitignore 관리 블록. 실패 시 직전에 잡은 LockGuard 를 drop 하여 디스크 .lock 정리.
let gitignore_path = root.join(".gitignore");
match write_managed_block(&gitignore_path, "oculpm", GITIGNORE_BLOCK_BODY, CommentStyle::Hash) {
    Ok(result) => {
        report.wrote_gitignore = matches!(
            result,
            ManagedBlockResult::Inserted | ManagedBlockResult::Updated
        );
    }
    Err(e) => {
        drop(guard);
        return Err(e);
    }
}
```

> **노트**: doc 의 원문은 "5단계" 였으나 실제 `init_project` 의 실제 번호는 6 (PR6/PR7 의 단계 정렬). 단계 7 (`ProjectEntry` insert) 직전.

---

## 3. 시나리오별 검증

- [x] `.gitignore` 부재 → 새로 만들고 관리 블록만 작성 (파일 시작에 1줄 빈 줄 X)
  - `init_creates_gitignore_when_missing` — `gi.starts_with("# oculpm:begin v1")` 확인
- [x] `.gitignore` 존재 + 관리 블록 없음 → 파일 끝에 빈 줄 1개 + 관리 블록 append
  - `init_appends_block_to_existing_gitignore` — `"dist/\n\n# oculpm:begin v1"` 부분문자열 확인
- [x] 관리 블록 존재 + 동일 내용 → no-op
  - `init_is_idempotent_for_gitignore` — 두 번째 init 는 fast-path 로 즉시 반환하므로 disk byte-equal 보장 (`assert_eq!(snapshot, after)`). atomic_io 의 `managed_block_update_and_unchanged` 가 `Unchanged` 분기 자체를 따로 검증.
- [x] 관리 블록 존재 + 내용 변경 → 우리 컨텐츠로 갱신 (사용자 라인 사라짐)
  - atomic_io 의 `managed_block_update_and_unchanged` 케이스로 검증됨 — 매니저는 같은 호출을 위임.
- [x] 관리 블록 begin 만 있음 → `Err(ManagedBlockMismatch)`, 락 회수
  - `init_errors_on_orphan_managed_block_and_releases_lock` — 에러 변종 + `.oculpm/.lock` 부재 + `get_status(...).initialized == false`
- [x] Windows CRLF 보존
  - `init_preserves_crlf_in_gitignore` — pre-existing CRLF .gitignore → `\r\n# oculpm:begin v1\r\n` + `.oculpm/index/\r\n` 보존, LF-only `.oculpm/index/\n.oculpm/.lock\n` 부재 검증

---

## 4. DoD

- [x] 6개 시나리오 모두 검증 (위 §3)
- [x] `git status` 가 `.oculpm/index/`, `.lock`, `.schema-version` 을 표시하지 않음 — 관리 블록이 5 항목 전부 포함, 새 프로젝트 자동 cover
- [x] `git status` 가 `.oculpm/config.toml` 을 표시함 (사용자가 commit 여부 결정) — 블록 본문에 `config.toml` 미포함
- [x] `OculpmInitReport.wrote_gitignore` 가 변경 있을 때 true, 멱등 호출 시 false — `init_creates_gitignore_when_missing` + `init_is_idempotent_for_gitignore`

---

## 5. 실행 노트

### 발견된 함정 / 변경

1. **에러 분기에서 LockGuard 정리** — 단계 5 에서 `.oculpm/.lock` 을 잡은 직후 단계 6 의 `write_managed_block` 이 `ManagedBlockMismatch` 로 실패하면, init 가 실패 상태로 끝나는데 디스크의 `.lock` 파일과 heartbeat 태스크가 그대로 살아남는 문제가 있었음. → `drop(guard)` 명시 호출로 RAII 즉시 발화하도록 처리. `init_errors_on_orphan_managed_block_and_releases_lock` 테스트가 이를 검증.

2. **`GITIGNORE_BLOCK_BODY` const 분리** — 블록 본문을 `manager.rs` 모듈 레벨 `const` 로 노출. 향후 W3 의 Settings Preview (사용자에게 "이 5줄이 추가됩니다" 보여줄 때) 와 W4 의 통합 검사 (block_check) 가 같은 source-of-truth 를 참조하도록.

3. **`Unchanged` 분기 직접 검증 생략** — manager 의 두 번째 `init_project` 는 fast-path 로 단계 0 에서 반환하므로 `write_managed_block` 의 `Unchanged` 분기는 manager 경로로 도달하지 않음. 해당 분기는 atomic_io 의 `managed_block_update_and_unchanged` 가 이미 검증. manager 측에서는 "두 번째 init 는 디스크를 안 건드린다" 로 간접 검증.

4. **CRLF 보존 — content 의 LF 가 자동 변환됨** — `GITIGNORE_BLOCK_BODY` 는 LF 만 쓰지만 `atomic_io::render_block` 이 detected EOL 로 `\n → \r\n` 치환 (PR5). 즉 const 를 OS 별로 분기할 필요 없음. CRLF 테스트가 변환 + 보존 양쪽을 검증.

5. **PR8 doc 의 "5단계" → 실제 "6단계"** — PR8 doc 원문은 PR6 초안의 단계 번호를 따랐으나, PR6 §2 / PR7 의 최종 순서에는 단계가 더 늘어남. 본 문서 §2 에서 번호 6 으로 명시 (실제 코드 댓글과 일치).

### 추가/변경된 코드 (3 파일)

- **`src-tauri/src/oculpm/manager.rs`**
  - `GITIGNORE_BLOCK_BODY: &str` const 추가 (00-spec §1.2 와 일치)
  - `init_project` 단계 6 채움 — `write_managed_block` 호출 + `report.wrote_gitignore` 갱신 + 에러 시 `drop(guard)`
  - import: `write_managed_block`, `ManagedBlockResult`, `CommentStyle`
  - manager::tests 에 PR8 케이스 5개 추가

- **`docs/major_update/oculpm/W1/PR8-gitignore-managed-block.md`** — 본 문서 (시나리오/DoD 체크 + 실행 노트)
- **`docs/major_update/oculpm/W1/README.md`** — W1-PR8 ✅ 마크

### 빌드/테스트 시간

- `cargo test --lib oculpm::manager` 11 tests: 컴파일 **5.10s**, 실행 **0.19s**
- 전체 oculpm 46 tests (41 → 46): 실행 **1.07s** — 회귀 0
- 격리 clippy lint: 신규 **0건** (기존 6개 warning 은 oculpm 외부, 변동 없음)

### 다음 페이즈로 넘기는 메모

- **W2 (watcher)**: 이미 `.oculpm/index/` 가 관리 블록에 포함됨 → 워처가 생성하는 NDJSON 파일이 `git status` 에 나타나지 않음. 추가 작업 불필요.
- **W3 (Settings Preview)**: `GITIGNORE_BLOCK_BODY` 를 Settings 화면에서 read-only preview 로 노출. 사용자가 직접 5줄을 수정한 경우 다음 init 에서 우리 컨텐츠로 덮어쓰임을 안내 토스트로 경고 (00-spec §1.2 footnote).
- **W4 (agents block_check)**: 동일한 `managed_block_*` API 가 `CLAUDE.md`, `.cursor/rules/*.mdc` 등의 어댑터 파일에도 적용됨. 본 PR 의 에러 처리 (`drop(guard)`) 패턴은 어댑터 동기화에도 그대로 재사용 가능.
- **README**: W1 끝났으므로 W1/README.md 의 페이즈 회고 섹션을 채우는 별도 작업 필요 (예상 vs 실제 소요, 함정 vs 가이드 예측, W2 로 넘기는 결정).
