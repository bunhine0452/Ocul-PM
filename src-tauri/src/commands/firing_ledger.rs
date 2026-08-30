//! AD-1 — 발동 원장 커맨드 (thin). 로직은 `oculpm::firing_ledger` 소유.
//!
//! 커맨드는 둘이다: 증분 스캔(`firing_rescan`)과 창 조회(`firing_stats`).
//! 파일을 쓰는 경로는 없다 — transcript 는 읽기 전용이고, 결과는 파생 캐시
//! (SQLite)에만 남는다.

use std::path::PathBuf;

use chrono::{Duration, Local};
use serde::Serialize;
use tauri::State;

use crate::db::Db;
use crate::oculpm::firing_ledger::{self, FiringStat, KIND_RULE};

async fn project_root(db: &Db, project_id: u32) -> Result<PathBuf, String> {
    let project = db
        .get_project(project_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(PathBuf::from(project.root_path))
}

/// specta 는 u64 노출을 금지한다 — 바이트는 u32 로 좁혀 내보낸다.
/// 실측 규모(세션당 ~90KB · 창당 수십 MB)에서 상한에 닿지 않는다.
fn saturating_u32(v: u64) -> u32 {
    u32::try_from(v).unwrap_or(u32::MAX)
}

fn home_dir() -> Result<PathBuf, String> {
    directories::BaseDirs::new()
        .map(|b| b.home_dir().to_path_buf())
        .ok_or_else(|| "Could not find the home directory".to_string())
}

/// 한 번의 증분 스캔 결과.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct FiringScanReport {
    /// 이번에 새로 읽은 파일 수 (변화 없는 파일은 세지 않는다).
    pub files_scanned: u32,
    /// 이번에 새로 적재한 집계 행 수.
    pub rows_written: u32,
    /// transcript 폴더를 못 찾았다 (Claude Code 사용 이력 없음 등).
    pub no_transcripts: bool,
    /// false 면 예산이 동나 남은 분량이 있다 — 다시 부르면 이어 간다.
    pub complete: bool,
}

/// 프로젝트별 스캔 직렬화. 훅이 탭 전환마다 재마운트되어(규칙 탭·스킬 탭이
/// 각자 `useFiringLedger` 를 쓴다) 스캔 둘이 같은 재개점에서 동시에 돌던 것을
/// 막는다 — 둘째는 첫째가 끝난 뒤 새 재개점을 읽으므로 읽을 것이 없다.
/// (DB 쪽 CAS 가 마지막 그물이지만, 파일을 두 번 읽는 낭비까지는 못 막는다.)
fn scan_lock(project_id: u32) -> std::sync::Arc<tokio::sync::Mutex<()>> {
    static LOCKS: std::sync::LazyLock<
        std::sync::Mutex<std::collections::HashMap<u32, std::sync::Arc<tokio::sync::Mutex<()>>>>,
    > = std::sync::LazyLock::new(Default::default);
    let mut map = LOCKS.lock().unwrap_or_else(|p| p.into_inner());
    map.entry(project_id).or_default().clone()
}

/// 한 라운드 스캔 — `firing_rescan`·`firing_rebuild` 가 공유한다. 호출자가
/// 프로젝트 스캔 락을 쥔 채 부른다.
async fn rescan_once(db: &Db, project_id: u32) -> Result<FiringScanReport, String> {
    let root = project_root(db, project_id).await?;
    let home = home_dir()?;
    let resume: std::collections::HashMap<String, u64> = db
        .firing_scan_points(project_id)
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .collect();

    // 파일 I/O 와 JSON 파싱은 blocking — 런타임 워커를 붙잡지 않는다.
    let scan = tokio::task::spawn_blocking(move || {
        let dirs = firing_ledger::transcript_dirs(&home, &root);
        if dirs.is_empty() {
            return (Vec::new(), true, true);
        }
        let targets =
            firing_ledger::enumerate_targets(&dirs, |f| resume.get(f).copied().unwrap_or(0));
        let (scanned, complete) = firing_ledger::scan_targets(targets);
        (scanned, complete, false)
    })
    .await
    .map_err(|e| format!("Scan task failed: {e}"))?;

    let (scanned, complete, no_transcripts) = scan;
    let mut rows_written = 0u32;
    let mut files_scanned = 0u32;
    for file in scanned {
        let n = file.rows.len() as u32;
        let rows = file
            .rows
            .into_iter()
            .map(|r| (r.kind.to_string(), r.key, r.workday, r.count, r.bytes))
            .collect();
        let applied = db
            .firing_apply_scan(
                project_id,
                file.session_file,
                file.started_at,
                file.reset,
                file.bytes_consumed,
                rows,
            )
            .await
            .map_err(|e| e.to_string())?;
        if applied {
            files_scanned += 1;
            rows_written += n;
        }
    }

    Ok(FiringScanReport {
        files_scanned,
        rows_written,
        no_transcripts,
        complete,
    })
}

/// transcript 를 증분 스캔해 발동 원장을 갱신한다. 첫 호출은 누적 이력을
/// 전부 읽으므로 오래 걸릴 수 있고, 예산을 넘기면 `complete=false` 로
/// 끊어 돌려준다 (호출자가 반복 호출로 마저 채운다).
#[tauri::command]
#[specta::specta]
pub async fn firing_rescan(db: State<'_, Db>, project_id: u32) -> Result<FiringScanReport, String> {
    let lock = scan_lock(project_id);
    let _guard = lock.lock().await;
    rescan_once(&db, project_id).await
}

/// 원장을 비우고 처음부터 다시 센다 — 이중 집계·낡은 재개점을 되돌리는 유일한
/// 길. 예산 라운드를 여기서 이어 붙여 한 번의 호출로 끝낸다 (상한 20 라운드 —
/// 라운드당 96MB 이니 이 저장소 실측 293MB 도 넉넉하다).
#[tauri::command]
#[specta::specta]
pub async fn firing_rebuild(
    db: State<'_, Db>,
    project_id: u32,
) -> Result<FiringScanReport, String> {
    const MAX_ROUNDS: usize = 20;
    let lock = scan_lock(project_id);
    let _guard = lock.lock().await;
    db.firing_clear(project_id)
        .await
        .map_err(|e| e.to_string())?;
    let mut total = FiringScanReport {
        files_scanned: 0,
        rows_written: 0,
        no_transcripts: false,
        complete: false,
    };
    for _ in 0..MAX_ROUNDS {
        let round = rescan_once(&db, project_id).await?;
        total.files_scanned += round.files_scanned;
        total.rows_written += round.rows_written;
        total.no_transcripts = round.no_transcripts;
        total.complete = round.complete;
        if round.complete || round.no_transcripts {
            break;
        }
    }
    Ok(total)
}

/// 발동 통계 창 조회 결과.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct FiringOverview {
    pub stats: Vec<FiringStat>,
    /// 조회 창 (workday, 포함 양끝).
    pub since: String,
    pub until: String,
    /// 창 안에서 발동이 관측된 세션 수.
    pub sessions: u32,
    /// 세션 1건당 규칙 주입 바이트 (컨텍스트 예산 바의 값).
    pub bytes_per_session: u32,
    /// 마지막 스캔 시각 (unix). None = 한 번도 안 돌았다.
    pub last_scan_at: Option<u32>,
}

/// 최근 `days` 일 창의 발동 통계. 스캔은 하지 않는다 — 순수 조회다.
#[tauri::command]
#[specta::specta]
pub async fn firing_stats(
    db: State<'_, Db>,
    project_id: u32,
    days: u32,
) -> Result<FiringOverview, String> {
    let root = project_root(&db, project_id).await?;
    let home = home_dir()?;
    let today = Local::now().date_naive();
    let until = today.format("%Y%m%d").to_string();
    let since = (today - Duration::days(days.max(1) as i64 - 1))
        .format("%Y%m%d")
        .to_string();

    let aggregates = db
        .firing_aggregates(project_id, since.clone(), until.clone())
        .await
        .map_err(|e| e.to_string())?;
    let sessions = db
        .firing_session_count(project_id, since.clone(), until.clone())
        .await
        .map_err(|e| e.to_string())?;
    let last_scan_at = db
        .firing_last_scan_at(project_id)
        .await
        .map_err(|e| e.to_string())?;

    let rule_bytes: u64 = aggregates
        .iter()
        .filter(|a| a.kind == KIND_RULE)
        .map(|a| a.bytes)
        .sum();
    let stats = aggregates
        .into_iter()
        .map(|a| {
            let label = if a.kind == KIND_RULE {
                firing_ledger::rule_label(&a.key, &home, &root)
            } else {
                a.key.clone()
            };
            FiringStat {
                kind: a.kind,
                key: a.key,
                label,
                count: a.count,
                bytes: saturating_u32(a.bytes),
                sessions: a.sessions,
                last_workday: a.last_workday,
            }
        })
        .collect();

    Ok(FiringOverview {
        stats,
        since,
        until,
        sessions,
        bytes_per_session: if sessions == 0 {
            0
        } else {
            saturating_u32(rule_bytes / sessions as u64)
        },
        last_scan_at,
    })
}
