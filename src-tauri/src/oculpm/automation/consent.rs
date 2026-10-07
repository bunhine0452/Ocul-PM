//! 배경 자동화의 **기기 동의** — 저장소 설정만으로는 켜지지 않는다.
//!
//! `config.toml` 과 `.oculpm/automation/` 는 저장소에 실려 온다. 남이 만든 저장소를
//! 열면 그 사람이 켜 둔 자동 화해·일지 초안·스케줄·감시가 **내 키로, 내 대화
//! 원문을 들고** 돈다 (2026-10-07 외부 보안 피드백 #1). 그래서 디스크의 스위치는
//! "이 저장소가 원하는 것" 이고, 실제로 도는지는 이 기기의 동의가 정한다.
//!
//! - 앱 안에서 스위치를 켜거나 정의를 저장·재개하면 그 **변경분**이 동의다
//!   (`oculpm_set_config`·`automation_save`·`automation_set_enabled`).
//! - 디스크에서만 켜지거나 바뀐 것은 **확인 대기** — 오늘 화면의 카드가 묻는다.
//! - 「지금 실행」처럼 사람이 누른 실행은 이 문을 지나지 않는다. 막는 것은 발동
//!   쪽(스케줄러 틱·워처 규칙·훅 초안)뿐이다.
//!
//! 선언적 설정 문서(`config apply`)로 켠 스위치도 디스크에서 온 것으로 본다 —
//! 그 문서가 어디서 왔는지 앱은 모른다. 확인 카드가 한 번 더 묻는다.
//!
//! **동의는 그때 본 것에 묶인다** (3차 피드백, 2026-10-08 — direnv 의 `allow` 와
//! 같은 모양). 처음 판(v3.8.0)은 프로젝트에 한 번 허락하면 영구였다: 그 뒤 `git
//! pull` 이 새 스케줄을 켜거나 지시문을 바꿔도 말없이 돌았다. 이제 동의는 켜 둔
//! 스위치 목록과 **켜진 정의마다의 지문**(지시문·발동 조건·산출물)을 기록하고,
//! 디스크의 것이 그 범위를 벗어나면 배경 작업 **전체**를 다시 확인 대기로 돌린다.
//! 끄거나 지우는 쪽은 범위를 좁히는 것이라 다시 묻지 않는다. 거두기
//! (`automation_consent_revoke`)는 기록을 지운다. 단위는 여전히 프로젝트 하나다.
//! 저장 자리는 SQLite `settings` — 기기에만 있고 저장소에는 없다.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::db::Db;
use crate::oculpm::automation::store::{self, AutomationDef, AutomationKind};
use crate::oculpm::spec::OculpmConfig;

/// SQLite `settings` 키 접두 (`automation_consent.<project_id>`). 선언적 설정
/// 문서는 이 키를 쓰지도 옮기지도 못한다 (`config::schema` — 남의 문서 한 장이
/// 동의를 위조하면 이 문이 무의미하다).
pub const KEY_PREFIX: &str = "automation_consent.";

/// 배경 스위치의 config 키 — 확인 카드가 이름표로 옮긴다.
const SWITCHES: [&str; 4] = [
    "agents.auto_reconcile",
    "agents.auto_journal_draft",
    "automation.schedules",
    "automation.watchers",
];

fn key(project_id: u32) -> String {
    format!("{KEY_PREFIX}{project_id}")
}

/// 디스크 설정이 켜 둔 배경 스위치들 (config 키 이름 그대로). 비면 묻을 것이 없다.
pub fn requested(config: &OculpmConfig) -> Vec<String> {
    [
        config.agents.auto_reconcile,
        config.agents.auto_journal_draft,
        config.automation.schedules,
        config.automation.watchers,
    ]
    .into_iter()
    .zip(SWITCHES)
    .filter(|(on, _)| *on)
    .map(|(_, name)| name.to_string())
    .collect()
}

/// 동의가 덮어야 하는 것 — 켜진 스위치와, 그 스위치 아래에서 실제로 돌 정의들.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Surface {
    pub switches: BTreeSet<String>,
    /// `schedules/<id>` → (제목, 지문). 켜진 종류의 켜진 정의만.
    pub defs: BTreeMap<String, (String, String)>,
}

/// 지금 디스크의 표면. 정의 폴더를 읽지 못하면 `None` — 모르는 것은 덮였다고
/// 말할 수 없다.
pub fn surface(config: &OculpmConfig, root: &Path) -> Option<Surface> {
    let mut defs = BTreeMap::new();
    for (kind, on) in [
        (AutomationKind::Schedule, config.automation.schedules),
        (AutomationKind::Watcher, config.automation.watchers),
    ] {
        if !on {
            continue;
        }
        for parsed in store::list_automations(root, kind).ok()? {
            if parsed.def.enabled {
                defs.insert(
                    def_key(kind, &parsed.def.id),
                    (parsed.def.title.clone(), fingerprint(&parsed.def)),
                );
            }
        }
    }
    Some(Surface {
        switches: requested(config).into_iter().collect(),
        defs,
    })
}

fn def_key(kind: AutomationKind, id: &str) -> String {
    format!("{}/{id}", kind.dir_name())
}

/// 정의가 **무엇을 언제 하는가**의 지문 — 제목·날짜처럼 동작을 바꾸지 않는 칸은 뺀다
/// (이름만 고쳤다고 다시 묻지 않게).
fn fingerprint(def: &AutomationDef) -> String {
    let mut shape = def.clone();
    shape.title.clear();
    shape.created.clear();
    shape.updated.clear();
    let bytes = serde_json::to_vec(&shape).unwrap_or_default();
    blake3::hash(&bytes).to_hex()[..16].to_string()
}

/// 기록된 동의 — 허락한 스위치와 정의 지문.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
struct Approval {
    at: String,
    switches: BTreeSet<String>,
    defs: BTreeMap<String, String>,
}

impl Approval {
    /// 디스크 표면이 이 동의 안인가 — 스위치는 부분집합, 정의는 지문까지 같아야 한다.
    fn covers(&self, surface: &Surface) -> bool {
        surface.switches.is_subset(&self.switches)
            && surface
                .defs
                .iter()
                .all(|(k, (_, fp))| self.defs.get(k) == Some(fp))
    }

    /// 덮이지 않은 정의(새로 켜졌거나 지문이 바뀐 것)의 제목들.
    fn uncovered_defs(&self, surface: &Surface) -> Vec<String> {
        surface
            .defs
            .iter()
            .filter(|(k, (_, fp))| self.defs.get(*k) != Some(fp))
            .map(|(_, (title, _))| title.clone())
            .collect()
    }
}

async fn approval(db: &Db, project_id: u32) -> Option<Approval> {
    let raw = db.settings_get(key(project_id)).await.ok()??;
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    // v3.8.0~3.9.0 은 시각 한 줄만 적었다 — 스위치는 허락한 것으로, 정의는 모르는
    // 것으로 읽는다. 켜진 정의가 있는 프로젝트만 카드가 한 번 더 묻는다.
    Some(serde_json::from_str(raw).unwrap_or_else(|_| Approval {
        at: raw.to_string(),
        switches: SWITCHES.iter().map(|s| s.to_string()).collect(),
        defs: BTreeMap::new(),
    }))
}

async fn store_approval(db: &Db, project_id: u32, mut a: Approval) -> Result<(), String> {
    a.at = chrono::Utc::now().to_rfc3339();
    let json = serde_json::to_string(&a).map_err(|e| e.to_string())?;
    db.settings_set(key(project_id), json)
        .await
        .map_err(|e| e.to_string())
}

/// 이 기기가 지금 디스크의 배경 자동화를 허락했는가. 읽지 못하면 **아니다** —
/// 모르는 채로 과금 호출을 내보내지 않는다. 덮을 것이 없으면 참이다.
pub async fn granted(db: &Db, project_id: u32, config: &OculpmConfig, root: &Path) -> bool {
    let Some(surface) = surface(config, root) else {
        return false;
    };
    if surface == Surface::default() {
        return true;
    }
    approval(db, project_id)
        .await
        .is_some_and(|a| a.covers(&surface))
}

/// 확인 카드의 「이 기기에서 켜기」 — 지금 디스크의 표면 전체를 허락한다.
pub async fn grant(
    db: &Db,
    project_id: u32,
    config: &OculpmConfig,
    root: &Path,
) -> Result<(), String> {
    let surface = surface(config, root).ok_or("could not read automation definitions")?;
    store_approval(
        db,
        project_id,
        Approval {
            at: String::new(),
            switches: surface.switches,
            defs: surface
                .defs
                .into_iter()
                .map(|(k, (_, fp))| (k, fp))
                .collect(),
        },
    )
    .await
}

/// 앱 안에서 사람이 바꾼 **변경분**을 허락에 더한다 — `before` 에 없던 스위치와,
/// `before` 와 지문이 다른 정의. 이미 확인 대기이던 것은 그대로 대기다 (설정 화면의
/// 다른 칸을 저장했다고 남이 켜 둔 것까지 허락되면 안 된다).
pub async fn approve_changes(
    db: &Db,
    project_id: u32,
    before: &Surface,
    after: &Surface,
) -> Result<(), String> {
    let new_switches: Vec<&String> = after.switches.difference(&before.switches).collect();
    let new_defs: Vec<(&String, &String)> = after
        .defs
        .iter()
        .filter(|(k, (_, fp))| before.defs.get(*k).map(|(_, b)| b) != Some(fp))
        .map(|(k, (_, fp))| (k, fp))
        .collect();
    if new_switches.is_empty() && new_defs.is_empty() {
        return Ok(());
    }
    let mut a = approval(db, project_id).await.unwrap_or_default();
    a.switches.extend(new_switches.into_iter().cloned());
    a.defs
        .extend(new_defs.into_iter().map(|(k, fp)| (k.clone(), fp.clone())));
    store_approval(db, project_id, a).await
}

/// 정의 하나를 앱에서 저장·재개한 직후 — 디스크에서 다시 읽어 그 지문을 허락한다.
/// 꺼진 정의는 표면 밖이라 할 일이 없다.
pub async fn approve_def(
    db: &Db,
    project_id: u32,
    root: &Path,
    kind: AutomationKind,
    id: &str,
) -> Result<(), String> {
    let Some(parsed) = store::read_automation(root, kind, id).map_err(|e| e.to_string())? else {
        return Ok(());
    };
    if !parsed.def.enabled {
        return Ok(());
    }
    let mut a = approval(db, project_id).await.unwrap_or_default();
    a.defs.insert(def_key(kind, id), fingerprint(&parsed.def));
    store_approval(db, project_id, a).await
}

/// 허락 거두기 — 기록을 지운다. 다음 틱부터 디스크의 스위치는 확인 대기다.
pub async fn revoke(db: &Db, project_id: u32) -> Result<(), String> {
    db.settings_delete(key(project_id))
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

/// 발동 쪽이 읽는 설정 — 동의가 지금 표면을 덮으면 그대로, 아니면 배경 스위치를
/// 전부 끈 사본.
pub async fn effective(
    db: &Db,
    project_id: u32,
    config: OculpmConfig,
    root: &Path,
) -> OculpmConfig {
    if requested(&config).is_empty() || granted(db, project_id, &config, root).await {
        config
    } else {
        masked(&config)
    }
}

/// 배경 모델 1회 시드(D2)가 필요한가 — 화해·초안 스위치가 켜져 있고 **이 기기가
/// 허락했을 때만**. 동의 전의 시드는 저장소 설정이 내 대화 모델을 배경 슬롯에
/// 꽂게 하는 길이었다 (외부 보안 피드백 #1 — "모델 미설정이면 조용히 스킵" 우회).
pub async fn seed_wanted(db: &Db, project_id: u32, config: &OculpmConfig, root: &Path) -> bool {
    (config.agents.auto_reconcile || config.agents.auto_journal_draft)
        && granted(db, project_id, config, root).await
}

/// 확인 카드가 그리는 것.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct AutomationConsent {
    /// 디스크 설정이 켜 둔 배경 스위치 (`agents.auto_reconcile` 꼴).
    pub requested: Vec<String>,
    /// 이 기기의 동의가 지금 디스크의 표면을 덮는가.
    pub granted: bool,
    /// 동의 뒤에 새로 켜지거나 바뀐 정의의 제목 — 카드가 "무엇이 바뀌었나" 를 말한다.
    pub changed: Vec<String>,
}

impl AutomationConsent {
    /// 묻을 것이 있는가 — 켜 둔 스위치가 있는데 아직 허락하지 않았다.
    pub fn pending(&self) -> bool {
        !self.requested.is_empty() && !self.granted
    }
}

pub async fn status(
    db: &Db,
    project_id: u32,
    config: &OculpmConfig,
    root: &Path,
) -> AutomationConsent {
    let surface = surface(config, root);
    let approval = approval(db, project_id).await;
    let granted = match &surface {
        None => false,
        Some(s) if *s == Surface::default() => true,
        Some(s) => approval.as_ref().is_some_and(|a| a.covers(s)),
    };
    // 처음 묻는 것이면 정의 목록은 비운다 — 카드는 스위치만 말한다.
    let changed = match (&surface, &approval) {
        (Some(s), Some(a)) => a.uncovered_defs(s),
        _ => Vec::new(),
    };
    AutomationConsent {
        requested: requested(config),
        granted,
        changed,
    }
}

#[cfg(test)]
#[path = "consent_tests.rs"]
mod tests;
