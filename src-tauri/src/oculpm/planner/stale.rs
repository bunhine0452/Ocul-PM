//! 「판정 뒤 바뀜」 — 판정 ✓ 이 지금 코드에 대해서도 참인가 (11-02).
//!
//! 판정은 확인 명령을 **그때** 돌린 결과다. 그 뒤 계획이 다룬 파일이 다시 저장됐으면 ✓ 는
//! 더 이상 지금의 코드를 말하지 않는다. 계획이 다룬 파일 = 그 계획 plan-log 에 걸린 일지들의
//! `files_touched`. 「다시 저장」은 파일의 수정 시각(mtime)이 판정 시각보다 늦은 것이다 —
//! 커밋은 mtime 을 바꾸지 않아서 「확인 → 판정 → 커밋」 의 흔한 순서는 잡히지 않고, 판정 뒤
//! 고친 것 · pull/rebase 로 내용이 바뀐 것만 잡힌다. LLM 0 · 네트워크 0.
//!
//! 수정 시각은 **후보**만 고른다 (11-22). clone · pull · 브랜치 전환은 내용이 같은 파일의 수정
//! 시각도 바꾸므로, 후보가 있을 때만 git 에게 「판정 줄을 들여온 커밋과 지금 내용이 다른가」 를
//! 물어 받기만 한 파일을 뺀다 ([`changed_since_verdict`]). 후보가 없는 보통의 날은 git 실행 0.

use std::path::{Component, Path};
use std::time::SystemTime;

/// 판정 시각보다 늦게 저장된 파일 (프로젝트 루트 기준 상대경로, 정렬). 없어진 파일·`.oculpm/`·
/// 루트 밖을 가리키는 경로는 보지 않는다. 판정 시각을 못 읽으면 빈 목록 — 모르는 것을 낡았다고 하지 않는다.
pub fn changed_after(root: &Path, files: &[String], verdict_ts: &str) -> Vec<String> {
    let Some(at) = crate::clock::parse_rfc3339(verdict_ts) else {
        return Vec::new();
    };
    let at: SystemTime = at.into();
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

/// 판정 뒤 **내용이** 바뀐 파일 — [`changed_after`] 의 후보를 git 으로 한 번 더 거른다
/// (2026-11-22, 플랜 `agent-era-20261122` {#stale-by-content}).
///
/// 수정 시각만 보면 **받기만 한 파일**이 「통과 뒤 바뀜」으로 선다: clone · pull · 브랜치 전환 ·
/// 워크트리는 내용이 같아도 수정 시각을 지금으로 바꾼다. 에이전트가 클라우드 · 워크트리 · 다른
/// 기기에서 일하고 결과가 git 으로 돌아오는 흐름에서는 그 거짓 호박색이 매일 생긴다.
///
/// 판정 줄은 계획 파일에 적히고, 확인한 코드와 함께(또는 그 뒤에) 커밋된다. 그래서 **그 판정 줄을
/// 들여온 커밋**의 트리는 판정이 본 코드를 담고 있다. 후보 가운데 그 커밋과 지금 내용이 같은
/// 파일은 바뀐 것이 아니다 — 뺀다. 빼기만 한다: 결과는 늘 수정 시각 후보의 부분집합이다.
///
/// git 이 답하지 못하면(저장소가 아니다 · 판정 줄이 아직 커밋되지 않았다 · 얕은 클론이라 그
/// 커밋이 없다 · 계획 파일 이름이 id 와 다르다) 예전처럼 수정 시각만 본다. 후보가 없으면 git 을
/// 띄우지 않는다 — 보통의 날에는 프로세스 0 이다. 네트워크 0 · LLM 0.
pub fn changed_since_verdict(
    root: &Path,
    files: &[String],
    verdict_ts: &str,
    plan_id: &str,
) -> Vec<String> {
    let candidates = changed_after(root, files, verdict_ts);
    if candidates.is_empty() {
        return candidates;
    }
    // 같은 후보(경로 · 수정 시각)에 같은 물음이면 답도 같다 — 오늘 화면은 워처가 깨울 때마다
    // 다시 묻고, git 은 Windows 에서 한 번에 수십 ms 다.
    let key = (
        root.to_path_buf(),
        plan_id.to_string(),
        verdict_ts.to_string(),
    );
    let stamp = stamp_of(root, &candidates);
    if let Ok(cache) = CONTENT_CACHE.lock() {
        if let Some((seen, answer)) = cache.get(&key) {
            if *seen == stamp {
                return answer.clone();
            }
        }
    }
    let answer = match content_changed(root, plan_id, verdict_ts, &candidates) {
        Some(differs) => candidates
            .into_iter()
            .filter(|f| differs.contains(f))
            .collect(),
        None => candidates,
    };
    if let Ok(mut cache) = CONTENT_CACHE.lock() {
        // 계획 수만큼만 자란다. 그래도 프로젝트를 오래 여닫으면 쌓이니 상한을 둔다.
        if cache.len() >= 512 {
            cache.clear();
        }
        cache.insert(key, (stamp, answer.clone()));
    }
    answer
}

type ContentKey = (std::path::PathBuf, String, String);
/// (후보들의 `경로 · 수정 시각` 도장, 그때의 답).
static CONTENT_CACHE: std::sync::LazyLock<
    std::sync::Mutex<std::collections::HashMap<ContentKey, (Vec<(String, u128)>, Vec<String>)>>,
> = std::sync::LazyLock::new(Default::default);

/// 후보마다 `(경로, 수정 시각 나노초)` — 하나라도 다시 저장되면 도장이 달라진다.
fn stamp_of(root: &Path, files: &[String]) -> Vec<(String, u128)> {
    files
        .iter()
        .map(|f| {
            let at = std::fs::metadata(root.join(f))
                .and_then(|m| m.modified())
                .ok()
                .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_nanos());
            (f.clone(), at)
        })
        .collect()
}

/// `root` 에서 `git <args>` 의 표준 출력 (실패 · 시간 초과면 `None`).
fn git_lines(root: &Path, args: &[&str]) -> Option<Vec<String>> {
    let out = crate::git::safe::output(&mut crate::git::safe::cmd(root, args)).ok()?;
    out.status.success().then(|| {
        String::from_utf8_lossy(&out.stdout)
            .lines()
            .map(|l| l.trim_end_matches('\r').to_string())
            .filter(|l| !l.is_empty())
            .collect()
    })
}

/// 후보 가운데 **판정 줄을 들여온 커밋과 지금의 내용이 다른** 파일 (프로젝트 루트 기준).
/// 그 커밋을 못 찾으면 `None` — 그때 호출부는 수정 시각만 믿는다.
fn content_changed(
    root: &Path,
    plan_id: &str,
    verdict_ts: &str,
    candidates: &[String],
) -> Option<std::collections::HashSet<String>> {
    use std::collections::HashSet;
    // 인자로 나가는 글자를 좁힌다 — 계획 id 와 판정 시각은 저장소에 실려 온 글이다.
    let plain = |s: &str| {
        !s.is_empty()
            && !s.starts_with(['-', '.'])
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || "._-+:".contains(c))
    };
    if !plain(plan_id) || !plain(verdict_ts) {
        return None;
    }
    // 판정 줄(그 시각 문자열)이 계획 파일에 처음 나타난 커밋 — 로그가 넘쳐 `<id>.log.md` 로
    // 옮겨졌어도 들여온 커밋은 같다. `log` 는 새것부터 내므로 마지막 줄이 가장 오래된 것이다.
    let pick = format!("-S{verdict_ts}");
    let plan = format!(".oculpm/planner/{plan_id}.md");
    let archive = format!(".oculpm/planner/{plan_id}.log.md");
    let commits = git_lines(root, &["log", "--format=%H", &pick, "--", &plan, &archive])?;
    let base = commits.last()?;
    if base.len() < 40 || !base.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    // 그 커밋과 지금 워킹트리가 다른 추적 파일 — 경로는 프로젝트 루트(여기) 기준으로.
    let diff: HashSet<String> = git_lines(root, &["diff", "--name-only", "--relative", base])?
        .into_iter()
        .collect();
    let mut differs: HashSet<String> = candidates
        .iter()
        .filter(|f| diff.contains(*f))
        .cloned()
        .collect();
    // diff 는 추적하지 않는 파일을 말하지 않는다 — 그 커밋에 **없던** 파일은 판정 뒤에 생긴 것이라
    // 바뀐 것으로 남긴다. diff 가 후보를 전부 짚었으면 트리는 읽지 않는다.
    if differs.len() < candidates.len() {
        let then: HashSet<String> = git_lines(root, &["ls-tree", "-r", "--name-only", base])?
            .into_iter()
            .collect();
        differs.extend(candidates.iter().filter(|f| !then.contains(*f)).cloned());
    }
    Some(differs)
}

/// 일지가 적은 경로가 프로젝트 안 · 기록 폴더 밖인가.
pub(crate) fn inside_project(rel: &str) -> bool {
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
        let verdict = crate::clock::parse_rfc3339("2026-11-02T10:00:00+09:00").unwrap();
        let t: SystemTime = verdict.into();
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

    // ─── 내용으로 다시 거르기 (11-22 {#stale-by-content}) ────────────────────

    const VERDICT_TS: &str = "2026-11-22T10:00:00+09:00";

    fn git(root: &Path, args: &[&str]) {
        let out = crate::git::safe::output(&mut crate::git::safe::cmd(root, args)).expect("git");
        assert!(
            out.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    fn write(root: &Path, rel: &str, text: &str) {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }

    /// 수정 시각을 판정보다 한 시간 뒤로 — clone · pull 이 파일을 다시 쓴 것을 흉내 낸다.
    fn redate(root: &Path, rel: &str) {
        let at: SystemTime = crate::clock::parse_rfc3339(VERDICT_TS).unwrap().into();
        File::options()
            .write(true)
            .open(root.join(rel))
            .unwrap()
            .set_modified(at + Duration::from_secs(3600))
            .unwrap();
    }

    fn plan_md(rows: &str) -> String {
        format!(
            "---\nid: round\nstatus: active\n---\n\n- [x] 하나 {{#a}}\n\n<!-- oculpm:plan-log begin v1 -->\n| 시각 | 항목 | 에이전트 | 변화 | 일지 | 메모 |\n|---|---|---|---|---|---|\n{rows}<!-- oculpm:plan-log end -->\n"
        )
    }

    /// 코드 둘과 판정 줄이 든 계획을 **한 커밋**으로 — 「확인 → 판정 → 커밋」 의 흔한 순서.
    fn repo_with_verdict_commit() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        git(root, &["init", "-q"]);
        git(root, &["config", "user.email", "t@example.com"]);
        git(root, &["config", "user.name", "t"]);
        git(root, &["config", "commit.gpgsign", "false"]);
        write(root, "src/a.rs", "fn a() {}\n");
        write(root, "src/b.rs", "fn b() {}\n");
        write(root, ".oculpm/planner/round.md", &plan_md(""));
        git(root, &["add", "."]);
        git(root, &["commit", "-qm", "seed"]);
        let row =
            format!("| {VERDICT_TS} | #a | claude-code | ~→x |  | 판정 ✓ 12 passed · mac |\n");
        write(root, ".oculpm/planner/round.md", &plan_md(&row));
        write(root, "src/a.rs", "fn a() { /* 고쳤다 */ }\n");
        git(root, &["add", "."]);
        git(root, &["commit", "-qm", "fix + verdict"]);
        dir
    }

    fn files() -> Vec<String> {
        ["src/a.rs", "src/b.rs", "src/new.rs"]
            .map(String::from)
            .to_vec()
    }

    /// **이 장치의 이유** — 받기만 한 파일(수정 시각만 새롭고 내용은 판정 때 그대로)은 바뀐 것이 아니다.
    #[test]
    fn files_that_were_only_rewritten_are_not_stale() {
        let dir = repo_with_verdict_commit();
        let root = dir.path();
        redate(root, "src/a.rs");
        redate(root, "src/b.rs");
        // 수정 시각만 보면 둘 다 「통과 뒤 바뀜」 이다.
        assert_eq!(
            changed_after(root, &files(), VERDICT_TS),
            ["src/a.rs", "src/b.rs"]
        );
        // 내용은 판정 줄을 들여온 커밋과 같다 — 조용하다.
        assert!(changed_since_verdict(root, &files(), VERDICT_TS, "round").is_empty());
    }

    /// 판정 뒤 정말 고친 파일 · 판정 뒤 새로 생긴 파일은 그대로 남는다.
    #[test]
    fn files_really_changed_after_the_verdict_stay_stale() {
        let dir = repo_with_verdict_commit();
        let root = dir.path();
        redate(root, "src/a.rs");
        write(root, "src/b.rs", "fn b() { /* 판정 뒤에 고침 */ }\n");
        redate(root, "src/b.rs");
        write(root, "src/new.rs", "fn n() {}\n");
        redate(root, "src/new.rs");
        assert_eq!(
            changed_since_verdict(root, &files(), VERDICT_TS, "round"),
            ["src/b.rs", "src/new.rs"],
            "추적하지 않는 새 파일은 diff 가 말하지 않아도 바뀐 것이다"
        );
        // 그 고침을 커밋해도 판정이 본 내용과 다르다는 사실은 그대로다.
        git(root, &["add", "."]);
        git(root, &["commit", "-qm", "after"]);
        redate(root, "src/b.rs");
        redate(root, "src/new.rs");
        assert_eq!(
            changed_since_verdict(root, &files(), VERDICT_TS, "round"),
            ["src/b.rs", "src/new.rs"]
        );
    }

    /// git 이 답하지 못하면 수정 시각만 본다 — 모르는 것을 「그대로」 라고 하지 않는다.
    #[test]
    fn without_a_verdict_commit_the_modified_time_decides() {
        // 저장소가 아니다.
        let plain = tempfile::tempdir().unwrap();
        write(plain.path(), "src/a.rs", "x\n");
        redate(plain.path(), "src/a.rs");
        assert_eq!(
            changed_since_verdict(plain.path(), &files(), VERDICT_TS, "round"),
            ["src/a.rs"]
        );
        // 판정 줄이 아직 커밋되지 않았다 (같은 기기에서 일하는 중).
        let dir = repo_with_verdict_commit();
        let root = dir.path();
        let later = "2026-11-22T11:00:00+09:00";
        let at: SystemTime = crate::clock::parse_rfc3339(later).unwrap().into();
        File::options()
            .write(true)
            .open(root.join("src/a.rs"))
            .unwrap()
            .set_modified(at + Duration::from_secs(60))
            .unwrap();
        // b.rs 는 판정보다 앞 — 만든 날의 시계에 기대면 판정 시각이 지난 뒤(11-23)부터 b.rs 도 「바뀜」 이 된다.
        File::options()
            .write(true)
            .open(root.join("src/b.rs"))
            .unwrap()
            .set_modified(at - Duration::from_secs(3600))
            .unwrap();
        assert_eq!(
            changed_since_verdict(root, &files(), later, "round"),
            ["src/a.rs"]
        );
        // 이상한 계획 id 는 git 에 싣지 않는다.
        redate(root, "src/b.rs");
        assert_eq!(
            changed_since_verdict(root, &files(), VERDICT_TS, "--output=x"),
            ["src/a.rs", "src/b.rs"]
        );
    }

    /// 후보가 없으면 git 을 띄우지 않고, 같은 물음은 한 번만 묻는다.
    #[test]
    fn git_runs_only_when_there_are_candidates_and_only_once() {
        let dir = repo_with_verdict_commit();
        let root = dir.path();
        // 커밋은 수정 시각을 바꾸지 않지만 이 저장소는 방금 만들어져 전부 「지금」 이다 — 옛날로 돌린다.
        let old: SystemTime = crate::clock::parse_rfc3339("2026-11-01T00:00:00+09:00")
            .unwrap()
            .into();
        for rel in ["src/a.rs", "src/b.rs"] {
            File::options()
                .write(true)
                .open(root.join(rel))
                .unwrap()
                .set_modified(old)
                .unwrap();
        }
        let before = crate::git::safe::spawn_count();
        assert!(changed_since_verdict(root, &files(), VERDICT_TS, "round").is_empty());
        assert_eq!(
            crate::git::safe::spawn_count(),
            before,
            "후보가 없는데 git 을 띄웠다"
        );

        redate(root, "src/a.rs");
        assert!(changed_since_verdict(root, &files(), VERDICT_TS, "round").is_empty());
        let asked = crate::git::safe::spawn_count();
        assert!(asked > before, "후보가 있으면 git 에게 묻는다");
        assert!(changed_since_verdict(root, &files(), VERDICT_TS, "round").is_empty());
        assert_eq!(
            crate::git::safe::spawn_count(),
            asked,
            "같은 후보 · 같은 수정 시각이면 다시 묻지 않는다"
        );
    }
}
