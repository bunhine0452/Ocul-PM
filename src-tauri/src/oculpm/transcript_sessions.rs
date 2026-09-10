//! 이 프로젝트의 transcript 는 **어느 파일들이고, 최근순은 무엇인가**.
//!
//! `firing_ledger` 에서 떼어 냈다. 저쪽은 "한 줄에서 무엇을 건지는가"(파싱·집계)를
//! 소유하고 여기는 파일시스템 쪽 질문만 소유한다. 소비자가 둘이 되면서 경계가
//! 실재하게 됐다 — 증분 스캔은 **전부**를 최근순으로 원하고, 세션당 예산은
//! **최근 N 건**만 원한다.

use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// transcript 폴더 루트 (홈 기준).
const PROJECTS_SUBDIR: &str = ".claude/projects";
/// 후보 디렉터리가 정말 이 프로젝트인지 확인할 때 읽는 선두 바이트.
const CWD_PROBE_BYTES: usize = 64 * 1024;
/// 세션당 예산이 보는 창 — **최근 N 세션**.
///
/// 배지의 30일 창으로 세션당 바이트를 내면, 창 안에서 규칙 구성이 바뀐 순간
/// 30일 내내 이미 없는 비용을 청구한다. 2026-09-09 실측이 그 모양이었다:
/// ECC 규칙 팩을 09-03 에 전역 삭제했는데도 예산은 80KB/세션을 보고했고,
/// 분자 6.2MB 중 살아 있는 규칙의 몫은 752B 하나뿐이었다.
///
/// 세션 창은 삭제·`paths` 좁히기·추가를 똑같이 처리한다 — 파일이 아직 있는지
/// 묻지 않고, 안 걸리면 그냥 분자에서 빠지기 때문이다. 디스크 존재 여부로
/// 거르는 방식은 삭제만 잡고 좁히기를 놓치는데, 좁히기야말로 이 화면이 미는
/// 주 처방이라 그 절반은 틀린 절반이다.
///
/// 20 인 이유: 활동일 기준 이 저장소가 약 10세션/일이라 대략 이틀이면 옛
/// 구성이 씻겨 나간다. 날짜 창처럼 설정을 고칠 때마다 비지도 않는다.
pub const BUDGET_SESSION_WINDOW: usize = 20;

// ─────────────────────────────────────────────────────────────────────────────
// transcript 위치 찾기
// ─────────────────────────────────────────────────────────────────────────────

/// Claude Code 의 프로젝트 폴더 슬러그 — 경로의 비영숫자를 `-` 로 바꾼 형태
/// (실측: `/Users/x/Desktop/git/ai-pm` → `-Users-x-Desktop-git-ai-pm`).
pub fn project_slug(root: &Path) -> String {
    root.to_string_lossy()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

/// 파일 선두에서 `cwd` 를 하나 건진다 — 슬러그가 손실 변환이라
/// (`/` 와 `-` 가 같은 글자가 된다) 후보 폴더의 진짜 주인을 확인하는 용도.
fn probe_cwd(file: &Path) -> Option<String> {
    let raw = read_head(file, CWD_PROBE_BYTES)?;
    for line in raw.lines().take(40) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
            if let Some(cwd) = v.get("cwd").and_then(|c| c.as_str()) {
                return Some(cwd.to_string());
            }
        }
    }
    None
}

fn read_head(file: &Path, cap: usize) -> Option<String> {
    use std::io::Read;
    let mut f = std::fs::File::open(file).ok()?;
    let mut buf = vec![0u8; cap];
    let n = f.read(&mut buf).ok()?;
    buf.truncate(n);
    Some(String::from_utf8_lossy(&buf).into_owned())
}

/// 이 프로젝트의 transcript 폴더들. 하위 디렉터리에서 시작한 세션은 별도
/// 슬러그 폴더(`…-ai-pm-src-tauri`)로 갈리므로 접두 일치까지 후보로 잡고,
/// 실제 `cwd` 가 프로젝트 루트 안인지 확인해 남의 프로젝트를 배제한다.
pub fn transcript_dirs(home: &Path, project_root: &Path) -> Vec<PathBuf> {
    let base = home.join(PROJECTS_SUBDIR);
    let slug = project_slug(project_root);
    let Ok(entries) = std::fs::read_dir(&base) else {
        return Vec::new();
    };
    let mut dirs: Vec<PathBuf> = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let candidate = name == slug || name.starts_with(&format!("{slug}-"));
        if !candidate || !entry.path().is_dir() {
            continue;
        }
        if name == slug || dir_belongs_to(&entry.path(), project_root) {
            dirs.push(entry.path());
        }
    }
    dirs.sort();
    dirs
}

/// 접두 일치 폴더의 소유 확인 — 첫 transcript 의 `cwd` 가 프로젝트 루트
/// 아래여야 한다. 판단 근거가 없으면(빈 폴더·cwd 부재) 보수적으로 배제한다.
fn dir_belongs_to(dir: &Path, project_root: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    for entry in entries.flatten() {
        if entry.path().extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        if let Some(cwd) = probe_cwd(&entry.path()) {
            return Path::new(&cwd).starts_with(project_root);
        }
    }
    false
}

/// transcript 파일 하나 — 최근순 정렬의 단위.
pub struct SessionFile {
    pub session_file: String,
    pub abs_path: PathBuf,
    pub modified: Option<SystemTime>,
}

/// 프로젝트의 transcript 를 **최근순**으로 나열한다 (같은 mtime 이면 이름순).
///
/// mtime 은 파일당 한 번만 읽는다 — 종전 비교자는 정렬 도중 같은 파일을 여러
/// 번 stat 했다. 파일명이 UUID 라 이름순은 날짜와 무관해서, 최근성의 근거는
/// mtime 뿐이다.
pub fn list_sessions(dirs: &[PathBuf]) -> Vec<SessionFile> {
    let mut out: Vec<SessionFile> = Vec::new();
    for dir in dirs {
        let Some(dir_name) = dir.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let Ok(entries) = std::fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let Some(file_name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            out.push(SessionFile {
                session_file: format!("{dir_name}/{file_name}"),
                modified: std::fs::metadata(&path).and_then(|m| m.modified()).ok(),
                abs_path: path,
            });
        }
    }
    out.sort_by(|a, b| {
        b.modified
            .cmp(&a.modified)
            .then_with(|| a.session_file.cmp(&b.session_file))
    });
    out
}

/// 세션당 예산의 **분모** — 최근 `n` 세션의 `session_file` 키.
///
/// 발동이 있었는지 묻지 않는 것이 요점이다. 원장에는 발동이 있어야 행이
/// 생기므로, 원장으로 세션을 세면 규칙이 하나도 안 걸린 조용한 세션이 통째로
/// 빠져 평균이 부풀려진다 (2026-09-09 실측: 09-04 이후 세션 98건 중 원장에
/// 잡힌 것 3건). 디스크의 transcript 를 세면 그 편향이 없다.
pub fn recent_sessions(dirs: &[PathBuf], n: usize) -> Vec<String> {
    list_sessions(dirs)
        .into_iter()
        .take(n)
        .map(|s| s.session_file)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_maps_non_alphanumerics_to_dash() {
        assert_eq!(
            project_slug(Path::new("/Users/x/Desktop/git/ai-pm")),
            "-Users-x-Desktop-git-ai-pm"
        );
    }

    // ─── 세션 창 (예산의 분모) ──────────────────────────────────────────────

    /// mtime 을 명시해 파일을 만든다 — 최근순 정렬의 유일한 근거다.
    /// 순서를 생성 순서에 맡기면 같은 mtime 이 나올 때 이름순 타이브레이크로
    /// 넘어가 테스트가 흔들린다.
    fn session(dir: &Path, name: &str, secs_ago: u64) {
        let path = dir.join(name);
        std::fs::write(&path, "{}\n").unwrap();
        let when = std::time::SystemTime::now() - std::time::Duration::from_secs(secs_ago);
        let f = std::fs::File::options().write(true).open(&path).unwrap();
        f.set_times(std::fs::FileTimes::new().set_modified(when))
            .unwrap();
    }

    #[test]
    fn recent_sessions_takes_the_newest_first_and_caps_at_n() {
        let dir = tempfile::TempDir::new().unwrap();
        let slug = dir.path().join("proj-slug");
        std::fs::create_dir(&slug).unwrap();
        session(&slug, "old.jsonl", 3000);
        session(&slug, "mid.jsonl", 2000);
        session(&slug, "new.jsonl", 1000);
        // transcript 가 아닌 파일은 세션이 아니다.
        std::fs::write(slug.join("notes.txt"), "x").unwrap();

        let all = recent_sessions(std::slice::from_ref(&slug), 10);
        assert_eq!(
            all,
            vec![
                "proj-slug/new.jsonl".to_string(),
                "proj-slug/mid.jsonl".to_string(),
                "proj-slug/old.jsonl".to_string(),
            ]
        );
        // 창은 가장 최근 n 건만 — 옛 구성이 여기서 밀려나면서 씻겨 나간다.
        assert_eq!(recent_sessions(&[slug], 2).len(), 2);
    }

    /// 이 창이 존재하는 이유. 원장은 **발동이 있어야** 행이 생기므로, 규칙이
    /// 하나도 안 걸린 조용한 세션은 원장에서 보이지 않는다. 그런 세션까지
    /// 분모에 들어가야 "규칙을 지웠다" 가 평균에 반영된다.
    #[test]
    fn recent_sessions_counts_quiet_sessions_too() {
        let dir = tempfile::TempDir::new().unwrap();
        let slug = dir.path().join("proj-slug");
        std::fs::create_dir(&slug).unwrap();
        // 발동이 하나도 없는 transcript — 원장에는 행이 안 생긴다.
        session(&slug, "quiet.jsonl", 10);
        assert_eq!(recent_sessions(&[slug], 20).len(), 1);
    }

    #[test]
    fn recent_sessions_is_empty_without_transcripts() {
        let dir = tempfile::TempDir::new().unwrap();
        assert!(recent_sessions(&[dir.path().join("nope")], 20).is_empty());
    }
}
