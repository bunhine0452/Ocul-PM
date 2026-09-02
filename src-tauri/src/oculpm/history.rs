//! 로컬 히스토리 — 파일 한 판(版)씩 (docs/20260902_vscode-borrows/06-local-history.md).
//!
//! VS Code 의 로컬 히스토리는 "내가 저장할 때마다 판을 남긴다" 다. 이 앱에서
//! 파일을 고치는 것은 **주로 에이전트**라, 같은 기계가 다른 질문에 답한다:
//! *이 파일이 오늘 어떻게 여기까지 왔나 — 누가(사람/에이전트), 언제, 무엇을
//! 바꿔서.* git 은 커밋 사이를 못 보고, 일지는 일지를 쓴 작업 단위만 알고,
//! `file_snapshots` 는 경로당 한 장뿐이다. 그 사이를 이 모듈이 메운다.
//!
//! ## 어디에 — `.oculpm/index/history/`
//!
//! [`crate::oculpm::entry_diffs`] 의 선례를 그대로 따른다: `.oculpm/index/` 는
//! 워처가 자기 억제하고(쓰기가 다시 이벤트를 만들지 않는다), `.gitignore` 에
//! 들어 있고, SQLite 캐시와 달리 마크다운에서 재생성되지 않는다(캐시를 지워도
//! 살아남는다).
//!
//! ```text
//! .oculpm/index/history/
//!   <ab>/                        # blake3(rel_path) 앞 2글자 — 한 디렉터리에 수천 개를 안 넣는다
//!     <abcdef…16>/               # blake3(rel_path) 앞 16글자
//!       meta.json                # { path, entries: [{ ts_ms, hash, bytes, source, op }] }
//!       1756800000123-9f2a1c4d.snap   # 그 시점의 파일 내용 (원문 그대로)
//! ```
//!
//! `meta.json` 에 `path` 를 적어 두므로 해시 → 경로 역방향이 성립한다
//! (디렉터리 이름만으로는 안 된다). **SQLite 테이블은 만들지 않는다** — v1 의
//! 질문은 전부 "이 파일 하나" 라 그 파일의 `meta.json` 한 장이면 답이 나온다.
//!
//! ## 무엇을 — 전문 스냅샷
//!
//! 패치가 아니라 파일 전문이다. 어느 판이든 O(1)로 열 수 있고, 사슬 중간이
//! 깨져도 나머지가 산다. 압축하지 않는다 — 256KB × 50 = 파일당 최대 12.8MB 로
//! 캡이 이미 작다.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use specta::Type;

/// 사이드카 스키마 판. 읽는 쪽이 미래 모양을 거절할 수 있게 적어 둔다.
const SCHEMA_VERSION: u32 = 1;

/// 이보다 큰 파일은 아예 안 남긴다 (상수, 설정 아님 — VS Code 기본값과 같다).
pub const MAX_SNAPSHOT_BYTES: u64 = 256 * 1024;

/// 파일당 최대 판 수의 기본값 (설정 `code_local_history_max_entries`).
pub const DEFAULT_MAX_ENTRIES: usize = 50;

/// 병합 창 — 이 안에 들어온 **같은 source** 의 판은 직전 판을 교체한다.
pub const MERGE_WINDOW_MS: i64 = 10_000;

/// 프로젝트 총량 상한. 넘으면 오래된 판부터 정리한다.
pub const PROJECT_BUDGET_BYTES: u64 = 512 * 1024 * 1024;

/// 전역 정리를 몇 번의 캡처마다 한 번 돌릴지. 매번 디렉터리를 걷지 않는다.
const SWEEP_EVERY: u64 = 50;

/// 바이너리 판정 프로브 — 인덱서와 같은 휴리스틱(선두 8KB 에 NUL).
const BINARY_PROBE_BYTES: usize = 8192;

/// `code_write` 자기 기록의 유효 시간. 이 안에 같은 해시가 워처로 돌아오면
/// 사람이 저장한 것이다.
const SELF_WRITE_TTL: Duration = Duration::from_secs(5);

/// 이 판을 만든 손. 자동 저장이 켜지면 사람 저장이 초 단위로 쌓이므로 병합이
/// 필요하고, 반대로 **내 저장 직후의 에이전트 쓰기는 절대 병합하면 안 된다** —
/// 그 경계가 바로 사용자가 보고 싶어 하는 지점이다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum HistorySource {
    User,
    Agent,
}

/// 그 판이 만들어진 이유. `create` 는 **우리가 처음 본 판**이라는 뜻이다 —
/// 히스토리를 켜기 전부터 있던 파일의 첫 판은 워처가 준 op 를 그대로 믿는다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum HistoryOp {
    Create,
    Update,
}

/// 한 판. `ts_ms` 가 그 판의 신원이다 (읽기·되돌리기 인자).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HistoryEntry {
    /// 판의 신원 겸 정렬 키 (epoch ms).
    pub ts_ms: i64,
    /// blake3 hex (접두어 없음).
    pub hash: String,
    pub bytes: u32,
    pub source: HistorySource,
    pub op: HistoryOp,
}

/// 디스크의 `meta.json` 모양. `entries` 는 **오래된 → 최신** 순서다.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct HistoryMeta {
    schema_version: u32,
    path: String,
    entries: Vec<HistoryEntry>,
}

impl HistoryMeta {
    fn empty(path: &str) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            path: path.to_string(),
            entries: Vec::new(),
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 레이아웃 (순수)
// ─────────────────────────────────────────────────────────────────────────────

/// 프로젝트의 히스토리 뿌리.
pub fn history_root(root: &Path) -> PathBuf {
    root.join(".oculpm").join("index").join("history")
}

/// 경로 키 — blake3 hex. 앞 2글자가 샤드, 앞 16글자가 파일 디렉터리다.
pub fn key_for(rel_path: &str) -> String {
    blake3::hash(rel_path.as_bytes()).to_hex().to_string()
}

/// 이 파일의 히스토리 디렉터리.
pub fn dir_for(root: &Path, rel_path: &str) -> PathBuf {
    let key = key_for(rel_path);
    history_root(root).join(&key[..2]).join(&key[..16])
}

/// 스냅샷 파일 이름. `ts_ms` 로 정렬이 되고 해시 앞 8자로 같은 밀리초의 충돌을
/// 가른다 (같은 해시는 애초에 두 번 안 남는다).
fn snap_name(entry: &HistoryEntry) -> String {
    let short = &entry.hash[..entry.hash.len().min(8)];
    format!("{}-{}.snap", entry.ts_ms, short)
}

/// 선두 8KB 에 NUL 이 있으면 바이너리로 본다 (인덱서와 같은 휴리스틱).
/// 이미지 판을 50장 쌓지 않기 위한 문지기다.
pub fn looks_binary(bytes: &[u8]) -> bool {
    bytes[..bytes.len().min(BINARY_PROBE_BYTES)].contains(&0)
}

/// 이 경로를 히스토리에 남길 것인가 (순수).
///
/// `.oculpm/` 은 우리 인프라라 자기 자신을 찍지 않고, `.git/` 은 이미 판을
/// 갖고 있다. `.env*` 는 보통 gitignore 라 워처를 못 지나지만 지나는 경우가
/// 있어 **여기서 한 번 더 막는다** — 스냅샷은 되돌리기용이라 원문이어야 하므로
/// [`crate::oculpm::redact`] 를 적용할 수 없고, 그러면 남기지 않는 것이 답이다.
pub fn should_capture(rel_path: &str) -> bool {
    if rel_path.is_empty() || rel_path.contains("..") || rel_path.starts_with('/') {
        return false;
    }
    if rel_path.starts_with(".oculpm/") || rel_path.starts_with(".git/") {
        return false;
    }
    let name = rel_path.rsplit('/').next().unwrap_or(rel_path);
    if name == ".env" || name.starts_with(".env.") {
        return false;
    }
    true
}

// ─────────────────────────────────────────────────────────────────────────────
// 보존 판단 (순수)
// ─────────────────────────────────────────────────────────────────────────────

/// [`decide_capture`] 의 답.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CaptureDecision {
    /// 남기지 않는다 — 내용이 직전 판과 같거나, 보존 상한이 0이다.
    Skip,
    /// 남긴다. `entries` 가 새 `meta.json` 의 목록이고, `evicted` 의 스냅샷
    /// 파일은 지운다.
    Keep {
        entries: Vec<HistoryEntry>,
        evicted: Vec<HistoryEntry>,
    },
}

/// 새 판 하나를 기존 목록에 어떻게 얹을지 정한다. IO 를 하지 않는다 — 보존
/// 정책 전체가 여기 한 함수에 있고, 그래서 단위 테스트가 가능하다.
///
/// 순서: ① 직전 판과 내용이 같으면 버린다 → ② 같은 손이 병합 창 안에 다시
/// 썼으면 직전 판을 **교체**한다 → ③ 상한을 넘으면 가장 오래된 것부터 뺀다.
pub fn decide_capture(
    existing: &[HistoryEntry],
    next: HistoryEntry,
    max_entries: usize,
    merge_window_ms: i64,
) -> CaptureDecision {
    if max_entries == 0 {
        return CaptureDecision::Skip;
    }
    if existing.last().is_some_and(|last| last.hash == next.hash) {
        return CaptureDecision::Skip;
    }

    let mut entries = existing.to_vec();
    let mut evicted = Vec::new();

    let merges = entries.last().is_some_and(|last| {
        last.source == next.source
            && next.ts_ms >= last.ts_ms
            && next.ts_ms - last.ts_ms <= merge_window_ms
    });
    if merges {
        let old = entries.pop().expect("merges implies a last entry");
        // 파일이 생긴 순간은 병합해도 잃지 않는다 — create 는 한 번뿐이다.
        let op = if old.op == HistoryOp::Create {
            HistoryOp::Create
        } else {
            next.op
        };
        entries.push(HistoryEntry { op, ..next });
        evicted.push(old);
    } else {
        entries.push(next);
    }

    while entries.len() > max_entries {
        evicted.push(entries.remove(0));
    }
    CaptureDecision::Keep { entries, evicted }
}

/// 프로젝트 총량이 예산을 넘을 때 지울 판을 고른다 (순수).
///
/// 입력은 `(파일 키, 판)` 쌍 전부. **파일마다 최신 한 판은 남긴다** — 예산
/// 때문에 어떤 파일의 히스토리가 통째로 비는 것보다, 모든 파일이 마지막 한
/// 판을 갖는 편이 이 기능의 질문에 덜 나쁜 답이다. 그래도 예산에 못 들면
/// 거기서 멈춘다 (지울 수 있는 것을 다 지운 뒤에도 넘으면 그냥 넘는다).
pub fn plan_budget_eviction(all: &[(String, HistoryEntry)], budget: u64) -> Vec<(String, i64)> {
    let mut total: u64 = all.iter().map(|(_, e)| u64::from(e.bytes)).sum();
    if total <= budget {
        return Vec::new();
    }
    let mut remaining: HashMap<&str, usize> = HashMap::new();
    for (key, _) in all {
        *remaining.entry(key.as_str()).or_insert(0) += 1;
    }

    let mut order: Vec<&(String, HistoryEntry)> = all.iter().collect();
    order.sort_by_key(|(key, e)| (e.ts_ms, key.clone()));

    let mut out = Vec::new();
    for (key, entry) in order {
        if total <= budget {
            break;
        }
        let left = remaining.get_mut(key.as_str()).expect("counted above");
        if *left <= 1 {
            continue;
        }
        *left -= 1;
        total = total.saturating_sub(u64::from(entry.bytes));
        out.push((key.clone(), entry.ts_ms));
    }
    out
}

// ─────────────────────────────────────────────────────────────────────────────
// 출처 판정 — 사람이 썼나, 에이전트가 썼나
// ─────────────────────────────────────────────────────────────────────────────

/// `code_write` 가 방금 쓴 것을 잠깐 기억한다. 워처는 사람이 쓰든 에이전트가
/// 쓰든 **같은 이벤트**를 보므로, 출처를 아는 유일한 길이 이 쪽지다.
///
/// TTL 안에 해시가 맞으면 `User`, 아니면 `Agent`. (에디터 저장과 에이전트
/// 쓰기가 5초 안에 같은 해시를 만드는 경우 = 내용이 같다 = 어차피 중복
/// 캡처로 걸러진다.)
#[derive(Default)]
pub struct HistoryState {
    recent: Mutex<HashMap<(u32, String), (String, Instant)>>,
}

impl HistoryState {
    /// `code_write` / 되돌리기 성공 직후에 부른다.
    pub fn note_self_write(&self, project_id: u32, rel_path: &str, hash: &str) {
        let Ok(mut map) = self.recent.lock() else {
            return;
        };
        map.retain(|_, (_, at)| at.elapsed() < SELF_WRITE_TTL);
        map.insert(
            (project_id, rel_path.to_string()),
            (normalize_hash(hash).to_string(), Instant::now()),
        );
    }

    /// 워처가 소비한다 — 한 번 읽으면 지운다 (같은 쪽지가 다음 에이전트 쓰기를
    /// 사람으로 둔갑시키지 않게).
    pub fn take_source(&self, project_id: u32, rel_path: &str, hash: &str) -> HistorySource {
        let Ok(mut map) = self.recent.lock() else {
            return HistorySource::Agent;
        };
        map.retain(|_, (_, at)| at.elapsed() < SELF_WRITE_TTL);
        let key = (project_id, rel_path.to_string());
        match map.get(&key) {
            Some((h, _)) if h == normalize_hash(hash) => {
                map.remove(&key);
                HistorySource::User
            }
            _ => HistorySource::Agent,
        }
    }
}

/// 워처는 `blake3:<hex>`, `code_write` 는 `<hex>` 를 준다.
fn normalize_hash(hash: &str) -> &str {
    hash.strip_prefix("blake3:").unwrap_or(hash)
}

// ─────────────────────────────────────────────────────────────────────────────
// IO
// ─────────────────────────────────────────────────────────────────────────────

fn read_meta(dir: &Path, rel_path: &str) -> HistoryMeta {
    let Ok(bytes) = std::fs::read(dir.join("meta.json")) else {
        return HistoryMeta::empty(rel_path);
    };
    match serde_json::from_slice::<HistoryMeta>(&bytes) {
        Ok(m) if m.schema_version == SCHEMA_VERSION => m,
        _ => HistoryMeta::empty(rel_path),
    }
}

/// tmp → rename 통째 교체. 작아서 비용이 없고, 보존 정책 적용이 곧 이 파일의
/// 재작성이다.
fn write_meta(dir: &Path, meta: &HistoryMeta) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let json = serde_json::to_vec_pretty(meta)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    let tmp = dir.join("meta.json.tmp");
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, dir.join("meta.json"))
}

/// 캡처 결과 — 호출자가 로그로 구분할 수 있게.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureOutcome {
    /// 판이 하나 늘었거나 병합으로 갈렸다.
    Captured,
    /// 정책이 막았다 (중복·상한 0·크기 초과·바이너리·제외 경로·파일 없음).
    Skipped,
}

/// 한 판을 남긴다. 동기 IO 라 `spawn_blocking` 안에서 부른다.
///
/// `expected_hash` 는 워처가 이미 계산해 둔 해시다 — 파일을 읽기 **전에**
/// 중복을 걸러 IO 를 아낀다. 실제로 기록하는 해시는 읽은 바이트에서 다시
/// 계산한다(그 사이 파일이 또 바뀌었을 수 있다).
pub fn capture(
    root: &Path,
    rel_path: &str,
    op: HistoryOp,
    source: HistorySource,
    expected_hash: Option<&str>,
    max_entries: usize,
) -> std::io::Result<CaptureOutcome> {
    if !should_capture(rel_path) || max_entries == 0 {
        return Ok(CaptureOutcome::Skipped);
    }
    let dir = dir_for(root, rel_path);
    let meta = read_meta(&dir, rel_path);

    // 워처의 해시로 먼저 거른다 — 여기서 걸리면 파일을 읽지도 않는다.
    if let Some(h) = expected_hash {
        if meta
            .entries
            .last()
            .is_some_and(|last| last.hash == normalize_hash(h))
        {
            return Ok(CaptureOutcome::Skipped);
        }
    }

    let full = root.join(rel_path);
    let Ok(file_meta) = std::fs::metadata(&full) else {
        return Ok(CaptureOutcome::Skipped);
    };
    if !file_meta.is_file() || file_meta.len() > MAX_SNAPSHOT_BYTES {
        return Ok(CaptureOutcome::Skipped);
    }
    let Ok(bytes) = std::fs::read(&full) else {
        return Ok(CaptureOutcome::Skipped);
    };
    if looks_binary(&bytes) {
        return Ok(CaptureOutcome::Skipped);
    }

    // 이미 판이 있으면 이건 create 일 수 없다. macOS 의 원자적 저장은
    // rename 이라 기존 파일의 저장도 Create 이벤트로 온다 — 그 거짓말을
    // 여기서 되돌린다.
    let op = if meta.entries.is_empty() {
        op
    } else {
        HistoryOp::Update
    };
    let next = HistoryEntry {
        ts_ms: chrono::Utc::now().timestamp_millis(),
        hash: blake3::hash(&bytes).to_hex().to_string(),
        bytes: u32::try_from(bytes.len()).unwrap_or(u32::MAX),
        source,
        op,
    };

    let (entries, evicted) =
        match decide_capture(&meta.entries, next.clone(), max_entries, MERGE_WINDOW_MS) {
            CaptureDecision::Skip => return Ok(CaptureOutcome::Skipped),
            CaptureDecision::Keep { entries, evicted } => (entries, evicted),
        };

    std::fs::create_dir_all(&dir)?;
    // 스냅샷을 먼저 쓴다 — meta 가 없는 스냅샷은 다음 정리가 걷어 가지만,
    // 스냅샷이 없는 meta 행은 사용자에게 "그 판이 정리됐습니다" 로 보인다.
    std::fs::write(dir.join(snap_name(&next)), &bytes)?;
    write_meta(
        &dir,
        &HistoryMeta {
            schema_version: SCHEMA_VERSION,
            path: rel_path.to_string(),
            entries,
        },
    )?;
    for old in &evicted {
        let _ = std::fs::remove_file(dir.join(snap_name(old)));
    }

    maybe_sweep(root);
    Ok(CaptureOutcome::Captured)
}

/// 캡처 횟수 — [`SWEEP_EVERY`] 번마다 한 번 전역 정리를 돌린다.
static CAPTURES: AtomicU64 = AtomicU64::new(0);

fn maybe_sweep(root: &Path) {
    let n = CAPTURES.fetch_add(1, Ordering::Relaxed);
    if n % SWEEP_EVERY == SWEEP_EVERY - 1 {
        let _ = enforce_budget(root, PROJECT_BUDGET_BYTES);
    }
}

/// 이 파일의 판 목록 — **최신순**. 없으면 빈 배열(오류 아님).
pub fn list(root: &Path, rel_path: &str) -> Vec<HistoryEntry> {
    let dir = dir_for(root, rel_path);
    let mut entries = read_meta(&dir, rel_path).entries;
    entries.reverse();
    entries
}

/// 그 판의 내용. meta 에 없거나 스냅샷 파일이 사라졌으면 `None`.
pub fn read_snapshot(root: &Path, rel_path: &str, ts_ms: i64) -> Option<Vec<u8>> {
    let dir = dir_for(root, rel_path);
    let meta = read_meta(&dir, rel_path);
    let entry = meta.entries.iter().find(|e| e.ts_ms == ts_ms)?;
    std::fs::read(dir.join(snap_name(entry))).ok()
}

/// 이 파일의 판 전부 삭제 (사용자 요청 · 민감 파일).
pub fn forget(root: &Path, rel_path: &str) -> std::io::Result<()> {
    let dir = dir_for(root, rel_path);
    if dir.exists() {
        std::fs::remove_dir_all(&dir)?;
    }
    Ok(())
}

/// 프로젝트의 히스토리 전부 삭제.
pub fn clear_all(root: &Path) -> std::io::Result<()> {
    let dir = history_root(root);
    if dir.exists() {
        std::fs::remove_dir_all(&dir)?;
    }
    Ok(())
}

/// 지금 쓰는 용량 (스냅샷 + meta). 보이지 않는 곳에서 디스크를 먹는 기능은
/// 반드시 자기 크기를 보여 줘야 한다.
pub fn usage_bytes(root: &Path) -> u64 {
    let mut total = 0u64;
    for (dir, _) in walk_history(root) {
        let Ok(rd) = std::fs::read_dir(&dir) else {
            continue;
        };
        for e in rd.flatten() {
            if let Ok(m) = e.metadata() {
                total = total.saturating_add(m.len());
            }
        }
    }
    total
}

/// 이름이 바뀐 파일의 판을 따라 옮긴다. `from_rel` 이 디렉터리면 그 아래
/// 모든 파일의 판을 함께 옮긴다 (meta 에 경로가 적혀 있어 가능하다).
///
/// 워처는 rename 을 경로별 Delete + Create 로 흘려보내 둘을 잇지 못한다 —
/// 그래서 이 갱신은 `code_rename` 커맨드가 부른다. 앱 밖(터미널 `mv`)의
/// 이름 바꾸기는 이 다리가 없어 판이 옛 경로에 남는다.
pub fn rename(root: &Path, from_rel: &str, to_rel: &str) -> std::io::Result<()> {
    let from_prefix = format!("{}/", from_rel.trim_end_matches('/'));
    for (dir, meta) in walk_history(root) {
        let next_path = if meta.path == from_rel {
            to_rel.to_string()
        } else if let Some(rest) = meta.path.strip_prefix(&from_prefix) {
            format!("{}/{}", to_rel.trim_end_matches('/'), rest)
        } else {
            continue;
        };
        let target = dir_for(root, &next_path);
        if target == dir {
            continue;
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        // 대상 자리에 옛 판이 있으면(같은 이름의 파일이 전에 있었다) 그 쪽을
        // 버린다 — 지금 파일의 역사가 정본이다.
        if target.exists() {
            std::fs::remove_dir_all(&target)?;
        }
        std::fs::rename(&dir, &target)?;
        let mut moved = meta;
        moved.path = next_path;
        write_meta(&target, &moved)?;
    }
    Ok(())
}

/// 프로젝트 총량 상한을 적용한다. 지운 바이트 수를 돌려준다.
pub fn enforce_budget(root: &Path, budget: u64) -> u64 {
    let dirs: Vec<(PathBuf, HistoryMeta)> = walk_history(root);
    let mut by_key: HashMap<String, (PathBuf, HistoryMeta)> = HashMap::new();
    let mut all: Vec<(String, HistoryEntry)> = Vec::new();
    for (dir, meta) in dirs {
        let key = dir.to_string_lossy().to_string();
        for e in &meta.entries {
            all.push((key.clone(), e.clone()));
        }
        by_key.insert(key, (dir, meta));
    }

    let plan = plan_budget_eviction(&all, budget);
    if plan.is_empty() {
        return 0;
    }
    let mut freed = 0u64;
    let mut drop_by_key: HashMap<String, Vec<i64>> = HashMap::new();
    for (key, ts) in plan {
        drop_by_key.entry(key).or_default().push(ts);
    }
    for (key, tss) in drop_by_key {
        let Some((dir, meta)) = by_key.get_mut(&key) else {
            continue;
        };
        let (dropped, kept): (Vec<_>, Vec<_>) = meta
            .entries
            .iter()
            .cloned()
            .partition(|e| tss.contains(&e.ts_ms));
        for e in &dropped {
            freed = freed.saturating_add(u64::from(e.bytes));
            let _ = std::fs::remove_file(dir.join(snap_name(e)));
        }
        meta.entries = kept;
        let _ = write_meta(dir, meta);
    }
    freed
}

/// 히스토리 뿌리 아래의 모든 `(디렉터리, meta)`. 두 단계 고정 깊이라 걸음이
/// 얕다 — 그래도 매 캡처마다 돌지 않는다 ([`maybe_sweep`]).
fn walk_history(root: &Path) -> Vec<(PathBuf, HistoryMeta)> {
    let mut out = Vec::new();
    let Ok(shards) = std::fs::read_dir(history_root(root)) else {
        return out;
    };
    for shard in shards.flatten() {
        let Ok(files) = std::fs::read_dir(shard.path()) else {
            continue;
        };
        for f in files.flatten() {
            let dir = f.path();
            if !dir.is_dir() {
                continue;
            }
            let Ok(bytes) = std::fs::read(dir.join("meta.json")) else {
                continue;
            };
            match serde_json::from_slice::<HistoryMeta>(&bytes) {
                Ok(m) if m.schema_version == SCHEMA_VERSION => out.push((dir, m)),
                _ => {}
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(ts_ms: i64, hash: &str, source: HistorySource) -> HistoryEntry {
        HistoryEntry {
            ts_ms,
            hash: hash.to_string(),
            bytes: 10,
            source,
            op: HistoryOp::Update,
        }
    }

    #[test]
    fn key_shards_by_the_first_two_hex_chars() {
        let key = key_for("src/main.rs");
        let dir = dir_for(Path::new("/p"), "src/main.rs");
        assert!(dir.ends_with(format!("{}/{}", &key[..2], &key[..16])));
        assert!(dir.starts_with("/p/.oculpm/index/history"));
    }

    #[test]
    fn same_content_is_never_recorded_twice() {
        let existing = vec![entry(1, "aa", HistorySource::Agent)];
        let decision = decide_capture(
            &existing,
            entry(9_000, "aa", HistorySource::User),
            50,
            MERGE_WINDOW_MS,
        );
        assert_eq!(decision, CaptureDecision::Skip);
    }

    #[test]
    fn max_entries_zero_is_off() {
        let decision = decide_capture(&[], entry(1, "aa", HistorySource::User), 0, MERGE_WINDOW_MS);
        assert_eq!(decision, CaptureDecision::Skip);
    }

    #[test]
    fn the_same_hand_inside_the_merge_window_replaces_the_previous_version() {
        let existing = vec![entry(1_000, "aa", HistorySource::User)];
        let CaptureDecision::Keep { entries, evicted } = decide_capture(
            &existing,
            entry(6_000, "bb", HistorySource::User),
            50,
            MERGE_WINDOW_MS,
        ) else {
            panic!("expected Keep");
        };
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].hash, "bb");
        assert_eq!(evicted.len(), 1);
        assert_eq!(evicted[0].hash, "aa");
    }

    #[test]
    fn a_different_hand_is_never_merged_even_inside_the_window() {
        let existing = vec![entry(1_000, "aa", HistorySource::User)];
        let CaptureDecision::Keep { entries, evicted } = decide_capture(
            &existing,
            entry(1_500, "bb", HistorySource::Agent),
            50,
            MERGE_WINDOW_MS,
        ) else {
            panic!("expected Keep");
        };
        assert_eq!(
            entries.len(),
            2,
            "그 경계가 사용자가 보고 싶어 하는 지점이다"
        );
        assert!(evicted.is_empty());
    }

    #[test]
    fn merging_keeps_the_create_op() {
        let existing = vec![HistoryEntry {
            op: HistoryOp::Create,
            ..entry(1_000, "aa", HistorySource::Agent)
        }];
        let CaptureDecision::Keep { entries, .. } = decide_capture(
            &existing,
            entry(2_000, "bb", HistorySource::Agent),
            50,
            MERGE_WINDOW_MS,
        ) else {
            panic!("expected Keep");
        };
        assert_eq!(entries[0].op, HistoryOp::Create);
    }

    #[test]
    fn the_cap_drops_the_oldest_first() {
        let existing: Vec<HistoryEntry> = (0..3)
            .map(|i| entry(i * 100_000, &format!("h{i}"), HistorySource::Agent))
            .collect();
        let CaptureDecision::Keep { entries, evicted } = decide_capture(
            &existing,
            entry(999_000, "new", HistorySource::Agent),
            3,
            MERGE_WINDOW_MS,
        ) else {
            panic!("expected Keep");
        };
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].hash, "h1");
        assert_eq!(evicted.len(), 1);
        assert_eq!(evicted[0].hash, "h0");
    }

    #[test]
    fn budget_eviction_takes_the_oldest_but_leaves_one_version_per_file() {
        let mut all = Vec::new();
        for (key, ts) in [("a", 1), ("a", 2), ("b", 3), ("b", 4)] {
            all.push((
                key.to_string(),
                HistoryEntry {
                    bytes: 100,
                    ..entry(ts, &format!("{key}{ts}"), HistorySource::Agent)
                },
            ));
        }
        // 총 400, 예산 100 → 파일마다 최신 한 판만 남는다(총 200) — 더는 못 줄인다.
        let plan = plan_budget_eviction(&all, 100);
        assert_eq!(plan.len(), 2);
        assert!(plan.contains(&("a".to_string(), 1)));
        assert!(plan.contains(&("b".to_string(), 3)));
    }

    #[test]
    fn budget_eviction_is_empty_under_budget() {
        let all = vec![("a".to_string(), entry(1, "aa", HistorySource::Agent))];
        assert!(plan_budget_eviction(&all, 1_000).is_empty());
    }

    #[test]
    fn secrets_and_our_own_infrastructure_are_never_captured() {
        assert!(should_capture("src/main.rs"));
        assert!(should_capture("config/env.ts"));
        assert!(!should_capture(".env"));
        assert!(!should_capture("apps/web/.env.local"));
        assert!(!should_capture(".oculpm/index/history/x"));
        assert!(!should_capture(".git/config"));
        assert!(!should_capture("../outside.rs"));
        assert!(!should_capture(""));
    }

    #[test]
    fn binary_probe_only_looks_at_the_head() {
        assert!(looks_binary(b"png\0\0data"));
        assert!(!looks_binary(b"fn main() {}"));
        let mut late_nul = vec![b'a'; BINARY_PROBE_BYTES + 10];
        late_nul[BINARY_PROBE_BYTES + 5] = 0;
        assert!(!looks_binary(&late_nul));
    }

    #[test]
    fn self_write_note_expires_into_agent() {
        let state = HistoryState::default();
        state.note_self_write(1, "a.ts", "blake3:abc");
        assert_eq!(state.take_source(1, "a.ts", "abc"), HistorySource::User);
        // 쪽지는 한 번만 쓰인다.
        assert_eq!(state.take_source(1, "a.ts", "abc"), HistorySource::Agent);
    }

    #[test]
    fn a_different_hash_is_the_agents_write() {
        let state = HistoryState::default();
        state.note_self_write(1, "a.ts", "abc");
        assert_eq!(state.take_source(1, "a.ts", "def"), HistorySource::Agent);
        assert_eq!(state.take_source(2, "a.ts", "abc"), HistorySource::Agent);
    }
}
