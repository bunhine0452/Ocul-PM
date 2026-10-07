//! 배경 자동화의 **기기 동의** — 저장소 설정만으로는 켜지지 않는다.
//!
//! `config.toml` 과 `.oculpm/automation/` 는 저장소에 실려 온다. 남이 만든 저장소를
//! 열면 그 사람이 켜 둔 자동 화해·일지 초안·스케줄·감시가 **내 키로, 내 대화
//! 원문을 들고** 돈다 (2026-10-07 외부 보안 피드백 #1). 그래서 디스크의 스위치는
//! "이 저장소가 원하는 것" 이고, 실제로 도는지는 이 기기의 동의가 정한다.
//!
//! - 앱 안에서 스위치를 켜면 그 순간이 동의다 (`oculpm_set_config` 가 기록한다).
//! - 디스크에서만 켜진 스위치는 **확인 대기** — 오늘 화면의 카드가 묻는다.
//! - 「지금 실행」처럼 사람이 누른 실행은 이 문을 지나지 않는다. 막는 것은 발동
//!   쪽(스케줄러 틱·워처 규칙·훅 초안)뿐이다.
//!
//! 선언적 설정 문서(`config apply`)로 켠 스위치도 디스크에서 온 것으로 본다 —
//! 그 문서가 어디서 왔는지 앱은 모른다. 확인 카드가 한 번 더 묻는다.
//!
//! 단위는 프로젝트 하나다 (VS Code 작업 영역 신뢰와 같은 모양): 한 번 동의한
//! 프로젝트에서 나중에 켜진 스위치는 다시 묻지 않는다. 저장 자리는 SQLite
//! `settings` — 기기에만 있고 저장소에는 없다.

use crate::db::Db;
use crate::oculpm::spec::OculpmConfig;

/// SQLite `settings` 키 접두 (`automation_consent.<project_id>`). 선언적 설정
/// 문서는 이 키를 쓰지도 옮기지도 못한다 (`config::schema` — 남의 문서 한 장이
/// 동의를 위조하면 이 문이 무의미하다).
pub const KEY_PREFIX: &str = "automation_consent.";

fn key(project_id: u32) -> String {
    format!("{KEY_PREFIX}{project_id}")
}

/// 디스크 설정이 켜 둔 배경 스위치들 (config 키 이름 그대로). 비면 묻을 것이 없다.
pub fn requested(config: &OculpmConfig) -> Vec<String> {
    [
        ("agents.auto_reconcile", config.agents.auto_reconcile),
        (
            "agents.auto_journal_draft",
            config.agents.auto_journal_draft,
        ),
        ("automation.schedules", config.automation.schedules),
        ("automation.watchers", config.automation.watchers),
    ]
    .into_iter()
    .filter(|(_, on)| *on)
    .map(|(name, _)| name.to_string())
    .collect()
}

/// 이 기기가 이 프로젝트의 배경 자동화를 허락했는가. 읽지 못하면 **아니다** —
/// 모르는 채로 과금 호출을 내보내지 않는다.
pub async fn granted(db: &Db, project_id: u32) -> bool {
    matches!(db.settings_get(key(project_id)).await, Ok(Some(v)) if !v.trim().is_empty())
}

/// 동의를 기록한다. 값은 기록 시각(사람이 진단할 때 읽는다).
pub async fn grant(db: &Db, project_id: u32) -> Result<(), String> {
    db.settings_set(key(project_id), chrono::Utc::now().to_rfc3339())
        .await
        .map_err(|e| e.to_string())
}

/// 배경 스위치를 전부 끈 사본. 디스크는 건드리지 않는다 — 저장소의 파일을
/// 몰래 고치면 그 사람의 커밋을 우리가 바꾸는 셈이다.
pub fn masked(config: &OculpmConfig) -> OculpmConfig {
    let mut out = config.clone();
    out.agents.auto_reconcile = false;
    out.agents.auto_journal_draft = false;
    out.automation.schedules = false;
    out.automation.watchers = false;
    out
}

/// 발동 쪽이 읽는 설정 — 동의가 있으면 그대로, 없으면 배경 스위치를 끈 사본.
pub async fn effective(db: &Db, project_id: u32, config: OculpmConfig) -> OculpmConfig {
    if requested(&config).is_empty() || granted(db, project_id).await {
        config
    } else {
        masked(&config)
    }
}

/// 배경 모델 1회 시드(D2)가 필요한가 — 화해·초안 스위치가 켜져 있고 **이 기기가
/// 허락했을 때만**. 동의 전의 시드는 저장소 설정이 내 대화 모델을 배경 슬롯에
/// 꽂게 하는 길이었다 (외부 보안 피드백 #1 — "모델 미설정이면 조용히 스킵" 우회).
pub async fn seed_wanted(db: &Db, project_id: u32, config: &OculpmConfig) -> bool {
    (config.agents.auto_reconcile || config.agents.auto_journal_draft)
        && granted(db, project_id).await
}

/// `old` → `new` 로 앱 안에서 바꿀 때, 꺼져 있던 배경 스위치를 **새로 켰는가**.
/// 그 순간이 동의다 — 사람이 설정 화면에서 직접 눌렀다.
pub fn turns_any_on(old: &OculpmConfig, new: &OculpmConfig) -> bool {
    let before = requested(old);
    requested(new).iter().any(|name| !before.contains(name))
}

/// 확인 카드가 그리는 것.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct AutomationConsent {
    /// 디스크 설정이 켜 둔 배경 스위치 (`agents.auto_reconcile` 꼴).
    pub requested: Vec<String>,
    /// 이 기기가 허락했는가.
    pub granted: bool,
}

impl AutomationConsent {
    /// 묻을 것이 있는가 — 켜 둔 스위치가 있는데 아직 허락하지 않았다.
    pub fn pending(&self) -> bool {
        !self.requested.is_empty() && !self.granted
    }
}

pub async fn status(db: &Db, project_id: u32, config: &OculpmConfig) -> AutomationConsent {
    AutomationConsent {
        requested: requested(config),
        granted: granted(db, project_id).await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn on() -> OculpmConfig {
        let mut c = OculpmConfig::default_for_new_project();
        c.agents.auto_reconcile = true;
        c.automation.schedules = true;
        c
    }

    #[test]
    fn requested_lists_only_the_switches_that_are_on() {
        assert!(requested(&OculpmConfig::default_for_new_project()).is_empty());
        assert_eq!(
            requested(&on()),
            vec!["agents.auto_reconcile", "automation.schedules"]
        );
    }

    #[test]
    fn masked_turns_every_background_switch_off_and_nothing_else() {
        let mut c = on();
        c.agents.auto_journal_draft = true;
        c.automation.watchers = true;
        c.automation.daily_run_budget = 7;
        let m = masked(&c);
        assert!(requested(&m).is_empty());
        assert_eq!(m.automation.daily_run_budget, 7);
        assert_eq!(m.agents.active, c.agents.active);
    }

    #[test]
    fn turning_a_switch_on_in_the_app_is_consent_but_turning_off_is_not() {
        let off = OculpmConfig::default_for_new_project();
        assert!(turns_any_on(&off, &on()));
        assert!(!turns_any_on(&on(), &off));
        assert!(
            !turns_any_on(&on(), &on()),
            "같은 값을 다시 저장한 것은 새 동의가 아니다"
        );
    }

    #[tokio::test]
    async fn without_consent_the_repo_switches_do_not_run() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("t.db")).await.unwrap();

        let eff = effective(&db, 7, on()).await;
        assert!(requested(&eff).is_empty(), "동의 전에는 꺼진 채로 읽힌다");
        let st = status(&db, 7, &on()).await;
        assert!(st.pending());

        grant(&db, 7).await.unwrap();
        assert!(granted(&db, 7).await);
        assert_eq!(requested(&effective(&db, 7, on()).await).len(), 2);
        assert!(!status(&db, 7, &on()).await.pending());
        // 다른 프로젝트의 동의로 번지지 않는다.
        assert!(!granted(&db, 8).await);
    }
}
