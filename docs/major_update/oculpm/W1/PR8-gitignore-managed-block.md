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

CommentStyle: `Hash`.

---

## 2. `init_project` 의 5단계에 통합

W1-PR6 에서 자리만 있던 5번 단계를 채움:

```rust
// 5. .gitignore 관리 블록
let gitignore_path = root.join(".gitignore");
let content = render_gitignore_block();
let result = atomic_io::write_managed_block(
    &gitignore_path,
    "oculpm",
    &content,
    CommentStyle::Hash,
)?;
report.wrote_gitignore = matches!(result, ManagedBlockResult::Inserted | ManagedBlockResult::Updated);
```

---

## 3. 시나리오별 검증

- [ ] `.gitignore` 부재 → 새로 만들고 관리 블록만 작성 (파일 시작에 1줄 빈 줄 X)
- [ ] `.gitignore` 존재 + 관리 블록 없음 → 파일 끝에 빈 줄 1개 + 관리 블록 append
- [ ] 관리 블록 존재 + 동일 내용 → no-op (mtime 안 바뀜)
- [ ] 관리 블록 존재 + 내용 변경 (사용자가 추가 라인 삽입) → 우리 컨텐츠로 갱신, 사용자 라인 사라짐 — Settings 에서 사용자에게 안내 (W4 에서)
- [ ] 관리 블록 begin 만 있음 → `Err(ManagedBlockMismatch)`, 사용자 토스트 (UI 는 W3 까지 콘솔)
- [ ] Windows CRLF 보존

---

## 4. DoD

- [ ] 6개 시나리오 모두 검증
- [ ] `git status` 가 `.oculpm/index/`, `.lock`, `.schema-version` 을 표시하지 않음
- [ ] `git status` 가 `.oculpm/config.toml` 을 표시함 (사용자가 commit 여부 결정)
- [ ] `OculpmInitReport.wrote_gitignore` 가 변경 있을 때 true, 멱등 호출 시 false

---

## 5. 실행 노트
- (작업 중 채움)
