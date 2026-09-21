//! 릴리스 노트 **초안** (플랜 `journal-scale-round` `{#release-notes-draft}`).
//!
//! # 왜 초안인가 — 쓰지 않는다
//!
//! 이 저장소의 릴리스는 다섯 면(버전 6파일 · `CHANGELOG.md` · README ko/en ·
//! 랜딩 ko/en)을 사람이 채우는 규율이고, 그중 `CHANGELOG.md` 만이 GitHub 릴리스
//! 노트의 원본이다 (`docs/RELEASE.md`). 그래서 이 커맨드는 **파일을 건드리지
//! 않는다** — 마크다운 한 판을 돌려줄 뿐이고, 붙여 넣는 것은 사람이다. 앱이
//! CHANGELOG 를 고치기 시작하면 "다섯 면을 한 번에 훑는다"는 규율이 한 면만
//! 자동이 되어 나머지 네 면이 조용히 뒤처진다.
//!
//! 버전도 짓지 않는다. `## v?` 자리표시를 두고 `scripts/bump-version.mjs` 가
//! 정한다고 적는다 — 커밋 목록만 보고 minor/patch 를 판정하는 것은 추측이다.
//!
//! # 커밋과 일지를 어떻게 잇는가
//!
//! 범위(`from..to`)의 커밋에서 **시각 범위**와 **만진 파일**을 얻는다. 시각
//! 범위는 프로젝트의 워크데이 리졸버(`manager.workday_at`)를 지나 일지 폴더의
//! 날짜가 되고, 그 워크데이의 일지를 캐시에서 읽는다. 만진 파일은 일지의
//! `files_touched` 와 교집합을 내어 **가중**이 된다 — 겹침이 큰 일지가 먼저 온다.
//!
//! 겹치지 않는 일지도 목록에 남기고 「커밋 연결 없음」을 적는다. 같은 날 쓴
//! 일지가 이 릴리스와 무관할 수 있다는 사실을 지우는 편이, 있는 것을 감추는
//! 편보다 낫다 — 판단은 붙여 넣는 사람이 한다.
//!
//! # 새 아웃바운드 자리를 만들지 않는다
//!
//! LLM 판은 `summary::call_llm` 을 그대로 지난다 (`commands/rollup.rs` 와 같은
//! 이유 — 유출 경계 원장은 `llm::create` 를 **부르는 파일**을 센다). 재료도
//! 같은 캐시 투영(`rollup_source_entries`)이라 `Redaction::ViaProjection` 사유가
//! 그대로 적용된다.

use std::collections::HashSet;

use serde::Serialize;
use tauri::State;

use crate::app_error::AppError;
use crate::db::Db;
use crate::git;
use crate::oculpm::cache::{JournalCache, RollupSourceEntry};
use crate::oculpm::content_lang::ContentLang;
use crate::oculpm::manager::OculpmManager;

/// 범위에서 읽을 커밋 상한. 태그 사이가 이보다 길면 초안이 아니라 목록이 된다.
const COMMIT_CAP: u32 = 400;
/// 인용 한 줄의 문자 수 상한. 초안은 **읽히려고** 있다.
const QUOTE_CHARS: usize = 220;
/// 문체 표본으로 실을 `CHANGELOG` 섹션 수.
const STYLE_SAMPLES: usize = 2;
/// 문체 표본 전체의 문자 수 상한 — 긴 릴리스 두 개가 프롬프트를 삼키지 않게.
const STYLE_SAMPLE_CHARS: usize = 6000;

// ─────────────────────────────────────────────────────────────────────────────
// 응답
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct ReleaseNotesDraft {
    /// 붙여 넣을 마크다운 한 판. **어디에도 쓰이지 않았다.**
    pub markdown: String,
    /// 범위 안 커밋 수.
    pub commits: u32,
    /// 그 워크데이 범위에서 모은 일지 수.
    pub entries: u32,
    /// 그중 커밋이 만진 파일과 겹친 일지 수.
    pub linked: u32,
    /// 실제로 쓰인 기준. `None` = `v*` 태그를 찾지 못해 전체 이력을 읽었다.
    pub from_ref: Option<String>,
    pub to_ref: String,
    pub used_llm: bool,
    /// 사용자에게 알릴 한 줄 (폴백 사유·태그 없음 등).
    pub note: Option<String>,
}

// ─────────────────────────────────────────────────────────────────────────────
// 순수 — 결정적 초안
// ─────────────────────────────────────────────────────────────────────────────

/// 초안의 한 줄이 될 일지. 캐시 원본에 **커밋과의 연결**을 더한 판.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DraftEntry {
    pub relative_path: String,
    pub entry_type: String,
    pub title: String,
    /// 본문 첫 문단(타입별 선행 섹션). 한 줄로 편다.
    pub lead: String,
    /// `files_touched` 와 범위 커밋이 만진 파일의 교집합 크기. 0 = 연결 없음.
    pub overlap: usize,
}

/// 일지 타입이 가는 묶음. 순서가 곧 초안의 섹션 순서다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Bucket {
    /// bug · error — 「고친 것」.
    Fixed,
    /// feature — 「새로 생긴 것」.
    New,
    /// refactor · chore · 그 밖 — 「안에서 바뀐 것」.
    Inside,
}

pub(crate) fn bucket_of(entry_type: &str) -> Bucket {
    match entry_type {
        "bug" | "error" => Bucket::Fixed,
        "feature" => Bucket::New,
        _ => Bucket::Inside,
    }
}

fn bucket_title(b: Bucket, lang: ContentLang) -> &'static str {
    match b {
        Bucket::Fixed => lang.pick("### 고친 것", "### Fixed"),
        Bucket::New => lang.pick("### 새로 생긴 것", "### New"),
        Bucket::Inside => lang.pick("### 안에서 바뀐 것", "### Inside"),
    }
}

/// 타입별 **선행 섹션** — AGENTS.md §2 의 강제 헤더 순서에서 첫 번째.
/// 없는 타입(chore)은 본문 첫 문단을 쓴다.
fn lead_section(entry_type: &str) -> Option<&'static str> {
    match entry_type {
        "bug" | "error" => Some("## 발생 원인"),
        "feature" => Some("## 추가 기능"),
        "refactor" => Some("## 동기"),
        _ => None,
    }
}

/// 일지 본문에서 인용할 첫 문단.
///
/// 타입의 선행 섹션이 있으면 그 아래 첫 문단, 없거나 못 찾으면 본문 첫 문단
/// (첫 줄 `[x] 제목` 체크박스와 헤더 줄은 건너뛴다). 여러 줄이면 한 줄로 편다.
pub(crate) fn lead_paragraph(entry_type: &str, body: &str) -> String {
    let from_section = lead_section(entry_type).and_then(|h| {
        let mut lines = body.lines().skip_while(|l| l.trim() != h);
        lines.next()?; // 헤더 줄 자체
        first_paragraph(lines)
    });
    let text = from_section
        .or_else(|| {
            first_paragraph(
                body.lines()
                    .filter(|l| !l.trim_start().starts_with('#'))
                    .skip_while(|l| is_checkbox_line(l)),
            )
        })
        .unwrap_or_default();
    truncate_chars(&text, QUOTE_CHARS)
}

/// 본문 첫 줄의 `[x] 제목` / `[ ] 제목` 표식인가 (AGENTS.md §2).
fn is_checkbox_line(line: &str) -> bool {
    let t = line.trim_start();
    t.starts_with("[x]") || t.starts_with("[X]") || t.starts_with("[ ]")
}

/// 빈 줄을 건너뛰고 만난 첫 문단을 한 줄로 편다.
fn first_paragraph<'a>(lines: impl Iterator<Item = &'a str>) -> Option<String> {
    let mut para: Vec<&str> = Vec::new();
    for line in lines {
        let t = line.trim();
        if t.is_empty() {
            if para.is_empty() {
                continue;
            }
            break;
        }
        if t.starts_with('#') && !para.is_empty() {
            break;
        }
        para.push(t);
    }
    if para.is_empty() {
        None
    } else {
        Some(para.join(" "))
    }
}

/// 문자 단위로 자른다 — 바이트로 자르면 한글 중간이 깨진다.
fn truncate_chars(s: &str, cap: usize) -> String {
    if s.chars().count() <= cap {
        return s.to_string();
    }
    let cut: String = s.chars().take(cap).collect();
    format!("{}…", cut.trim_end())
}

/// 캐시 일지 + 커밋이 만진 파일(프로젝트 기준) → 초안 항목.
/// 묶음 순서, 그 안에서 **겹침 큰 순 → 워크데이 → 경로**로 정렬한다.
pub(crate) fn build_entries(
    entries: &[RollupSourceEntry],
    commit_files: &HashSet<String>,
) -> Vec<DraftEntry> {
    let mut out: Vec<(Bucket, usize, String, DraftEntry)> = entries
        .iter()
        .map(|e| {
            let overlap = e.files.iter().filter(|f| commit_files.contains(*f)).count();
            (
                bucket_of(&e.entry_type),
                overlap,
                e.workday.clone(),
                DraftEntry {
                    relative_path: e.relative_path.clone(),
                    entry_type: e.entry_type.clone(),
                    title: e.title.clone(),
                    lead: lead_paragraph(&e.entry_type, &e.body_markdown),
                    overlap,
                },
            )
        })
        .collect();
    out.sort_by(|a, b| {
        a.0.cmp(&b.0)
            .then_with(|| b.1.cmp(&a.1))
            .then_with(|| a.2.cmp(&b.2))
            .then_with(|| a.3.relative_path.cmp(&b.3.relative_path))
    });
    out.into_iter().map(|(_, _, _, e)| e).collect()
}

/// 통계 한 줄 — 커밋 N개 · 일지 M건 · 이어진 일지 K건.
pub(crate) fn stats_line(
    from_ref: Option<&str>,
    to_ref: &str,
    commits: usize,
    entries: &[DraftEntry],
    lang: ContentLang,
) -> String {
    let linked = entries.iter().filter(|e| e.overlap > 0).count();
    let range = match from_ref {
        Some(f) => format!("`{f}..{to_ref}`"),
        None => format!("`{to_ref}` ({})", lang.pick("태그 없음", "no tag")),
    };
    match lang {
        ContentLang::English => format!(
            "Range {range} · {commits} commits · {} journal entries · {linked} linked to a commit",
            entries.len()
        ),
        _ => format!(
            "범위 {range} · 커밋 {commits}개 · 일지 {}건 · 커밋과 이어진 일지 {linked}건",
            entries.len()
        ),
    }
}

/// LLM 없이 만드는 초안. **키가 없거나 호출이 실패하면 이게 최종 산출물**이다.
pub(crate) fn deterministic_draft(
    from_ref: Option<&str>,
    to_ref: &str,
    commits: usize,
    entries: &[DraftEntry],
    lang: ContentLang,
) -> String {
    let mut out = String::from("## v?\n\n");
    // 버전을 짓지 않는 이유를 초안 자체가 말한다 — 이 줄을 지우고 실제 버전을
    // 적는 것이 사람의 몫이다.
    out.push_str(lang.pick(
        "<!-- 버전 자리 — `scripts/bump-version.mjs` 가 6개 버전 파일과 함께 정합니다. \
         태그를 밀기 전에 `v?` 를 실제 버전으로 바꾸세요. -->\n\n",
        "<!-- Version placeholder — `scripts/bump-version.mjs` decides it together with the \
         6 version files. Replace `v?` before pushing the tag. -->\n\n",
    ));
    out.push_str(&stats_line(from_ref, to_ref, commits, entries, lang));
    out.push_str("\n\n");

    if entries.is_empty() {
        out.push_str(lang.pick(
            "이 범위의 워크데이에서 작업 일지를 찾지 못했어요.\n",
            "No work journals were found in this range's workdays.\n",
        ));
        return out;
    }

    for b in [Bucket::Fixed, Bucket::New, Bucket::Inside] {
        let group: Vec<&DraftEntry> = entries
            .iter()
            .filter(|e| bucket_of(&e.entry_type) == b)
            .collect();
        if group.is_empty() {
            continue;
        }
        out.push_str(bucket_title(b, lang));
        out.push_str("\n\n");
        for e in group {
            out.push_str(&bullet(e, lang));
        }
        out.push('\n');
    }
    out
}

fn bullet(e: &DraftEntry, lang: ContentLang) -> String {
    let mut line = format!("- **{}**", e.title.trim());
    if !e.lead.is_empty() {
        line.push_str(&format!(" — {}", e.lead));
    }
    if e.overlap == 0 {
        line.push(' ');
        line.push_str(lang.pick("「커밋 연결 없음」", "(not linked to a commit)"));
    }
    line.push_str(&format!(
        " ({}: `{}`)\n",
        lang.pick("일지", "journal"),
        e.relative_path
    ));
    line
}

// ─────────────────────────────────────────────────────────────────────────────
// 순수 — 참조 위생과 문체 표본
// ─────────────────────────────────────────────────────────────────────────────

/// git 에 넘길 수 있는 ref 인가. `--output=…` 같은 문자열이 플래그로 읽히는 것을
/// 막는다 — 읽기 전용 `git log` 라도 인자 자리에 옵션이 서면 동작이 달라진다.
pub(crate) fn sane_ref(raw: &str) -> Option<String> {
    let r = raw.trim();
    if r.is_empty() || r.starts_with('-') {
        return None;
    }
    let ok = r
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || "._/~^@-".contains(c));
    ok.then(|| r.to_string())
}

/// `CHANGELOG.md` 위에서부터 `## ` 섹션 `n` 개 — 문체 표본.
///
/// 요약하지 않고 **그대로** 넣는다. 이 저장소의 체인지로그 문체(굵은 첫 문장 +
/// "무엇이 왜 아팠고 어떻게 바뀌었나" 문단)는 규칙으로 옮겨 적을 수 있는 것이
/// 아니라 읽혀야 옮는 것이다.
pub(crate) fn style_samples(changelog: &str, n: usize) -> String {
    let lines: Vec<&str> = changelog.lines().collect();
    let heads: Vec<usize> = lines
        .iter()
        .enumerate()
        .filter(|(_, l)| l.starts_with("## "))
        .map(|(i, _)| i)
        .collect();
    if heads.is_empty() {
        return String::new();
    }
    let end = heads.get(n).copied().unwrap_or(lines.len());
    truncate_chars(&lines[heads[0]..end].join("\n"), STYLE_SAMPLE_CHARS)
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM
// ─────────────────────────────────────────────────────────────────────────────

/// 서사체로 다시 쓰게 하는 시스템 프롬프트. **초안에 있는 사실만** 쓰게 한다 —
/// 체인지로그는 사용자가 읽는 약속이라 여기서 지어낸 한 줄이 곧 거짓말이 된다.
// i18n-ignore-next-line -- LLM 프롬프트 본문 (03-i18n.md §4.5)
const SYSTEM_PROMPT: &str = r#"너는 이 저장소의 CHANGELOG 를 쓰는 사람이다.
입력: 기계가 만든 릴리스 노트 초안(일지 제목과 본문 첫 문단)과, 이 저장소의 지난 릴리스 본문(문체 표본).
출력: 마크다운 본문만 (코드펜스·머리말 금지). `## v?` 헤더와 그 아래 주석 줄을 **그대로** 첫 두 줄로 둘 것.
문체: 기능 나열이 아니라 서사다. 중요한 변화 2~4개는 **굵은 첫 문장**으로 시작하는 문단으로 — 무엇이 왜 아팠고 어떻게 바뀌었는지. 나머지는 `- **무엇** — 어떻게` 불릿으로 묶는다.
규칙: 초안에 있는 사실만. 버전 번호를 짓지 말 것(`v?` 유지). 일지 경로는 최종 본문에 남기지 말 것. 추측·다짐·홍보 문구 금지."#;

/// 설정의 **대화 모델**을 읽는다 (프런트 `resolveLlmTarget` 과 같은 순서).
/// 배경 작업이 아니라 사용자가 버튼으로 시작하는 전경 작업이라 `core_*` 슬롯이
/// 아니라 이쪽이다 (`oculpm_rollup_week` 이 프런트에서 같은 값을 받아 온다).
async fn chat_target(db: &Db) -> Option<(String, String)> {
    let get = |k: String| async move {
        db.settings_get(k)
            .await
            .ok()
            .flatten()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
    };
    let provider = get("default_provider".to_string()).await?;
    let model = match get(format!("model_{provider}")).await {
        Some(m) => m,
        None => get("default_model".to_string()).await?,
    };
    Some((provider, model))
}

// ─────────────────────────────────────────────────────────────────────────────
// 커맨드
// ─────────────────────────────────────────────────────────────────────────────

/// 지난 태그부터 지금까지의 커밋과 일지로 릴리스 노트 초안을 만든다.
///
/// `from_ref` 기본값 = `to_ref` 에서 거슬러 닿는 마지막 `v*` 태그,
/// `to_ref` 기본값 = `HEAD`. `use_llm` 이 참이어도 모델이 없거나 호출이 실패하면
/// 결정적 초안으로 물러선다 (`used_llm=false` + `note`) — `oculpm_generate_summary`
/// 와 같은 폴백 규약. **`CHANGELOG.md` 는 건드리지 않는다** (모듈 문서 §왜 초안인가).
#[tauri::command]
#[specta::specta]
pub async fn oculpm_release_notes_draft(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
    from_ref: Option<String>,
    to_ref: Option<String>,
    use_llm: bool,
) -> Result<ReleaseNotesDraft, AppError> {
    let root = manager.project_root(project_id).await?;
    let to = to_ref
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map_or_else(
            || Ok("HEAD".to_string()),
            |r| {
                sane_ref(r)
                    .ok_or_else(|| AppError::new("release_notes_bad_ref", format!("to: {r}")))
            },
        )?;
    let mut note: Option<String> = None;
    let from = match from_ref.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(r) => Some(
            sane_ref(r)
                .ok_or_else(|| AppError::new("release_notes_bad_ref", format!("from: {r}")))?,
        ),
        None => {
            let found = git::latest_version_tag(&root, &to)?;
            if found.is_none() {
                note = Some(
                    "`v*` 태그를 찾지 못해 이력 전체를 읽었어요 — 기준을 직접 적으면 범위가 좁아져요."
                        .to_string(),
                );
            }
            found
        }
    };

    let commits = git::log_range_with_files(&root, from.as_deref().unwrap_or(""), &to, COMMIT_CAP)?;

    // 커밋이 만진 파일을 **프로젝트 기준**으로 되맞춘다 — 저장소 루트가 프로젝트
    // 루트와 다를 수 있고, 일지의 `files_touched` 는 프로젝트 기준이다.
    let mut commit_files: HashSet<String> = HashSet::new();
    if let Some(repo) = git::primary_repo(&root) {
        let nesting = git::nesting::repo_nesting(&root, &repo);
        for c in &commits {
            for f in &c.files {
                if let Some(p) = git::nesting::rebase(&nesting, f) {
                    commit_files.insert(p);
                }
            }
        }
    }

    // 커밋의 시각 범위 → 워크데이 범위 (프로젝트 리졸버를 지난다).
    let mut entries: Vec<RollupSourceEntry> = Vec::new();
    if let (Some(min), Some(max)) = (
        commits.iter().map(|c| c.timestamp).min(),
        commits.iter().map(|c| c.timestamp).max(),
    ) {
        let workday = |ts: i32| {
            let manager = &manager;
            async move {
                let utc = chrono::DateTime::from_timestamp(ts as i64, 0)?;
                manager.workday_at(project_id, utc).await.ok()
            }
        };
        if let (Some(since), Some(until)) = (workday(min).await, workday(max).await) {
            entries = JournalCache::new(&db)
                .rollup_source_entries(project_id, &since, &until)
                .await?;
        }
    } else if note.is_none() {
        note = Some("이 범위에 커밋이 없어요 — 기준을 확인해 주세요.".to_string());
    }

    let draft_entries = build_entries(&entries, &commit_files);
    let linked = draft_entries.iter().filter(|e| e.overlap > 0).count() as u32;
    let lang = crate::oculpm::content_lang::current(&db).await;
    let deterministic =
        deterministic_draft(from.as_deref(), &to, commits.len(), &draft_entries, lang);

    let (markdown, used_llm) = if use_llm && !draft_entries.is_empty() {
        match narrate(&db, &root, &deterministic, &draft_entries, lang).await {
            Ok(md) => (md, true),
            Err(e) => {
                note = Some(format!("LLM 사용 불가로 기본 초안을 냈어요 ({e})"));
                (deterministic, false)
            }
        }
    } else {
        (deterministic, false)
    };

    Ok(ReleaseNotesDraft {
        markdown,
        commits: commits.len() as u32,
        entries: draft_entries.len() as u32,
        linked,
        from_ref: from,
        to_ref: to,
        used_llm,
        note,
    })
}

/// 결정적 초안 + 문체 표본을 모델에 넘겨 서사체로 다시 쓰게 한다. 일지가 많으면
/// 잘라내지 않고 `summary::chunking` 의 map-reduce 를 **같은 정책으로** 지난다.
async fn narrate(
    db: &Db,
    root: &std::path::Path,
    deterministic: &str,
    entries: &[DraftEntry],
    lang: ContentLang,
) -> Result<String, String> {
    let (provider, model) = chat_target(db)
        .await
        .ok_or_else(|| "no chat model configured".to_string())?;
    let samples = git::read_changelog(root)
        .ok()
        .flatten()
        .map(|f| style_samples(&f.content, STYLE_SAMPLES))
        .unwrap_or_default();

    let header = format!(
        "[기계가 만든 초안 — 이 사실만 쓸 것]\n{}\n\n[일지 {}건]",
        deterministic.trim(),
        entries.len()
    );
    let blocks: Vec<String> = entries
        .iter()
        .map(|e| {
            format!(
                "- ({}, {}) {} / {}",
                e.entry_type,
                if e.overlap > 0 {
                    "커밋 연결됨"
                } else {
                    "커밋 연결 없음"
                },
                e.title,
                e.lead
            )
        })
        .collect();
    let tail = if samples.is_empty() {
        String::new()
    } else {
        format!("\n[문체 표본 — 지난 릴리스 본문]\n{samples}\n")
    };

    crate::commands::summary::chunking::map_reduce_blocks(
        &provider,
        &model,
        SYSTEM_PROMPT,
        &header,
        &blocks,
        &tail,
        lang,
    )
    .await
}

// ─────────────────────────────────────────────────────────────────────────────
// tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn src(ty: &str, workday: &str, title: &str, body: &str, files: &[&str]) -> RollupSourceEntry {
        RollupSourceEntry {
            relative_path: format!("{workday}/X/{title}.md"),
            workday: workday.to_string(),
            entry_type: ty.to_string(),
            status: "done".to_string(),
            agent_id: "claude-code".to_string(),
            title: title.to_string(),
            body_markdown: body.to_string(),
            body_md_hash: "h".to_string(),
            files: files.iter().map(|s| s.to_string()).collect(),
        }
    }

    /// 타입이 묶음을 정하고, 초안은 그 순서로 선다.
    #[test]
    fn types_fall_into_three_buckets_in_order() {
        assert_eq!(bucket_of("bug"), Bucket::Fixed);
        assert_eq!(bucket_of("error"), Bucket::Fixed);
        assert_eq!(bucket_of("feature"), Bucket::New);
        assert_eq!(bucket_of("refactor"), Bucket::Inside);
        assert_eq!(bucket_of("chore"), Bucket::Inside);

        let entries = build_entries(
            &[
                src("chore", "20260921", "잡일", "[x] 잡일\n\n정리했어요.", &[]),
                src(
                    "feature",
                    "20260921",
                    "새 기능",
                    "[x] 새 기능\n\n## 추가 기능\n\n버튼이 생겼어요.",
                    &[],
                ),
                src(
                    "bug",
                    "20260921",
                    "버그",
                    "[x] 버그\n\n## 발생 원인\n\n널이었어요.",
                    &[],
                ),
            ],
            &HashSet::new(),
        );
        let md = deterministic_draft(Some("v3.3.0"), "HEAD", 3, &entries, ContentLang::Unset);
        let fixed = md.find("### 고친 것").unwrap();
        let new = md.find("### 새로 생긴 것").unwrap();
        let inside = md.find("### 안에서 바뀐 것").unwrap();
        assert!(fixed < new && new < inside, "{md}");
        // 각 묶음은 타입의 선행 섹션 첫 문단을 인용한다.
        assert!(md.contains("널이었어요."), "{md}");
        assert!(md.contains("버튼이 생겼어요."), "{md}");
        // chore 는 선행 섹션이 없다 — 체크박스 줄을 건너뛴 첫 문단.
        assert!(md.contains("정리했어요."), "{md}");
    }

    /// 커밋이 만진 파일과 겹치는 일지가 먼저 서고, 겹치지 않는 일지는 남되
    /// 「커밋 연결 없음」이 붙는다.
    #[test]
    fn commit_overlap_weighs_entries_and_marks_the_unlinked() {
        let touched: HashSet<String> = ["src/a.ts".to_string(), "src/b.ts".to_string()]
            .into_iter()
            .collect();
        let entries = build_entries(
            &[
                src(
                    "bug",
                    "20260920",
                    "스침",
                    "[x] 스침\n\n## 발생 원인\n\n하나.",
                    &["src/a.ts"],
                ),
                src(
                    "bug",
                    "20260920",
                    "무관",
                    "[x] 무관\n\n## 발생 원인\n\n둘.",
                    &["docs/x.md"],
                ),
                src(
                    "bug",
                    "20260920",
                    "겹침",
                    "[x] 겹침\n\n## 발생 원인\n\n셋.",
                    &["src/a.ts", "src/b.ts"],
                ),
            ],
            &touched,
        );
        let titles: Vec<&str> = entries.iter().map(|e| e.title.as_str()).collect();
        assert_eq!(titles, vec!["겹침", "스침", "무관"], "겹침 큰 순");
        assert_eq!(entries[2].overlap, 0);

        let md = deterministic_draft(Some("v3.3.0"), "HEAD", 2, &entries, ContentLang::Unset);
        let unlinked_at = md.find("**무관**").unwrap();
        let end = md[unlinked_at..].find('\n').unwrap() + unlinked_at;
        assert!(md[unlinked_at..end].contains("커밋 연결 없음"), "{md}");
        assert!(!md[..unlinked_at].contains("커밋 연결 없음"), "{md}");
    }

    /// 버전을 짓지 않는다 — `## v?` 자리표시와 근거 한 줄, 그리고 통계 줄.
    #[test]
    fn the_draft_never_invents_a_version_and_states_its_counts() {
        let entries = build_entries(
            &[src(
                "bug",
                "20260921",
                "T",
                "[x] T\n\n## 발생 원인\n\n왜.",
                &["src/a.ts"],
            )],
            &["src/a.ts".to_string()].into_iter().collect(),
        );
        let md = deterministic_draft(Some("v3.3.0"), "HEAD", 7, &entries, ContentLang::Unset);
        assert!(md.starts_with("## v?\n"), "{md}");
        assert!(md.contains("bump-version.mjs"), "{md}");
        assert!(
            !md.contains("## v3.3.1") && !md.contains("## v3.4.0"),
            "버전을 지어냈다:\n{md}"
        );
        assert!(
            md.contains("범위 `v3.3.0..HEAD` · 커밋 7개 · 일지 1건 · 커밋과 이어진 일지 1건"),
            "{md}"
        );

        // 태그가 없으면 그 사실을 통계 줄이 말한다.
        let none = stats_line(None, "HEAD", 3, &entries, ContentLang::Unset);
        assert!(none.contains("태그 없음"), "{none}");
    }

    /// 인용은 잘리되 한글이 깨지지 않는다.
    #[test]
    fn a_long_lead_is_cut_on_a_character_boundary() {
        let long = "가".repeat(QUOTE_CHARS + 50);
        let lead = lead_paragraph("bug", &format!("[x] T\n\n## 발생 원인\n\n{long}"));
        assert_eq!(lead.chars().count(), QUOTE_CHARS + 1, "… 한 글자 포함");
        assert!(lead.ends_with('…'));
    }

    /// 플래그로 읽힐 문자열은 ref 가 아니다.
    #[test]
    fn a_ref_that_could_be_a_flag_is_refused() {
        assert_eq!(sane_ref(" v3.3.0 ").as_deref(), Some("v3.3.0"));
        assert_eq!(sane_ref("origin/main").as_deref(), Some("origin/main"));
        assert_eq!(sane_ref("HEAD~3").as_deref(), Some("HEAD~3"));
        assert!(sane_ref("--output=/tmp/x").is_none());
        assert!(sane_ref("").is_none());
        assert!(sane_ref("v1 && rm -rf /").is_none());
    }

    /// 문체 표본은 최신 두 섹션만 — 요약하지 않고 그대로.
    #[test]
    fn style_samples_take_the_two_newest_sections() {
        let cl = "# Changelog\n\n안내문.\n\n## v3.3.0\n\n첫째.\n\n## v3.2.2\n\n둘째.\n\n## v3.2.1\n\n셋째.\n";
        let s = style_samples(cl, 2);
        assert!(s.starts_with("## v3.3.0"), "{s}");
        assert!(s.contains("둘째."), "{s}");
        assert!(!s.contains("셋째."), "{s}");
        assert!(!s.contains("안내문"), "{s}");
        assert_eq!(style_samples("헤더 없는 파일", 2), "");
    }
}
