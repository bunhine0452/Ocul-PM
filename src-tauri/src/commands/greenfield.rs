//! Greenfield project creation commands (W6 / G4 — MASTER-GUIDE §4.4).
//!
//! Handles:
//! - Wizard draft (blueprint) persistence
//! - External CLI availability checks (OS-aware PATH probing)
//! - Scaffold execution (`pnpm create vite`, `cargo new`, etc.)
//! - LLM-powered initial seed goal generation
//! - Full project creation orchestration

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::State;

use crate::db::{Db, Goal, ProjectBlueprint};
use crate::llm;
use crate::oculpm::manager::OculpmManager;

// ─── Blueprint CRUD ───────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn save_blueprint(
    db: State<'_, Db>,
    id: Option<u32>,
    name: String,
    idea_text: Option<String>,
    target_users: Option<String>,
    stack_choice: Option<String>,
    folder_name: Option<String>,
    folder_path: Option<String>,
    seed_goals_json: Option<String>,
    wizard_step: u32,
) -> Result<ProjectBlueprint, String> {
    db.save_blueprint(
        id,
        name,
        idea_text,
        target_users,
        stack_choice,
        folder_name,
        folder_path,
        seed_goals_json,
        wizard_step,
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn get_blueprint(
    db: State<'_, Db>,
    blueprint_id: u32,
) -> Result<ProjectBlueprint, String> {
    db.get_blueprint(blueprint_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn list_blueprints(db: State<'_, Db>) -> Result<Vec<ProjectBlueprint>, String> {
    db.list_blueprints().await.map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn delete_blueprint(db: State<'_, Db>, blueprint_id: u32) -> Result<(), String> {
    db.delete_blueprint(blueprint_id)
        .await
        .map_err(|e| e.to_string())
}

// ─── CLI availability check ──────────────────────────────────────────

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct CliCheckResult {
    pub available: bool,
    pub cli_name: String,
    pub path: Option<String>,
    pub version: Option<String>,
}

/// Check if a CLI tool is available on the system PATH (or common install
/// locations). Returns availability, resolved path, and version string.
///
/// The check uses `which`(Unix) / `where`(Windows) followed by a
/// `--version` probe. On failure, we scan well-known install directories
/// as a fallback (e.g. `~/.cargo/bin` for `cargo`).
#[tauri::command]
#[specta::specta]
pub async fn check_cli_available(cli_name: String) -> Result<CliCheckResult, String> {
    // Try `which` / `where` first
    let which_cmd = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };

    let cli = cli_name.clone();
    let resolved_path = tokio::task::spawn_blocking(move || {
        let output = std::process::Command::new(which_cmd)
            .arg(&cli)
            .output();
        match output {
            Ok(o) if o.status.success() => {
                let stdout = String::from_utf8_lossy(&o.stdout);
                Some(stdout.lines().next().unwrap_or("").trim().to_string())
            }
            _ => find_in_common_paths(&cli),
        }
    })
    .await
    .map_err(|e| e.to_string())?;

    if let Some(ref path) = resolved_path {
        // Try to get version
        let p = path.clone();
        let version = tokio::task::spawn_blocking(move || get_cli_version_sync(&p))
            .await
            .ok()
            .flatten();
        Ok(CliCheckResult {
            available: true,
            cli_name,
            path: Some(path.clone()),
            version,
        })
    } else {
        Ok(CliCheckResult {
            available: false,
            cli_name,
            path: None,
            version: None,
        })
    }
}

/// Scan well-known install directories for the given CLI binary.
fn find_in_common_paths(cli_name: &str) -> Option<String> {
    let home = dirs_home().unwrap_or_default();
    let candidates: Vec<PathBuf> = if cfg!(target_os = "windows") {
        vec![
            home.join("AppData/Roaming/npm").join(format!("{cli_name}.cmd")),
            home.join(".cargo/bin").join(format!("{cli_name}.exe")),
            PathBuf::from("C:/Program Files/Go/bin").join(format!("{cli_name}.exe")),
        ]
    } else {
        vec![
            PathBuf::from("/usr/local/bin").join(cli_name),
            PathBuf::from("/usr/bin").join(cli_name),
            home.join(".cargo/bin").join(cli_name),
            home.join(".nvm/current/bin").join(cli_name),
            home.join(".local/bin").join(cli_name),
            PathBuf::from("/opt/homebrew/bin").join(cli_name),
        ]
    };

    for p in candidates {
        if p.exists() {
            return Some(p.to_string_lossy().to_string());
        }
    }
    None
}

fn dirs_home() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("USERPROFILE").map(PathBuf::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var_os("HOME").map(PathBuf::from)
    }
}

fn get_cli_version_sync(path: &str) -> Option<String> {
    let output = std::process::Command::new(path)
        .arg("--version")
        .output()
        .ok()?;
    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        Some(stdout.lines().next().unwrap_or("").trim().to_string())
    } else {
        None
    }
}

// ─── Scaffold execution ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct GreenfieldResult {
    pub project_id: u32,
    pub scaffold_output: Option<String>,
    pub seed_goals: Vec<Goal>,
}

/// Create a new project from the Greenfield wizard.
///
/// 1. Creates the folder (if it doesn't exist)
/// 2. Optionally runs a scaffold CLI (e.g. `pnpm create vite`)
/// 3. Registers the project in the database via `create_project`
/// 3b. (W3-PR10) Optionally initialises `.oculpm/` for the new project so
///     the user does not see the onboarding modal on first Today open.
///     Failure is **non-fatal**: the project row is already committed and
///     EmptyToday V1 provides a "활성화" recovery path.
/// 4. Cleans up the blueprint (if any)
/// 5. Returns the new project ID
#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn create_greenfield_project(
    db: State<'_, Db>,
    manager: State<'_, OculpmManager>,
    name: String,
    root_path: String,
    scaffold_cmd: Option<String>,
    scaffold_args: Option<Vec<String>>,
    blueprint_id: Option<u32>,
    init_oculpm: bool,
) -> Result<GreenfieldResult, String> {
    let target = PathBuf::from(&root_path);

    // 1. Create directory
    if !target.exists() {
        tokio::fs::create_dir_all(&target)
            .await
            .map_err(|e| format!("폴더 생성 실패: {e}"))?;
    }

    // 2. Run scaffold CLI (if specified)
    let scaffold_output = if let Some(cmd) = scaffold_cmd {
        let args = scaffold_args.unwrap_or_default();
        let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        match run_scaffold_cli(&cmd, &arg_refs, &target).await {
            Ok(output) => Some(output),
            Err(e) => {
                // Non-fatal: project folder already created, user can scaffold manually
                tracing::warn!(cmd, error = %e, "scaffold CLI failed, continuing with empty project");
                Some(format!("⚠️ 스캐폴딩 실패: {e}\n수동으로 실행해주세요."))
            }
        }
    } else {
        None
    };

    // 3. Register project in DB
    let project_id = db
        .create_project(name, root_path)
        .await
        .map_err(|e| e.to_string())?;

    // 3b. (W3-PR10) ocul-pm init — opt-in from the wizard (default ON).
    //     Failure path keeps the project alive: the user lands on
    //     EmptyToday V1 and can hit "활성화" to retry. W4 will add an
    //     `manager.sync_agents(project_id)` call here once the adapter
    //     templates exist; the wire-point is intentionally placed.
    if init_oculpm {
        if let Err(e) = manager.init_project(project_id, &target).await {
            tracing::warn!(
                project_id,
                error = %e,
                "oculpm init during greenfield failed — user can retry via EmptyToday V1"
            );
        }
    }

    // 4. Clean up blueprint
    if let Some(bp_id) = blueprint_id {
        let _ = db.delete_blueprint(bp_id).await;
    }

    Ok(GreenfieldResult {
        project_id,
        scaffold_output,
        seed_goals: vec![],
    })
}

/// Execute an external scaffold CLI command inside the target directory.
/// Captures stdout+stderr, with a 60-second timeout.
async fn run_scaffold_cli(cmd: &str, args: &[&str], cwd: &Path) -> Result<String, String> {
    let cmd = cmd.to_string();
    let args: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    let cwd = cwd.to_path_buf();

    let result = tokio::task::spawn_blocking(move || {
        use std::time::{Duration, Instant};
        let start = Instant::now();
        let timeout = Duration::from_secs(60);

        let child = std::process::Command::new(&cmd)
            .args(&args)
            .current_dir(&cwd)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn();

        match child {
            Ok(c) => match c.wait_with_output() {
                Ok(output) => {
                    if start.elapsed() > timeout {
                        Err("CLI 실행 시간 초과 (60초)".to_string())
                    } else {
                        Ok(output)
                    }
                }
                Err(e) => Err(format!("CLI 출력 대기 실패: {e}")),
            },
            Err(e) => Err(format!("CLI 실행 실패: {e}")),
        }
    })
    .await
    .map_err(|e| format!("task spawn 실패: {e}"))??;

    let stdout = String::from_utf8_lossy(&result.stdout);
    let stderr = String::from_utf8_lossy(&result.stderr);

    if result.status.success() {
        Ok(format!("{stdout}\n{stderr}").trim().to_string())
    } else {
        Err(format!(
            "CLI 종료 코드 {}: {}",
            result.status.code().unwrap_or(-1),
            stderr.trim()
        ))
    }
}

// ─── Seed goal generation (LLM) ─────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct SeedGoalPayload {
    title: String,
    description: Option<String>,
    priority: Option<i32>,
}

/// Ask the LLM to generate 3~5 initial goals for a newly created project
/// based on the user's idea and chosen tech stack. The goals are persisted
/// via `goal_create` and returned to the frontend for display in the wizard.
#[tauri::command]
#[specta::specta]
pub async fn generate_seed_goals(
    db: State<'_, Db>,
    project_id: u32,
    idea_text: String,
    stack_choice: String,
    provider: String,
    model: String,
) -> Result<Vec<Goal>, String> {
    let api_key = {
        let secret_name = format!("{provider}_api_key");
        crate::secrets::get(&secret_name)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("API key for {provider} is not set"))?
    };
    let client = llm::create(&provider, api_key).map_err(|e| e.to_string())?;

    let system_prompt = r#"You are a PM assistant for a software project.
Based on the project idea and tech stack below, generate 3-5 concrete initial goals
for the first sprint. Each goal should be actionable and specific.

Return ONLY valid JSON (no fences, no prose) shaped exactly like:
[
  {"title": "≤60자 한국어 제목", "description": "2-3줄 구체적인 설명 (한국어)", "priority": 1}
]

Priority: 1 = urgent, 2 = high, 3 = medium.
Goals should cover project setup, core feature, and testing/deployment."#;

    let user_msg = format!(
        "프로젝트 아이디어: {idea}\n기술 스택: {stack}",
        idea = idea_text,
        stack = stack_choice,
    );

    let response = client
        .chat(
            vec![
                llm::Message {
                    role: llm::Role::System,
                    content: system_prompt.to_string(),
                },
                llm::Message {
                    role: llm::Role::User,
                    content: user_msg,
                },
            ],
            llm::ChatOptions {
                model,
                temperature: Some(0.4),
                max_tokens: Some(800),
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    let content = response.content.trim();
    let json_str = if content.starts_with("```") {
        content
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim()
    } else {
        content
    };

    let payloads: Vec<SeedGoalPayload> = serde_json::from_str(json_str).map_err(|e| {
        format!("LLM 응답 파싱 실패: {e}\nRaw: {content}")
    })?;

    let mut goals = Vec::new();
    for payload in payloads.into_iter().take(5) {
        let goal = db
            .create_goal(
                Some(project_id),
                payload.title,
                payload.description,
                payload.priority.unwrap_or(2),
                None,
            )
            .await
            .map_err(|e| e.to_string())?;
        goals.push(goal);
    }

    Ok(goals)
}
