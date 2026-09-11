//! `/usage` 와 `usage_update` — 컨텍스트 사용량과 요금제 한도.
//!
//! 한도는 **두 출처**로 온다. `usage_update._meta._claude/rateLimit` 은 턴이
//! 돌 때마다 한 종류씩 오고, `/usage` 는 세 줄을 한 번에 주지만 답이 사람이
//! 읽는 글이라 파싱해야 한다. 두 어휘를 하나로 모으는 것도 여기 몫이다 —
//! 어긋나면 계기에 같은 한도가 두 줄로 선다.
//!
//! `session` 에서 갈라져 나왔다(파일이 한계를 넘었다). 부르는 자리가 계속
//! `session::` 을 쓸 수 있도록 그쪽에서 다시 내보낸다.

use agent_client_protocol::schema::v1::SessionUpdate;
use serde::{Deserialize, Serialize};

use super::auth_status::AcpAuthStatus;

/// 한도 하나 (5시간 세션 · 주간 · 주간 Fable …).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct AcpRateLimit {
    /// 종류 문자열 (`seven_day` 등). 어댑터가 `_meta` 로 준 기계 이름이 기준이고,
    /// `/usage` 의 사람 말 라벨은 **아는 것만** 그 이름으로 접는다
    /// (`markdown_limit_kind`). 모르는 이름은 지어내지 않고 원문 그대로 둔다.
    pub kind: String,
    /// 0.0~1.0.
    pub utilization: f64,
    /// epoch 초. 표시용 문자열로 바꾸는 건 프런트 몫.
    pub resets_at: Option<f64>,
    /// `/usage` 가 준 사람이 읽는 초기화 시각 ("Aug 16 at 4:59am (Asia/Seoul)").
    /// epoch 보다 **덜 정확하지만 더 정직하다** — 우리가 시간대를 다시 계산하다
    /// 틀리느니 CLI 가 쓴 문장을 그대로 보여 준다.
    pub resets_text: Option<String>,
    /// `allowed` · `allowed_warning` … (경고 색을 고르는 열쇠).
    pub status: Option<String>,
}

/// 마지막으로 본 사용량 한 벌.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct AcpUsage {
    pub used: u32,
    pub size: u32,
    pub cost_usd: Option<f64>,
    pub limits: Vec<AcpRateLimit>,
    /// `/usage` 가 한도 뒤에 덧붙이는 "무엇이 사용량에 기여했나" 대목 — **원문 그대로**.
    ///
    /// 구조를 뜯지 않는 이유: 컨텍스트 길이 경고·스킬·플러그인·MCP 서버처럼
    /// 항목이 계속 늘고 문구도 CLI 판올림마다 바뀐다. 표로 파싱해 두면 다음 판에
    /// 조용히 빈칸이 되는데, 원문을 그대로 보이면 무엇이 늘어도 그대로 보인다.
    pub detail: Option<String>,
    /// 어댑터가 **어떤 신원으로** 도는가 (`_auth/status_update`). 한도는 계정의
    /// 것이라 같은 벌에 산다. `None` 은 "어댑터가 보고하지 않았다" — 로그아웃은
    /// `Some(kind: "none")` 으로 따로 온다 (`auth_status.rs`).
    pub identity: Option<AcpAuthStatus>,
}

impl AcpUsage {
    /// 아무것도 못 본 상태 — 첫 조각이 오기 전의 바탕.
    pub fn empty() -> Self {
        Self {
            used: 0,
            size: 0,
            cost_usd: None,
            limits: Vec::new(),
            detail: None,
            identity: None,
        }
    }

    /// `usage_update` 한 조각을 접는다. 한도는 한 번에 한 종류씩 오므로 종류별로
    /// **누적**한다 — 덮어쓰면 마지막 한 줄만 남는다. 알림에는 기여도 대목과
    /// 신원이 없으니 갖고 있던 것을 유지한다.
    pub fn fold_update(previous: Option<Self>, fresh: Self) -> Self {
        let base = previous.unwrap_or_else(Self::empty);
        let mut limits = base.limits;
        for limit in fresh.limits {
            match limits.iter_mut().find(|l| l.kind == limit.kind) {
                Some(existing) => *existing = limit,
                None => limits.push(limit),
            }
        }
        Self {
            limits,
            detail: base.detail,
            identity: base.identity,
            ..fresh
        }
    }

    /// `/usage` 의 답으로 한도를 **교체**한다 — 세 줄을 한 번에 주는 완전한
    /// 스냅샷이라, 옛 `_meta` 조각과 섞으면 같은 한도가 두 이름으로 두 줄 보인다
    /// (`seven_day` 와 `week (all models)`).
    ///
    /// 둘 다 못 읽었으면 `None` — 파싱이 실패한 응답으로 멀쩡한 값을 지우면
    /// 카드가 비어 버린다. 한쪽만 못 읽은 경우도 그쪽은 지난 것을 남긴다:
    /// 기여도 대목은 `/usage` 만 주고, 한도가 빈 목록으로 갈리면 계기가 통째로
    /// 사라진다(계기는 한도가 없으면 안 그린다).
    pub fn fold_report(
        previous: Option<Self>,
        limits: Vec<AcpRateLimit>,
        detail: Option<String>,
    ) -> Option<Self> {
        if limits.is_empty() && detail.is_none() {
            return None;
        }
        let base = previous.unwrap_or_else(Self::empty);
        Some(Self {
            limits: if limits.is_empty() {
                base.limits
            } else {
                limits
            },
            detail: detail.or(base.detail),
            ..base
        })
    }

    /// 신원 갱신 — 나머지는 그대로.
    pub fn with_identity(previous: Option<Self>, identity: AcpAuthStatus) -> Self {
        Self {
            identity: Some(identity),
            ..previous.unwrap_or_else(Self::empty)
        }
    }
}

/// `usage_update` 에서 사용량과 한도를 뽑는다. 그 밖의 종류면 `None`.
///
/// 한도는 `_meta._claude/rateLimit` 에 실려 오는데 **한 번에 하나씩** 온다 —
/// 그래서 호출부가 종류별로 누적해야 세 줄(세션·주간·Fable)이 다 모인다.
pub fn usage_of(update: &SessionUpdate) -> Option<AcpUsage> {
    let SessionUpdate::UsageUpdate(usage) = update else {
        return None;
    };

    let limits = usage
        .meta
        .as_ref()
        .and_then(|meta| serde_json::to_value(meta).ok())
        .map(|meta| collect_limits(&meta))
        .unwrap_or_default();

    Some(AcpUsage {
        used: saturate(usage.used),
        size: saturate(usage.size),
        cost_usd: usage
            .cost
            .as_ref()
            .filter(|c| c.currency == "USD")
            .map(|c| c.amount),
        limits,
        detail: None,
        identity: None,
    })
}

/// `_meta` 어디에 있든 `utilization` 을 가진 객체를 한도로 본다.
///
/// 키 이름(`_claude/rateLimit`)에 기대지 않는 이유: `_meta` 는 확장 지점이라
/// 벤더가 자리를 옮기거나 늘릴 수 있다. 모양으로 찾으면 그때도 살아남는다.
fn collect_limits(value: &serde_json::Value) -> Vec<AcpRateLimit> {
    let mut found = Vec::new();
    walk_limits(value, &mut found);
    found
}

fn walk_limits(value: &serde_json::Value, out: &mut Vec<AcpRateLimit>) {
    match value {
        serde_json::Value::Object(map) => {
            if let Some(utilization) = map.get("utilization").and_then(serde_json::Value::as_f64) {
                out.push(AcpRateLimit {
                    kind: map
                        .get("rateLimitType")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("unknown")
                        .to_string(),
                    utilization,
                    resets_at: map.get("resetsAt").and_then(serde_json::Value::as_f64),
                    resets_text: None,
                    status: map
                        .get("status")
                        .and_then(serde_json::Value::as_str)
                        .map(str::to_string),
                });
            }
            for nested in map.values() {
                walk_limits(nested, out);
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                walk_limits(item, out);
            }
        }
        _ => {}
    }
}

/// `/usage` 응답 본문에서 한도를 읽는다.
///
/// **왜 텍스트를 파싱하나**: `/usage` 는 CLI 가 로컬에서 답하는 커맨드라
/// 토큰을 쓰지 않는다(실측: inputTokens=outputTokens=0). 반면 `usage_update`
/// 의 `_meta` 한도는 턴이 돌 때 한 종류씩만 온다. 즉 이쪽이 **공짜이면서 더
/// 완전하다** — 세션·주간·Fable 을 한 번에 준다.
///
/// 파싱은 방어적이다. 문구가 바뀌면 못 읽을 뿐 죽지 않고, 못 읽은 줄은
/// 조용히 빠진다(호출부가 기존 값을 유지한다).
///
/// **두 모양을 다 읽는다.** 어댑터 0.75.0 부터 `/usage` 의 답을 어댑터가
/// 가로채 마크다운으로 다시 그리는데, 구조화 조회가 실패하면 CLI 의 원래
/// 평문을 그대로 흘려보낸다. 어느 쪽이 올지는 그때 가 봐야 안다.
///
/// ```text
/// // 0.75.0~ (마크다운)
/// **5-hour limit** — **42%** · Resets Sep 6, 3:00 PM GMT+9
/// **Weekly · all models** — **13%** · Resets Sep 10, 3:00 PM GMT+9
///
/// // ~0.74.0 (CLI 평문, 지금도 폴백으로 온다)
/// Current session: 0% used
/// Current week (all models): 83% used · resets Aug 16 at 4:59am (Asia/Seoul)
/// ```
pub fn parse_usage_report(text: &str) -> Vec<AcpRateLimit> {
    let mut found = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if let Some(limit) = markdown_limit(line).or_else(|| plain_limit(line)) {
            found.push(limit);
        }
    }
    found
}

/// `**5-hour limit** — **42%** · Resets Sep 6, 3:00 PM GMT+9`
fn markdown_limit(line: &str) -> Option<AcpRateLimit> {
    let (label, rest) = line.strip_prefix("**")?.split_once("**")?;
    // 라벨과 퍼센트 사이의 구분선(em dash)은 장식이라 통째로 건너뛴다.
    let rest = rest.trim_matches(|c: char| c.is_whitespace() || c == '—' || c == '-');
    let (percent, after) = rest.strip_prefix("**")?.split_once("%**")?;
    let percent = percent.trim().parse::<f64>().ok()?;

    Some(AcpRateLimit {
        kind: markdown_limit_kind(label),
        utilization: (percent / 100.0).clamp(0.0, 1.0),
        resets_at: None,
        // "· Resets Sep 6, 3:00 PM GMT+9" 에서 뒤쪽만.
        resets_text: after
            .split_once("Resets")
            .map(|(_, when)| when.trim().to_string())
            .filter(|when| !when.is_empty()),
        status: None,
    })
}

/// 마크다운 라벨을 `_meta` 가 쓰는 **기계 이름**으로 되돌린다.
///
/// 이름을 지어내는 게 아니라 **한 어휘로 모으는** 것이다: 같은 한도가
/// `usage_update._meta` 로도 오는데, 거기서는 `five_hour` 로 오고 여기서는
/// "5-hour limit" 으로 온다. 그대로 두면 계기에 같은 한도가 두 줄로 서고
/// (`kind` 가 중복 제거 열쇠다) 툴바에는 영문 문장이 그대로 박힌다.
///
/// 모르는 이름은 건드리지 않는다 — `model_scoped` 는 모델 표시명을 그대로
/// 주므로 우리가 접을 수 있는 것만 접고 나머지는 원문으로 흘려보낸다.
fn markdown_limit_kind(label: &str) -> String {
    let label = label.trim();
    let lower = label.to_lowercase();
    if lower.starts_with("5-hour") {
        return "five_hour".to_string();
    }
    let Some((_, model)) = label.split_once('·') else {
        return label.to_string();
    };
    if !lower.starts_with("weekly") {
        return label.to_string();
    }
    let model = model.trim();
    match model.to_lowercase().as_str() {
        "all models" => "seven_day".to_string(),
        "opus" => "seven_day_opus".to_string(),
        "sonnet" => "seven_day_sonnet".to_string(),
        _ => model.to_string(),
    }
}

/// `Current week (all models): 83% used · resets Aug 16 at 4:59am (Asia/Seoul)`
fn plain_limit(line: &str) -> Option<AcpRateLimit> {
    let (label, tail) = line.strip_prefix("Current ")?.split_once(':')?;
    let (percent, after) = tail.trim().split_once("% used")?;
    let percent = percent.trim().parse::<f64>().ok()?;

    Some(AcpRateLimit {
        kind: label.trim().to_string(),
        utilization: (percent / 100.0).clamp(0.0, 1.0),
        resets_at: None,
        // "· resets Aug 16 at 4:59am (Asia/Seoul)" 에서 뒤쪽만.
        resets_text: after
            .split_once("resets")
            .map(|(_, when)| when.trim().to_string())
            .filter(|when| !when.is_empty()),
        status: None,
    })
}

/// `/usage` 답변에서 "무엇이 기여했나" 대목만 잘라낸다 (없으면 `None`).
///
/// 머리글 줄 자체는 뺀다 — 카드에 이미 제목이 있어 두 번 쓰면 시끄럽다.
///
/// 머리글도 두 벌이다: 마크다운은 "What's using your limits?"(굽은 따옴표),
/// 평문 폴백은 "What's contributing to your limits usage?". 따옴표 모양에
/// 기대지 않으려고 그 앞뒤 조각으로만 찾는다.
pub fn parse_usage_detail(text: &str) -> Option<String> {
    let head = text.lines().position(|line| {
        let line = line.to_lowercase();
        (line.contains("what") && line.contains("using your limits"))
            || line.contains("contributing to your limits usage")
    })?;
    let body = text
        .lines()
        .skip(head + 1)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string();
    (!body.is_empty()).then_some(body)
}

/// 프로토콜의 `u64` 토큰 수를 프런트가 받는 `u32` 로. 넘치면 최대값.
pub(super) fn saturate(value: u64) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn limit(kind: &str, utilization: f64) -> AcpRateLimit {
        AcpRateLimit {
            kind: kind.to_string(),
            utilization,
            resets_at: None,
            resets_text: None,
            status: None,
        }
    }

    fn identity(kind: &str) -> AcpAuthStatus {
        AcpAuthStatus {
            kind: kind.to_string(),
            label: "Claude Max".to_string(),
            detail: None,
            email: Some("me@example.com".to_string()),
            organization: None,
            plan: None,
        }
    }

    /// `usage_update` 는 한도를 한 종류씩 준다 — 누적돼야 세 줄이 모이고, 알림에
    /// 없는 기여도·신원은 지난 것이 남아야 한다 (`process.rs` 에서 옮겨 온 규칙).
    #[test]
    fn fold_update_accumulates_limits_and_keeps_detail_and_identity() {
        let first = AcpUsage {
            limits: vec![limit("five_hour", 0.2)],
            detail: Some("기여도".to_string()),
            identity: Some(identity("account")),
            ..AcpUsage::empty()
        };
        let fresh = AcpUsage {
            used: 10,
            limits: vec![limit("seven_day", 0.5), limit("five_hour", 0.3)],
            ..AcpUsage::empty()
        };
        let folded = AcpUsage::fold_update(Some(first), fresh);
        assert_eq!(folded.used, 10);
        assert_eq!(folded.limits.len(), 2);
        assert_eq!(folded.limits[0].utilization, 0.3, "같은 종류는 제자리 갱신");
        assert_eq!(folded.detail.as_deref(), Some("기여도"));
        assert_eq!(
            folded.identity.as_ref().map(|i| i.kind.as_str()),
            Some("account")
        );
    }

    /// `/usage` 는 완전한 스냅샷이라 한도를 **교체**한다. 다만 못 읽은 쪽은 지난
    /// 것을 남기고, 둘 다 못 읽었으면 아무 것도 바꾸지 않는다.
    #[test]
    fn fold_report_replaces_limits_but_never_blanks_what_it_could_not_read() {
        let base = AcpUsage {
            limits: vec![limit("five_hour", 0.2), limit("seven_day", 0.5)],
            detail: Some("옛 기여도".to_string()),
            identity: Some(identity("api_key")),
            ..AcpUsage::empty()
        };
        assert_eq!(
            AcpUsage::fold_report(Some(base.clone()), Vec::new(), None),
            None
        );

        let only_limits =
            AcpUsage::fold_report(Some(base.clone()), vec![limit("seven_day", 0.9)], None)
                .expect("한도만 읽어도 갱신");
        assert_eq!(only_limits.limits.len(), 1, "병합이 아니라 교체");
        assert_eq!(only_limits.detail.as_deref(), Some("옛 기여도"));
        assert_eq!(
            only_limits.identity.as_ref().map(|i| i.kind.as_str()),
            Some("api_key")
        );

        let only_detail =
            AcpUsage::fold_report(Some(base), Vec::new(), Some("새 기여도".to_string()))
                .expect("기여도만 읽어도 갱신");
        assert_eq!(
            only_detail.limits.len(),
            2,
            "빈 목록으로 갈면 계기가 사라진다"
        );
        assert_eq!(only_detail.detail.as_deref(), Some("새 기여도"));
    }

    /// 신원은 한도가 오기 전에도 올 수 있다 — 빈 바탕 위에 신원만 선다.
    #[test]
    fn with_identity_stands_alone_before_any_usage() {
        let got = AcpUsage::with_identity(None, identity("none"));
        assert!(got.limits.is_empty());
        assert_eq!(got.identity.as_ref().map(|i| i.kind.as_str()), Some("none"));
    }

    /// 실측 응답(2026-08-15) 그대로 — 문구가 바뀌면 여기서 먼저 깨진다.
    #[test]
    fn usage_report_parses_the_three_lines() {
        let report =
            "You are currently using your subscription to power your Claude Code usage\n\n\
             Current session: 0% used\n\
             Current week (all models): 83% used · resets Aug 16 at 4:59am (Asia/Seoul)\n\
             Current week (Fable): 66% used · resets Aug 16 at 4:59am (Asia/Seoul)\n\n\
             What's contributing to your limits usage?";

        let limits = parse_usage_report(report);
        assert_eq!(limits.len(), 3, "관측: {limits:?}");

        assert_eq!(limits[0].kind, "session");
        assert_eq!(limits[0].utilization, 0.0);
        assert_eq!(limits[0].resets_text, None, "초기화 시각이 없는 줄도 있다");

        assert_eq!(limits[1].kind, "week (all models)");
        assert!((limits[1].utilization - 0.83).abs() < 1e-9);
        assert_eq!(
            limits[1].resets_text.as_deref(),
            Some("Aug 16 at 4:59am (Asia/Seoul)")
        );

        assert_eq!(limits[2].kind, "week (Fable)");
        assert!((limits[2].utilization - 0.66).abs() < 1e-9);
    }

    /// 어댑터 0.75.1 의 `formatUsageResponse` 를 그대로 돌려 받은 출력이다
    /// (`dist/usage-markdown.js` 에 실측 입력을 먹여 뽑았다). 어댑터가 문구를
    /// 바꾸면 여기서 먼저 깨진다.
    #[test]
    fn usage_report_parses_the_markdown_render() {
        let report = "## Usage\n\n\
             > Claude Max subscription usage\n\n\
             ### Limits\n\n\
             **5-hour limit** — **42%** · Resets Sep 6, 3:00 PM GMT+9\n\n\
             `████████░░░░░░░░░░░░`\n\n\
             **Weekly · all models** — **13%** · Resets Sep 10, 3:00 PM GMT+9\n\n\
             `███░░░░░░░░░░░░░░░░░`\n\n\
             **Weekly · Opus** — **7%** · Resets Sep 10, 3:00 PM GMT+9\n\n\
             `█░░░░░░░░░░░░░░░░░░░`\n\n\
             **Weekly · Sonnet** — **91%**\n\n\
             `██████████████████░░`\n\n\
             ---\n\n\
             ### This session\n\n\
             | Cost | API time | Active |\n\
             |:--|:--|:--|\n\
             | $1.23 | 1m 35s | 60m |\n\n\
             ### What’s using your limits?\n\n\
             **Last 24h** · 12 requests · 3 sessions\n";

        let limits = parse_usage_report(report);
        assert_eq!(limits.len(), 4, "관측: {limits:?}");

        // 라벨이 아니라 `_meta` 와 **같은 어휘**로 접혀야 계기에 두 줄로 서지 않는다.
        let kinds: Vec<&str> = limits.iter().map(|l| l.kind.as_str()).collect();
        assert_eq!(
            kinds,
            [
                "five_hour",
                "seven_day",
                "seven_day_opus",
                "seven_day_sonnet"
            ]
        );

        assert!((limits[0].utilization - 0.42).abs() < 1e-9);
        assert_eq!(
            limits[0].resets_text.as_deref(),
            Some("Sep 6, 3:00 PM GMT+9")
        );
        assert!((limits[3].utilization - 0.91).abs() < 1e-9);
        assert_eq!(limits[3].resets_text, None, "초기화 시각이 없는 줄도 있다");

        // 표·머리글·막대는 한도가 아니다.
        assert!(!kinds.contains(&"Last 24h"));
    }

    /// `model_scoped` 는 모델 **표시명**을 그대로 준다 — 모르는 이름을 우리가
    /// 지어내지 않고 원문으로 흘려보낸다.
    #[test]
    fn markdown_limit_keeps_model_names_it_does_not_know() {
        let limits = parse_usage_report("**Weekly · Haiku 4.5** — **3%**");
        assert_eq!(limits.len(), 1, "관측: {limits:?}");
        assert_eq!(limits[0].kind, "Haiku 4.5");
    }

    #[test]
    fn usage_detail_keeps_the_body_verbatim_without_its_heading() {
        let report = "Current session: 0% used\n\n             What's contributing to your limits usage?\n\n             91% of your usage was at >150k context\n             Skills                 % of usage\n               /frontend-design       4%\n";

        let detail = parse_usage_detail(report).expect("기여도 대목이 있어야 한다");
        assert!(
            detail.starts_with("91% of your usage"),
            "머리글은 빼고: {detail:?}"
        );
        assert!(
            detail.contains("/frontend-design       4%"),
            "정렬 공백까지 그대로"
        );
    }

    /// 한도만 오고 대목이 없는 응답도 있다 — 그때 빈 문자열을 만들면 카드에
    /// 제목만 남은 빈 칸이 생긴다.
    #[test]
    fn usage_detail_is_none_when_the_section_is_absent_or_empty() {
        assert_eq!(parse_usage_detail("Current session: 0% used"), None);
        assert_eq!(
            parse_usage_detail("What's contributing to your limits usage?\n\n   \n"),
            None
        );
    }

    /// 0.75.1 은 머리글을 "What’s using your limits?" 로 바꿨다 — 굽은
    /// 따옴표까지 포함해서. 따옴표 모양에 기대면 여기서 무너진다.
    #[test]
    fn usage_detail_finds_the_markdown_heading_too() {
        let report = "### What’s using your limits?\n\n\
             > Approximate, overlapping measures · this machine only · excludes claude.ai\n\n\
             **Last 24h** · 12 requests · 3 sessions\n\n\
             | MCP server | Usage |\n\
             |:--|--:|\n\
             | oculpm | `███░░░░░░░░░░░░░░░░░` 15% |\n";

        let detail = parse_usage_detail(report).expect("기여도 대목이 있어야 한다");
        assert!(
            detail.starts_with("> Approximate"),
            "머리글은 빼고: {detail:?}"
        );
        assert!(detail.contains("| oculpm |"), "표는 그대로 넘긴다");

        // 곧은 따옴표로 바뀌어도 읽어야 한다.
        assert!(parse_usage_detail("### What's using your limits?\n\n한 줄").is_some());
    }

    /// 문구가 바뀌면 **못 읽을 뿐 죽지 않아야** 한다 — 호출부가 기존 값을 지킨다.
    #[test]
    fn usage_report_ignores_lines_it_does_not_understand() {
        assert!(parse_usage_report("Usage: 없음").is_empty());
        assert!(parse_usage_report("Current session: unknown used").is_empty());
        assert!(parse_usage_report("").is_empty());
    }

    #[test]
    fn usage_without_meta_yields_no_limits() {
        use agent_client_protocol::schema::v1::UsageUpdate;
        let found =
            usage_of(&SessionUpdate::UsageUpdate(UsageUpdate::new(1, 2))).expect("Usage 여야 한다");
        assert!(found.limits.is_empty());
    }
}
