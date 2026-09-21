//! 주간 보고의 **map-reduce** — 잘라내기에서 청킹으로 (`{#weekly-cap}`).
//!
//! `commands/summary.rs` 에서 갈라 나왔다. 그 파일은 크기 한계(800줄)에
//! 닿았고, 여기 있는 것은 "무엇이 모델에 닿는가"라는 **하나의 계약**이다 —
//! 프롬프트 조립은 전부 순수 함수라 테스트가 직접 물 수 있고, 모델 호출
//! 자체(`llm::create`)는 유출 경계 원장이 세는 자리라 `summary.rs` 에 남는다.
//!
//! # 왜 잘라내기가 문제였나
//!
//! 예전 `fmt_llm_input` 은 `entries.iter().take(60)` 뒤에 "… 외 N개" 한 줄을
//! 붙였다. 주 100건인 저장소에서 40건이 제목조차 모델에 닿지 않았고, 그러면서
//! 응답의 `entry_count` 는 100 이라고 말했다 — **없는 것을 요약했다고 적는**
//! 모양이다. 청킹은 그 거짓을 없앤다: 조각마다 부분 요약을 만들고(map), 그
//! 부분 요약들을 합성한다(reduce). 전 건이 최소 한 번은 모델을 지난다.

use crate::db::OpenPlanItem;
use crate::oculpm::cache::RangeEntry;
use crate::oculpm::content_lang::ContentLang;

use super::{call_llm, system_prompt, SummaryStyle};

/// LLM **한 번의 호출**에 넣는 일지 줄 수 (프롬프트 폭주 방지).
/// 잘라내기가 아니라 **청크 크기**다.
pub(super) const LLM_ENTRY_CAP: usize = 60;
/// 부분 요약을 몇 개까지 만들 것인가 — 합성 호출 하나가 감당할 수 있는 수.
/// 여기를 넘으면 청킹조차 정직하지 않으므로 결정적 경로로 물러선다.
pub(super) const MAX_CHUNKS: usize = 12;

/// 부분 요약을 만드는 1단계 시스템 프롬프트 (`{#weekly-cap}` map 단계).
///
/// 여기서 만든 글은 사용자가 보지 않는다 — **2단계의 입력**이다. 그래서
/// "읽기 좋게" 가 아니라 "합성해도 사실이 안 뭉개지게" 를 요구한다.
// i18n-ignore-next-line -- LLM 프롬프트 본문 (03-i18n.md §4.5)
const CHUNK_SYSTEM_PROMPT: &str = r#"너는 작업 일지 묶음을 다음 단계가 합성할 수 있게 압축하는 조수다.
입력: 한 기간의 작업 일지 일부(전체의 한 조각).
출력: 마크다운 불릿만 (헤더·코드펜스·머리말 금지). 5~10불릿.
규칙: 입력에 있는 사실만. 비슷한 일지는 묶되 **건수를 괄호로 남길 것**.
      기능/버그/리팩토링/에러의 구분과 미완 여부를 잃지 말 것."#;

/// 일지 목록 블록 — 단일 호출이든 청크든 같은 모양이라 두 경로가 갈리지 않는다.
fn fmt_entry_lines(entries: &[RangeEntry]) -> String {
    let mut out = String::new();
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
    out
}

fn fmt_open_items_block(open_items: &[OpenPlanItem]) -> String {
    let mut out = String::from("\n[활성 플랜 미완 항목]\n");
    if open_items.is_empty() {
        out.push_str("(없음)\n");
    } else {
        for i in open_items {
            out.push_str(&format!(
                "- [{}] {} ({})\n",
                i.plan_title, i.item_title, i.status
            ));
        }
    }
    out
}

/// 단일 호출 입력 — `entries` 가 [`LLM_ENTRY_CAP`] 안일 때.
fn fmt_llm_input(
    since: &str,
    until: &str,
    entries: &[RangeEntry],
    open_items: &[OpenPlanItem],
) -> String {
    let mut out = format!(
        "기간: {since} ~ {until} (일지 {}개)\n\n[작업 일지]\n",
        entries.len()
    );
    out.push_str(&fmt_entry_lines(entries));
    out.push_str(&fmt_open_items_block(open_items));
    out
}

/// map 단계 입력 — 조각이 전체의 어디인지 밝힌다.
fn fmt_chunk_input(
    since: &str,
    until: &str,
    index: usize,
    total: usize,
    entries: &[RangeEntry],
) -> String {
    format!(
        "기간: {since} ~ {until}\n조각 {index}/{total} (이 조각의 일지 {}개)\n\n[작업 일지]\n{}",
        entries.len(),
        fmt_entry_lines(entries)
    )
}

/// reduce 단계 입력 — 원본 대신 부분 요약을 넣는다. **건수는 전체 건수**다.
fn fmt_reduce_input(
    since: &str,
    until: &str,
    total_entries: usize,
    partials: &[String],
    open_items: &[OpenPlanItem],
) -> String {
    let mut out = format!(
        "기간: {since} ~ {until} (일지 {total_entries}개 — 아래 부분 요약 {}개가 그 전부를 덮는다)\n",
        partials.len()
    );
    for (i, part) in partials.iter().enumerate() {
        out.push_str(&format!(
            "\n[부분 요약 {}/{}]\n{}\n",
            i + 1,
            partials.len(),
            part.trim()
        ));
    }
    out.push_str(&fmt_open_items_block(open_items));
    out
}

/// 스타일에 맞는 마크다운 한 판. 일지가 [`LLM_ENTRY_CAP`] 을 넘으면 잘라내지
/// 않고 **나눠 부르고 합성한다** (`{#weekly-cap}`).
///
/// 순차 호출인 이유는 속도가 아니라 한도다 — 청크 12개를 동시에 던지면
/// 제공자의 rate limit 에 걸려 전부 실패하고, 그 실패는 폴백으로 내려가
/// "LLM 을 켰는데 왜 기본 형식이지"가 된다.
pub(super) async fn generate_with_llm(
    provider: &str,
    model: &str,
    style: SummaryStyle,
    since: &str,
    until: &str,
    entries: &[RangeEntry],
    open_items: &[OpenPlanItem],
    content_lang: ContentLang,
) -> Result<String, String> {
    if entries.len() <= LLM_ENTRY_CAP {
        let input = fmt_llm_input(since, until, entries, open_items);
        return call_llm(provider, model, system_prompt(style), input, content_lang).await;
    }

    let chunks: Vec<&[RangeEntry]> = entries.chunks(LLM_ENTRY_CAP).collect();
    if chunks.len() > MAX_CHUNKS {
        return Err(format!(
            "entries={} would need {} chunks (cap {MAX_CHUNKS})",
            entries.len(),
            chunks.len()
        ));
    }
    let mut partials: Vec<String> = Vec::with_capacity(chunks.len());
    for (i, chunk) in chunks.iter().enumerate() {
        let input = fmt_chunk_input(since, until, i + 1, chunks.len(), chunk);
        partials.push(call_llm(provider, model, CHUNK_SYSTEM_PROMPT, input, content_lang).await?);
    }
    let input = fmt_reduce_input(since, until, entries.len(), &partials, open_items);
    call_llm(provider, model, system_prompt(style), input, content_lang).await
}

/// 같은 map-reduce 를 **다른 재료**에 쓰는 자리 (`{#release-notes-draft}`).
///
/// 위 [`generate_with_llm`] 은 스탠드업/PR/주간의 재료(`RangeEntry` +
/// 플랜 항목)를 안다. 릴리스 노트 초안의 재료는 그게 아니라 일지 발췌 블록과
/// 문체 표본이다 — 그래서 **정책만** 나눠 쓴다: 조각 크기([`LLM_ENTRY_CAP`]),
/// 조각 수 상한([`MAX_CHUNKS`]), 1단계 압축 프롬프트, 순차 호출.
///
/// * `blocks` — 항목 하나당 한 덩어리. 조각내는 단위가 이것이다.
/// * `header` — 두 단계 모두의 머리글(범위·전체 건수).
/// * `tail` — **합성 단계에만** 붙는 꼬리(문체 표본 등). 1단계는 압축만 하므로
///   표본을 넣을 이유가 없고, 넣으면 조각 수만큼 토큰을 되쓴다.
pub(crate) async fn map_reduce_blocks(
    provider: &str,
    model: &str,
    final_system: &str,
    header: &str,
    blocks: &[String],
    tail: &str,
    content_lang: ContentLang,
) -> Result<String, String> {
    if blocks.len() <= LLM_ENTRY_CAP {
        let input = format!("{header}\n{}\n{tail}", blocks.join("\n"));
        return call_llm(provider, model, final_system, input, content_lang).await;
    }
    let chunks: Vec<&[String]> = blocks.chunks(LLM_ENTRY_CAP).collect();
    if chunks.len() > MAX_CHUNKS {
        return Err(format!(
            "blocks={} would need {} chunks (cap {MAX_CHUNKS})",
            blocks.len(),
            chunks.len()
        ));
    }
    let mut partials: Vec<String> = Vec::with_capacity(chunks.len());
    for (i, chunk) in chunks.iter().enumerate() {
        let input = format!(
            "{header}\n조각 {}/{} (이 조각 {}개)\n\n{}",
            i + 1,
            chunks.len(),
            chunk.len(),
            chunk.join("\n")
        );
        partials.push(call_llm(provider, model, CHUNK_SYSTEM_PROMPT, input, content_lang).await?);
    }
    let mut input = format!(
        "{header}\n(아래 부분 요약 {}개가 그 전부를 덮는다)\n",
        partials.len()
    );
    for (i, part) in partials.iter().enumerate() {
        input.push_str(&format!(
            "\n[부분 요약 {}/{}]\n{}\n",
            i + 1,
            partials.len(),
            part.trim()
        ));
    }
    input.push_str(tail);
    call_llm(provider, model, final_system, input, content_lang).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::summary::tests::{entry, item};

    // 프롬프트 조립은 순수 함수라 여기서 문을 수 있다. 실제 모델 호출은
    // 못 물지만, **무엇이 모델에 닿는가**는 이 함수들이 정한다.

    fn many(n: usize) -> Vec<RangeEntry> {
        (0..n)
            .map(|i| {
                entry(
                    "feature",
                    "done",
                    "20260915",
                    &format!("작업{i}"),
                    &["a.rs"],
                )
            })
            .collect()
    }

    /// 한 조각도 잃지 않는다 — 청크를 이어 붙이면 전 건이 나온다.
    #[test]
    fn chunking_covers_every_entry_without_a_tail_note() {
        let entries = many(145);
        let chunks: Vec<&[RangeEntry]> = entries.chunks(LLM_ENTRY_CAP).collect();
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks.iter().map(|c| c.len()).sum::<usize>(), 145);

        let joined: String = chunks
            .iter()
            .enumerate()
            .map(|(i, c)| fmt_chunk_input("20260914", "20260920", i + 1, 3, c))
            .collect();
        for i in [0usize, 59, 60, 120, 144] {
            assert!(joined.contains(&format!("작업{i} ")), "작업{i} 가 빠졌다");
        }
        // 옛 절단의 흔적이 어디에도 남지 않는다.
        assert!(!joined.contains("외 "), "{joined:.400}");
    }

    /// 단일 호출 경로도 절단 문구를 만들지 않는다 (상한 안이므로 애초에 전부다).
    #[test]
    fn a_small_range_still_goes_in_one_call() {
        let entries = many(5);
        let input = fmt_llm_input("20260914", "20260920", &entries, &[]);
        assert!(input.contains("일지 5개"));
        assert!(input.contains("작업4"));
        assert!(!input.contains("외 "));
    }

    /// 2단계 입력은 **전체 건수**를 말한다 — 여기서 부분 요약 개수를 말하면
    /// 모델이 "3건을 요약하라"고 읽는다.
    #[test]
    fn the_reduce_step_states_the_total_not_the_chunk_count() {
        let input = fmt_reduce_input(
            "20260914",
            "20260920",
            145,
            &["- 기능 20건".to_string(), "- 버그 5건".to_string()],
            &[item("v3", "남은 일", "todo")],
        );
        assert!(input.contains("일지 145개"), "{input}");
        assert!(
            input.contains("부분 요약 2개가 그 전부를 덮는다"),
            "{input}"
        );
        assert!(input.contains("[부분 요약 1/2]") && input.contains("[부분 요약 2/2]"));
        assert!(input.contains("남은 일"), "미완 항목은 2단계에 붙는다");
    }

    /// 청크가 상한을 넘으면 **조용히 자르지 않고** 오류로 물러선다 — 호출자는
    /// 결정적 폴백(전 건 포함)을 내보낸다.
    #[test]
    fn an_absurd_range_refuses_instead_of_truncating() {
        let needed = MAX_CHUNKS * LLM_ENTRY_CAP + 1;
        assert!(many(needed).chunks(LLM_ENTRY_CAP).count() > MAX_CHUNKS);
    }
}
