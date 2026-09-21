//! 일지 검색의 **공용 심장** — 랭킹(순수 함수)과 후보 행의 모양.
//!
//! 두 호출자가 이 한 벌을 나눠 쓴다:
//!
//! * `oculpm::mcp::tools::search` — MCP 도구 `journal_search`. 캐시가 열리면
//!   SQLite 에서, 아니면 디스크를 걸어 후보를 모은다.
//! * `commands::journal_search` — 프런트용 Tauri 커맨드. 항상 캐시에서.
//!
//! **랭킹은 한 군데뿐이다.** 캐시 경로와 디스크 폴백이 서로 다른 순서를 내면
//! "앱이 켜져 있냐"에 따라 같은 질의가 다른 답을 주고, 그건 검색이 아니라
//! 운이다. 그래서 두 경로는 후보를 모으는 방법만 다르고, 점수·정렬·`why` 는
//! 전부 [`rank`] 가 정한다.
//!
//! # 점수 모양 ({#search-rank})
//!
//! 옛 랭킹은 "매치 강도(u8) → 경로 역순"이었다. 그 모양에는 관련도라는 개념이
//! 없어서, 토큰이 둘 이상인 질의에서 한 칸만 걸린 일지와 세 칸 다 걸린 일지가
//! 같은 등급이었고, 상한 20 안에서 최신순으로 잘렸다.
//!
//! 지금은 **토큰별 최고 필드 가중치의 합 + 최신성 소량 가산**이다:
//!
//! * 필드 가중치 — 제목 > 태그 > 슬러그 > 파일/경로 > 본문
//! * 다중 토큰은 토큰마다 최고 필드를 골라 **합산**한다 (모든 토큰이 어딘가
//!   걸려야 후보다 — AND).
//! * 질의 전체(구)가 한 필드에 통째로 걸리면 그 가중치의 절반을 더 얹는다.
//! * 최신성은 [`RECENCY_MAX`] 를 넘지 않는다. **가장 좁은 필드 간격(본문↔경로
//!   30)보다 작아야** 최신성이 필드 등급을 뒤집지 못한다 — 오래된 제목 정확
//!   매치가 최근 본문 우연 매치보다 아래로 내려가면 이 라운드가 고치려던
//!   그 결함이 그대로다.

use std::cmp::Ordering;

pub mod cache;

#[cfg(test)]
mod tests;

/// 히트 한 줄에 붙는 매치 근방 발췌의 최대 **문자** 수 (바이트 아님 — 본문이
/// 한국어라 바이트로 자르면 글자가 쪼개진다).
pub const SNIPPET_CHARS: usize = 140;

/// 필드 가중치. 간격이 [`RECENCY_MAX`] 보다 넓어야 최신성이 등급을 못 뒤집는다.
pub const W_TITLE: f64 = 100.0;
pub const W_TAG: f64 = 70.0;
pub const W_SLUG: f64 = 55.0;
/// 일지 경로 자신 + `files_touched` 의 경로.
pub const W_PATH: f64 = 40.0;
pub const W_BODY: f64 = 10.0;

/// 최신성 가산의 상한. 가장 좁은 필드 간격(40 − 10 = 30)보다 작다.
pub const RECENCY_MAX: f64 = 9.0;

/// 어디서 걸렸는가 — 응답의 `why` 칸이 되는 값.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MatchedIn {
    Title,
    /// 소문자화된 태그 (옛 도구가 `tag:{소문자}` 를 실어 온 그대로).
    Tag(String),
    Slug,
    /// 일지 경로 자신이거나 `files_touched` 의 한 줄.
    Path(String),
    /// 본문 매치 — 값은 **원문** 바이트 오프셋 (발췌를 뜰 자리).
    Body(usize),
    /// query 없이 필터만으로 걸린 것.
    FilterOnly,
}

impl MatchedIn {
    fn weight(&self) -> f64 {
        match self {
            MatchedIn::Title => W_TITLE,
            MatchedIn::Tag(_) => W_TAG,
            MatchedIn::Slug => W_SLUG,
            MatchedIn::Path(_) => W_PATH,
            MatchedIn::Body(_) => W_BODY,
            MatchedIn::FilterOnly => 0.0,
        }
    }
}

/// 랭킹에 들어가는 일지 한 건. 캐시 행이든 디스크 파일이든 여기로 접힌다.
#[derive(Debug, Clone)]
pub struct SearchRow {
    /// `.oculpm/journal/` 기준 상대경로 (`20260821/Bugs/1842_bug_x.md`).
    pub relative_path: String,
    pub workday: String,
    /// `bug|feature|error|refactor|chore`, 판정 불가면 `?`.
    pub type_token: String,
    /// `planned|in_progress|done|abandoned`, 판정 불가면 `?`.
    pub status_token: String,
    pub title: String,
    pub slug: String,
    pub tags: Vec<String>,
    /// frontmatter `files_touched[].path`.
    pub files: Vec<String>,
    /// 본문 마크다운 (frontmatter 제외).
    pub body: String,
    /// `file` 필터가 걸렸다면 **어느 경로로** 걸렸는지 — query 매치가 없을 때
    /// `why` 가 된다.
    pub file_hit: Option<String>,
}

/// 점수가 매겨진 히트.
#[derive(Debug, Clone)]
pub struct Scored {
    pub row: SearchRow,
    pub score: f64,
    pub matched: MatchedIn,
}

impl Scored {
    /// 응답의 `why` 칸 — 본문 매치는 발췌, 그 밖은 매치한 자리.
    pub fn why(&self) -> String {
        match &self.matched {
            MatchedIn::Title => "title".to_string(),
            MatchedIn::Tag(t) => format!("tag:{t}"),
            MatchedIn::Slug => "slug".to_string(),
            MatchedIn::Path(p) => format!("path:{p}"),
            MatchedIn::Body(at) => snippet_around(&self.row.body, *at),
            MatchedIn::FilterOnly => match &self.row.file_hit {
                Some(p) => format!("file:{p}"),
                None => snippet_around(&self.row.body, 0),
            },
        }
    }

    /// UI 가 늘 한 줄을 보여줄 수 있게 — 본문 매치면 그 근방, 아니면 앞머리.
    pub fn snippet(&self) -> String {
        match &self.matched {
            MatchedIn::Body(at) => snippet_around(&self.row.body, *at),
            _ => snippet_around(&self.row.body, 0),
        }
    }

    /// 기계가 읽는 매치 자리 이름 (`title|tag|slug|path|body|filter`).
    pub fn matched_field(&self) -> &'static str {
        match &self.matched {
            MatchedIn::Title => "title",
            MatchedIn::Tag(_) => "tag",
            MatchedIn::Slug => "slug",
            MatchedIn::Path(_) => "path",
            MatchedIn::Body(_) => "body",
            MatchedIn::FilterOnly => "filter",
        }
    }
}

/// 질의를 토큰으로 자른다. 공백 단위, 소문자.
///
/// 빈 벡터는 "질의 없음" — 필터만으로 거른 목록을 최신순으로 돌려준다.
pub fn tokenize(query: Option<&str>) -> Vec<String> {
    query
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|q| q.split_whitespace().map(str::to_lowercase).collect())
        .unwrap_or_default()
}

/// 후보 행에 점수를 매기고 정렬한다. **순수 함수** — 같은 입력이면 같은 순서다.
///
/// 토큰이 하나도 안 걸린 행은 떨어진다 (AND). 토큰이 없으면 전부 남고 최신순.
pub fn rank(rows: Vec<SearchRow>, tokens: &[String]) -> Vec<Scored> {
    let mut scored: Vec<Scored> = Vec::with_capacity(rows.len());
    for row in rows {
        let low = Lowered::of(&row);
        if let Some((score, matched)) = score_row(&row, &low, tokens) {
            scored.push(Scored {
                row,
                score,
                matched,
            });
        }
    }
    apply_recency(&mut scored);
    scored.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(Ordering::Equal)
            // 같은 점수면 최신, 같은 날이면 늦은 시각 (경로 역순이 곧 시각 역순).
            .then_with(|| b.row.workday.cmp(&a.row.workday))
            .then_with(|| b.row.relative_path.cmp(&a.row.relative_path))
    });
    scored
}

/// 매치한 집합 **안에서의** 상대 최신성을 얹는다.
///
/// "오늘"을 기준으로 삼지 않는 이유는 둘이다. 하루가 지나면 순서가 바뀌는
/// 랭킹은 테스트가 못 물고, 이 도구의 질문("예전에 이거 왜 그랬지")에서
/// 중요한 것은 절대 나이가 아니라 **이 결과들 중 어느 쪽이 최근인가**다.
fn apply_recency(scored: &mut [Scored]) {
    let mut days: Vec<String> = scored.iter().map(|s| s.row.workday.clone()).collect();
    days.sort_unstable();
    days.dedup();
    if days.len() < 2 {
        return;
    }
    let last = (days.len() - 1) as f64;
    for s in scored.iter_mut() {
        if let Ok(idx) = days.binary_search(&s.row.workday) {
            s.score += RECENCY_MAX * (idx as f64) / last;
        }
    }
}

/// 한 행의 점수와 **가장 강한** 매치 자리. 토큰이 하나라도 안 걸리면 `None`.
fn score_row(row: &SearchRow, low: &Lowered, tokens: &[String]) -> Option<(f64, MatchedIn)> {
    if tokens.is_empty() {
        return Some((0.0, MatchedIn::FilterOnly));
    }
    let mut total = 0.0;
    let mut best: Option<MatchedIn> = None;
    for token in tokens {
        let matched = best_field(row, low, token)?;
        total += matched.weight();
        best = Some(stronger(best, matched));
    }
    // 구(句) 보너스 — 토큰이 흩어져 걸린 것보다 통째로 걸린 쪽이 관련도가 높다.
    if tokens.len() > 1 {
        let phrase = tokens.join(" ");
        if let Some(matched) = best_field(row, low, &phrase) {
            total += matched.weight() / 2.0;
            best = Some(stronger(best, matched));
        }
    }
    Some((total, best.unwrap_or(MatchedIn::FilterOnly)))
}

fn stronger(current: Option<MatchedIn>, candidate: MatchedIn) -> MatchedIn {
    match current {
        Some(c) if c.weight() >= candidate.weight() => c,
        _ => candidate,
    }
}

/// 이 토큰이 걸리는 **가장 강한** 필드. 순서가 곧 가중치 순서다.
fn best_field(row: &SearchRow, low: &Lowered, token: &str) -> Option<MatchedIn> {
    if low.title.contains(token) {
        return Some(MatchedIn::Title);
    }
    if let Some(tag) = low.tags.iter().find(|t| t.contains(token)) {
        return Some(MatchedIn::Tag(tag.clone()));
    }
    if low.slug.contains(token) {
        return Some(MatchedIn::Slug);
    }
    if low.path.contains(token) {
        return Some(MatchedIn::Path(row.relative_path.clone()));
    }
    if let Some(i) = low.files.iter().position(|f| f.contains(token)) {
        return Some(MatchedIn::Path(row.files[i].clone()));
    }
    // 소문자 변환이 바이트 길이를 바꿀 수 있어(터키어 I 등) 위치를 원문에
    // 그대로 쓰면 경계가 어긋난다. 길이가 같을 때만 원문 오프셋으로 쓴다.
    match low.body.find(token) {
        Some(at) if low.body.len() == row.body.len() => Some(MatchedIn::Body(at)),
        Some(_) => Some(MatchedIn::Body(0)),
        None => None,
    }
}

/// 한 행의 소문자 사본 — 토큰마다 다시 만들지 않으려고 한 번만 뜬다.
struct Lowered {
    title: String,
    slug: String,
    path: String,
    tags: Vec<String>,
    files: Vec<String>,
    body: String,
}

impl Lowered {
    fn of(row: &SearchRow) -> Self {
        Self {
            title: row.title.to_lowercase(),
            slug: row.slug.to_lowercase(),
            path: row.relative_path.to_lowercase(),
            tags: row.tags.iter().map(|t| t.to_lowercase()).collect(),
            files: row
                .files
                .iter()
                .map(|f| f.replace('\\', "/").to_lowercase())
                .collect(),
            body: row.body.to_lowercase(),
        }
    }
}

/// 매치 지점 근방을 한 줄 발췌로 접는다. 줄바꿈·연속 공백을 한 칸으로 눌러
/// TSV 한 칸에 안전하게 들어가게 하고, 문자 단위로 자른다.
pub fn snippet_around(body: &str, match_at: usize) -> String {
    // 매치 앞 40자쯤부터 보여준다 — 문맥 없이 잘린 발췌는 읽을 수 없다.
    let lead = 40;
    let at = match_at.min(body.len());
    // 매치 오프셋이 문자 경계가 아닐 수 있다 (소문자화 길이가 같아도 안전하게).
    let at = (0..=at)
        .rev()
        .find(|i| body.is_char_boundary(*i))
        .unwrap_or(0);
    let start = body[..at]
        .char_indices()
        .rev()
        .nth(lead)
        .map(|(i, _)| i)
        .unwrap_or(0);
    let raw: String = body[start..]
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let mut out: String = raw.chars().take(SNIPPET_CHARS).collect();
    if raw.chars().count() > SNIPPET_CHARS {
        out.push('…');
    }
    if start > 0 {
        out.insert(0, '…');
    }
    out
}
