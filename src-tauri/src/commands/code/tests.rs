//! `commands/code` 의 단위 테스트 — `code.rs` 안에 있던 `mod tests` 를 파일
//! 크기 래칫(`scripts/check-file-sizes.mjs`) 때문에 그대로 옮겼다. 순수 함수만
//! 문다(휴지통·DB 는 부르지 않는다). 형제 모듈의 비공개 도우미는 `pub(super)`
//! 로 열려 `mod.rs` 의 글롭을 타고 `super::*` 로 들어온다.
//!
//! 트리·디렉터리 한 단계(`code_tree`/`code_dir`)의 테스트는 같은 래칫 때문에
//! `tree_tests.rs` 에 있다.

use super::*;
use std::fs;
use std::path::Path;
use tempfile::TempDir;

pub(super) fn write(root: &Path, rel: &str, contents: &[u8]) {
    let p = root.join(rel);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(p, contents).unwrap();
}

/// 가져오기 목적지가 이미 그 이름을 쓰고 있으면 **덮어쓰지 않는다**.
/// 드롭 한 번이 같은 이름의 원본을 지우는 일은 되돌릴 수 없다.
#[test]
fn import_dedupes_instead_of_overwriting() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    let outside = TempDir::new().unwrap();
    write(outside.path(), "note.txt", b"new");
    write(root, "dest/note.txt", b"old");
    let src = outside
        .path()
        .join("note.txt")
        .to_string_lossy()
        .to_string();

    let out = import_into(root, &root.join("dest"), std::slice::from_ref(&src)).unwrap();
    assert_eq!(out.imported, vec!["dest/note-2.txt"]);
    // 원래 있던 파일은 그대로다.
    assert_eq!(
        fs::read_to_string(root.join("dest/note.txt")).unwrap(),
        "old"
    );
    assert_eq!(
        fs::read_to_string(root.join("dest/note-2.txt")).unwrap(),
        "new"
    );

    // 한 번 더 넣으면 -3. 자리를 찾을 때까지 센다.
    let out = import_into(root, &root.join("dest"), &[src]).unwrap();
    assert_eq!(out.imported, vec!["dest/note-3.txt"]);
}

/// 폴더는 재귀로, 심볼릭 링크는 빼고. 링크를 따라가면 프로젝트 밖 내용이
/// 사본으로 들어온다 (트리·검색과 같은 정책).
#[test]
fn import_copies_folders_and_skips_symlinks() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    let outside = TempDir::new().unwrap();
    write(outside.path(), "pack/a.txt", b"A");
    write(outside.path(), "pack/deep/b.txt", b"B");
    write(outside.path(), "secret.txt", b"S");
    write(outside.path(), "vault/key.txt", b"K");
    // 파일 링크와 폴더 링크(Windows 는 정션일 수 있다) 둘 다 — 어느 쪽도 따라가지 않는다.
    if !crate::test_links::file(
        &outside.path().join("secret.txt"),
        &outside.path().join("pack/link.txt"),
    ) || !crate::test_links::dir(
        &outside.path().join("vault"),
        &outside.path().join("pack/linkdir"),
    ) {
        return;
    }

    let src = outside.path().join("pack").to_string_lossy().to_string();
    let out = import_into(root, root, &[src]).unwrap();

    assert_eq!(out.imported, vec!["pack"]);
    assert_eq!(fs::read_to_string(root.join("pack/a.txt")).unwrap(), "A");
    assert_eq!(
        fs::read_to_string(root.join("pack/deep/b.txt")).unwrap(),
        "B"
    );
    assert!(
        !root.join("pack/link.txt").exists(),
        "심볼릭 링크는 복사하지 않는다"
    );
    assert!(
        fs::symlink_metadata(root.join("pack/linkdir")).is_err(),
        "폴더 링크도 복사하지 않는다"
    );
}

/// 상한에 걸리면 **거기까지 복사된 채로** 멈추고 `truncated` 로 알린다.
/// 되돌리면 오래 걸린 복사가 통째로 사라져 더 나쁘다.
#[test]
fn import_stops_at_the_file_budget_and_reports_it() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    let outside = TempDir::new().unwrap();
    let mut budget = Budget {
        files: MAX_IMPORT_FILES - 1,
        bytes: 0,
        truncated: false,
    };
    write(outside.path(), "a.txt", b"A");
    write(outside.path(), "b.txt", b"B");

    assert!(copy_one(&outside.path().join("a.txt"), root, &mut budget).is_ok());
    assert!(copy_one(&outside.path().join("b.txt"), root, &mut budget).is_err());
    assert!(budget.truncated);
    assert!(root.join("a.txt").exists());
    assert!(!root.join("b.txt").exists());
}

/// 폴더를 자기 안으로 넣으면 무한 재귀가 된다 — 시작 전에 막는다.
#[test]
fn import_refuses_a_folder_into_itself() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    write(root, "pack/a.txt", b"A");
    let out = import_into(
        root,
        &root.join("pack"),
        &[root.join("pack").to_string_lossy().to_string()],
    )
    .unwrap();
    assert!(out.imported.is_empty());
    assert_eq!(out.skipped, vec!["pack"]);
}

/// 없는 원본은 오류가 아니라 **건너뜀**이다 — 여러 개를 끌어놓았을 때
/// 하나가 사라졌다고 나머지까지 못 들어오면 안 된다.
#[test]
fn import_skips_missing_sources_and_keeps_going() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    let outside = TempDir::new().unwrap();
    write(outside.path(), "ok.txt", b"OK");
    let out = import_into(
        root,
        root,
        &[
            outside
                .path()
                .join("gone.txt")
                .to_string_lossy()
                .to_string(),
            outside.path().join("ok.txt").to_string_lossy().to_string(),
        ],
    )
    .unwrap();
    assert_eq!(out.imported, vec!["ok.txt"]);
    assert_eq!(out.skipped, vec!["gone.txt"]);
}

#[test]
fn binary_probe_detects_nul() {
    assert!(looks_binary(b"\x00\x01\x02"));
    assert!(looks_binary(b"PNG\x00 blob"));
    assert!(!looks_binary(b"plain text \xEA\xB0\x80"));
    assert!(!looks_binary(b""));
}

#[test]
fn write_saves_when_hash_matches() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    write(root, "a.txt", b"before");
    let base = blake3::hash(b"before").to_hex().to_string();

    let out = write_with_lock(&root.join("a.txt"), "after", &base).unwrap();
    match out {
        CodeWriteOutcome::Saved { hash } => {
            assert_eq!(hash, blake3::hash(b"after").to_hex().to_string());
        }
        other => panic!("expected Saved, got {other:?}"),
    }
    assert_eq!(fs::read_to_string(root.join("a.txt")).unwrap(), "after");
}

#[test]
fn write_conflicts_on_stale_hash() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    write(root, "a.txt", b"disk version");
    let stale = blake3::hash(b"what the editor read").to_hex().to_string();

    let out = write_with_lock(&root.join("a.txt"), "my edit", &stale).unwrap();
    match out {
        CodeWriteOutcome::Conflict { disk_hash } => {
            assert_eq!(
                disk_hash,
                blake3::hash(b"disk version").to_hex().to_string()
            );
        }
        other => panic!("expected Conflict, got {other:?}"),
    }
    // 덮어쓰지 않았다.
    assert_eq!(
        fs::read_to_string(root.join("a.txt")).unwrap(),
        "disk version"
    );
}

#[test]
fn write_rejects_missing_file() {
    let tmp = TempDir::new().unwrap();
    let out = write_with_lock(&tmp.path().join("nope.txt"), "x", "hash");
    assert!(out.is_err(), "새 파일 생성은 v1 스코프 밖");
}

#[test]
fn canonical_allows_regular_file_in_root() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    write(root, "a.txt", b"x");
    let p = canonical_within_root(root, &root.join("a.txt")).unwrap();
    assert!(p.ends_with("a.txt"));
}

#[test]
fn canonical_rejects_symlink_escaping_root() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path().join("proj");
    fs::create_dir_all(&root).unwrap();
    fs::write(tmp.path().join("secret.txt"), b"top secret").unwrap();
    if !crate::test_links::file(&tmp.path().join("secret.txt"), &root.join("leak.txt")) {
        return;
    }

    let err = canonical_within_root(&root, &root.join("leak.txt")).unwrap_err();
    assert!(err.contains("escapes"), "{err}");
}

#[test]
fn canonical_resolves_symlink_within_root() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path().join("proj");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("real.txt"), b"x").unwrap();
    if !crate::test_links::file(&root.join("real.txt"), &root.join("alias.txt")) {
        return;
    }

    // 루트 안 심링크는 허용 — 대상 경로로 해석돼 저장해도 링크가 안 깨진다.
    let p = canonical_within_root(&root, &root.join("alias.txt")).unwrap();
    assert!(p.ends_with("real.txt"), "{p:?}");
}

// ─── 파일 조작 ──────────────────────────────────────────────────────────

#[test]
fn normalize_rel_cleans_and_rejects_dangerous_paths() {
    assert_eq!(normalize_rel("src/main.rs").unwrap(), "src/main.rs");
    assert_eq!(normalize_rel("/src//main.rs/").unwrap(), "src/main.rs");
    assert_eq!(normalize_rel("src\\lib.rs").unwrap(), "src/lib.rs");
    assert_eq!(normalize_rel("  a / b  ").unwrap(), "a/b");
    // 루트 자신을 가리키는 요청은 만들어질 수 없다.
    assert!(normalize_rel("").is_err());
    assert!(normalize_rel("   ").is_err());
    assert!(normalize_rel("/").is_err());
    assert!(normalize_rel(".").is_err());
    assert!(normalize_rel("../escape").is_err());
    assert!(normalize_rel("src/../../etc").is_err());
}

#[test]
fn create_makes_file_with_missing_parents() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    let target = resolve_for_mutation(root, &root.join("a/b/c.ts")).unwrap();

    create_file(&target).unwrap();
    assert!(root.join("a/b/c.ts").is_file());
    assert_eq!(fs::read_to_string(root.join("a/b/c.ts")).unwrap(), "");
}

#[test]
fn create_refuses_to_clobber() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    write(root, "a.txt", b"precious");
    let target = resolve_for_mutation(root, &root.join("a.txt")).unwrap();

    let err = create_file(&target).unwrap_err();
    assert!(err.contains("already exists"), "{err}");
    assert_eq!(fs::read_to_string(root.join("a.txt")).unwrap(), "precious");
}

#[test]
fn mkdir_creates_and_then_refuses() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    let target = resolve_for_mutation(root, &root.join("x/y")).unwrap();

    create_dir(&target).unwrap();
    assert!(root.join("x/y").is_dir());
    // 두 번째는 조용히 성공하지 않는다 — 트리에 변화가 없으면 사용자가 헷갈린다.
    let err = create_dir(&target).unwrap_err();
    assert!(err.contains("already exists"), "{err}");
}

#[test]
fn rename_moves_file_and_refuses_to_clobber() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    write(root, "src/a.rs", b"content");
    write(root, "dst/taken.rs", b"someone else");

    let from = resolve_for_mutation(root, &root.join("src/a.rs")).unwrap();
    let to = resolve_for_mutation(root, &root.join("dst/b.rs")).unwrap();
    assert!(!rename_path(&from, &to).unwrap(), "파일이므로 is_dir=false");
    assert!(!root.join("src/a.rs").exists());
    assert_eq!(
        fs::read_to_string(root.join("dst/b.rs")).unwrap(),
        "content"
    );

    // 이미 있는 이름으로는 못 옮긴다 — fs::rename 은 말없이 덮어쓴다.
    write(root, "src/c.rs", b"c");
    let from2 = resolve_for_mutation(root, &root.join("src/c.rs")).unwrap();
    let taken = resolve_for_mutation(root, &root.join("dst/taken.rs")).unwrap();
    let err = rename_path(&from2, &taken).unwrap_err();
    assert!(err.contains("already exists"), "{err}");
    assert_eq!(
        fs::read_to_string(root.join("dst/taken.rs")).unwrap(),
        "someone else"
    );
}

#[test]
fn rename_reports_directories_and_blocks_moving_into_self() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    write(root, "pkg/inner/file.rs", b"x");

    let from = resolve_for_mutation(root, &root.join("pkg")).unwrap();
    let into_self = resolve_for_mutation(root, &root.join("pkg/inner/pkg")).unwrap();
    let err = rename_path(&from, &into_self).unwrap_err();
    assert!(err.contains("into itself"), "{err}");
    assert!(
        root.join("pkg/inner/file.rs").is_file(),
        "가지가 남아 있어야 한다"
    );

    // 정상 이름 바꾸기는 폴더임을 알린다 (프런트가 탭 접두사를 갈아끼운다).
    let to = resolve_for_mutation(root, &root.join("renamed")).unwrap();
    assert!(rename_path(&from, &to).unwrap(), "폴더이므로 is_dir=true");
    assert!(root.join("renamed/inner/file.rs").is_file());
}

#[test]
fn delete_reports_missing_path() {
    let tmp = TempDir::new().unwrap();
    // 실제 휴지통 이동은 테스트하지 않는다 — 사용자의 휴지통을 더럽히지
    // 않으려고 (`cargo test` 는 자주 돈다). 여기서는 휴지통을 부르기 전에
    // 서는 가드만 확인한다.
    let err = delete_to_trash(&tmp.path().join("nope.txt")).unwrap_err();
    assert!(err.contains("no longer exists"), "{err}");
}

/// Windows 러너에서만 — **실제 휴지통**으로 간다. 커맨드가 도는 자리(tokio
/// blocking 풀)에서, 그리고 그 스레드가 이미 COM 을 MTA 로 초기화해 둔 최악의
/// 경우에도(`trash` 는 거기서 패닉했다) 파일·폴더가 휴지통에 들어가는지 본다.
/// 넣은 것은 끝에 비운다.
#[cfg(windows)]
#[tokio::test(flavor = "multi_thread")]
async fn delete_reaches_the_recycle_bin_from_a_blocking_worker() {
    use windows_sys::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

    let tmp = TempDir::new().unwrap();
    let tag = uuid::Uuid::new_v4().simple().to_string();
    let file = tmp.path().join(format!("oculpm-trash-{tag}.txt"));
    let dir = tmp.path().join(format!("oculpm-trash-{tag}-dir"));
    fs::write(&file, b"x").unwrap();
    write(&dir, "inner.txt", b"y");

    let f = file.clone();
    tokio::task::spawn_blocking(move || delete_to_trash(&f))
        .await
        .unwrap()
        .expect("풀 스레드에서 휴지통으로");
    let d = dir.clone();
    tokio::task::spawn_blocking(move || {
        // SAFETY: 이 풀 스레드를 MTA 로 만든다 — 다른 라이브러리가 남긴 상태의 흉내.
        unsafe { CoInitializeEx(std::ptr::null(), COINIT_MULTITHREADED as u32) };
        delete_to_trash(&d)
    })
    .await
    .unwrap()
    .expect("MTA 로 초기화된 스레드에서도 휴지통으로");
    assert!(!file.exists() && !dir.exists(), "원래 자리에서 사라졌다");

    let ours: Vec<_> = trash::os_limited::list()
        .expect("휴지통 목록")
        .into_iter()
        .filter(|item| item.name.to_string_lossy().contains(&tag))
        .collect();
    assert_eq!(ours.len(), 2, "휴지통에 둘 다 있어야 한다: {ours:?}");
    trash::os_limited::purge_all(ours).expect("넣은 것 비우기");
}

/// Linux 는 복사한 파일을 클립보드에서 읽지 못한다 — 빈 목록("복사한 파일
/// 없음")이 아니라 **이유를 말하는 오류**여야 한다 (D4).
#[cfg(all(not(target_os = "macos"), not(windows)))]
#[tokio::test]
async fn clipboard_paste_says_it_is_unavailable_on_linux() {
    let err = code_clipboard_files().await.unwrap_err();
    assert_eq!(err, super::import::LINUX_CLIPBOARD_UNSUPPORTED);
    assert!(err.contains("drag"), "대안을 알려야 한다: {err}");
}

#[test]
fn resolve_for_mutation_accepts_paths_that_do_not_exist_yet() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    let canon_root = fs::canonicalize(root).unwrap();

    let out = resolve_for_mutation(root, &root.join("brand/new/file.ts")).unwrap();
    assert_eq!(out, canon_root.join("brand/new/file.ts"));
}

#[test]
fn resolve_for_mutation_rejects_escape_through_symlinked_parent() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path().join("proj");
    fs::create_dir_all(&root).unwrap();
    fs::create_dir_all(tmp.path().join("outside")).unwrap();
    if !crate::test_links::dir(&tmp.path().join("outside"), &root.join("link")) {
        return;
    }

    let err = resolve_for_mutation(&root, &root.join("link/planted.txt")).unwrap_err();
    assert!(err.contains("escapes"), "{err}");
}

/// 대상이 심링크면 **링크 자체**를 다뤄야 한다. 경로 전체를 canonical 로
/// 풀면 "루트 안의 링크를 지운다" 가 "루트 밖의 원본을 지운다" 가 된다.
#[test]
fn resolve_for_mutation_keeps_the_link_itself() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path().join("proj");
    fs::create_dir_all(&root).unwrap();
    fs::write(tmp.path().join("secret.txt"), b"top secret").unwrap();
    if !crate::test_links::file(&tmp.path().join("secret.txt"), &root.join("leak.txt")) {
        return;
    }

    let out = resolve_for_mutation(&root, &root.join("leak.txt")).unwrap();
    assert!(out.ends_with("leak.txt"), "{out:?}");
    assert!(out.starts_with(fs::canonicalize(&root).unwrap()));
}

/// 깨진 심링크는 `exists()` 로 보면 "없음" 이라, 그 자리에 파일을 만들면
/// 커널이 링크를 따라가 **루트 밖에** 쓴다. symlink_metadata 로 막는다.
#[test]
fn create_refuses_to_write_through_a_dangling_symlink() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path().join("proj");
    fs::create_dir_all(&root).unwrap();
    let outside = tmp.path().join("outside.txt");
    if !crate::test_links::file(&outside, &root.join("bait.txt")) {
        return;
    }
    assert!(
        !root.join("bait.txt").exists(),
        "깨진 링크 — exists() 는 false"
    );

    let target = resolve_for_mutation(&root, &root.join("bait.txt")).unwrap();
    let err = create_file(&target).unwrap_err();
    assert!(err.contains("already exists"), "{err}");
    assert!(!outside.exists(), "루트 밖에 아무것도 만들어지지 않았다");
}

#[cfg(unix)]
#[test]
fn write_preserves_permissions() {
    use std::os::unix::fs::PermissionsExt;
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    write(root, "run.sh", b"#!/bin/sh\necho hi");
    let p = root.join("run.sh");
    fs::set_permissions(&p, fs::Permissions::from_mode(0o755)).unwrap();
    let base = blake3::hash(b"#!/bin/sh\necho hi").to_hex().to_string();

    write_with_lock(&p, "#!/bin/sh\necho bye", &base).unwrap();
    let mode = fs::metadata(&p).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o755, "실행 비트가 저장 후에도 유지돼야 한다");
}

// ─── 전역 검색 · 치환 ──────────────────────────────────────────────────

fn re(query: &str, case: bool, word: bool, regex: bool) -> regex::Regex {
    build_search_regex(query, case, word, regex).unwrap()
}

#[test]
fn search_regex_escapes_literals_and_wraps_words() {
    // 일반 모드 — 메타문자가 문자 그대로다.
    let r = re("a.b(", false, false, false);
    assert!(r.is_match("xa.b(y"));
    assert!(!r.is_match("aXb("));
    // 대소문자.
    assert!(re("foo", false, false, false).is_match("FOO"));
    assert!(!re("foo", true, false, false).is_match("FOO"));
    // 단어 단위 — 비캡처 그룹이라 정규식 모드의 그룹 번호가 안 밀린다.
    let w = re("foo", false, true, false);
    assert!(w.is_match("a foo b"));
    assert!(!w.is_match("foobar"));
    // 정규식 모드의 문법 오류는 조용히 빈 결과가 아니라 오류다.
    assert!(build_search_regex("foo(", false, false, true).is_err());
}

#[test]
fn search_content_reports_utf16_columns_and_previews() {
    let content = "let x = 1;\n한글 앞 match 뒤\nmatch match\n";
    let (hits, over) = search_content(&re("match", false, false, false), content, 100);
    assert!(!over);
    assert_eq!(hits.len(), 3);
    // 한글은 UTF-8 로 3바이트지만 UTF-16 으로 1단위 — "한글 앞 " = 5단위.
    assert_eq!((hits[0].line, hits[0].col, hits[0].len), (2, 5, 5));
    assert_eq!(hits[0].preview, "한글 앞 match 뒤");
    assert_eq!(hits[0].preview_col, 5);
    // 한 줄의 두 매치는 각각 나온다.
    assert_eq!((hits[1].line, hits[1].col), (3, 0));
    assert_eq!((hits[2].line, hits[2].col), (3, 6));
}

#[test]
fn search_content_anchors_apply_per_line_and_skips_empty_matches() {
    let content = "foo bar\nbar foo\n";
    let (hits, _) = search_content(&re("^foo", false, false, true), content, 100);
    assert_eq!(hits.len(), 1, "^ 는 각 줄의 시작이다");
    assert_eq!(hits[0].line, 1);
    // `a*` 류의 빈 매치는 버린다.
    let (hits, _) = search_content(&re("z*", false, false, true), content, 100);
    assert!(hits.is_empty());
}

#[test]
fn search_content_trims_indent_but_keeps_the_match_in_preview() {
    let content = format!("{}needle end\n", " ".repeat(120));
    let (hits, _) = search_content(&re("needle", false, false, false), &content, 100);
    assert_eq!(
        hits[0].preview, "needle end",
        "들여쓰기는 미리보기에서 잘린다"
    );
    assert_eq!(hits[0].preview_col, 0);
    assert_eq!(hits[0].col, 120, "본문 좌표는 줄 기준 그대로");
}

#[test]
fn search_project_respects_tree_visibility_and_caps() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    fs::create_dir_all(root.join(".git")).unwrap();
    write(root, ".gitignore", b"dist/\n");
    write(root, "src/a.ts", b"needle one\nneedle two\n");
    write(root, ".env", b"needle hidden\n");
    write(root, "dist/out.js", b"needle ignored\n");
    write(root, "blob.bin", b"needle\x00binary\n");

    let out = search_project(root, &re("needle", false, false, false), 100);
    let paths: Vec<&str> = out.files.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(paths, vec![".env", "src/a.ts"], "정렬 + 시야: {paths:?}");
    assert_eq!(out.total_hits, 3);
    assert!(!out.truncated);

    // 상한 — 자르고 알린다.
    let capped = search_project(root, &re("needle", false, false, false), 2);
    assert_eq!(capped.total_hits, 2);
    assert!(capped.truncated);
}

#[test]
fn replace_in_content_replaces_all_and_preserves_line_endings() {
    let content = "foo a\r\nfoo b\nno hit\nfoo";
    let (out, n) =
        replace_in_content(content, &re("foo", false, false, false), "bar", false, None).unwrap();
    assert_eq!(n, 3);
    assert_eq!(
        out, "bar a\r\nbar b\nno hit\nbar",
        "CRLF·마지막 줄 무종결 보존"
    );
    // 매치가 없으면 None — 쓰기 자체를 건너뛴다.
    assert!(replace_in_content(
        "clean\n",
        &re("foo", false, false, false),
        "bar",
        false,
        None
    )
    .is_none());
}

#[test]
fn replace_in_content_single_target_uses_utf16_coordinates() {
    let content = "한글 foo 뒤 foo\nfoo\n";
    // 첫 줄의 **두 번째** foo — "한글 foo 뒤 " = 3+1+3+1+1+1 = ... UTF-16 로 col 9.
    let col = utf16_len("한글 foo 뒤 ");
    let (out, n) = replace_in_content(
        content,
        &re("foo", false, false, false),
        "bar",
        false,
        Some((1, col)),
    )
    .unwrap();
    assert_eq!(n, 1);
    assert_eq!(out, "한글 foo 뒤 bar\nfoo\n");
    // 좌표가 매치 시작과 안 맞으면 아무것도 안 바꾼다.
    assert!(replace_in_content(
        content,
        &re("foo", false, false, false),
        "bar",
        false,
        Some((1, col + 1)),
    )
    .is_none());
}

#[test]
fn replace_expands_groups_only_in_regex_mode() {
    let content = "name: kim\n";
    // 정규식 모드 — $1 이 캡처로 펼쳐진다.
    let (out, _) = replace_in_content(
        content,
        &re(r"name: (\w+)", false, false, true),
        "user: $1",
        true,
        None,
    )
    .unwrap();
    assert_eq!(out, "user: kim\n");
    // 일반 모드 — $1 은 문자 그대로다.
    let (out, _) =
        replace_in_content(content, &re("kim", false, false, false), "$1", false, None).unwrap();
    assert_eq!(out, "name: $1\n");
}

#[test]
fn replace_in_file_writes_atomically_and_reports_count() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    write(root, "src/a.ts", b"foo\nfoo bar\n");

    let n = replace_in_file(
        root,
        "src/a.ts",
        &re("foo", false, false, false),
        "baz",
        false,
        None,
    )
    .unwrap();
    assert_eq!(n, 2);
    assert_eq!(
        fs::read_to_string(root.join("src/a.ts")).unwrap(),
        "baz\nbaz bar\n"
    );
    // 매치 없음 = 0, 오류 아님.
    let n = replace_in_file(
        root,
        "src/a.ts",
        &re("foo", false, false, false),
        "baz",
        false,
        None,
    )
    .unwrap();
    assert_eq!(n, 0);
    // 루트 밖 경로는 여전히 막힌다.
    assert!(replace_in_file(
        root,
        "../x",
        &re("a", false, false, false),
        "b",
        false,
        None
    )
    .is_err());
}
