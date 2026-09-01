//! `ocul-pm config export|plan|apply` — same-exe 서브커맨드
//! (Osaurus 라운드 Phase 6 #config-cli).
//!
//! `--pty-host` 선례를 따른다: **같은 실행 파일**이 GUI 를 띄우지 않고 이
//! 모드로 뜬다. 새 바이너리를 빌드·서명·배포하지 않는 것이 요점이다.
//!
//! GUI 가 없으므로 `AppHandle` 도 없다 — 앱 데이터 경로는 `setup_logging` 과
//! 같은 `directories::ProjectDirs` 로 직접 구한다 (Tauri 의 `app_data_dir()`
//! 가 내부에서 쓰는 그 크레이트다).
//!
//! 종료 코드: `0` 성공 · `1` 오류 · `2` 사용법 · `3` **일부만 적용됨**.
//! 3 이 따로 있는 이유는 CI 가 "적용은 됐는데 다 되진 않았다" 를 초록으로
//! 지나치면 안 되기 때문이다.

use std::path::{Path, PathBuf};

use crate::config::applier::ConfigApplyStatus;
use crate::config::planner::{self, ConfigOp, ConfigPlan, ConfigSurface};
use crate::config::schema;
use crate::db::Db;

const USAGE: &str = "\
usage: ocul-pm config <command> [options]

commands:
  export            print the current state as a config document
  plan   <file>     show what applying <file> would change
  apply  <file>     apply <file>, then re-plan to verify

options:
  --project <path>  project root for the `project:` section
  -o <file>         write export output to <file> instead of stdout
";

/// `main.rs` 가 `config` 를 만나면 여기로 들어오고, 돌아가지 않는다.
pub fn run(args: Vec<String>) -> ! {
    let code = match dispatch(args) {
        Ok(code) => code,
        Err(message) => {
            eprintln!("error: {message}");
            1
        }
    };
    std::process::exit(code)
}

/// 파싱된 명령줄. I/O 와 분리해 두어 인자 해석만 따로 검사한다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Invocation {
    pub command: String,
    pub file: Option<PathBuf>,
    pub project: Option<PathBuf>,
    pub out: Option<PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Parsed {
    Run(Invocation),
    /// 사용법을 찍고 이 코드로 끝낸다 (`--help` 는 0, 명령 없음은 2).
    Usage(i32),
}

/// 순수 인자 해석. 옵션은 어느 자리에 와도 되고, 위치 인자는 최대 둘
/// (명령, 파일) 이다.
pub fn parse_args(args: Vec<String>) -> Result<Parsed, String> {
    let mut command: Option<String> = None;
    let mut file: Option<PathBuf> = None;
    let mut project: Option<PathBuf> = None;
    let mut out: Option<PathBuf> = None;

    let mut it = args.into_iter();
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--project" => {
                project = Some(PathBuf::from(it.next().ok_or("--project needs a path")?))
            }
            "-o" | "--output" => out = Some(PathBuf::from(it.next().ok_or("-o needs a path")?)),
            "-h" | "--help" => return Ok(Parsed::Usage(0)),
            other if command.is_none() => command = Some(other.to_string()),
            other if file.is_none() => file = Some(PathBuf::from(other)),
            other => return Err(format!("unexpected argument: {other}")),
        }
    }

    match command {
        Some(command) => Ok(Parsed::Run(Invocation {
            command,
            file,
            project,
            out,
        })),
        None => Ok(Parsed::Usage(2)),
    }
}

fn dispatch(args: Vec<String>) -> Result<i32, String> {
    let invocation = match parse_args(args)? {
        Parsed::Run(i) => i,
        Parsed::Usage(0) => {
            print!("{USAGE}");
            return Ok(0);
        }
        Parsed::Usage(code) => {
            eprint!("{USAGE}");
            return Ok(code);
        }
    };

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|e| e.to_string())?;

    runtime.block_on(async move {
        let Invocation {
            command,
            file,
            project,
            out,
        } = invocation;
        let db = open_db().await?;
        let root = match project {
            Some(p) => Some(
                p.canonicalize()
                    .map_err(|e| format!("{}: {e}", p.display()))?,
            ),
            None => None,
        };
        match command.as_str() {
            "export" => cmd_export(&db, root.as_deref(), out.as_deref()).await,
            "plan" => cmd_plan(&db, root.as_deref(), &need_file(file)?).await,
            "apply" => cmd_apply(&db, root.as_deref(), &need_file(file)?).await,
            other => {
                eprintln!("unknown command: {other}");
                eprint!("{USAGE}");
                Ok(2)
            }
        }
    })
}

fn need_file(file: Option<PathBuf>) -> Result<PathBuf, String> {
    file.ok_or_else(|| "this command needs a config file path".to_string())
}

/// `<app_data>/ocul-pm.db` — GUI 가 여는 것과 **같은 파일**이다.
async fn open_db() -> Result<Db, String> {
    let dir = directories::ProjectDirs::from("com", "kimhyunbin", "ocul-pm")
        .ok_or("cannot resolve the app data directory")?
        .data_dir()
        .to_path_buf();
    Db::open(dir.join("ocul-pm.db"))
        .await
        .map_err(|e| format!("cannot open the database: {e}"))
}

async fn settings_map(db: &Db) -> Result<std::collections::BTreeMap<String, String>, String> {
    Ok(db
        .settings_get_all()
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .collect())
}

async fn cmd_export(db: &Db, root: Option<&Path>, out: Option<&Path>) -> Result<i32, String> {
    let state = planner::capture(settings_map(db).await?, root);
    let text = schema::render_doc(&planner::export(&state)).map_err(|e| e.detail())?;
    match out {
        Some(path) => {
            std::fs::write(path, text.as_bytes())
                .map_err(|e| format!("{}: {e}", path.display()))?;
            eprintln!("wrote {}", path.display());
        }
        None => print!("{text}"),
    }
    Ok(0)
}

async fn cmd_plan(db: &Db, root: Option<&Path>, file: &Path) -> Result<i32, String> {
    let plan = plan_file(db, root, file).await?;
    print!("{}", render_plan(&plan));
    Ok(0)
}

async fn cmd_apply(db: &Db, root: Option<&Path>, file: &Path) -> Result<i32, String> {
    let doc = read_doc(file)?;
    let plan = {
        let state = planner::capture(settings_map(db).await?, root);
        planner::plan(&state, &doc, root)
    };
    print!("{}", render_plan(&plan));

    let result = crate::commands::declarative_config::apply_doc(db, root, &doc)
        .await
        .map_err(|e| e.to_string())?;

    for f in &result.failed {
        eprintln!(
            "  ! {} {} — {} ({})",
            surface_tag(f.surface),
            f.key,
            f.detail,
            f.code
        );
    }
    match result.status {
        ConfigApplyStatus::Applied => {
            println!(
                "\n적용 완료 — {}건. 대조 검증에서 남은 차이 없음.",
                result.applied.len()
            );
            Ok(0)
        }
        ConfigApplyStatus::NoOp => {
            println!("\n이미 이 상태입니다 — 쓴 것 없음.");
            Ok(0)
        }
        ConfigApplyStatus::Partial => {
            println!(
                "\n일부만 적용됨 — {}건 적용 · {}건 실패 · 대조에서 {}건 남음.",
                result.applied.len(),
                result.failed.len(),
                result.residual
            );
            Ok(3)
        }
    }
}

async fn plan_file(db: &Db, root: Option<&Path>, file: &Path) -> Result<ConfigPlan, String> {
    let doc = read_doc(file)?;
    let state = planner::capture(settings_map(db).await?, root);
    Ok(planner::plan(&state, &doc, root))
}

fn read_doc(file: &Path) -> Result<schema::ConfigDoc, String> {
    let text = std::fs::read_to_string(file).map_err(|e| format!("{}: {e}", file.display()))?;
    schema::parse_doc(&text).map_err(|e| e.detail())
}

/// 승인 카드와 **같은 목록**을 글자로. 화면과 터미널이 다른 것을 보면
/// "CLI 로 확인하고 UI 로 적용" 이 성립하지 않는다.
pub fn render_plan(plan: &ConfigPlan) -> String {
    let mut out = String::from("설정을 이 상태로 맞춥니다\n");
    if let Some(root) = &plan.project_root {
        out.push_str(&format!("  프로젝트: {root}\n"));
    }
    for item in &plan.items {
        let tag = surface_tag(item.surface);
        match item.op {
            ConfigOp::Add => out.push_str(&format!(
                "  + {tag} {} 를 {} 로 추가\n",
                item.key,
                item.to.as_deref().unwrap_or("")
            )),
            ConfigOp::Change => out.push_str(&format!(
                "  ~ {tag} {}  {} → {}\n",
                item.key,
                item.from.as_deref().unwrap_or(""),
                item.to.as_deref().unwrap_or("")
            )),
            ConfigOp::Blocked => out.push_str(&format!(
                "  ⚠ {tag} {} — 이행하지 않음 ({})\n",
                item.key,
                item.reason.as_deref().unwrap_or("")
            )),
            ConfigOp::Unchanged => {}
        }
    }
    out.push_str(&format!(
        "  · 변경 없음 {}건\n추가 {} · 변경 {} · 이행 불가 {}\n",
        plan.unchanged, plan.added, plan.changed, plan.blocked
    ));
    out
}

fn surface_tag(surface: ConfigSurface) -> &'static str {
    match surface {
        ConfigSurface::Settings => "설정",
        ConfigSurface::OculpmConfig => "프로젝트",
        ConfigSurface::Rule => "규칙",
        ConfigSurface::Skill => "스킬",
        ConfigSurface::Automation => "자동화",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::planner::ConfigState;
    use std::collections::BTreeMap;

    #[test]
    fn renders_every_op_and_the_unchanged_tally() {
        let state = ConfigState {
            settings: BTreeMap::from([
                ("theme".to_string(), "nord".to_string()),
                ("core_model".to_string(), "sonnet".to_string()),
            ]),
            ..Default::default()
        };
        let doc = schema::parse_doc(
            "oculpm_config: v1\nsettings:\n  theme: nord\n  core_model: haiku\n  content_language: ko\n",
        )
        .unwrap();
        let plan = planner::plan(&state, &doc, None);
        let text = render_plan(&plan);
        assert!(
            text.contains("+ 설정 content_language 를 ko 로 추가"),
            "{text}"
        );
        assert!(text.contains("~ 설정 core_model  sonnet → haiku"), "{text}");
        assert!(text.contains("· 변경 없음 1건"), "{text}");
        assert!(
            !text.contains("theme"),
            "unchanged rows stay out of the body — the tally carries them"
        );
    }

    #[test]
    fn parses_options_in_any_position() {
        let args = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let Parsed::Run(i) = parse_args(args(&["--project", "/p", "apply", "c.yaml"])).unwrap()
        else {
            panic!("expected a run")
        };
        assert_eq!(i.command, "apply");
        assert_eq!(i.file, Some(PathBuf::from("c.yaml")));
        assert_eq!(i.project, Some(PathBuf::from("/p")));

        let Parsed::Run(j) = parse_args(args(&["export", "-o", "out.yaml"])).unwrap() else {
            panic!("expected a run")
        };
        assert_eq!(j.out, Some(PathBuf::from("out.yaml")));
        assert_eq!(j.file, None);

        assert_eq!(parse_args(args(&["--help"])).unwrap(), Parsed::Usage(0));
        assert_eq!(parse_args(args(&[])).unwrap(), Parsed::Usage(2));
        assert!(parse_args(args(&["plan", "a", "b"])).is_err());
        assert!(parse_args(args(&["plan", "--project"])).is_err());
    }

    #[test]
    fn blocked_rows_say_why() {
        let doc = schema::parse_doc(
            "oculpm_config: v1\nproject:\n  oculpm:\n    agents:\n      auto_reconcile: true\n",
        )
        .unwrap();
        let plan = planner::plan(&ConfigState::default(), &doc, None);
        let text = render_plan(&plan);
        assert!(
            text.contains("⚠ 프로젝트 project — 이행하지 않음 (no_project)"),
            "{text}"
        );
    }
}
