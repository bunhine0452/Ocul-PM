//! 「판정 뒤 바뀜」 — 판정 ✓ 이 지금 코드에 대해서도 참인가 (11-02).
//!
//! 판정은 확인 명령을 **그때** 돌린 결과다. 그 뒤 계획이 다룬 파일이 다시 저장됐으면 ✓ 는
//! 더 이상 지금의 코드를 말하지 않는다. 계획이 다룬 파일 = 그 계획 plan-log 에 걸린 일지들의
//! `files_touched`. 「다시 저장」은 파일의 수정 시각(mtime)이 판정 시각보다 늦은 것이다 —
//! 커밋은 mtime 을 바꾸지 않아서 「확인 → 판정 → 커밋」 의 흔한 순서는 잡히지 않고, 판정 뒤
//! 고친 것 · pull/rebase 로 내용이 바뀐 것만 잡힌다. LLM 0 · 네트워크 0 · git 실행 0.

use std::path::{Component, Path};
use std::time::SystemTime;

/// 판정 시각보다 늦게 저장된 파일 (프로젝트 루트 기준 상대경로, 정렬). 없어진 파일·`.oculpm/`·
/// 루트 밖을 가리키는 경로는 보지 않는다. 판정 시각을 못 읽으면 빈 목록 — 모르는 것을 낡았다고 하지 않는다.
pub fn changed_after(root: &Path, files: &[String], verdict_ts: &str) -> Vec<String> {
    let Ok(at) = chrono::DateTime::parse_from_rfc3339(verdict_ts) else {
        return Vec::new();
    };
    let at: SystemTime = at.with_timezone(&chrono::Utc).into();
    let mut out: Vec<String> = files
        .iter()
        .filter(|f| inside_project(f))
        .filter(|f| {
            std::fs::metadata(root.join(f.as_str()))
                .and_then(|m| m.modified())
                .is_ok_and(|m| m > at)
        })
        .cloned()
        .collect();
    out.sort();
    out.dedup();
    out
}

/// 일지가 적은 경로가 프로젝트 안 · 기록 폴더 밖인가.
fn inside_project(rel: &str) -> bool {
    let p = Path::new(rel);
    !rel.is_empty()
        && !rel.starts_with(".oculpm/")
        && p.components().all(|c| matches!(c, Component::Normal(_)))
}

/// plan-log 의 일지 열(`.oculpm/journal/…` 또는 일지 루트 기준) → 캐시의 일지 루트 기준 경로.
pub fn journal_rel(r: &str) -> String {
    let s = r.strip_prefix(".oculpm/").unwrap_or(r);
    s.strip_prefix("journal/").unwrap_or(s).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::time::Duration;

    fn touch(root: &Path, rel: &str, at: SystemTime) {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        let f = File::create(&p).unwrap();
        f.set_modified(at).unwrap();
    }

    #[test]
    fn files_saved_after_the_verdict_are_stale() {
        let dir = tempfile::tempdir().unwrap();
        let verdict = chrono::DateTime::parse_from_rfc3339("2026-11-02T10:00:00+09:00").unwrap();
        let t: SystemTime = verdict.with_timezone(&chrono::Utc).into();
        touch(dir.path(), "src/before.ts", t - Duration::from_secs(60));
        touch(dir.path(), "src/after.ts", t + Duration::from_secs(60));
        touch(
            dir.path(),
            ".oculpm/journal/x.md",
            t + Duration::from_secs(60),
        );
        let files = [
            "src/after.ts",
            "src/before.ts",
            "src/gone.ts",
            ".oculpm/journal/x.md",
            "../outside.ts",
            "/etc/hosts",
            "src/after.ts",
        ]
        .map(String::from);
        assert_eq!(
            changed_after(dir.path(), &files, "2026-11-02T10:00:00+09:00"),
            vec!["src/after.ts".to_string()]
        );
        assert!(changed_after(dir.path(), &files, "어제").is_empty());
    }

    #[test]
    fn plan_log_journal_refs_become_cache_paths() {
        assert_eq!(
            journal_rel(".oculpm/journal/20261102/Bugs/a.md"),
            "20261102/Bugs/a.md"
        );
        assert_eq!(
            journal_rel("journal/20261102/Bugs/a.md"),
            "20261102/Bugs/a.md"
        );
        assert_eq!(journal_rel("20261102/Bugs/a.md"), "20261102/Bugs/a.md");
    }
}
