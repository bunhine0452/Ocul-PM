//! 주간 롤업 커맨드 셋 (journal-scale-round `{#rollup-weekly}`).
//!
//! 층 나눔은 `commands/related.rs` 와 같다 — 주 산술·본문 생성·디스크 계약은
//! 순수 모듈(`oculpm::rollup`)이, 원재료 질의는 캐시(`cache/rollup.rs`)가,
//! 모델 호출은 **이미 있는 자리**(`commands::summary::call_llm`)가 한다.
//! 여기는 셋을 잇고 「오래됨」을 판정한다.
//!
//! # 새 아웃바운드 자리를 만들지 않는다
//!
//! LLM 판은 `summary::call_llm` 을 그대로 지난다. 유출 경계 원장
//! (`tests/egress_inventory.rs`)은 `llm::create` 를 **부르는 파일**을 세므로,
//! 여기서 직접 클라이언트를 만들면 원장에 새 줄이 필요해진다. 같은 프롬프트
//! 조립 규약(리댁션은 마스킹된 캐시 투영이 진다)을 쓰면서 자리만 늘릴 이유가
//! 없다 — `commands/summary.rs` 의 `Redaction::ViaProjection` 사유가 이 경로에
//! 그대로 적용된다 (`rollup_source_entries` 도 같은 캐시를 읽는다).

use chrono::Local;
use tauri::State;

use crate::app_error::AppError;
use crate::db::Db;
use crate::oculpm::cache::{JournalCache, RollupSourceEntry};
use crate::oculpm::manager::OculpmManager;
use crate::oculpm::rollup::{
    self, generate, week, RollupDoc, RollupFrontmatter, RollupRange, RollupSummary, ROLLUP_SCHEMA,
};

/// LLM 판의 시스템 프롬프트. 결정적 본문과 **같은 다섯 섹션**을 요구한다 —
/// 파일 모양이 생성기에 따라 달라지면 `journal_read` 로 이 파일을 읽는
/// 에이전트가 두 규격을 알아야 한다.
// i18n-ignore-next-line -- LLM 프롬프트 본문 (03-i18n.md §4.5)
const ROLLUP_SYSTEM_PROMPT: &str = r#"너는 한 주의 작업 일지를 한국어 주간 요약으로 압축하는 테크 리드다.
입력: 그 주의 작업 일지 목록(타입/상태/제목/워크데이/파일)과 본문에서 뽑은 결정 문장.
출력: 마크다운 본문만 (코드펜스·머리말 금지). 아래 다섯 섹션을 **이 순서, 이 제목 그대로**:
## 한 주 요약   — 3~6문장. 무엇이 진행됐고 어디에 힘이 몰렸는지.
## 결정         — 불릿. 무엇을 정했고 무엇을 기각했는지. 없으면 "- (없음)".
## 해결한 결함   — 불릿. 제목과 관련 파일 경로.
## 추가한 기능   — 불릿.
## 이월/미완     — 불릿. done 이 아닌 항목.
규칙: 입력에 있는 사실만. 건수는 입력의 수와 맞을 것. 추측·평가·다짐 금지."#;

/// 모델 입력 상한 — 한 주 일지가 이보다 많으면 제목만으로도 프롬프트가 터진다.
/// 넘치면 결정적 본문으로 물러선다 (`note` 로 밝힌다).
const LLM_WEEK_CAP: usize = 150;

// ─────────────────────────────────────────────────────────────────────────────
// 커맨드
// ─────────────────────────────────────────────────────────────────────────────

/// 한 주의 롤업을 만들어 `.oculpm/rollups/<week>.md` 에 쓴다.
///
/// `week` 가 없으면 **오늘이 속한 ISO 주**. `use_llm` 이 참이어도 provider/model
/// 미설정·호출 실패·과대 입력이면 결정적 본문으로 물러선다 (`used_llm=false`
/// + `note`) — `oculpm_generate_summary` 와 같은 폴백 규약이라 API 키 없이도
/// 항상 파일이 나온다.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_rollup_week(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
    week: Option<String>,
    use_llm: bool,
    provider: Option<String>,
    model: Option<String>,
) -> Result<RollupDoc, AppError> {
    let week = match week {
        Some(w) => w,
        None => week::week_key(Local::now().date_naive()),
    };
    let (from, to) = week::week_bounds(&week)
        .ok_or_else(|| AppError::new("rollup_bad_week", format!("not an ISO week: {week}")))?;

    let root = manager.project_root(project_id).await?;
    let entries = JournalCache::new(&db)
        .rollup_source_entries(project_id, &from, &to)
        .await?;

    let hash = rollup::entries_hash(&entries);
    let deterministic = generate::deterministic_body(&week, &from, &to, &entries);

    let content_lang = crate::oculpm::content_lang::current(&db).await;
    let (body, generator, used_llm, note) = match llm_target(use_llm, provider, model) {
        Some((provider, model)) if entries.len() <= LLM_WEEK_CAP => {
            let input = fmt_llm_input(&week, &from, &to, &entries, &deterministic);
            match crate::commands::summary::call_llm(
                &provider,
                &model,
                ROLLUP_SYSTEM_PROMPT,
                input,
                content_lang,
            )
            .await
            {
                Ok(md) => (md, format!("llm:{model}"), true, None),
                Err(e) => (
                    deterministic,
                    "deterministic".to_string(),
                    false,
                    Some(format!("LLM 사용 불가로 기본 형식으로 만들었어요 ({e})")),
                ),
            }
        }
        Some(_) => (
            deterministic,
            "deterministic".to_string(),
            false,
            Some(format!(
                "이 주의 일지가 {}건이라 모델 입력 상한({LLM_WEEK_CAP}건)을 넘어 기본 형식으로 만들었어요.",
                entries.len()
            )),
        ),
        None => (deterministic, "deterministic".to_string(), false, None),
    };

    let fm = RollupFrontmatter {
        oculpm_rollup: ROLLUP_SCHEMA.to_string(),
        week: week.clone(),
        range: RollupRange {
            from: from.clone(),
            to: to.clone(),
        },
        entry_count: entries.len() as u32,
        entries_hash: hash.clone(),
        generated_at: Local::now().to_rfc3339(),
        generator,
    };
    rollup::write(&root, &fm, &body)?;

    Ok(RollupDoc {
        summary: rollup::summarize(&fm, &body, Some(&hash)),
        body_markdown: body,
        used_llm,
        note,
    })
}

/// 디스크의 롤업 목록 — 최신 주 먼저. `stale` 은 그 주의 **현재** 일지 지문과
/// frontmatter 의 `entries_hash` 를 대조해 매긴다.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_rollup_list(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
) -> Result<Vec<RollupSummary>, AppError> {
    let root = manager.project_root(project_id).await?;
    let files = rollup::read_all(&root);
    let cache = JournalCache::new(&db);
    let mut out = Vec::with_capacity(files.len());
    for (fm, body) in files {
        // 주마다 한 번 — 롤업 수는 주 단위라 이 저장소에서도 수십 개다.
        let current = cache
            .rollup_source_entries(project_id, &fm.range.from, &fm.range.to)
            .await
            .ok()
            .map(|e| rollup::entries_hash(&e));
        out.push(rollup::summarize(&fm, &body, current.as_deref()));
    }
    Ok(out)
}

/// 한 주의 롤업 전문 — 모달이 렌더한다. 없으면 `rollup_missing`.
#[tauri::command]
#[specta::specta]
pub async fn oculpm_rollup_read(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    project_id: u32,
    week: String,
) -> Result<RollupDoc, AppError> {
    let root = manager.project_root(project_id).await?;
    let (fm, body) = rollup::read_one(&root, &week)
        .ok_or_else(|| AppError::new("rollup_missing", format!("no rollup for {week}")))?;
    let current = JournalCache::new(&db)
        .rollup_source_entries(project_id, &fm.range.from, &fm.range.to)
        .await
        .ok()
        .map(|e| rollup::entries_hash(&e));
    let used_llm = fm.generator.starts_with("llm:");
    Ok(RollupDoc {
        summary: rollup::summarize(&fm, &body, current.as_deref()),
        body_markdown: body,
        used_llm,
        note: None,
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// 내부
// ─────────────────────────────────────────────────────────────────────────────

fn llm_target(
    use_llm: bool,
    provider: Option<String>,
    model: Option<String>,
) -> Option<(String, String)> {
    if !use_llm {
        return None;
    }
    Some((provider?, model?))
}

/// 모델 입력. **결정적 본문을 함께 넣는다** — 세어서 나온 사실(건수·상위
/// 파일·결정 인용)을 모델이 다시 세게 하지 않는다. 모델이 할 일은 그 위에
/// 문장을 얹는 것이다.
fn fmt_llm_input(
    week: &str,
    from: &str,
    to: &str,
    entries: &[RollupSourceEntry],
    deterministic: &str,
) -> String {
    let mut out = format!(
        "주: {week} ({from} ~ {to}) · 일지 {}개\n\n[작업 일지]\n",
        entries.len()
    );
    for e in entries {
        out.push_str(&format!(
            "- ({}, {}) {} / {} / 파일 {}개\n",
            e.entry_type,
            e.status,
            e.title,
            e.workday,
            e.files.len()
        ));
    }
    out.push_str("\n[결정적 생성기가 이미 센 사실 — 건수와 인용은 여기에 맞출 것]\n");
    out.push_str(deterministic);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_llm_is_only_targeted_when_everything_is_set() {
        assert!(llm_target(false, Some("a".into()), Some("m".into())).is_none());
        assert!(llm_target(true, None, Some("m".into())).is_none());
        assert!(llm_target(true, Some("a".into()), None).is_none());
        assert_eq!(
            llm_target(true, Some("anthropic".into()), Some("m".into())),
            Some(("anthropic".to_string(), "m".to_string()))
        );
    }

    /// 프롬프트는 결정적 본문을 **재료로** 싣는다 — 모델이 건수를 새로 세지
    /// 않게 하는 것이 이 설계의 전부다.
    #[test]
    fn the_prompt_carries_the_counted_facts() {
        let input = fmt_llm_input(
            "2026-W38",
            "20260914",
            "20260920",
            &[],
            "## 한 주 요약\n\n0건.",
        );
        assert!(input.contains("주: 2026-W38 (20260914 ~ 20260920)"));
        assert!(input.contains("이미 센 사실"));
        assert!(input.contains("## 한 주 요약"));
    }

    /// 다섯 섹션 제목이 프롬프트와 결정적 생성기에서 **같은 글자**여야 한다.
    /// 어긋나면 같은 디렉터리 안에 두 규격의 파일이 섞인다.
    #[test]
    fn both_generators_promise_the_same_five_headings() {
        for heading in [
            generate::SECTION_SUMMARY,
            generate::SECTION_DECISIONS,
            generate::SECTION_FIXED,
            generate::SECTION_FEATURES,
            generate::SECTION_CARRIED,
        ] {
            assert!(
                ROLLUP_SYSTEM_PROMPT.contains(heading),
                "프롬프트가 {heading} 를 요구하지 않는다"
            );
        }
    }
}
