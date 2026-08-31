//! 정착 타이머와 증폭 루프 가드 — 워처 자동화의 순수 심장 (Phase 2 §2.1·§2.4).
//!
//! ```text
//! fs 이벤트 → [원인 제외] → [watch 경로 일치] → 창 열기/연장
//!                                              → 마지막 이벤트 + 티어 지연
//!                                              → 만료 = 정착 → 러너에 enqueue
//! ```
//!
//! # 왜 여기에 시계가 없는가
//!
//! `now` 는 전부 인자다. 티어 정착은 "10분을 기다린 뒤에만 돈다" 는 성질이라
//! 실시간으로는 시험할 수 없다 — 이벤트 스트림과 시각을 주입해 **중간엔 0건,
//! 마지막 이벤트 + 지연에만 1건** 을 단언한다 (설계 §3).
//!
//! # 증폭 루프 (R1)
//!
//! 자동화가 일지를 쓰면 워처가 그 쓰기를 본다. 그대로 두면 자기 산출물이 자기를
//! 다시 부르는 고리가 된다. [`is_excluded_cause`] 가 네 경로를 **트리거 원인에서**
//! 제외한다 — `watcher.rs` 의 "이벤트 emit" 판정과는 **다른 판정**이다. UI 는
//! 계속 emit 을 받아야 화면이 갱신되기 때문이다.
//!
//! 그물은 셋이다: (1) 원인 제외 (2) 최소 간격(티어 지연 ×2) (3) 일일 예산(러너).

use std::collections::{BTreeMap, BTreeSet};

use chrono::{DateTime, Duration as ChronoDuration, Utc};

use crate::oculpm::automation::store::AutomationDef;
use crate::oculpm::automation::tiers::{tier_of, Responsiveness};

/// 한 정착 창이 들고 다니는 경로 수 상한. 넘으면 세지만 담지 않는다 —
/// 지시문에 붙는 관측 사실이지 파일 목록의 SSOT 가 아니다.
pub const MAX_WINDOW_PATHS: usize = 200;

/// **트리거 원인에서 제외**되는 경로들 (R1 — 증폭 루프 가드).
///
/// - `.oculpm/journal/` · `.oculpm/planner/` — 자동화 자신의 산출물
/// - `.oculpm/automation/` — 정의 파일 편집
/// - `.oculpm/index/` — 이미 self-suppress 중이지만 여기서도 못박는다
pub const EXCLUDED_CAUSE_PREFIXES: [&str; 4] = [
    ".oculpm/journal/",
    ".oculpm/planner/",
    ".oculpm/automation/",
    ".oculpm/index/",
];

/// 경로 구분자를 `/` 로 통일한다 (윈도우 대비 — 비교는 한 어휘로).
fn norm(rel: &str) -> String {
    rel.replace('\\', "/")
}

/// 이 경로의 변경이 자동화를 **깨울 수 있는가**. `false` = 원인에서 제외.
///
/// UI 이벤트 emit 판정과 분리돼 있다는 것이 핵심이다 — 일지가 바뀌면 화면은
/// 갱신돼야 하지만 자동화는 깨어나면 안 된다.
pub fn is_excluded_cause(rel: &str) -> bool {
    let rel = norm(rel);
    let rel = rel.trim_start_matches("./");
    EXCLUDED_CAUSE_PREFIXES.iter().any(|p| rel.starts_with(p))
}

/// `watch:` 값을 비교 가능한 모양으로 — 앞뒤 슬래시와 `./` 를 벗긴다.
/// 빈 문자열과 `.` 은 둘 다 프로젝트 루트(전부 일치)다.
pub fn normalize_watch(raw: &str) -> String {
    let w = norm(raw);
    let w = w.trim();
    if w == "." {
        return String::new();
    }
    let w = w.trim_start_matches("./").trim_start_matches('/');
    w.trim_end_matches('/').to_string()
}

/// `watch:` 가 쓸 수 없는 값인가. 프런트가 i18n 키로 바꿀 코드를 돌려준다.
///
/// 경로는 fs 접근에 쓰이지 않고 **접두 비교**에만 쓰이므로 탈출 위험은 없다.
/// 다만 `..` 이나 절대 경로는 어떤 상대 경로와도 만나지 않아 **영원히 안 도는
/// 자동화**가 된다 — 조용히 두지 않고 저장 시점에 말한다.
pub fn watch_error(raw: Option<&str>) -> Option<&'static str> {
    let raw = raw.map(str::trim).unwrap_or("");
    if raw.is_empty() || raw == "." {
        return None; // 프로젝트 루트
    }
    let normalized = norm(raw);
    if normalized.starts_with('/') || normalized.split('/').any(|seg| seg == "..") {
        return Some("automation_bad_watch");
    }
    if normalize_watch(raw).is_empty() {
        return Some("automation_bad_watch");
    }
    None
}

// ─────────────────────────────────────────────────────────────────────────────
// 감시 규칙
// ─────────────────────────────────────────────────────────────────────────────

/// 워처 자동화 하나를 "무엇을 얼마나 기다렸다 깨울까" 로 줄인 것.
/// 정의 파일에서 파생되며 fs 이벤트마다 읽히므로 값 타입이다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WatchRule {
    pub automation_id: String,
    /// 프로젝트 상대 디렉터리. 빈 문자열 = 프로젝트 루트.
    pub watch: String,
    pub recursive: bool,
    pub tier: Responsiveness,
}

impl WatchRule {
    /// 정의 → 규칙. `recursive` 기본값은 `true` (감시는 보통 트리 전체다).
    pub fn from_def(def: &AutomationDef) -> Self {
        Self {
            automation_id: def.id.clone(),
            watch: normalize_watch(def.watch.as_deref().unwrap_or("")),
            recursive: def.recursive.unwrap_or(true),
            tier: tier_of(def.responsiveness.as_deref()),
        }
    }

    /// 이 경로가 감시 범위 안인가. 원인 제외는 여기서 보지 않는다
    /// ([`SettleTracker::note`] 가 먼저 거른다) — 규칙은 범위만 안다.
    pub fn matches(&self, rel: &str) -> bool {
        let rel = norm(rel);
        let rel = rel.trim_start_matches("./");
        if self.watch.is_empty() {
            // 루트 감시: 재귀가 꺼져 있으면 최상위 파일만.
            return self.recursive || !rel.contains('/');
        }
        let Some(rest) = rel.strip_prefix(&self.watch) else {
            return false;
        };
        let Some(rest) = rest.strip_prefix('/') else {
            return false; // `src2/x.rs` 가 `src` 로 걸리지 않게
        };
        self.recursive || !rest.contains('/')
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 정착 창
// ─────────────────────────────────────────────────────────────────────────────

/// 아직 멎지 않은(또는 방금 멎은) 작업 구간 하나.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SettleWindow {
    pub automation_id: String,
    /// 창의 첫 이벤트 — 초안 중복 키의 시작점이다 (§2.3).
    pub started_at: DateTime<Utc>,
    pub last_event_at: DateTime<Utc>,
    pub tier: Responsiveness,
    /// 창 안에 바뀐 경로 (최대 [`MAX_WINDOW_PATHS`]).
    pub paths: BTreeSet<String>,
    /// 창 안의 총 이벤트 수 (경로 상한과 무관하게 센다).
    pub events: u32,
}

impl SettleWindow {
    /// 이 창이 `now` 기준으로 정착했는가.
    pub fn is_settled(&self, now: DateTime<Utc>) -> bool {
        self.deadline() <= now
    }

    /// 지금 정착 예정 시각.
    pub fn deadline(&self) -> DateTime<Utc> {
        self.last_event_at + ChronoDuration::milliseconds(self.tier.delay_ms() as i64)
    }

    /// 담지 못하고 센 것이 있는가 (경로 상한 초과).
    pub fn truncated(&self) -> bool {
        self.events as usize > self.paths.len()
    }
}

/// 정착 결과 하나.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Settled {
    pub window: SettleWindow,
    /// `false` = 최소 간격 안이라 이번엔 버린다 (§2.4).
    pub fire: bool,
    /// 버린 사실을 원장에 적을 차례인가 — **연속 스로틀 중 첫 번째만** `true`.
    /// 매번 적으면 짧은 티어에서 원장이 스로틀 행으로 뒤덮인다.
    pub report: bool,
}

/// 프로젝트 하나의 정착 상태. `note` 는 fs 이벤트마다, `take_settled` 는
/// 드라이버 틱마다 불린다.
#[derive(Debug, Default)]
pub struct SettleTracker {
    windows: BTreeMap<String, SettleWindow>,
    last_fired: BTreeMap<String, DateTime<Utc>>,
    /// 마지막 발동 이후 스로틀을 이미 원장에 적었는가.
    throttle_reported: BTreeMap<String, bool>,
}

impl SettleTracker {
    pub fn new() -> Self {
        Self::default()
    }

    /// fs 이벤트 하나를 규칙 목록에 흘린다. 반환값은 창을 열거나 연장한 규칙 수.
    ///
    /// **원인 제외가 여기 있다** — 제외 경로는 어떤 규칙과도 만나지 않는다.
    pub fn note(&mut self, rules: &[WatchRule], rel: &str, now: DateTime<Utc>) -> usize {
        if is_excluded_cause(rel) {
            return 0;
        }
        let mut touched = 0;
        for rule in rules {
            if !rule.matches(rel) {
                continue;
            }
            touched += 1;
            let win = self
                .windows
                .entry(rule.automation_id.clone())
                .or_insert_with(|| SettleWindow {
                    automation_id: rule.automation_id.clone(),
                    started_at: now,
                    last_event_at: now,
                    tier: rule.tier,
                    paths: BTreeSet::new(),
                    events: 0,
                });
            // 정의가 바뀌어 티어가 달라졌으면 열린 창도 새 티어를 따른다.
            win.tier = rule.tier;
            win.last_event_at = now;
            win.events = win.events.saturating_add(1);
            if win.paths.len() < MAX_WINDOW_PATHS {
                win.paths.insert(norm(rel));
            }
        }
        touched
    }

    /// 정착한 창들을 꺼낸다 (꺼내면 창은 사라진다). 최소 간격 안이면
    /// `fire = false` 로 돌려 호출부가 사유를 남길 수 있게 한다.
    pub fn take_settled(&mut self, now: DateTime<Utc>) -> Vec<Settled> {
        let ready: Vec<String> = self
            .windows
            .values()
            .filter(|w| w.is_settled(now))
            .map(|w| w.automation_id.clone())
            .collect();

        let mut out = Vec::with_capacity(ready.len());
        for id in ready {
            let Some(window) = self.windows.remove(&id) else {
                continue;
            };
            let throttled =
                self.last_fired
                    .get(&id)
                    .map(|last| {
                        now - *last
                            < ChronoDuration::milliseconds(
                                window.tier.min_interval().as_millis() as i64
                            )
                    })
                    .unwrap_or(false);
            if throttled {
                let already = self.throttle_reported.get(&id).copied().unwrap_or(false);
                self.throttle_reported.insert(id, true);
                out.push(Settled {
                    window,
                    fire: false,
                    report: !already,
                });
            } else {
                self.last_fired.insert(id.clone(), now);
                self.throttle_reported.insert(id, false);
                out.push(Settled {
                    window,
                    fire: true,
                    report: true,
                });
            }
        }
        out
    }

    /// 다음으로 무언가 정착할 시각 — 드라이버가 이만큼만 잔다.
    pub fn next_deadline(&self) -> Option<DateTime<Utc>> {
        self.windows.values().map(SettleWindow::deadline).min()
    }

    /// 사라진 정의의 창·이력을 버린다 (파일이 SSOT).
    pub fn retain_known(&mut self, known: &BTreeSet<String>) {
        self.windows.retain(|id, _| known.contains(id));
        self.last_fired.retain(|id, _| known.contains(id));
        self.throttle_reported.retain(|id, _| known.contains(id));
    }

    pub fn open_windows(&self) -> usize {
        self.windows.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oculpm::automation::store::{AutomationKind, AutomationOutput};

    fn t(secs: i64) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-08-31T09:00:00Z")
            .unwrap()
            .with_timezone(&Utc)
            + ChronoDuration::seconds(secs)
    }

    fn ms(millis: i64) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-08-31T09:00:00Z")
            .unwrap()
            .with_timezone(&Utc)
            + ChronoDuration::milliseconds(millis)
    }

    fn rule(id: &str, watch: &str, tier: Responsiveness) -> WatchRule {
        WatchRule {
            automation_id: id.into(),
            watch: normalize_watch(watch),
            recursive: true,
            tier,
        }
    }

    // ── 원인 제외 (R1) ──────────────────────────────────────────────────────

    #[test]
    fn our_own_outputs_are_never_a_cause() {
        for p in [
            ".oculpm/journal/20260831/Chores/1200_chore_x.md",
            ".oculpm/planner/osaurus-bench-round.md",
            ".oculpm/automation/watchers/draft-on-settle.md",
            ".oculpm/index/changes/20260831.ndjson",
        ] {
            assert!(is_excluded_cause(p), "{p} 가 원인에서 제외되지 않는다");
        }
        for p in [
            "src/main.rs",
            ".oculpm/config.toml",
            ".oculpm/discussion/x.md",
            "docs/oculpm/journal/notes.md",
        ] {
            assert!(!is_excluded_cause(p), "{p} 를 잘못 제외한다");
        }
    }

    /// 설계 §3 — **증폭 루프**: 자동화가 일지를 쓰는 시나리오 → 재발동 0건.
    #[test]
    fn an_automation_writing_a_journal_never_retriggers_itself() {
        let rules = vec![rule("draft-on-settle", "", Responsiveness::Deferred)];
        let mut tr = SettleTracker::new();

        // 1) 사용자가 코드를 고친다 → 창이 열리고 정착해서 1건 발동.
        tr.note(&rules, "src/lib.rs", t(0));
        let fired = tr.take_settled(t(301));
        assert_eq!(fired.len(), 1);
        assert!(fired[0].fire);

        // 2) 그 발동이 일지·플랜·원장·정의를 쓴다. 워처는 그 쓰기를 전부 본다.
        for p in [
            ".oculpm/journal/20260831/Chores/1205_chore_draft-on-settle-auto.md",
            ".oculpm/index/journal/20260831.json",
            ".oculpm/planner/osaurus-bench-round.md",
            ".oculpm/automation/watchers/draft-on-settle.md",
        ] {
            assert_eq!(tr.note(&rules, p, t(310)), 0, "{p} 가 창을 열었다");
        }

        // 3) 아무리 기다려도 두 번째 발동은 없다.
        assert!(tr.next_deadline().is_none());
        assert!(
            tr.take_settled(t(10_000)).is_empty(),
            "재발동 0건이어야 한다"
        );
    }

    // ── 티어 정착 (§3 "티어 정착") ──────────────────────────────────────────

    /// 이벤트 스트림 주입 → **마지막 이벤트 + 지연에만** 발동, 중간엔 0건.
    #[test]
    fn a_window_fires_only_after_the_last_event_plus_the_tier_delay() {
        let rules = vec![rule("draft", "src", Responsiveness::Patient)]; // 3s
        let mut tr = SettleTracker::new();

        // 0s·1s·2s 에 저장 — 매번 타이머가 리셋된다.
        for (i, at) in [0i64, 1_000, 2_000].iter().enumerate() {
            tr.note(&rules, &format!("src/f{i}.rs"), ms(*at));
            assert!(
                tr.take_settled(ms(*at)).is_empty(),
                "이벤트 순간에는 정착이 아니다"
            );
        }
        // 첫 이벤트 기준 3s(=3000ms)가 지났지만 마지막 이벤트 기준으론 1s 다.
        assert!(
            tr.take_settled(ms(3_000)).is_empty(),
            "중간엔 0건 — 첫 이벤트가 아니라 마지막 이벤트가 기준이다"
        );
        assert!(tr.take_settled(ms(4_999)).is_empty());

        // 마지막 이벤트(2s) + 지연(3s) = 5s 에 정확히 1건.
        let fired = tr.take_settled(ms(5_000));
        assert_eq!(fired.len(), 1);
        assert!(fired[0].fire);
        let w = &fired[0].window;
        assert_eq!(w.started_at, ms(0), "구간 시작은 첫 이벤트");
        assert_eq!(w.last_event_at, ms(2_000));
        assert_eq!(w.events, 3);
        assert_eq!(w.paths.len(), 3);

        // 꺼내면 창은 사라진다 — 같은 창이 두 번 돌지 않는다.
        assert!(tr.take_settled(ms(60_000)).is_empty());
    }

    #[test]
    fn next_deadline_tracks_the_last_event() {
        let rules = vec![rule("a", "", Responsiveness::Relaxed)]; // 60s
        let mut tr = SettleTracker::new();
        assert!(tr.next_deadline().is_none());
        tr.note(&rules, "a.txt", t(0));
        assert_eq!(tr.next_deadline(), Some(t(60)));
        tr.note(&rules, "b.txt", t(10));
        assert_eq!(tr.next_deadline(), Some(t(70)), "리셋된다");
    }

    /// 티어가 다르면 각자의 시계로 정착한다.
    #[test]
    fn each_automation_settles_on_its_own_tier() {
        let rules = vec![
            rule("fastie", "", Responsiveness::Fast),    // 200ms
            rule("slowie", "", Responsiveness::Relaxed), // 60s
        ];
        let mut tr = SettleTracker::new();
        tr.note(&rules, "x.rs", ms(0));
        let first = tr.take_settled(ms(200));
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].window.automation_id, "fastie");
        assert!(tr.take_settled(ms(59_999)).is_empty());
        assert_eq!(tr.take_settled(ms(60_000)).len(), 1);
    }

    // ── 최소 간격 (§2.4) ────────────────────────────────────────────────────

    #[test]
    fn the_same_automation_cannot_refire_inside_the_minimum_interval() {
        let rules = vec![rule("a", "", Responsiveness::Patient)]; // 지연 3s, 최소 간격 6s
        let mut tr = SettleTracker::new();

        tr.note(&rules, "x.rs", ms(0));
        assert!(tr.take_settled(ms(3_000))[0].fire, "첫 발동은 3s 에");

        // 3.1s 에 다시 바뀌고 6.1s 에 정착 — 마지막 발동(3s)에서 3.1s 뒤라 이르다.
        tr.note(&rules, "y.rs", ms(3_100));
        let second = tr.take_settled(ms(6_100));
        assert_eq!(second.len(), 1);
        assert!(!second[0].fire, "최소 간격(6s) 안이라 버린다");
        assert!(second[0].report, "첫 스로틀은 사유를 남긴다");

        // 연속 스로틀은 한 번만 원장에 적는다 (짧은 티어에서 원장이 뒤덮인다).
        tr.note(&rules, "z.rs", ms(4_000));
        let third = tr.take_settled(ms(7_000));
        assert!(!third[0].fire, "여전히 마지막 발동에서 6s 안이다");
        assert!(!third[0].report, "연속 스로틀은 다시 적지 않는다");

        // 최소 간격을 넘기면 다시 돈다 — 스로틀은 시계를 밀지 않는다.
        tr.note(&rules, "w.rs", ms(20_000));
        let fourth = tr.take_settled(ms(23_000));
        assert!(fourth[0].fire);
        assert!(fourth[0].report);
    }

    // ── watch 범위 ──────────────────────────────────────────────────────────

    #[test]
    fn watch_scope_matches_directories_not_prefixes() {
        let r = rule("a", "src/", Responsiveness::Fast);
        assert!(r.matches("src/main.rs"));
        assert!(r.matches("src/deep/nested/x.rs"));
        assert!(!r.matches("src2/main.rs"), "접두 일치는 범위가 아니다");
        assert!(!r.matches("docs/x.md"));
        assert!(!r.matches("src"), "디렉터리 자신은 파일이 아니다");

        // 루트 감시는 전부 본다.
        let root = rule("b", "", Responsiveness::Fast);
        assert!(root.matches("anything/at/all.rs"));
        assert!(root.matches("README.md"));
    }

    #[test]
    fn non_recursive_watch_sees_only_direct_children() {
        let mut r = rule("a", "docs", Responsiveness::Fast);
        r.recursive = false;
        assert!(r.matches("docs/x.md"));
        assert!(!r.matches("docs/deep/x.md"));

        let mut root = rule("b", "", Responsiveness::Fast);
        root.recursive = false;
        assert!(root.matches("README.md"));
        assert!(!root.matches("src/main.rs"));
    }

    /// 영원히 안 도는 감시 경로는 저장 시점에 말한다.
    #[test]
    fn impossible_watch_paths_are_reported_not_silently_dead() {
        assert_eq!(watch_error(None), None);
        assert_eq!(watch_error(Some("")), None);
        assert_eq!(watch_error(Some(".")), None);
        assert_eq!(watch_error(Some("src/features")), None);
        assert_eq!(watch_error(Some("/etc")), Some("automation_bad_watch"));
        assert_eq!(watch_error(Some("../other")), Some("automation_bad_watch"));
        assert_eq!(watch_error(Some("src/../..")), Some("automation_bad_watch"));
    }

    #[test]
    fn root_watch_is_spelled_three_ways() {
        assert_eq!(normalize_watch(""), "");
        assert_eq!(normalize_watch("."), "");
        assert_eq!(normalize_watch("./"), "");
        assert_eq!(normalize_watch("/src/"), "src");
    }

    #[test]
    fn rules_come_from_the_definition_with_sane_defaults() {
        let mut def = AutomationDef::new("w", AutomationKind::Watcher, "감시", "2026-08-31");
        def.output = AutomationOutput::Journal;
        let r = WatchRule::from_def(&def);
        assert_eq!(r.watch, "", "watch 가 없으면 프로젝트 루트");
        assert!(r.recursive, "재귀가 기본");
        assert_eq!(r.tier, Responsiveness::Balanced);

        def.watch = Some("./src/".into());
        def.recursive = Some(false);
        def.responsiveness = Some("deferred".into());
        let r = WatchRule::from_def(&def);
        assert_eq!(r.watch, "src");
        assert!(!r.recursive);
        assert_eq!(r.tier, Responsiveness::Deferred);
    }

    #[test]
    fn window_paths_are_capped_but_events_are_counted() {
        let rules = vec![rule("a", "", Responsiveness::Fast)];
        let mut tr = SettleTracker::new();
        for i in 0..(MAX_WINDOW_PATHS + 10) {
            tr.note(&rules, &format!("f{i}.rs"), ms(0));
        }
        let fired = tr.take_settled(ms(1_000));
        let w = &fired[0].window;
        assert_eq!(w.paths.len(), MAX_WINDOW_PATHS);
        assert_eq!(w.events as usize, MAX_WINDOW_PATHS + 10);
        assert!(w.truncated());
    }

    #[test]
    fn vanished_definitions_lose_their_windows() {
        let rules = vec![rule("gone", "", Responsiveness::Fast)];
        let mut tr = SettleTracker::new();
        tr.note(&rules, "x.rs", ms(0));
        assert_eq!(tr.open_windows(), 1);
        tr.retain_known(&BTreeSet::new());
        assert_eq!(tr.open_windows(), 0);
        assert!(tr.take_settled(ms(10_000)).is_empty());
    }
}
