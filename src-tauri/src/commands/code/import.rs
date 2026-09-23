//! 바깥에서 안으로: 파일 가져오기 (Finder 드래그 · ⌘V).
//!
//! 드롭과 클립보드 붙여넣기는 결국 OS 절대경로 목록이라 `code_import` 하나로
//! 모인다. 예산(파일 수·바이트)과 이름 중복 회피, 심링크 배제가 이 모듈의
//! 정책이다 — 트리·검색과 같은 "링크를 따라가지 않는다" 원칙을 공유한다.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::State;

use super::guards::canonical_within_root;
use super::project_root;
use crate::commands::project::secure_join;
use crate::db::Db;

/// 한 번에 가져오는 파일 수 상한. 폴더는 재귀라 `node_modules` 하나를 잘못
/// 끌어놓으면 수만 개가 된다 — 막고 **알리는** 편이 멎는 것보다 낫다.
pub(super) const MAX_IMPORT_FILES: usize = 2_000;

/// 한 번에 가져오는 총 바이트 상한. 위와 같은 이유로 둔다.
const MAX_IMPORT_BYTES: u64 = 512 * 1024 * 1024;

/// `code_import` 결과. 건너뛴 것은 이유를 묶어 **개수만** 돌려준다 — 한 번에
/// 수백 개가 건너뛰어질 수 있어 목록을 그대로 토스트에 부으면 읽히지 않는다.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct CodeImportResult {
    /// 새로 생긴 것들의 프로젝트 루트 기준 경로 (트리를 다시 읽고 열 자리).
    pub imported: Vec<String>,
    /// 가져오지 못한 원본의 **이름**들 (경로가 아니라 이름 — 토스트용).
    pub skipped: Vec<String>,
    /// 상한에 걸려 중간에 멈췄다.
    pub truncated: bool,
}

/// 외부 파일·폴더를 프로젝트 안으로 **복사**한다 (원본은 그대로 둔다).
///
/// 드롭과 ⌘V 가 같이 쓰는 창구다. 두 입력 모두 결국 OS 절대경로 목록이라
/// 여기 하나로 모인다.
///
/// `dest_dir` 은 프로젝트 루트 기준 폴더 경로(`""` = 루트). 파일 경로가 오면
/// **그 부모 폴더**로 읽는다 — 트리에서 파일 위에 떨어뜨리는 것은 "그 옆에
/// 놓아 달라"는 뜻이지 그 파일을 폴더로 쓰겠다는 뜻이 아니다.
#[tauri::command]
#[specta::specta]
pub async fn code_import(
    db: State<'_, Db>,
    project_id: u32,
    dest_dir: String,
    sources: Vec<String>,
) -> Result<CodeImportResult, String> {
    let root = project_root(&db, project_id).await?;
    let dest = if dest_dir.is_empty() {
        root.clone()
    } else {
        secure_join(&root, &dest_dir)?
    };
    tauri::async_runtime::spawn_blocking(move || {
        let dest = canonical_within_root(&root, &dest)?;
        // 파일 위에 떨어뜨렸으면 그 부모로. 루트를 벗어날 일은 없다(이미 안쪽).
        let dest = if dest.is_dir() {
            dest
        } else {
            dest.parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| root.clone())
        };
        import_into(&root, &dest, &sources)
    })
    .await
    .map_err(|e| format!("Failed to import: {e}"))?
}

/// 클립보드에 담긴 **파일 경로들**. 없으면 빈 목록 (오류가 아니다 — 글자를
/// 복사해 둔 상태에서 ⌘V 를 누른 것도 정상이다).
///
/// macOS 는 Finder 가, Windows 는 탐색기가 "복사" 로 올린 파일 목록을 읽는다.
/// Linux 는 **읽지 못한다고 말한다** — 예전처럼 늘 빈 목록을 돌려주면 "복사한
/// 파일이 없다" 와 구별되지 않는다 (크로스플랫폼 D4). 드래그는 어느 OS 에서나 된다.
#[tauri::command]
#[specta::specta]
pub async fn code_clipboard_files() -> Result<Vec<String>, String> {
    Ok(clipboard_file_paths()?
        .into_iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect())
}

/// 탐색기의 "복사" — `CF_HDROP` (`super::clipboard_windows`).
#[cfg(windows)]
fn clipboard_file_paths() -> Result<Vec<PathBuf>, String> {
    super::clipboard_windows::file_paths()
}

/// Linux 데스크톱의 파일 복사는 `text/uri-list` 로 오는데, 그 클립보드는 GTK
/// 메인 스레드에서만 읽힌다 — 아직 그 다리가 없다. 조용히 비우지 않고 이유와
/// 대안을 돌려준다.
#[cfg(all(not(target_os = "macos"), not(windows)))]
fn clipboard_file_paths() -> Result<Vec<PathBuf>, String> {
    Err(LINUX_CLIPBOARD_UNSUPPORTED.to_string())
}

/// Linux 의 붙여넣기 거절 문구 — 프런트 오류 사전이 이 문장으로 안내 키를 고른다.
#[cfg_attr(any(target_os = "macos", windows), allow(dead_code))]
pub(super) const LINUX_CLIPBOARD_UNSUPPORTED: &str =
    "Pasting copied files is not available on Linux — drag the files into the tree instead.";

/// pasteboard 의 `public.file-url` 항목들 → 경로. Finder 의 "복사"가 올리는 것이다.
#[cfg(target_os = "macos")]
fn clipboard_file_paths() -> Result<Vec<PathBuf>, String> {
    use objc2_app_kit::{NSPasteboard, NSPasteboardTypeFileURL};
    use objc2_foundation::NSURL;

    let mut out = Vec::new();
    unsafe {
        let pb = NSPasteboard::generalPasteboard();
        let Some(items) = pb.pasteboardItems() else {
            return Ok(out);
        };
        for item in items.iter() {
            // URL 문자열을 직접 퍼센트 디코딩하지 않는다 — Foundation 이 이미
            // 안다 (`My%20File.txt` 같은 이름을 손으로 풀면 반드시 틀린다).
            let Some(s) = item.stringForType(NSPasteboardTypeFileURL) else {
                continue;
            };
            let Some(url) = NSURL::URLWithString(&s) else {
                continue;
            };
            if let Some(path) = url.path() {
                out.push(PathBuf::from(path.to_string()));
            }
        }
    }
    Ok(out)
}

/// 실제 복사. 순수 함수라 테스트가 직접 부른다.
pub(super) fn import_into(
    root: &Path,
    dest: &Path,
    sources: &[String],
) -> Result<CodeImportResult, String> {
    let mut budget = Budget {
        files: 0,
        bytes: 0,
        truncated: false,
    };
    let mut imported = Vec::new();
    let mut skipped = Vec::new();

    for source in sources {
        if budget.truncated {
            break;
        }
        let src = PathBuf::from(source);
        let name = src
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        match copy_one(&src, dest, &mut budget) {
            Ok(created) => match created.strip_prefix(root) {
                Ok(rel) => imported.push(rel.to_string_lossy().replace('\\', "/")),
                // 루트 밖으로 나갈 수 없는 자리지만, 나갔다면 목록에 넣지 않는다.
                Err(_) => skipped.push(name),
            },
            Err(_) => skipped.push(if name.is_empty() {
                source.clone()
            } else {
                name
            }),
        }
    }
    Ok(CodeImportResult {
        imported,
        skipped,
        truncated: budget.truncated,
    })
}

/// 재귀 복사가 함께 쓰는 예산. 상한에 닿으면 그 자리에서 멈춘다.
pub(super) struct Budget {
    pub(super) files: usize,
    pub(super) bytes: u64,
    pub(super) truncated: bool,
}

impl Budget {
    /// 파일 하나를 더 담을 수 있는가. 없으면 `truncated` 를 세우고 false.
    fn take(&mut self, len: u64) -> bool {
        if self.files >= MAX_IMPORT_FILES || self.bytes + len > MAX_IMPORT_BYTES {
            self.truncated = true;
            return false;
        }
        self.files += 1;
        self.bytes += len;
        true
    }
}

/// 원본 하나를 `dest` 안으로. 이름이 겹치면 **덮어쓰지 않고** `name-2.ext`.
pub(super) fn copy_one(src: &Path, dest: &Path, budget: &mut Budget) -> Result<PathBuf, String> {
    // 심볼릭 링크는 따라가지 않는다 — 트리·검색과 같은 정책이고, 링크를 따라가면
    // 프로젝트 밖 내용이 사본으로 들어온다.
    let meta = std::fs::symlink_metadata(src).map_err(|e| format!("Could not read: {e}"))?;
    if meta.is_symlink() {
        return Err("Symbolic links are not imported".to_string());
    }
    let name = src
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| !n.is_empty())
        .ok_or_else(|| "Invalid file name".to_string())?;
    // 폴더를 자기 자신 안으로 넣으려는 시도 — 무한 재귀가 된다.
    if meta.is_dir() && dest.starts_with(src) {
        return Err("Cannot copy a folder into itself".to_string());
    }
    let target = dedupe_target(dest, name);
    if meta.is_dir() {
        copy_dir_recursive(src, &target, budget)?;
    } else {
        if !budget.take(meta.len()) {
            return Err("Import limit reached".to_string());
        }
        std::fs::copy(src, &target).map_err(|e| format!("Could not copy: {e}"))?;
    }
    Ok(target)
}

/// 겹치지 않는 이름을 고른다 — `a.txt` 가 있으면 `a-2.txt`, 그것도 있으면 `a-3.txt`.
/// (`.gitignore` 처럼 점으로 시작하는 이름은 확장자가 아니라 이름 전체로 본다.)
fn dedupe_target(dest: &Path, name: &str) -> PathBuf {
    if !dest.join(name).exists() {
        return dest.join(name);
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    let mut n = 2;
    loop {
        let candidate = dest.join(format!("{stem}-{n}{ext}"));
        if !candidate.exists() {
            return candidate;
        }
        n += 1;
    }
}

/// 폴더 재귀 복사. 예산이 다하면 **거기까지 복사된 채로** 멈춘다 — 되돌리면
/// 오래 걸린 복사가 통째로 사라져 더 나쁘다 (UI 가 잘렸음을 알린다).
fn copy_dir_recursive(src: &Path, dest: &Path, budget: &mut Budget) -> Result<(), String> {
    std::fs::create_dir_all(dest).map_err(|e| format!("Could not create folder: {e}"))?;
    let entries = std::fs::read_dir(src).map_err(|e| format!("Could not read folder: {e}"))?;
    for entry in entries.flatten() {
        if budget.truncated {
            return Ok(());
        }
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_symlink() {
            continue;
        }
        let child = entry.path();
        let Some(name) = child.file_name() else {
            continue;
        };
        let target = dest.join(name);
        if ft.is_dir() {
            copy_dir_recursive(&child, &target, budget)?;
        } else {
            let len = entry.metadata().map(|m| m.len()).unwrap_or(0);
            if !budget.take(len) {
                return Ok(());
            }
            std::fs::copy(&child, &target).map_err(|e| format!("Could not copy: {e}"))?;
        }
    }
    Ok(())
}
