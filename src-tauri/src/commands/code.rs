//! 코드 화면 백엔드 — 프로젝트 파일 트리 + 읽기/쓰기 (docs/code-editor/00-master-plan.md).
//!
//! SSOT 는 디스크다 — docs 뷰어와 같은 원칙으로 캐시를 두지 않는다. 모든 경로는
//! project.rs 의 [`secure_join`] 을 거쳐 프로젝트 루트 밖으로 못 나간다.
//!
//! 쓰기는 낙관적 잠금이다: 프런트가 읽을 때 받은 blake3 해시를 저장 시 되돌려
//! 보내고, 디스크가 그 사이 바뀌었으면 덮어쓰지 않고 `Conflict` 를 돌려준다
//! (에이전트가 활발히 파일을 고치는 앱 특성상 이 창구가 반드시 필요하다).
//! 저장 자체는 같은 디렉터리 임시 파일 + rename 으로 원자적이다.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::docs::natural_cmp;
use crate::commands::project::secure_join;
use crate::db::Db;

/// 트리 상한 — 이 이상은 `truncated` 로 알리고 자른다. gitignore 를 존중한
/// 걸음에서 소스 파일이 2만을 넘는 저장소는 트리 UI 자체가 무의미해지는
/// 크기라, 그때는 검색으로 여는 흐름이 맞다.
const MAX_TREE_FILES: usize = 20_000;

/// 한 디렉터리에서 한 번에 돌려주는 항목 상한. 지연 로딩은 **무시된 것까지**
/// 보여주므로 `node_modules` 같은 폴더가 그대로 열린다 — 한 단계라 깊이 폭발은
/// 없지만 폭은 막아 둔다.
const MAX_DIR_ENTRIES: usize = 5_000;

/// 에디터로 여는 파일의 상한. 이보다 크면 `too_large` — 뷰어가 아니라 로그/
/// 데이터 파일이라 외부 에디터로 보낸다 (base64 왕복·CM 하이라이트 비용 방어).
const MAX_EDIT_BYTES: u64 = 2 * 1024 * 1024;

/// 미리보기(이미지·PDF)로 실어 나르는 파일의 상한. 편집 상한([`MAX_EDIT_BYTES`])
/// 보다 크게 잡는다 — 스크린샷 한 장이 2MB 를 넘는 일은 흔해서, 같은 값을 쓰면
/// 정작 미리보기가 필요한 파일에서만 "너무 큼" 이 뜨는 꼴이 된다. docs 뷰어와 같은 값.
const MAX_PREVIEW_BYTES: u64 = 16 * 1024 * 1024;

/// 바이너리 판정 프로브 크기 — 선두 8KB 에 NUL 이 있으면 바이너리로 본다.
const BINARY_PROBE_BYTES: usize = 8192;

/// 전역 검색의 총 매치 상한. 이보다 많으면 `truncated` — 그 크기의 결과 목록은
/// 훑는 물건이 아니라 좁히라는 신호다 (VS Code 도 같은 이유로 잘라 알린다).
const MAX_SEARCH_HITS: usize = 2_000;

/// 미리보기 창 — 매치 앞뒤로 남기는 글자 수. 사이드바 폭에서 의미 있는 문맥은
/// 앞 몇십 자뿐이고, 뒤는 CSS 말줄임이 알아서 자른다.
const PREVIEW_BEFORE_CHARS: usize = 40;
const PREVIEW_AFTER_CHARS: usize = 200;

/// 코드 트리 한 노드. `relative_path` 는 프로젝트 루트 기준 슬래시 경로 —
/// 그대로 `code_read`/`code_write` 인자로 쓴다 (docs 뷰어와 같은 계약).
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct CodeTreeNode {
    pub name: String,
    pub relative_path: String,
    pub is_dir: bool,
    pub children: Vec<CodeTreeNode>,
}

/// `code_tree` 응답.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct CodeTree {
    pub nodes: Vec<CodeTreeNode>,
    pub file_count: u32,
    /// [`MAX_TREE_FILES`] 상한에 걸려 잘렸다 — UI 가 배지로 알린다.
    pub truncated: bool,
}

/// 디렉터리 한 단계의 항목. 지연 로딩 트리가 폴더를 펼칠 때마다 이것만 받는다.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct CodeDirEntry {
    pub name: String,
    pub relative_path: String,
    pub is_dir: bool,
    /// 저장소가 무시하도록 정한 항목(gitignore · git exclude · global). 숨기지
    /// 않고 **흐리게** 그린다 — 디스크에 있는 것은 보이되 성질은 밝힌다.
    pub ignored: bool,
}

/// `code_dir` 응답.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct CodeDirListing {
    pub entries: Vec<CodeDirEntry>,
    /// [`MAX_DIR_ENTRIES`] 에 걸려 잘렸다 — UI 가 밝힌다.
    pub truncated: bool,
}

/// `code_read` 응답. `binary`/`too_large` 면 `content` 는 빈 문자열이고
/// UI 는 "외부 에디터로 열기" 안내를 그린다.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct CodeFileContent {
    pub content: String,
    /// blake3(원본 바이트) hex — 저장 시 `base_hash` 로 되돌려 보내는 토큰.
    pub hash: String,
    pub bytes: u32,
    pub binary: bool,
    pub too_large: bool,
}

/// `code_asset` 응답 — 이미지/PDF 바이트를 base64 + MIME 으로. 웹뷰는 임의 파일
/// 경로를 `<img src>` 로 직접 못 읽으므로, 프런트가 이걸 Blob 으로 되돌려 문다
/// (docs 뷰어의 `docs_asset` 과 같은 계약).
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct CodeAsset {
    pub mime: String,
    pub base64: String,
    pub bytes: u32,
}

/// `code_write` 결과 — 충돌은 오류가 아니라 정상 분기라 Err 로 보내지 않는다
/// (프런트가 배너로 병합 선택지를 그려야 한다).
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "kind")]
pub enum CodeWriteOutcome {
    #[serde(rename = "saved")]
    Saved { hash: String },
    #[serde(rename = "conflict")]
    Conflict { disk_hash: String },
}

/// 프로젝트의 코드 파일 트리. gitignore 는 존중하되 **숨김 파일은 보여 준다** —
/// `.oculpm/` · `.claude/` · `.github/` · `.env` 처럼 실제로 편집하는 것들이
/// 전부 점 파일이라, 숨기면 이 화면이 IDE 로서 반쪽이 된다 (VS Code 탐색기도
/// 점 파일을 보여 준다). 인덱서와는 이 축에서만 시야가 다르다.
#[tauri::command]
#[specta::specta]
pub async fn code_tree(db: State<'_, Db>, project_id: u32) -> Result<CodeTree, String> {
    let root = project_root(&db, project_id).await?;
    tauri::async_runtime::spawn_blocking(move || build_code_tree(&root, MAX_TREE_FILES))
        .await
        .map_err(|e| format!("Failed to walk the project tree: {e}"))
}

/// 디렉터리 **한 단계**만 읽는다 — 지연 로딩 트리의 창구.
///
/// [`code_tree`] 와 시야가 다르다: 여기서는 `.git` 을 뺀 **디스크에 있는 것 전부**를
/// 돌려주고, 무시된 항목은 지우는 대신 `ignored` 로 표시한다. 한 번에 전부 걷는
/// [`code_tree`] 로는 이럴 수 없다 — 이 저장소만 해도 무시를 끄면 114,419 파일이라
/// 상한에 걸려 트리가 통째로 잘린다. 한 단계씩 읽으면 그 비용이 펼친 폴더에만 든다.
///
/// `rel_path` 가 비면 프로젝트 루트.
#[tauri::command]
#[specta::specta]
pub async fn code_dir(
    db: State<'_, Db>,
    project_id: u32,
    rel_path: String,
) -> Result<CodeDirListing, String> {
    let root = project_root(&db, project_id).await?;
    let full = if rel_path.is_empty() {
        root.clone()
    } else {
        secure_join(&root, &rel_path)?
    };
    tauri::async_runtime::spawn_blocking(move || {
        let full = canonical_within_root(&root, &full)?;
        if !full.is_dir() {
            return Err("Not a directory".to_string());
        }
        Ok(read_dir_level(&root, &full, MAX_DIR_ENTRIES))
    })
    .await
    .map_err(|e| format!("Failed to read the directory: {e}"))?
}

/// 단일 파일 본문 + 해시. 바이너리/대용량은 본문 없이 플래그만 세운다.
#[tauri::command]
#[specta::specta]
pub async fn code_read(
    db: State<'_, Db>,
    project_id: u32,
    rel_path: String,
) -> Result<CodeFileContent, String> {
    let root = project_root(&db, project_id).await?;
    let full = secure_join(&root, &rel_path)?;
    let full = canonical_within_root(&root, &full)?;
    let meta = tokio::fs::metadata(&full)
        .await
        .map_err(|e| format!("Failed to read file: {e}"))?;
    if !meta.is_file() {
        return Err("Not a file".to_string());
    }
    if meta.len() > MAX_EDIT_BYTES {
        return Ok(CodeFileContent {
            content: String::new(),
            hash: String::new(),
            bytes: meta.len().min(u32::MAX as u64) as u32,
            binary: false,
            too_large: true,
        });
    }
    let bytes = tokio::fs::read(&full)
        .await
        .map_err(|e| format!("Failed to read file: {e}"))?;
    let hash = blake3::hash(&bytes).to_hex().to_string();
    let len = bytes.len() as u32;
    if looks_binary(&bytes) {
        return Ok(CodeFileContent {
            content: String::new(),
            hash,
            bytes: len,
            binary: true,
            too_large: false,
        });
    }
    match String::from_utf8(bytes) {
        Ok(content) => Ok(CodeFileContent {
            content,
            hash,
            bytes: len,
            binary: false,
            too_large: false,
        }),
        // UTF-8 이 아니면 텍스트 에디터 대상이 아니다 — 바이너리로 취급.
        Err(_) => Ok(CodeFileContent {
            content: String::new(),
            hash,
            bytes: len,
            binary: true,
            too_large: false,
        }),
    }
}

/// 이미지·PDF 를 미리보기용 바이트로 읽는다.
///
/// [`code_read`] 와 **같은 경로 가드**를 쓰되(프로젝트 루트 밖 탈출 불가), 텍스트가
/// 아니므로 해시·바이너리 판정 없이 통째로 싣는다. 편집 대상이 아니라 저장 창구가
/// 없고, 그래서 낙관적 잠금 토큰(blake3)도 필요 없다.
#[tauri::command]
#[specta::specta]
pub async fn code_asset(
    db: State<'_, Db>,
    project_id: u32,
    rel_path: String,
) -> Result<CodeAsset, String> {
    let root = project_root(&db, project_id).await?;
    let full = secure_join(&root, &rel_path)?;
    let full = canonical_within_root(&root, &full)?;
    let meta = tokio::fs::metadata(&full)
        .await
        .map_err(|e| format!("Failed to read file: {e}"))?;
    if !meta.is_file() {
        return Err("Not a file".to_string());
    }
    if meta.len() > MAX_PREVIEW_BYTES {
        return Err("File is too large to preview (over 16MB)".to_string());
    }
    let bytes = tokio::fs::read(&full)
        .await
        .map_err(|e| format!("Failed to read file: {e}"))?;
    let len = bytes.len() as u32;
    Ok(CodeAsset {
        mime: crate::commands::docs::mime_for(&full),
        base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
        bytes: len,
    })
}

/// 파일 저장 (낙관적 잠금). **기존 파일만** — 신규 생성은 v1 스코프 밖이라
/// 트리와 어긋난 유령 경로 생성을 막는다.
#[tauri::command]
#[specta::specta]
pub async fn code_write(
    db: State<'_, Db>,
    project_id: u32,
    rel_path: String,
    content: String,
    base_hash: String,
) -> Result<CodeWriteOutcome, String> {
    let root = project_root(&db, project_id).await?;
    let full = secure_join(&root, &rel_path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let full = canonical_within_root(&root, &full)?;
        write_with_lock(&full, &content, &base_hash)
    })
    .await
    .map_err(|e| format!("Failed to save file: {e}"))?
}

// ── 바깥에서 안으로: 파일 가져오기 (Finder 드래그 · ⌘V) ─────────────────────

/// 한 번에 가져오는 파일 수 상한. 폴더는 재귀라 `node_modules` 하나를 잘못
/// 끌어놓으면 수만 개가 된다 — 막고 **알리는** 편이 멎는 것보다 낫다.
const MAX_IMPORT_FILES: usize = 2_000;

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
/// macOS 밖에서는 항상 비어 있다. 이 앱은 macOS 전용으로 배포되지만, 커맨드가
/// 사라지면 프런트가 갈라져야 하므로 계약은 모든 플랫폼에서 유지한다.
#[tauri::command]
#[specta::specta]
pub async fn code_clipboard_files() -> Result<Vec<String>, String> {
    Ok(clipboard_file_paths()
        .into_iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect())
}

/// pasteboard 의 `public.file-url` 항목들 → 경로. Finder 의 "복사"가 올리는 것이다.
#[cfg(target_os = "macos")]
fn clipboard_file_paths() -> Vec<PathBuf> {
    use objc2_app_kit::{NSPasteboard, NSPasteboardTypeFileURL};
    use objc2_foundation::NSURL;

    let mut out = Vec::new();
    unsafe {
        let pb = NSPasteboard::generalPasteboard();
        let Some(items) = pb.pasteboardItems() else {
            return out;
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
    out
}

#[cfg(not(target_os = "macos"))]
fn clipboard_file_paths() -> Vec<PathBuf> {
    Vec::new()
}

/// 실제 복사. 순수 함수라 테스트가 직접 부른다.
fn import_into(root: &Path, dest: &Path, sources: &[String]) -> Result<CodeImportResult, String> {
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
struct Budget {
    files: usize,
    bytes: u64,
    truncated: bool,
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
fn copy_one(src: &Path, dest: &Path, budget: &mut Budget) -> Result<PathBuf, String> {
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

/// 파일/폴더를 만들거나 옮긴 결과. 프런트가 그대로 열거나 탭 경로를 갈아끼운다.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct CodePathResult {
    /// 프로젝트 루트 기준 슬래시 경로 — `code_read`/`code_write` 인자와 같은 계약.
    pub relative_path: String,
    pub is_dir: bool,
}

/// 빈 파일 생성. 없는 중간 폴더는 같이 만든다 (VS Code 의 "새 파일" 과 같이
/// `a/b/c.ts` 를 한 번에 받는다). 이미 있으면 **덮어쓰지 않고** 오류다.
#[tauri::command]
#[specta::specta]
pub async fn code_create(
    db: State<'_, Db>,
    project_id: u32,
    rel_path: String,
) -> Result<CodePathResult, String> {
    let root = project_root(&db, project_id).await?;
    let rel = normalize_rel(&rel_path)?;
    let full = secure_join(&root, &rel)?;
    tauri::async_runtime::spawn_blocking(move || {
        let full = resolve_for_mutation(&root, &full)?;
        create_file(&full)?;
        Ok(CodePathResult {
            relative_path: rel,
            is_dir: false,
        })
    })
    .await
    .map_err(|e| format!("Failed to create the file: {e}"))?
}

/// 폴더 생성. 중간 폴더도 같이 만들되, 대상이 **이미 있으면 오류** —
/// `create_dir_all` 의 조용한 성공은 트리에 아무 변화가 없어 사용자를 헷갈리게 한다.
#[tauri::command]
#[specta::specta]
pub async fn code_mkdir(
    db: State<'_, Db>,
    project_id: u32,
    rel_path: String,
) -> Result<CodePathResult, String> {
    let root = project_root(&db, project_id).await?;
    let rel = normalize_rel(&rel_path)?;
    let full = secure_join(&root, &rel)?;
    tauri::async_runtime::spawn_blocking(move || {
        let full = resolve_for_mutation(&root, &full)?;
        create_dir(&full)?;
        Ok(CodePathResult {
            relative_path: rel,
            is_dir: true,
        })
    })
    .await
    .map_err(|e| format!("Failed to create the folder: {e}"))?
}

/// 이름 바꾸기 겸 이동 — 트리의 드래그 이동도 이 하나를 쓴다 (둘은 같은 연산이다:
/// 목적지의 부모가 다르면 이동, 같으면 이름 바꾸기).
///
/// 대상이 이미 있으면 오류다. `fs::rename` 은 파일을 말없이 덮어쓰므로 반드시
/// 먼저 막는다 — 이름 오타 한 번에 남의 파일이 사라지면 안 된다.
#[tauri::command]
#[specta::specta]
pub async fn code_rename(
    db: State<'_, Db>,
    project_id: u32,
    from_rel: String,
    to_rel: String,
) -> Result<CodePathResult, String> {
    let root = project_root(&db, project_id).await?;
    let from = normalize_rel(&from_rel)?;
    let to = normalize_rel(&to_rel)?;
    let from_full = secure_join(&root, &from)?;
    let to_full = secure_join(&root, &to)?;
    tauri::async_runtime::spawn_blocking(move || {
        let from_full = resolve_for_mutation(&root, &from_full)?;
        let to_full = resolve_for_mutation(&root, &to_full)?;
        let is_dir = rename_path(&from_full, &to_full)?;
        Ok(CodePathResult {
            relative_path: to,
            is_dir,
        })
    })
    .await
    .map_err(|e| format!("Failed to rename: {e}"))?
}

/// 삭제 — **OS 휴지통으로 보낸다**, 영구 삭제가 아니다.
///
/// 폴더 삭제는 재귀라 한 번의 오조작으로 잃는 것이 크다. 앱이 되돌릴 수 없는
/// 삭제를 만들지 않는 것이 원칙이고, 되돌리기는 OS 가 이미 잘한다. 휴지통이
/// 실패하면 **영구 삭제로 물러서지 않고** 오류를 그대로 알린다.
#[tauri::command]
#[specta::specta]
pub async fn code_delete(
    db: State<'_, Db>,
    project_id: u32,
    rel_path: String,
) -> Result<(), String> {
    let root = project_root(&db, project_id).await?;
    let rel = normalize_rel(&rel_path)?;
    let full = secure_join(&root, &rel)?;
    tauri::async_runtime::spawn_blocking(move || {
        let full = resolve_for_mutation(&root, &full)?;
        delete_to_trash(&full)
    })
    .await
    .map_err(|e| format!("Failed to delete: {e}"))?
}

/// 이 파일을 `files_touched` 로 만진 일지들 — 에디터 브레드크럼의 일지 칩.
///
/// 에이전트가 이 파일에 무슨 일을 했는지가 **편집 중에** 보이는 창구다. 클릭은
/// 일지 화면으로 점프하고, diff 사이드카가 있으면 인라인 비교의 원본이 된다.
#[tauri::command]
#[specta::specta]
pub async fn code_file_entries(
    db: State<'_, Db>,
    project_id: u32,
    rel_path: String,
) -> Result<Vec<crate::db::FileJournalEntry>, String> {
    db.oculpm_journal_for_file(project_id, rel_path, 20)
        .await
        .map_err(|e| e.to_string())
}

/// HEAD 시점의 파일 내용 — 인라인 비교("HEAD 와 비교")의 원본.
///
/// `None` = HEAD 에 없다(새 파일·저장소 밖) 또는 바이너리. 오류가 아니다 —
/// 비교할 기준이 없다는 것도 답이다.
#[tauri::command]
#[specta::specta]
pub async fn code_head_content(
    db: State<'_, Db>,
    project_id: u32,
    rel_path: String,
) -> Result<Option<String>, String> {
    let root = project_root(&db, project_id).await?;
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = crate::git::show_file_bytes(&root, &rel_path, "HEAD", MAX_EDIT_BYTES as usize)?;
        String::from_utf8(bytes).ok()
    })
    .await
    .map_err(|e| format!("Failed to read HEAD content: {e}"))
}

/// 전역 검색의 매치 하나. `col`/`len` 은 **UTF-16 단위** — CodeMirror 의 문서
/// 오프셋과 JS 문자열 인덱스가 그 단위라, 여기서 변환해 주면 프런트는 그대로
/// 선택 범위로 쓴다 (바이트 오프셋을 넘기면 한글에서 어긋난다).
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct CodeSearchHit {
    /// 1-based 줄 번호.
    pub line: u32,
    /// 줄 안 매치 시작 (UTF-16, 0-based).
    pub col: u32,
    /// 매치 길이 (UTF-16).
    pub len: u32,
    /// 매치 주변 한 줄 미리보기 — 들여쓰기와 먼 앞부분은 잘라 낸다.
    pub preview: String,
    /// `preview` 안에서의 매치 시작 (UTF-16) — 목록의 하이라이트용.
    pub preview_col: u32,
}

/// 한 파일의 매치 묶음. `path` 는 다른 code_* 커맨드와 같은 루트 기준 슬래시 경로.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct CodeSearchFile {
    pub path: String,
    pub hits: Vec<CodeSearchHit>,
}

/// `code_search` 응답.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct CodeSearchResult {
    pub files: Vec<CodeSearchFile>,
    pub total_hits: u32,
    /// [`MAX_SEARCH_HITS`] 상한에 걸려 잘렸다 — UI 가 "더 좁혀라" 로 알린다.
    pub truncated: bool,
}

/// 한 매치만 바꿀 때의 좌표 — `code_search` 가 준 그 좌표를 그대로 되돌려 받는다.
#[derive(Debug, Clone, Deserialize, specta::Type)]
pub struct CodeReplaceTarget {
    pub path: String,
    /// 1-based 줄 번호.
    pub line: u32,
    /// 줄 안 매치 시작 (UTF-16, 0-based).
    pub col: u32,
}

/// `code_search_replace` 결과. 파일 단위 실패는 전체를 멈추지 않고 `errors` 로
/// 모은다 — 100개 파일 중 1개가 그 사이 바뀌었다고 99개를 포기할 이유가 없다.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct CodeReplaceOutcome {
    pub files_changed: u32,
    pub hits_replaced: u32,
    pub errors: Vec<String>,
}

/// 프로젝트 전역 텍스트 검색 (VS Code 검색 사이드바의 백엔드).
///
/// 시야는 [`code_tree`] 와 같다: gitignore 존중 + 숨김 파일 포함 + `.git` 제외.
/// 트리에 보이는 것만 검색된다 — 두 창구의 시야가 어긋나면 "트리에 없는 파일이
/// 검색에 나온다" 류의 혼란이 생긴다. SQLite 인덱스를 쓰는 의미/정확 검색과
/// 달리 **디스크를 직접 읽는다** — 인덱싱 여부·신선도와 무관하게 지금 상태다.
#[tauri::command]
#[specta::specta]
pub async fn code_search(
    db: State<'_, Db>,
    project_id: u32,
    query: String,
    case_sensitive: bool,
    whole_word: bool,
    is_regex: bool,
) -> Result<CodeSearchResult, String> {
    if query.is_empty() {
        return Ok(CodeSearchResult {
            files: Vec::new(),
            total_hits: 0,
            truncated: false,
        });
    }
    let re = build_search_regex(&query, case_sensitive, whole_word, is_regex)?;
    let root = project_root(&db, project_id).await?;
    tauri::async_runtime::spawn_blocking(move || search_project(&root, &re, MAX_SEARCH_HITS))
        .await
        .map_err(|e| format!("Failed to search the project: {e}"))
}

/// 검색 조건과 같은 패턴으로 파일들 안의 매치를 치환한다.
///
/// `target` 이 있으면 **그 한 매치만** (paths 는 무시), 없으면 `paths` 의 모든
/// 매치를 바꾼다. 매치는 디스크의 **지금 내용**에서 다시 찾는다 — 검색 결과가
/// 낡았어도 "지금 매치되는 것을 바꾼다" 는 계약은 깨지지 않는다. 쓰기는
/// [`write_with_lock`] 을 그대로 타서 원자적이고, 치환 도중 파일이 또 바뀌면
/// 그 파일만 오류로 모은다.
///
/// 정규식 모드에서는 치환문의 `$1`/`${name}` 그룹 참조를 펼치고, 일반 모드에서는
/// 문자 그대로 넣는다 (VS Code 와 같은 규칙).
#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn code_search_replace(
    db: State<'_, Db>,
    project_id: u32,
    query: String,
    replacement: String,
    case_sensitive: bool,
    whole_word: bool,
    is_regex: bool,
    paths: Vec<String>,
    target: Option<CodeReplaceTarget>,
) -> Result<CodeReplaceOutcome, String> {
    if query.is_empty() {
        return Ok(CodeReplaceOutcome {
            files_changed: 0,
            hits_replaced: 0,
            errors: Vec::new(),
        });
    }
    let re = build_search_regex(&query, case_sensitive, whole_word, is_regex)?;
    let root = project_root(&db, project_id).await?;
    tauri::async_runtime::spawn_blocking(move || {
        let scope: Vec<(String, Option<(u32, u32)>)> = match &target {
            Some(t) => vec![(t.path.clone(), Some((t.line, t.col)))],
            None => paths.into_iter().map(|p| (p, None)).collect(),
        };
        let mut files_changed = 0u32;
        let mut hits_replaced = 0u32;
        let mut errors = Vec::new();
        for (rel, at) in scope {
            match replace_in_file(&root, &rel, &re, &replacement, is_regex, at) {
                Ok(0) => {}
                Ok(n) => {
                    files_changed += 1;
                    hits_replaced += n;
                }
                Err(e) => errors.push(format!("{rel}: {e}")),
            }
        }
        Ok(CodeReplaceOutcome {
            files_changed,
            hits_replaced,
            errors,
        })
    })
    .await
    .map_err(|e| format!("Failed to replace: {e}"))?
}

// ─── helpers ────────────────────────────────────────────────────────────────

async fn project_root(db: &Db, project_id: u32) -> Result<PathBuf, String> {
    let project = db
        .get_project(project_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(PathBuf::from(project.root_path))
}

fn looks_binary(bytes: &[u8]) -> bool {
    bytes[..bytes.len().min(BINARY_PROBE_BYTES)].contains(&0)
}

/// [`secure_join`] 은 어휘적 검사만 한다 — 경로에 심링크가 끼어 있으면 루트
/// 밖 파일이 열린다 (예: 프로젝트 안 `leak → ~/.ssh/id_rsa`. 트리 걸음은
/// 심링크를 안 따라가지만 `rel_path` 는 임의의 IPC 인자다). 실존 경로로
/// 해석해 루트 안인지 다시 확인하고, 해석된 경로를 돌려준다 — 루트 안을
/// 가리키는 심링크는 그 대상으로 저장되므로 링크 자체도 깨지지 않는다.
fn canonical_within_root(root: &Path, full: &Path) -> Result<PathBuf, String> {
    let canon_root =
        std::fs::canonicalize(root).map_err(|e| format!("Failed to resolve project root: {e}"))?;
    let canon = std::fs::canonicalize(full).map_err(|e| format!("Failed to read file: {e}"))?;
    if canon.starts_with(&canon_root) {
        Ok(canon)
    } else {
        Err("Path escapes the project root".to_string())
    }
}

/// 조작 대상 상대 경로 정리 — 앞뒤 공백·중복 슬래시·양끝 슬래시를 없애고
/// 사람이 실수로 넣기 쉬운 것들을 여기서 잘라 낸다.
///
/// [`secure_join`] 의 어휘적 검사는 `..` 탈출만 본다. 그 앞에서 **빈 경로**(=
/// 프로젝트 루트 자신)와 구간 하나짜리 `.` / `..` 을 막아, 루트를 지우거나
/// 이름을 바꾸는 요청이 애초에 만들어지지 않게 한다.
fn normalize_rel(rel: &str) -> Result<String, String> {
    let normalized = rel.replace('\\', "/");
    let segments: Vec<&str> = normalized
        .split('/')
        .map(str::trim)
        .filter(|seg| !seg.is_empty())
        .collect();
    if segments.is_empty() {
        return Err("Path is empty".to_string());
    }
    if segments.iter().any(|seg| *seg == "." || *seg == "..") {
        return Err("Path may not contain . or ..".to_string());
    }
    Ok(segments.join("/"))
}

/// 조작(생성·이름 바꾸기·삭제) 대상 경로의 심링크 가드.
///
/// [`canonical_within_root`] 와 두 가지가 다르다.
///
/// 1. **마지막 구간을 풀지 않는다.** 전체를 canonical 로 풀면 대상이 심링크일 때
///    링크가 아니라 *그 대상*을 가리킨다. 읽기·저장에서는 그게 옳지만(링크를 따라
///    실제 파일을 편집), 삭제·이름 바꾸기에서는 링크 자체를 다뤄야 한다 — 안 그러면
///    "루트 안의 링크를 지운다" 가 "루트 밖의 원본을 지운다" 가 된다.
/// 2. **아직 없는 경로도 받는다.** 생성은 정의상 없는 경로를 대상으로 한다.
///    실존하는 가장 깊은 조상까지만 풀어 루트 안인지 보고, 아직 없는 나머지 구간을
///    이어 붙인다 — 없는 구간은 심링크일 수 없으므로 같은 보장이 유지된다.
///
/// 존재 판정은 `symlink_metadata` 로 한다. `exists()` 는 링크를 따라가므로 **깨진
/// 심링크**를 "없음" 으로 보고, 그 자리에 파일을 만들면 커널이 링크를 따라가 루트
/// 밖에 쓴다.
fn resolve_for_mutation(root: &Path, full: &Path) -> Result<PathBuf, String> {
    let canon_root =
        std::fs::canonicalize(root).map_err(|e| format!("Failed to resolve project root: {e}"))?;
    let file_name = full
        .file_name()
        .ok_or_else(|| "Invalid path".to_string())?
        .to_os_string();
    let parent = full
        .parent()
        .ok_or_else(|| "Invalid path".to_string())?
        .to_path_buf();

    // 실존하는 가장 깊은 조상까지 내려가며, 지나온 (아직 없는) 구간을 모은다.
    let mut existing = parent;
    let mut missing: Vec<std::ffi::OsString> = Vec::new();
    while existing.symlink_metadata().is_err() {
        let name = existing
            .file_name()
            .ok_or_else(|| "Path escapes the project root".to_string())?
            .to_os_string();
        missing.push(name);
        existing = existing
            .parent()
            .ok_or_else(|| "Path escapes the project root".to_string())?
            .to_path_buf();
    }

    let canon =
        std::fs::canonicalize(&existing).map_err(|e| format!("Failed to resolve path: {e}"))?;
    if !canon.starts_with(&canon_root) {
        return Err("Path escapes the project root".to_string());
    }
    let mut out = canon;
    for seg in missing.iter().rev() {
        out.push(seg);
    }
    out.push(file_name);
    Ok(out)
}

/// 빈 파일 생성. 중간 폴더는 만들되 대상이 이미 있으면 오류 — 깨진 심링크도
/// "있음" 이라 [`resolve_for_mutation`] 의 가드와 짝을 이룬다.
fn create_file(full: &Path) -> Result<(), String> {
    if full.symlink_metadata().is_ok() {
        return Err("A file or folder with that name already exists".to_string());
    }
    if let Some(parent) = full.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create the folder: {e}"))?;
    }
    // create_new = 만들어져 있으면 실패. 위의 검사와 생성 사이 경쟁을 커널이 막는다.
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(full)
        .map(|_| ())
        .map_err(|e| format!("Failed to create the file: {e}"))
}

/// 폴더 생성. `create_dir_all` 은 이미 있어도 성공하는데, 그러면 트리에 아무
/// 변화가 없어 사용자는 만들어진 줄 안다 — 먼저 막는다.
fn create_dir(full: &Path) -> Result<(), String> {
    if full.symlink_metadata().is_ok() {
        return Err("A file or folder with that name already exists".to_string());
    }
    std::fs::create_dir_all(full).map_err(|e| format!("Failed to create the folder: {e}"))
}

/// 이름 바꾸기/이동. 돌려주는 bool 은 옮긴 것이 폴더였는지 (프런트가 탭 경로를
/// 하나만 갈아끼울지, 접두사 전체를 갈아끼울지 정하는 데 쓴다).
fn rename_path(from: &Path, to: &Path) -> Result<bool, String> {
    let meta = from
        .symlink_metadata()
        .map_err(|e| format!("Failed to read the source path: {e}"))?;
    if to.symlink_metadata().is_ok() {
        return Err("A file or folder with that name already exists".to_string());
    }
    // 폴더를 자기 후손으로 옮기면 `fs::rename` 이 EINVAL 을 내거나 (플랫폼에 따라)
    // 가지를 통째로 잃는다 — 드래그 이동에서 실제로 일어나는 실수라 먼저 막는다.
    if meta.is_dir() && to.starts_with(from) {
        return Err("Cannot move a folder into itself".to_string());
    }
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create the folder: {e}"))?;
    }
    std::fs::rename(from, to).map_err(|e| format!("Failed to rename: {e}"))?;
    Ok(meta.is_dir())
}

/// 휴지통으로. 영구 삭제로 물러서지 않는다 — 휴지통이 안 되는 환경(네트워크
/// 볼륨 등)에서는 조용히 지우는 것보다 실패를 말하는 쪽이 옳다.
fn delete_to_trash(full: &Path) -> Result<(), String> {
    if full.symlink_metadata().is_err() {
        return Err("That path no longer exists".to_string());
    }
    trash::delete(full).map_err(|e| format!("Failed to move to the Trash: {e}"))
}

/// 걸음(파일 목록) → 중첩 트리. 폴더 우선 + 자연 정렬은 [`sort_nodes`] 가 맡고,
/// 파일이 없는 폴더는 구조적으로 생기지 않는다 (파일 경로에서만 폴더를 만든다).
fn build_code_tree(root: &Path, max_files: usize) -> CodeTree {
    let mut files: Vec<String> = Vec::new();
    let mut truncated = false;
    for entry in ignore::WalkBuilder::new(root)
        .standard_filters(true)
        // 숨김 필터만 끈다 — gitignore 는 그대로 둔다 (node_modules·target 까지
        // 걸으면 상한을 즉시 넘겨 트리가 통째로 잘린다).
        .hidden(false)
        // `.git` 만은 예외로 막는다. 저장소 객체 DB 는 수만 파일이라 이것 하나로
        // 상한을 다 먹고, 사람이 여기서 편집할 것은 하나도 없다. (ripgrep 도
        // `--hidden` 에 같은 예외를 둔다.) 중첩 저장소가 있으므로 깊이 무관하게.
        .filter_entry(|e| e.file_name() != ".git")
        .build()
        .flatten()
    {
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        let Ok(rel) = entry.path().strip_prefix(root) else {
            continue;
        };
        let rel = rel.to_string_lossy().replace('\\', "/");
        if rel.is_empty() {
            continue;
        }
        if files.len() >= max_files {
            truncated = true;
            break;
        }
        files.push(rel);
    }
    let file_count = files.len() as u32;

    #[derive(Default)]
    struct DirAcc {
        dirs: BTreeMap<String, DirAcc>,
        files: Vec<String>,
    }
    let mut top = DirAcc::default();
    for rel in &files {
        let mut cursor = &mut top;
        let segs: Vec<&str> = rel.split('/').collect();
        for seg in &segs[..segs.len() - 1] {
            cursor = cursor.dirs.entry((*seg).to_string()).or_default();
        }
        cursor.files.push(segs[segs.len() - 1].to_string());
    }

    fn to_nodes(acc: DirAcc, prefix: &str) -> Vec<CodeTreeNode> {
        let mut out = Vec::new();
        for (name, child) in acc.dirs {
            let rel = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}/{name}")
            };
            let children = to_nodes(child, &rel);
            out.push(CodeTreeNode {
                name,
                relative_path: rel,
                is_dir: true,
                children,
            });
        }
        for name in acc.files {
            let rel = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}/{name}")
            };
            out.push(CodeTreeNode {
                name,
                relative_path: rel,
                is_dir: false,
                children: Vec::new(),
            });
        }
        sort_nodes(&mut out);
        out
    }

    CodeTree {
        nodes: to_nodes(top, ""),
        file_count,
        truncated,
    }
}

/// 한 디렉터리를 읽어 `ignored` 를 채운다.
///
/// 무시 여부는 직접 판정하지 않고 **같은 걸음에 한 번 더 물어서** 얻는다:
/// `max_depth(1)` 걸음이 살려 둔 이름의 집합을 만들고, `read_dir` 이 본 것 중
/// 거기 없는 것을 무시된 것으로 본다. gitignore 는 중첩 `.gitignore` · git
/// exclude · global 까지 얽혀 있어 손으로 다시 판정하면 [`code_tree`] 와 시야가
/// 어긋나기 시작한다 — 판정 주체를 하나로 둔다.
fn read_dir_level(root: &Path, dir: &Path, max_entries: usize) -> CodeDirListing {
    let mut kept: std::collections::HashSet<std::ffi::OsString> = std::collections::HashSet::new();
    for entry in ignore::WalkBuilder::new(dir)
        .standard_filters(true)
        .hidden(false)
        .max_depth(Some(1))
        .filter_entry(|e| e.file_name() != ".git")
        .build()
        .flatten()
    {
        if entry.depth() == 1 {
            kept.insert(entry.file_name().to_os_string());
        }
    }

    let Ok(read) = std::fs::read_dir(dir) else {
        return CodeDirListing {
            entries: Vec::new(),
            truncated: false,
        };
    };

    let mut entries: Vec<CodeDirEntry> = Vec::new();
    let mut truncated = false;
    for item in read.flatten() {
        let name_os = item.file_name();
        if name_os == ".git" {
            continue;
        }
        let name = name_os.to_string_lossy().to_string();
        // 심링크는 따라가지 않고 링크 자체의 종류로 본다 — 루프와 루트 밖 탈출을
        // 트리 단계에서부터 막는다 (여는 시점의 canonical 가드와 이중 방어).
        let Ok(meta) = item.metadata() else { continue };
        let full = item.path();
        let Ok(rel) = full.strip_prefix(root) else {
            continue;
        };
        let rel = rel.to_string_lossy().replace('\\', "/");
        if entries.len() >= max_entries {
            truncated = true;
            break;
        }
        entries.push(CodeDirEntry {
            name,
            relative_path: rel,
            is_dir: meta.is_dir(),
            ignored: !kept.contains(&name_os),
        });
    }

    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| natural_cmp(&a.name, &b.name))
    });
    CodeDirListing { entries, truncated }
}

/// 폴더 우선, 그다음 자연 정렬 (docs 트리의 `natural_cmp` 재사용 — `10-x` 가
/// `2-x` 뒤에 오도록).
fn sort_nodes(nodes: &mut [CodeTreeNode]) {
    nodes.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| natural_cmp(&a.name, &b.name))
    });
}

// ─── 전역 검색 · 치환 ───────────────────────────────────────────────────────

/// 검색 조건 → 정규식. 일반 모드는 통째로 이스케이프하고, 단어 단위는
/// `\b(?:…)\b` 로 감싼다 — 비캡처 그룹이라 정규식 모드의 `$1` 번호가 밀리지
/// 않는다. regex 크레이트는 선형 시간이라 사용자 패턴으로 역추적 폭발이 없다.
fn build_search_regex(
    query: &str,
    case_sensitive: bool,
    whole_word: bool,
    is_regex: bool,
) -> Result<regex::Regex, String> {
    let base = if is_regex {
        query.to_string()
    } else {
        regex::escape(query)
    };
    let pattern = if whole_word {
        format!(r"\b(?:{base})\b")
    } else {
        base
    };
    regex::RegexBuilder::new(&pattern)
        .case_insensitive(!case_sensitive)
        .build()
        .map_err(|e| format!("Invalid pattern: {e}"))
}

fn utf16_len(s: &str) -> u32 {
    s.encode_utf16().count() as u32
}

/// UTF-16 열 → 바이트 오프셋. 좌표가 문자 경계와 안 맞으면(그 사이 파일이
/// 바뀌었으면) None — 엉뚱한 자리를 바꾸는 것보다 그 매치를 포기하는 쪽이 옳다.
fn utf16_col_to_byte(line: &str, col: u32) -> Option<usize> {
    if col == 0 {
        return Some(0);
    }
    let mut units = 0u32;
    for (i, ch) in line.char_indices() {
        if units == col {
            return Some(i);
        }
        units += ch.len_utf16() as u32;
    }
    (units == col).then_some(line.len())
}

/// 매치 하나 → 좌표 + 미리보기. 들여쓰기는 잘라 내되 매치 자체는 항상 창 안에
/// 온전히 남긴다 (창 상한은 글자 수 기준이라 UTF-8 경계가 깨질 일이 없다).
fn make_hit(line_no: u32, line: &str, mstart: usize, mend: usize) -> CodeSearchHit {
    let indent = line.len() - line.trim_start().len();
    let vis_start = indent.min(mstart);
    let win_start = line[vis_start..mstart]
        .char_indices()
        .rev()
        .nth(PREVIEW_BEFORE_CHARS - 1)
        .map(|(i, _)| vis_start + i)
        .unwrap_or(vis_start);
    let win_end = line[mend..]
        .char_indices()
        .nth(PREVIEW_AFTER_CHARS)
        .map(|(i, _)| mend + i)
        .unwrap_or(line.len());
    CodeSearchHit {
        line: line_no,
        col: utf16_len(&line[..mstart]),
        len: utf16_len(&line[mstart..mend]),
        preview: line[win_start..win_end].to_string(),
        preview_col: utf16_len(&line[win_start..mstart]),
    }
}

/// 한 파일 본문의 매치들. 줄 단위로 찾는다 — `^`/`$` 가 자연스럽게 줄 경계가
/// 되고, 패턴이 줄을 넘을 수 없다는 것이 검색·치환 양쪽의 공통 계약이다.
/// 빈 매치(`a*` 류)는 버린다 — 글자 사이마다 잡히는 결과는 목록으로서 무의미하다.
fn search_content(re: &regex::Regex, content: &str, budget: usize) -> (Vec<CodeSearchHit>, bool) {
    let mut hits = Vec::new();
    for (idx, line) in content.lines().enumerate() {
        for m in re.find_iter(line) {
            if m.start() == m.end() {
                continue;
            }
            if hits.len() >= budget {
                return (hits, true);
            }
            hits.push(make_hit(idx as u32 + 1, line, m.start(), m.end()));
        }
    }
    (hits, false)
}

/// 트리와 같은 시야로 걷는 전역 검색. 에디터가 못 여는 파일(바이너리·2MB 초과·
/// 비 UTF-8)은 건너뛴다 — 결과를 눌러도 열 수 없는 매치는 목록에 둘 이유가 없다.
fn search_project(root: &Path, re: &regex::Regex, max_hits: usize) -> CodeSearchResult {
    let mut files: Vec<CodeSearchFile> = Vec::new();
    let mut total: usize = 0;
    let mut truncated = false;
    for entry in ignore::WalkBuilder::new(root)
        .standard_filters(true)
        .hidden(false)
        .filter_entry(|e| e.file_name() != ".git")
        .build()
        .flatten()
    {
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        let path = entry.path();
        let Ok(meta) = entry.metadata() else { continue };
        if meta.len() > MAX_EDIT_BYTES {
            continue;
        }
        let Ok(bytes) = std::fs::read(path) else {
            continue;
        };
        if looks_binary(&bytes) {
            continue;
        }
        let Ok(content) = String::from_utf8(bytes) else {
            continue;
        };
        let (hits, over) = search_content(re, &content, max_hits - total);
        if !hits.is_empty() {
            let Ok(rel) = path.strip_prefix(root) else {
                continue;
            };
            total += hits.len();
            files.push(CodeSearchFile {
                path: rel.to_string_lossy().replace('\\', "/"),
                hits,
            });
        }
        if over {
            truncated = true;
            break;
        }
    }
    files.sort_by(|a, b| natural_cmp(&a.path, &b.path));
    CodeSearchResult {
        files,
        total_hits: total as u32,
        truncated,
    }
}

/// 한 줄 안의 치환. `only_at` 이 있으면 그 바이트에서 시작하는 매치만 바꾼다.
/// 빈 매치는 검색과 같은 이유로 건너뛴다. 바뀐 것이 없으면 None.
fn replace_line(
    re: &regex::Regex,
    line: &str,
    replacement: &str,
    expand: bool,
    only_at: Option<usize>,
) -> Option<(String, u32)> {
    let mut out = String::with_capacity(line.len());
    let mut last = 0usize;
    let mut count = 0u32;
    for caps in re.captures_iter(line) {
        let m = caps.get(0).expect("group 0 always exists");
        if m.start() == m.end() {
            continue;
        }
        if only_at.is_some_and(|b| b != m.start()) {
            continue;
        }
        out.push_str(&line[last..m.start()]);
        if expand {
            caps.expand(replacement, &mut out);
        } else {
            out.push_str(replacement);
        }
        last = m.end();
        count += 1;
    }
    if count == 0 {
        return None;
    }
    out.push_str(&line[last..]);
    Some((out, count))
}

/// 본문 전체의 치환 — 줄 종결자(`\n`/`\r\n`·마지막 줄의 부재)를 **그대로 보존**
/// 한다. 줄로 갈랐다 다시 합치는 방식은 CRLF 파일을 통째로 LF 로 만드는 회귀가
/// 있어, 종결자를 본문에서 떼어 두었다가 그대로 되붙인다.
fn replace_in_content(
    content: &str,
    re: &regex::Regex,
    replacement: &str,
    expand: bool,
    target: Option<(u32, u32)>,
) -> Option<(String, u32)> {
    let mut out = String::with_capacity(content.len());
    let mut total = 0u32;
    for (idx, raw) in content.split_inclusive('\n').enumerate() {
        let line_no = idx as u32 + 1;
        let body_len = raw.len()
            - if raw.ends_with("\r\n") {
                2
            } else {
                usize::from(raw.ends_with('\n'))
            };
        let (body, term) = raw.split_at(body_len);
        let only_at = match target {
            Some((l, _)) if l != line_no => {
                out.push_str(raw);
                continue;
            }
            Some((_, col)) => match utf16_col_to_byte(body, col) {
                Some(b) => Some(b),
                None => {
                    out.push_str(raw);
                    continue;
                }
            },
            None => None,
        };
        match replace_line(re, body, replacement, expand, only_at) {
            Some((new_body, n)) => {
                total += n;
                out.push_str(&new_body);
                out.push_str(term);
            }
            None => out.push_str(raw),
        }
    }
    if total == 0 {
        None
    } else {
        Some((out, total))
    }
}

/// 파일 하나의 치환 — 읽기와 같은 경로 가드를 지나 [`write_with_lock`] 으로
/// 원자적으로 쓴다. 바꿀 매치가 없으면 0 (오류가 아니다 — 검색 후 파일이
/// 바뀌었을 수 있고, 그때 "지금은 매치가 없다" 는 정답이다).
fn replace_in_file(
    root: &Path,
    rel: &str,
    re: &regex::Regex,
    replacement: &str,
    expand: bool,
    target: Option<(u32, u32)>,
) -> Result<u32, String> {
    let full = secure_join(root, rel)?;
    let full = canonical_within_root(root, &full)?;
    let meta = std::fs::metadata(&full).map_err(|e| format!("Failed to read file: {e}"))?;
    if !meta.is_file() {
        return Err("Not a file".to_string());
    }
    if meta.len() > MAX_EDIT_BYTES {
        return Err("File is too large to edit".to_string());
    }
    let bytes = std::fs::read(&full).map_err(|e| format!("Failed to read file: {e}"))?;
    if looks_binary(&bytes) {
        return Err("Binary file".to_string());
    }
    let base_hash = blake3::hash(&bytes).to_hex().to_string();
    let content = String::from_utf8(bytes).map_err(|_| "Not a UTF-8 text file".to_string())?;
    let Some((new_content, count)) = replace_in_content(&content, re, replacement, expand, target)
    else {
        return Ok(0);
    };
    match write_with_lock(&full, &new_content, &base_hash)? {
        CodeWriteOutcome::Saved { .. } => Ok(count),
        CodeWriteOutcome::Conflict { .. } => {
            Err("File changed on disk during the replace".to_string())
        }
    }
}

/// 저장 직렬화 — 같은 파일에 저장이 동시에 두 건 들어오면 둘 다 해시 검사를
/// 통과한 뒤 서로를 덮어써, 둘 다 Saved 를 돌려주면서 한쪽 편집이 조용히
/// 사라진다. 저장은 드물고 짧아 경로별이 아닌 전역 뮤텍스로 충분하다.
static WRITE_LOCK: Mutex<()> = Mutex::new(());

/// 해시 대조 → 같은 디렉터리 임시 파일 → 권한 복사 → rename. 동기 IO 라
/// spawn_blocking 안에서 부른다.
fn write_with_lock(
    full: &Path,
    content: &str,
    base_hash: &str,
) -> Result<CodeWriteOutcome, String> {
    let _guard = WRITE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let disk = std::fs::read(full).map_err(|e| format!("Failed to read file before save: {e}"))?;
    let disk_hash = blake3::hash(&disk).to_hex().to_string();
    if disk_hash != base_hash {
        return Ok(CodeWriteOutcome::Conflict { disk_hash });
    }

    let parent = full
        .parent()
        .ok_or_else(|| "Invalid file path".to_string())?;
    let file_name = full
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Invalid file name".to_string())?;
    let tmp = parent.join(format!(".{file_name}.oculpm-save-tmp"));

    std::fs::write(&tmp, content.as_bytes()).map_err(|e| format!("Failed to save file: {e}"))?;
    // rename 은 inode 를 갈아끼우므로 원본 권한(실행 비트 등)을 임시 파일에
    // 먼저 옮겨 둬야 저장 후에도 유지된다.
    if let Ok(meta) = std::fs::metadata(full) {
        // 실패해도 저장은 계속하지만(내용 보존이 우선), 실행 비트가 조용히
        // 사라지는 종류의 회귀라 진단 가능하게 남긴다.
        if let Err(e) = std::fs::set_permissions(&tmp, meta.permissions()) {
            tracing::warn!(path = %full.display(), error = %e, "failed to preserve permissions on save");
        }
    }
    if let Err(e) = std::fs::rename(&tmp, full) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("Failed to save file: {e}"));
    }
    let hash = blake3::hash(content.as_bytes()).to_hex().to_string();
    Ok(CodeWriteOutcome::Saved { hash })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn write(root: &Path, rel: &str, contents: &[u8]) {
        let p = root.join(rel);
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(p, contents).unwrap();
    }

    fn names(nodes: &[CodeTreeNode]) -> Vec<String> {
        nodes.iter().map(|n| n.name.clone()).collect()
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
        #[cfg(unix)]
        std::os::unix::fs::symlink(
            outside.path().join("secret.txt"),
            outside.path().join("pack/link.txt"),
        )
        .unwrap();

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
    fn tree_nests_and_respects_gitignore() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        // ignore 크레이트는 git 저장소일 때만 .gitignore 를 적용한다.
        fs::create_dir_all(root.join(".git")).unwrap();
        write(root, ".gitignore", b"node_modules/\ndist/\n");
        write(root, "src/main.rs", b"fn main() {}");
        write(root, "src/lib.rs", b"pub fn x() {}");
        write(root, "README.md", b"# hi");
        write(root, "node_modules/pkg/index.js", b"ignored");
        write(root, "dist/out.js", b"ignored");

        let tree = build_code_tree(root, MAX_TREE_FILES);
        let top = names(&tree.nodes);
        assert!(top.contains(&"src".to_string()), "{top:?}");
        assert!(top.contains(&"README.md".to_string()), "{top:?}");
        assert!(
            !top.contains(&"node_modules".to_string()),
            "gitignore: {top:?}"
        );
        assert!(!top.contains(&"dist".to_string()), "gitignore: {top:?}");
        assert!(!tree.truncated);
        // 폴더 우선 정렬 + 중첩 경로.
        assert!(tree.nodes[0].is_dir, "dirs first: {top:?}");
        let src = tree.nodes.iter().find(|n| n.name == "src").unwrap();
        assert_eq!(src.relative_path, "src");
        let lib = src.children.iter().find(|n| n.name == "lib.rs").unwrap();
        assert_eq!(lib.relative_path, "src/lib.rs");
        assert!(!lib.is_dir);
    }

    /// 숨김 파일은 보여 주되 `.git` 객체 DB 는 막는다 — 이 화면에서 실제로
    /// 편집하는 것이 대부분 점 파일(.oculpm·.claude·.env)이기 때문이다.
    #[test]
    fn tree_shows_hidden_files_but_never_dot_git() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        fs::create_dir_all(root.join(".git")).unwrap();
        write(root, ".gitignore", b"secret-ignored/\n");
        write(root, ".env", b"KEY=1");
        write(root, ".oculpm/journal/20260823/note.md", b"# hi");
        write(root, ".git/objects/ab/cdef", b"blob");
        write(root, "nested/.git/objects/12/3456", b"blob");
        write(root, "secret-ignored/.env", b"still ignored");

        let tree = build_code_tree(root, MAX_TREE_FILES);
        let top = names(&tree.nodes);
        assert!(top.contains(&".env".to_string()), "hidden file: {top:?}");
        assert!(
            top.contains(&".gitignore".to_string()),
            "hidden file: {top:?}"
        );
        assert!(top.contains(&".oculpm".to_string()), "hidden dir: {top:?}");
        assert!(!top.contains(&".git".to_string()), "dot-git: {top:?}");
        // 숨김을 켜도 gitignore 는 여전히 이긴다.
        assert!(
            !top.contains(&"secret-ignored".to_string()),
            "gitignore: {top:?}"
        );
        // 중첩 저장소의 .git 도 깊이와 무관하게 막힌다.
        let nested = tree.nodes.iter().find(|n| n.name == "nested");
        assert!(nested.is_none(), "nested holds only .git: {top:?}");
    }

    /// 지연 로딩의 계약 — 무시된 것도 **보이되** `ignored` 로 표시된다.
    /// (한 번에 다 걷는 `code_tree` 는 이럴 수 없다: 무시를 끄면 상한에 걸린다.)
    #[test]
    fn dir_level_shows_ignored_entries_but_flags_them() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        fs::create_dir_all(root.join(".git")).unwrap();
        write(root, ".gitignore", b"node_modules/\ntarget/\n*.log\n");
        write(root, "src/main.rs", b"fn main() {}");
        write(root, "node_modules/pkg/index.js", b"ignored");
        write(root, "target/debug/bin", b"ignored");
        write(root, "debug.log", b"ignored");
        write(root, ".env", b"KEY=1");

        let out = read_dir_level(root, root, MAX_DIR_ENTRIES);
        let by_name: std::collections::HashMap<&str, &CodeDirEntry> =
            out.entries.iter().map(|e| (e.name.as_str(), e)).collect();

        assert!(!out.truncated);
        assert!(
            by_name.contains_key("node_modules"),
            "ignored dir must be listed"
        );
        assert!(by_name["node_modules"].ignored, "and flagged");
        assert!(by_name["target"].ignored);
        assert!(by_name["debug.log"].ignored);
        assert!(!by_name["src"].ignored, "tracked dir is not ignored");
        assert!(!by_name[".gitignore"].ignored, "hidden but tracked");
        assert!(!by_name[".env"].ignored, "hidden, not in this .gitignore");
        assert!(
            !by_name.contains_key(".git"),
            "the object DB is never listed"
        );
        // 한 단계만 읽는다 — 손자는 안 나온다.
        assert!(
            !by_name.contains_key("index.js"),
            "one level only: {:?}",
            by_name.keys()
        );
    }

    #[test]
    fn dir_level_reads_one_level_and_sorts_dirs_first() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(root, "b.txt", b"x");
        write(root, "a.txt", b"x");
        write(root, "zdir/inner.txt", b"x");
        write(root, "adir/inner.txt", b"x");

        let out = read_dir_level(root, root, MAX_DIR_ENTRIES);
        let names: Vec<&str> = out.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["adir", "zdir", "a.txt", "b.txt"]);
        // 하위 디렉터리를 직접 물으면 그 단계가 나온다.
        let sub = read_dir_level(root, &root.join("zdir"), MAX_DIR_ENTRIES);
        let sub_names: Vec<&str> = sub.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(sub_names, vec!["inner.txt"]);
        assert_eq!(sub.entries[0].relative_path, "zdir/inner.txt");
    }

    #[test]
    fn dir_level_truncates_wide_directories() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        for i in 0..10 {
            write(root, &format!("f{i}.txt"), b"x");
        }
        let out = read_dir_level(root, root, 4);
        assert!(out.truncated);
        assert_eq!(out.entries.len(), 4);
    }

    #[test]
    fn tree_truncates_at_cap() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        for i in 0..10 {
            write(root, &format!("f{i}.txt"), b"x");
        }
        let tree = build_code_tree(root, 5);
        assert!(tree.truncated);
        assert_eq!(tree.file_count, 5);
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

    #[cfg(unix)]
    #[test]
    fn canonical_rejects_symlink_escaping_root() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("proj");
        fs::create_dir_all(&root).unwrap();
        fs::write(tmp.path().join("secret.txt"), b"top secret").unwrap();
        std::os::unix::fs::symlink(tmp.path().join("secret.txt"), root.join("leak.txt")).unwrap();

        let err = canonical_within_root(&root, &root.join("leak.txt")).unwrap_err();
        assert!(err.contains("escapes"), "{err}");
    }

    #[cfg(unix)]
    #[test]
    fn canonical_resolves_symlink_within_root() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("proj");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("real.txt"), b"x").unwrap();
        std::os::unix::fs::symlink(root.join("real.txt"), root.join("alias.txt")).unwrap();

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

    #[test]
    fn resolve_for_mutation_accepts_paths_that_do_not_exist_yet() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        let canon_root = fs::canonicalize(root).unwrap();

        let out = resolve_for_mutation(root, &root.join("brand/new/file.ts")).unwrap();
        assert_eq!(out, canon_root.join("brand/new/file.ts"));
    }

    #[cfg(unix)]
    #[test]
    fn resolve_for_mutation_rejects_escape_through_symlinked_parent() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("proj");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(tmp.path().join("outside")).unwrap();
        std::os::unix::fs::symlink(tmp.path().join("outside"), root.join("link")).unwrap();

        let err = resolve_for_mutation(&root, &root.join("link/planted.txt")).unwrap_err();
        assert!(err.contains("escapes"), "{err}");
    }

    /// 대상이 심링크면 **링크 자체**를 다뤄야 한다. 경로 전체를 canonical 로
    /// 풀면 "루트 안의 링크를 지운다" 가 "루트 밖의 원본을 지운다" 가 된다.
    #[cfg(unix)]
    #[test]
    fn resolve_for_mutation_keeps_the_link_itself() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("proj");
        fs::create_dir_all(&root).unwrap();
        fs::write(tmp.path().join("secret.txt"), b"top secret").unwrap();
        std::os::unix::fs::symlink(tmp.path().join("secret.txt"), root.join("leak.txt")).unwrap();

        let out = resolve_for_mutation(&root, &root.join("leak.txt")).unwrap();
        assert!(out.ends_with("leak.txt"), "{out:?}");
        assert!(out.starts_with(fs::canonicalize(&root).unwrap()));
    }

    /// 깨진 심링크는 `exists()` 로 보면 "없음" 이라, 그 자리에 파일을 만들면
    /// 커널이 링크를 따라가 **루트 밖에** 쓴다. symlink_metadata 로 막는다.
    #[cfg(unix)]
    #[test]
    fn create_refuses_to_write_through_a_dangling_symlink() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("proj");
        fs::create_dir_all(&root).unwrap();
        let outside = tmp.path().join("outside.txt");
        std::os::unix::fs::symlink(&outside, root.join("bait.txt")).unwrap();
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
            replace_in_content(content, &re("foo", false, false, false), "bar", false, None)
                .unwrap();
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
            replace_in_content(content, &re("kim", false, false, false), "$1", false, None)
                .unwrap();
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
}
