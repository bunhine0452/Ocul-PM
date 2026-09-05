//! 자동화 정의의 온디스크 저장소 (Decision 1 — SSOT 는 마크다운).
//!
//! ```text
//! .oculpm/automation/
//!   schedules/<id>.md
//!   watchers/<id>.md
//! ```
//!
//! frontmatter(설정) + 본문(모델에게 그대로 가는 지시문). SQLite 는 런타임
//! 상태만 들고(033_automation.sql), 정의는 사람이 읽고 고치고 git 에 올린다.
//!
//! # 계약
//!
//! - **fail-soft.** 어떤 입력도 패닉하지 않는다. 깨진 필드는 경고로 남고
//!   기본값으로 채워진다 (`frontmatter.rs`·`planner/parse.rs` 와 같은 결).
//! - **id 는 파일 stem 과 같다.** frontmatter 의 `id` 가 없거나 다르면 stem 이
//!   이긴다(경고). 경로 조립은 정규화된 kebab id 로만 한다 — `..` 도 `/` 도
//!   통과하지 못한다.
//! - **멱등 쓰기.** 같은 바이트면 디스크를 건드리지 않는다 (`config.rs` 선례 —
//!   같은-내용 재작성이 mtime 만 바꿔 워처를 깨운다).
//! - **의미는 여기 없다.** `frequency`·`responsiveness` 는 문자열로 실어 나르기만
//!   한다. 8빈도 해석은 Phase 1(`#schedule-frequency`), 티어 해석은
//!   Phase 2(`#responsiveness-tiers`) 의 몫이다.

#![allow(dead_code)] // 큐에 넣는 쪽(Phase 1·2)이 아직 없다 — mod.rs 참조.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_yaml::Value as YamlValue;
use specta::Type;

use crate::oculpm::atomic_io::write_atomic;
use crate::oculpm::automation::conditions::{self, AutomationCondition};
use crate::oculpm::error::OculpmError;
use crate::oculpm::frontmatter::parse_frontmatter_and_body;

/// frontmatter 의 스키마 마커. 값이 다르면 경고만 하고 계속 읽는다.
pub const SCHEMA_MARKER: &str = "oculpm_automation";
pub const SCHEMA_VERSION: &str = "v1";

/// 정의 파일 크기 상한 — 지시문은 사람이 쓰는 글이다. 넘으면 읽지 않는다
/// (실수로 로그를 붙여넣은 파일을 통째로 모델에 보내는 사고 방지).
pub const MAX_DEFINITION_BYTES: u64 = 64 * 1024;

/// 플랜 화해의 정본 id. 씨앗 정의도, 레거시 `agents.auto_reconcile` 플래그가
/// 만드는 내장 규칙도 이 id 를 쓴다 — 사용자가 씨앗을 만들면 그동안 쌓인
/// 실행 이력이 **끊기지 않고** 이어진다.
pub const BUILTIN_PLAN_RECONCILE_ID: &str = "plan-reconcile";

/// 정의 파일이 없어도 원장 행을 남길 수 있는 내장 자동화 id — 고아 정리 면제.
pub const BUILTIN_IDS: [&str; 1] = [BUILTIN_PLAN_RECONCILE_ID];

// ─────────────────────────────────────────────────────────────────────────────
// 어휘
// ─────────────────────────────────────────────────────────────────────────────

/// 자동화의 두 축 — 스케줄은 시계에, 워처는 현실에 반응한다.
///
/// 직렬화 모양은 정의 파일의 `kind:` 값과 같다 (`schedule` / `watcher`) —
/// 디스크·바인딩·UI 가 한 어휘를 쓴다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum AutomationKind {
    Schedule,
    Watcher,
}

impl AutomationKind {
    pub const ALL: [AutomationKind; 2] = [AutomationKind::Schedule, AutomationKind::Watcher];

    /// frontmatter `kind:` 값.
    pub fn as_str(self) -> &'static str {
        match self {
            AutomationKind::Schedule => "schedule",
            AutomationKind::Watcher => "watcher",
        }
    }

    /// `.oculpm/automation/` 아래 디렉터리 이름 (복수형).
    pub fn dir_name(self) -> &'static str {
        match self {
            AutomationKind::Schedule => "schedules",
            AutomationKind::Watcher => "watchers",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s.trim() {
            "schedule" => Some(AutomationKind::Schedule),
            "watcher" => Some(AutomationKind::Watcher),
            _ => None,
        }
    }
}

/// 자동화가 무엇을 남기는가.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum AutomationOutput {
    /// 규격 일지 1건.
    Journal,
    /// 활성 플랜 글리프 갱신.
    Plan,
    /// 산출물 없음 — 실행 원장의 메모로만 남는다 (아침 브리핑 카드 등).
    None,
}

impl AutomationOutput {
    pub fn as_str(self) -> &'static str {
        match self {
            AutomationOutput::Journal => "journal",
            AutomationOutput::Plan => "plan",
            AutomationOutput::None => "none",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s.trim() {
            "journal" => Some(AutomationOutput::Journal),
            "plan" => Some(AutomationOutput::Plan),
            "none" => Some(AutomationOutput::None),
            _ => None,
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 정의
// ─────────────────────────────────────────────────────────────────────────────

/// 스케줄/워처 정의 하나. 스케줄·워처 전용 필드는 서로 `None` 이다.
///
/// 커맨드 경계를 그대로 건넌다 — 에디터가 편집하는 것이 곧 디스크에 쓰이는
/// 것이고, 그 사이에 매핑 표가 없다 (D1 의 "정의가 SSOT" 를 UI 까지 밀어붙인다).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AutomationDef {
    pub id: String,
    pub kind: AutomationKind,
    pub title: String,
    pub enabled: bool,
    /// `YYYY-MM-DD`. 시각은 주입받아 채운다 (호출부 규율 — 여기서 시계를 읽지 않는다).
    pub created: String,
    pub updated: String,

    // ── schedule 전용 (해석은 Phase 1) ──
    /// `once|minutes|hourly|daily|weekly|monthly|yearly|cron`.
    pub frequency: Option<String>,
    /// `HH:MM` 또는 ISO 날짜시각(`once`).
    pub at: Option<String>,
    pub weekday: Option<String>,
    pub day_of_month: Option<u32>,
    pub month: Option<u32>,
    pub day: Option<u32>,
    /// `minutes`/`hourly` 의 N.
    pub every: Option<u32>,
    /// 5필드 cron 식.
    pub cron: Option<String>,

    // ── watcher 전용 (해석은 Phase 2) ──
    /// 프로젝트 상대 경로.
    pub watch: Option<String>,
    pub recursive: Option<bool>,
    /// `fast|balanced|patient|relaxed|deferred|extended`.
    pub responsiveness: Option<String>,

    // ── 공통 ──
    pub output: AutomationOutput,
    /// 실행 조건 ({#automation-step-if}). **빈 목록 = 조건 없음 = 항상 실행**
    /// 이라 `conditions:` 가 없는 옛 정의는 동작이 그대로다. 어휘는 닫혀 있고
    /// (`conditions::ConditionWhen`) 자유 표현식은 받지 않는다.
    pub conditions: Vec<AutomationCondition>,
    /// 본문 — 모델에게 그대로 가는 지시문.
    pub instructions: String,
}

impl AutomationDef {
    /// 최소 정의 하나. 시각은 주입받는다 (`Date.now()` 직접 호출 금지 규율의 Rust 판).
    pub fn new(
        id: impl Into<String>,
        kind: AutomationKind,
        title: impl Into<String>,
        today: &str,
    ) -> Self {
        Self {
            id: id.into(),
            kind,
            title: title.into(),
            enabled: false,
            created: today.to_string(),
            updated: today.to_string(),
            frequency: None,
            at: None,
            weekday: None,
            day_of_month: None,
            month: None,
            day: None,
            every: None,
            cron: None,
            watch: None,
            recursive: None,
            responsiveness: None,
            output: AutomationOutput::None,
            conditions: Vec::new(),
            instructions: String::new(),
        }
    }
}

/// 파서 결과 — 정의는 항상 나오고, 어긋난 것은 경고로 남는다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ParsedAutomation {
    pub def: AutomationDef,
    pub warnings: Vec<String>,
}

// ─────────────────────────────────────────────────────────────────────────────
// 경로
// ─────────────────────────────────────────────────────────────────────────────

pub fn automation_root(project_root: &Path) -> PathBuf {
    project_root.join(".oculpm").join("automation")
}

pub fn automation_dir(project_root: &Path, kind: AutomationKind) -> PathBuf {
    automation_root(project_root).join(kind.dir_name())
}

/// 정의 파일 경로. id 가 kebab 으로 정규화되지 않으면 `None` — 경로 조립은
/// 정규화를 통과한 값으로만 한다 (`..`·`/`·백슬래시가 여기서 죽는다).
pub fn automation_path(project_root: &Path, kind: AutomationKind, id: &str) -> Option<PathBuf> {
    let id = normalize_id(id)?;
    Some(automation_dir(project_root, kind).join(format!("{id}.md")))
}

/// ASCII kebab 으로 정규화. 영숫자·`-` 만 남기고 연속 `-` 는 접는다.
/// 남는 글자가 없으면 `None`.
pub fn normalize_id(raw: &str) -> Option<String> {
    let mut out = String::with_capacity(raw.len());
    let mut prev_dash = false;
    for ch in raw.trim().chars() {
        let c = ch.to_ascii_lowercase();
        if c.is_ascii_alphanumeric() {
            out.push(c);
            prev_dash = false;
        } else if !prev_dash && !out.is_empty() {
            out.push('-');
            prev_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    (!out.is_empty()).then_some(out)
}

// ─────────────────────────────────────────────────────────────────────────────
// 파싱
// ─────────────────────────────────────────────────────────────────────────────

pub(super) fn yaml_str(map: &serde_yaml::Mapping, key: &str) -> Option<String> {
    match map.get(YamlValue::String(key.to_string()))? {
        YamlValue::String(s) if !s.trim().is_empty() => Some(s.trim().to_string()),
        YamlValue::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

pub(super) fn yaml_bool(map: &serde_yaml::Mapping, key: &str) -> Option<bool> {
    match map.get(YamlValue::String(key.to_string()))? {
        YamlValue::Bool(b) => Some(*b),
        YamlValue::String(s) => match s.trim() {
            "true" | "yes" => Some(true),
            "false" | "no" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

pub(super) fn yaml_u32(map: &serde_yaml::Mapping, key: &str) -> Option<u32> {
    match map.get(YamlValue::String(key.to_string()))? {
        YamlValue::Number(n) => n.as_u64().and_then(|v| u32::try_from(v).ok()),
        YamlValue::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

/// 정의 마크다운을 읽는다. `fallback_id` 는 파일 stem — frontmatter 의 `id` 가
/// 없거나 다르면 이쪽이 이긴다 (파일명이 정본이라야 경로와 id 가 갈라지지 않는다).
pub fn parse_automation(
    markdown: &str,
    fallback_id: &str,
    fallback_kind: AutomationKind,
) -> ParsedAutomation {
    let mut warnings: Vec<String> = Vec::new();
    let (pf, body) = parse_frontmatter_and_body(markdown);

    let map: serde_yaml::Mapping = if pf.raw_yaml.trim().is_empty() {
        warnings.push("frontmatter 가 없다 — 전부 기본값으로 읽는다".into());
        serde_yaml::Mapping::new()
    } else {
        match serde_yaml::from_str::<YamlValue>(&pf.raw_yaml) {
            Ok(YamlValue::Mapping(m)) => m,
            _ => {
                warnings.push("frontmatter YAML 을 읽지 못했다 — 전부 기본값".into());
                serde_yaml::Mapping::new()
            }
        }
    };

    match yaml_str(&map, SCHEMA_MARKER) {
        Some(v) if v == SCHEMA_VERSION => {}
        Some(v) => warnings.push(format!(
            "{SCHEMA_MARKER}: {v} 는 아는 버전이 아니다 (기대: {SCHEMA_VERSION})"
        )),
        None => warnings.push(format!("{SCHEMA_MARKER} 마커가 없다")),
    }

    let canonical = normalize_id(fallback_id).unwrap_or_else(|| "automation".to_string());
    if let Some(declared) = yaml_str(&map, "id") {
        if normalize_id(&declared).as_deref() != Some(canonical.as_str()) {
            warnings.push(format!(
                "frontmatter id '{declared}' 가 파일명 '{canonical}' 과 다르다 — 파일명을 쓴다"
            ));
        }
    }

    let kind = match yaml_str(&map, "kind") {
        Some(k) => match AutomationKind::parse(&k) {
            Some(parsed) if parsed == fallback_kind => parsed,
            Some(parsed) => {
                warnings.push(format!(
                    "kind '{}' 이 놓인 디렉터리('{}')와 다르다 — 디렉터리를 쓴다",
                    parsed.as_str(),
                    fallback_kind.dir_name()
                ));
                fallback_kind
            }
            None => {
                warnings.push(format!("알 수 없는 kind '{k}' — 디렉터리를 쓴다"));
                fallback_kind
            }
        },
        None => fallback_kind,
    };

    let title = yaml_str(&map, "title").unwrap_or_else(|| {
        warnings.push("title 이 없다 — id 를 쓴다".into());
        canonical.clone()
    });

    let output = match yaml_str(&map, "output") {
        Some(o) => AutomationOutput::parse(&o).unwrap_or_else(|| {
            warnings.push(format!("알 수 없는 output '{o}' — none 으로 읽는다"));
            AutomationOutput::None
        }),
        None => AutomationOutput::None,
    };

    let conditions = conditions::parse_conditions(&map, &mut warnings);

    let instructions = body.trim().to_string();
    if instructions.is_empty() {
        warnings.push("지시문 본문이 비었다 — 이 자동화는 모델에게 줄 말이 없다".into());
    }

    let def = AutomationDef {
        id: canonical,
        kind,
        title,
        enabled: yaml_bool(&map, "enabled").unwrap_or(false),
        created: yaml_str(&map, "created").unwrap_or_default(),
        updated: yaml_str(&map, "updated").unwrap_or_default(),
        frequency: yaml_str(&map, "frequency"),
        at: yaml_str(&map, "at"),
        weekday: yaml_str(&map, "weekday"),
        day_of_month: yaml_u32(&map, "day_of_month"),
        month: yaml_u32(&map, "month"),
        day: yaml_u32(&map, "day"),
        every: yaml_u32(&map, "every"),
        cron: yaml_str(&map, "cron"),
        watch: yaml_str(&map, "watch"),
        recursive: yaml_bool(&map, "recursive"),
        responsiveness: yaml_str(&map, "responsiveness"),
        output,
        conditions,
        instructions,
    };
    ParsedAutomation { def, warnings }
}

// ─────────────────────────────────────────────────────────────────────────────
// 직렬화
// ─────────────────────────────────────────────────────────────────────────────

fn push_str_field(out: &mut String, key: &str, value: &str) {
    // 따옴표로 감싸 콜론·`#` 이 든 제목이 YAML 을 깨지 않게 한다.
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
    out.push_str(&format!("{key}: \"{escaped}\"\n"));
}

/// 정의 → 마크다운. [`parse_automation`] 과 왕복한다.
pub fn render_automation(def: &AutomationDef) -> String {
    let mut fm = String::new();
    fm.push_str("---\n");
    fm.push_str(&format!("{SCHEMA_MARKER}: {SCHEMA_VERSION}\n"));
    fm.push_str(&format!("id: {}\n", def.id));
    fm.push_str(&format!("kind: {}\n", def.kind.as_str()));
    push_str_field(&mut fm, "title", &def.title);
    fm.push_str(&format!("enabled: {}\n", def.enabled));
    if !def.created.is_empty() {
        fm.push_str(&format!("created: {}\n", def.created));
    }
    if !def.updated.is_empty() {
        fm.push_str(&format!("updated: {}\n", def.updated));
    }
    if let Some(v) = &def.frequency {
        fm.push_str(&format!("frequency: {v}\n"));
    }
    if let Some(v) = &def.at {
        push_str_field(&mut fm, "at", v);
    }
    if let Some(v) = &def.weekday {
        fm.push_str(&format!("weekday: {v}\n"));
    }
    if let Some(v) = def.day_of_month {
        fm.push_str(&format!("day_of_month: {v}\n"));
    }
    if let Some(v) = def.month {
        fm.push_str(&format!("month: {v}\n"));
    }
    if let Some(v) = def.day {
        fm.push_str(&format!("day: {v}\n"));
    }
    if let Some(v) = def.every {
        fm.push_str(&format!("every: {v}\n"));
    }
    if let Some(v) = &def.cron {
        push_str_field(&mut fm, "cron", v);
    }
    if let Some(v) = &def.watch {
        push_str_field(&mut fm, "watch", v);
    }
    if let Some(v) = def.recursive {
        fm.push_str(&format!("recursive: {v}\n"));
    }
    if let Some(v) = &def.responsiveness {
        fm.push_str(&format!("responsiveness: {v}\n"));
    }
    fm.push_str(&format!("output: {}\n", def.output.as_str()));
    conditions::render_conditions(&mut fm, &def.conditions);
    fm.push_str("---\n\n");
    fm.push_str(def.instructions.trim());
    fm.push('\n');
    fm
}

// ─────────────────────────────────────────────────────────────────────────────
// 파일 IO
// ─────────────────────────────────────────────────────────────────────────────

/// 한 종류의 정의를 전부 읽는다. 디렉터리가 없으면 빈 목록(오류 아님).
/// 파일 하나가 깨져도 나머지는 돌아온다 — 읽지 못한 파일은 경고 항목이 된다.
pub fn list_automations(
    project_root: &Path,
    kind: AutomationKind,
) -> Result<Vec<ParsedAutomation>, OculpmError> {
    let dir = automation_dir(project_root, kind);
    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(source) => return Err(OculpmError::Io { path: dir, source }),
    };
    let mut out: Vec<ParsedAutomation> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let Some(id) = normalize_id(stem) else {
            continue;
        };
        let too_big = std::fs::metadata(&path)
            .map(|m| m.len() > MAX_DEFINITION_BYTES)
            .unwrap_or(false);
        if too_big {
            let mut def = AutomationDef::new(&id, kind, &id, "");
            def.enabled = false;
            out.push(ParsedAutomation {
                def,
                warnings: vec![format!(
                    "정의 파일이 {MAX_DEFINITION_BYTES} 바이트를 넘는다 — 읽지 않는다"
                )],
            });
            continue;
        }
        match std::fs::read_to_string(&path) {
            Ok(md) => out.push(parse_automation(&md, &id, kind)),
            Err(e) => {
                let mut def = AutomationDef::new(&id, kind, &id, "");
                def.enabled = false;
                out.push(ParsedAutomation {
                    def,
                    warnings: vec![format!("정의 파일을 읽지 못했다: {e}")],
                });
            }
        }
    }
    out.sort_by(|a, b| a.def.id.cmp(&b.def.id));
    Ok(out)
}

/// 두 종류를 합친 id 목록 — 고아 정리([`crate::db::Db::automation_prune_orphans`])
/// 가 이 목록을 SSOT 로 쓴다. 디렉터리를 못 읽으면 `Err` 를 돌려 **정리를
/// 건너뛰게** 한다 (빈 목록으로 오해해 상태를 전부 지우면 안 된다).
pub fn list_automation_ids(project_root: &Path) -> Result<Vec<String>, OculpmError> {
    let mut ids = Vec::new();
    for kind in AutomationKind::ALL {
        for parsed in list_automations(project_root, kind)? {
            ids.push(parsed.def.id);
        }
    }
    ids.sort();
    ids.dedup();
    Ok(ids)
}

/// 고아 정리([`crate::db::Db::automation_prune_orphans`])에 넘길 id 목록 —
/// 디스크의 정의 + [`BUILTIN_IDS`]. 내장 자동화는 정의 파일 없이도 돌 수 있으므로
/// (레거시 `auto_reconcile`) 그 실행 이력을 고아로 오해해 지우면 안 된다.
pub fn known_ids_for_prune(project_root: &Path) -> Result<Vec<String>, OculpmError> {
    let mut ids = list_automation_ids(project_root)?;
    ids.extend(BUILTIN_IDS.iter().map(|s| s.to_string()));
    ids.sort();
    ids.dedup();
    Ok(ids)
}

pub fn read_automation(
    project_root: &Path,
    kind: AutomationKind,
    id: &str,
) -> Result<Option<ParsedAutomation>, OculpmError> {
    let Some(path) = automation_path(project_root, kind, id) else {
        return Ok(None);
    };
    let md = match std::fs::read_to_string(&path) {
        Ok(md) => md,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(source) => return Err(OculpmError::Io { path, source }),
    };
    let canonical = normalize_id(id).unwrap_or_else(|| id.to_string());
    Ok(Some(parse_automation(&md, &canonical, kind)))
}

/// 정의를 디스크에 쓴다. 반환값 `true` = 실제로 썼다.
/// 같은 바이트면 건드리지 않는다 (멱등 — mtime 만 바꿔 워처를 깨우지 않는다).
pub fn write_automation(project_root: &Path, def: &AutomationDef) -> Result<bool, OculpmError> {
    let Some(path) = automation_path(project_root, def.kind, &def.id) else {
        return Err(OculpmError::InvalidPath(format!(
            "automation id '{}' 가 kebab 으로 정규화되지 않는다",
            def.id
        )));
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|source| OculpmError::Io {
            path: parent.to_path_buf(),
            source,
        })?;
    }
    let text = render_automation(def);
    if let Ok(existing) = std::fs::read(&path) {
        if existing == text.as_bytes() {
            return Ok(false);
        }
    }
    write_atomic(&path, text.as_bytes())?;
    Ok(true)
}

/// 정의를 지운다. 반환값 `true` = 지울 파일이 있었다.
pub fn delete_automation(
    project_root: &Path,
    kind: AutomationKind,
    id: &str,
) -> Result<bool, OculpmError> {
    let Some(path) = automation_path(project_root, kind, id) else {
        return Ok(false);
    };
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(source) => Err(OculpmError::Io { path, source }),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 테스트
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// 테스트
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests;
