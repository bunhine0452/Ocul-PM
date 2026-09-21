//! PR-CI2 — oculpm MCP 도구 3종의 구현 (D3).
//!
//! **디스크가 SSOT** 라는 설계 그대로: 도구는 `.oculpm/` 마크다운만 읽고 쓴다.
//! SQLite/앱 상태에 일절 접근하지 않으므로 앱이 꺼져 있어도 동작하고, 앱이
//! 켜져 있으면 기존 watcher 가 파일 변경을 보고 인덱싱한다 (IPC 없음).
//!
//! 동시성: 앱/다른 에이전트가 같은 plan 파일을 만질 수 있으나, 이는 외부
//! 에이전트가 AGENTS.md 규칙대로 파일을 직접 편집하는 기존 지원 경로와 동일한
//! 위험 표면이다 (원자적 전체-파일 쓰기, 마지막-작성자 승리).

use std::path::Path;

use chrono::{SecondsFormat, Timelike, Utc};

/// 이 서버를 띄운 쪽이 알려 주는 호출자 id (앱의 ACP 커맨드가 세션마다 넘긴다).
///
/// 도구 인자의 `agent_id` 가 없을 때 쓰는 기본값을 정한다. 이게 없던 동안에는
/// 앱 안에서 도는 **모든** 에이전트의 일지가 `claude-code` 로 기록됐다 —
/// provider 가 둘이 된 순간부터 그건 그냥 틀린 기록이다.
pub const AGENT_ID_ENV: &str = "OCULPM_AGENT_ID";

/// Claude Code 가 자기 자식 프로세스에 실어 주는 **대화 id**. 우리는 그 자식
/// (stdio MCP 서버)이라 그냥 읽으면 된다.
///
/// 이게 있으면 터미널을 분할해 띄운 대화들이 각자 쓴 일지를 구분할 수 있다 —
/// 우리 `session_id`(`YYYYMMDD-NNN`)는 프로젝트의 작업 시간대라 동시에 도는
/// N개 대화가 전부 같은 값을 받기 때문이다.
pub const CLAUDE_SESSION_ENV: &str = "CLAUDE_CODE_SESSION_ID";

/// **우리가** 실어 주는 대화 id — provider 중립 이름.
///
/// [`CLAUDE_SESSION_ENV`] 하나만 쓰던 동안 앱 안 ACP 대화에는 구멍이 있었다:
/// 그 이름은 Claude Code CLI 자신도 자식 프로세스에 실어 준다. 어댑터가 우리
/// 값을 자기 대화 id 로 **덮어쓰면** 일지의 `agent.session` 이 우리 마커·원장과
/// 갈라지고, 판정 사다리의 1순위가 그 대화의 일지를 못 알아본다.
///
/// 그래서 이 이름이 먼저다. Claude 도 Codex 도 이 이름은 모르므로 아무도 덮어쓰지
/// 않고, 없으면 예전 그대로 [`CLAUDE_SESSION_ENV`] 로 내려간다 (터미널에서 직접
/// 띄운 Claude Code 가 그 길이다).
///
/// # 폴백은 왜 못 지우는가 (실측 2026-09-07 · Claude Code 2.1.263)
///
/// 이 이름을 실어 주는 자리는 **앱뿐**이다([`crate::acp::recording`]). 터미널에서
/// 띄운 Claude Code 의 자식으로 뜬 서버에는 아무도 안 실어 준다 —
/// `plugin/oculpm/.mcp.json` 에 `env` 블록이 없기 때문이다.
///
/// 세 라운드가 "`.mcp.json` 에서 `${CLAUDE_CODE_SESSION_ID}` 로 채우면 된다"를
/// 시도하려 했다. **안 된다.** 보간이 푸는 것은 `CLAUDE_PLUGIN_ROOT` ·
/// `CLAUDE_PROJECT_DIR` 과 부모 셸의 환경뿐이고, 대화 id 는 부모 프로세스의
/// 환경에도 없다(자식마다 새로 실어 준다). 그리고 **못 푼 이름은 리터럴로 그대로
/// 나간다** — 그 매핑을 넣는 순간 [`session_id_from`] 의 1순위가 모든 대화에서
/// 같은 문자열을 집어 병렬 세션 귀속이 조용히 통째로 망가진다.
///
/// 그래서 [`CLAUDE_SESSION_ENV`] 는 "낡은 설치본 폴백"이 아니라 **터미널 경로의
/// 유일한 신원 근거**다. 실측 표와 회귀 가드는
/// `tests/plugin_manifest.rs::the_mcp_env_block_never_interpolates_an_unresolvable_variable`.
pub const OCULPM_SESSION_ENV: &str = "OCULPM_SESSION_ID";

/// 이 서버를 띄운 대화의 id. 다른 CLI(Codex·Gemini)나 손으로 띄운 자리에서는
/// 없는 것이 정상 — 그때는 `None` 이고 일지에 필드가 아예 안 실린다.
fn claude_session_id() -> Option<String> {
    session_id_from(
        std::env::var(OCULPM_SESSION_ENV).ok(),
        std::env::var(CLAUDE_SESSION_ENV).ok(),
    )
}

/// 우선순위만 떼어낸다 — 프로세스 환경을 건드리지 않고 시험할 수 있게
/// (`agent_id_or_default` 와 같은 이유: 병렬로 도는 다른 테스트까지 흔든다).
///
/// 빈 값은 **없는 것으로** 본다. 둘 중 하나가 빈 문자열이라고 다음 칸으로 못
/// 내려가면, 어댑터가 빈 값을 실어 주는 순간 신원이 통째로 사라진다.
fn session_id_from(ours: Option<String>, claude: Option<String>) -> Option<String> {
    claude_session_or_none(ours).or_else(|| claude_session_or_none(claude))
}

/// 환경변수 하나를 다듬는다 — 공백만 있는 값도 없는 것으로 본다.
fn claude_session_or_none(raw: Option<String>) -> Option<String> {
    raw.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

/// 인자로 안 준 `agent_id` 의 기본값. 터미널에서 직접 띄운 CLI 처럼 환경변수가
/// 없는 자리에서는 예전 그대로 `claude-code`.
fn default_agent_id() -> String {
    agent_id_or_default(std::env::var(AGENT_ID_ENV).ok())
}

/// 환경변수를 읽는 부분만 떼어낸다 — 테스트가 프로세스 환경을 건드리면
/// 병렬로 도는 다른 테스트까지 흔든다.
fn agent_id_or_default(raw: Option<String>) -> String {
    raw.map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "claude-code".to_string())
}
use serde_json::{json, Value};

use crate::oculpm::atomic_io::write_atomic;
use crate::oculpm::frontmatter::write_frontmatter_and_body;
use crate::oculpm::index::read_sessions_sync;
use crate::oculpm::manager::{category_subdir, create_journal_file, entry_type_filename_token};
use crate::oculpm::paths::WorkdayResolver;
use crate::oculpm::planner::parse::{parse_plan, ItemStatus};
use crate::oculpm::planner::plan_edit::{append_log_row, set_item_status_rolled, LogRow};
use crate::oculpm::planner::project::{find_plan_path, planner_dir};
use crate::oculpm::redact::{
    build_forbidden_matcher, compile_redact_patterns, is_forbidden_path, redact_text,
};
use crate::oculpm::session::resolve_session_for_timestamp;
use crate::oculpm::spec::{
    AgentRef, Difficulty, EntryStatus, EntryType, FileOp, FileTouched, JournalFrontmatter,
    OculpmConfig,
};

/// MCP `tools/list` 응답의 도구 정의. 스키마는 에이전트가 읽는 계약서다 —
/// AGENTS.md §2~§4 의 규칙을 여기 옮겨 담아 "규칙 문서를 안 읽은 에이전트"도
/// 규격 기록을 남기게 한다.
pub fn tool_definitions() -> Value {
    let mut tools = json!([
        {
            "name": "journal_write",
            "description": "ocul-pm 작업 일지 1건을 기록한다. 하나의 논리적 작업 단위(버그 수정/기능/리팩토링/에러 사이클/잡일)를 끝냈을 때 호출. 경로·파일명·frontmatter 규격은 서버가 보장하므로 파일을 직접 만들지 말 것.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "type": { "type": "string", "enum": ["bug", "feature", "error", "refactor", "chore"], "description": "작업 단위의 종류" },
                    "slug": { "type": "string", "description": "ASCII kebab-case, 40자 이내 (예: fix-cache-invalidation)" },
                    "title": { "type": "string", "description": "한 줄 제목. 언어는 프로젝트 AGENTS.md 를 따른다 (앱의 \"AI 작성 언어\" 설정이 그 마스터를 고른다)" },
                    "body_markdown": { "type": "string", "description": "본문. 타입별 권장 헤더 — bug/error: 발생 원인·해결 방법, feature: 추가 기능·동작 흐름, refactor: 동기·변경 요약. 마지막에 검증 섹션 1~3줄 필수. **정확한 헤더 이름과 언어는 프로젝트 AGENTS.md 를 따른다** (영어 프로젝트는 Root cause / Fix / Verification). 시크릿 금지." },
                    "status": { "type": "string", "enum": ["planned", "in_progress", "done", "abandoned"], "description": "기본 done" },
                    "difficulty": { "type": "string", "enum": ["verylow", "low", "medium", "high", "superhigh"] },
                    "files_touched": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "path": { "type": "string" },
                                "op": { "type": "string", "enum": ["create", "update", "delete", "rename", "correct"] }
                            },
                            "required": ["path"]
                        }
                    },
                    "tags": { "type": "array", "items": { "type": "string" } },
                    "related": {
                        "type": "array",
                        "description": "이어지는 과거 일지 링크 (journal_search 결과의 path 를 그대로). kind 는 blocks|blocked_by|followup|duplicate, 기본 followup",
                        "items": {
                            "type": "object",
                            "properties": {
                                "ref": { "type": "string", "description": ".oculpm/journal/ 기준 상대경로 (예: 20260522/Bugs/2050_bug_x.md). 앞의 `.oculpm/journal/` 은 붙여도 된다" },
                                "kind": { "type": "string", "enum": ["blocks", "blocked_by", "followup", "duplicate"] }
                            },
                            "required": ["ref"]
                        }
                    },
                    "session_id": { "type": "string", "description": "훅이 준 세션 id 가 있으면 그대로. 없으면 서버가 실행 중인 세션에 귀속시킨다" },
                    "agent_id": { "type": "string", "description": "호출한 에이전트 id (생략 시 이 세션을 띄운 에이전트)" },
                    "agent_version": { "type": "string", "description": "모델명 (예: Opus 4.8)" }
                },
                "required": ["type", "slug", "title", "body_markdown"]
            }
        },
        {
            "name": "journal_search",
            "description": "이 프로젝트의 과거 작업 일지를 검색한다. **작업을 시작하기 전에 부르라** — 같은 파일이나 같은 증상을 전에 건드린 기록이 있으면 그때의 원인·결정·실패한 접근을 그대로 물려받을 수 있고, 이미 해결된 문제를 다시 푸는 일을 막는다. 본문 전문이 아니라 압축된 히트 목록을 돌려주니, 읽을 것을 고른 뒤 journal_read 로 펼칠 것. 필터 중 file(이 경로를 건드린 일지)이 가장 정확하다.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "제목·태그·슬러그·경로·본문에서 찾을 문자열 (대소문자 무시, 부분 일치). 공백으로 나눈 토큰이 **전부** 걸린 일지만 남고, 제목>태그>슬러그>경로>본문 가중치에 최신성을 조금 더해 관련도순으로 싣는다 — 오래된 일지도 강하게 걸리면 위로 온다. 생략하면 필터에 맞는 것을 최신순으로." },
                    "file": { "type": "string", "description": "이 경로를 건드린 일지만 (frontmatter files_touched 부분 일치). 전체 경로도 파일명만도 된다 — 예: \"src/oculpm/watcher.rs\" 또는 \"watcher.rs\"" },
                    "types": { "type": "array", "items": { "type": "string", "enum": ["bug", "feature", "error", "refactor", "chore"] }, "description": "이 종류만. 생략 = 전부" },
                    "status": { "type": "array", "items": { "type": "string", "enum": ["planned", "in_progress", "done", "abandoned"] }, "description": "이 상태만. 생략 = 전부" },
                    "tags": { "type": "array", "items": { "type": "string" }, "description": "이 태그를 **전부** 가진 일지만 (AND)" },
                    "since": { "type": "string", "description": "YYYYMMDD — 이 workday 이후(포함)" },
                    "until": { "type": "string", "description": "YYYYMMDD — 이 workday 이전(포함)" },
                    "limit": { "type": "integer", "description": "히트 수 상한 (기본 20, 최대 50). 넘치면 total_matched 로 알려준다" }
                }
            }
        },
        {
            "name": "journal_read",
            "description": "일지 1건의 본문 전체를 읽는다. journal_search 가 고른 path 를 그대로 넘길 것 — 목록을 훑을 때 쓰지 말고, 읽을 가치가 있다고 판단한 뒤에만 부른다.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "journal_search 응답의 path (예: \"20260821/Bugs/1842_bug_live-refresh.md\"). \".oculpm/journal/\" 접두사가 붙어 있어도 된다" }
                },
                "required": ["path"]
            }
        },
        plan_status_definition(),
        {
            "name": "plan_update",
            "description": "플랜 항목 하나의 상태를 갱신하고 갱신 로그를 남긴다. 일지를 쓴 직후 대응 항목이 있으면 호출 (plan-log append 는 서버가 규격대로 수행). **base_hash 가 필수다** — 먼저 plan_status 로 그 플랜의 hash 를 읽고 그 값을 넘길 것. 병렬 세션이 같은 플랜을 고칠 때 한쪽 변경이 조용히 사라지는 것을 막는다. 해시가 어긋나면 아무것도 쓰지 않고 현재 hash 를 담은 오류로 돌아오니, 다시 읽어 판단한 뒤 새 hash 로 재호출할 것.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "plan_id": { "type": "string" },
                    "item_id": { "type": "string", "description": "{#id} 의 id (# 제외)" },
                    "status": { "type": "string", "enum": ["todo", "in_progress", "done", "blocked", "deferred", "dropped"] },
                    "journal_path": { "type": "string", "description": "방금 쓴 일지의 .oculpm/ 상대경로 (journal_write 응답의 path)" },
                    "note": { "type": "string", "description": "plan-log 메모 열 (짧게)" },
                    "base_hash": { "type": "string", "description": "**필수** — 네가 읽은 그 플랜 파일의 blake3 해시. 출처는 셋: plan_status 응답의 plans[].hash · plan_create 응답의 hash · 직전 plan_update 응답의 hash. 그 사이 남이 고쳤으면 덮어쓰지 않고 거부한다 (병렬 세션 보호)." },
                    "agent_id": { "type": "string", "description": "생략 시 이 세션을 띄운 에이전트" }
                },
                "required": ["plan_id", "item_id", "status", "base_hash"]
            }
        },
        {
            "name": "plan_create",
            "description": "새 플랜 파일(.oculpm/planner/<plan_id>.md)을 규격대로 생성한다. 사용자가 새 계획 수립을 승인/요청했고 기존 활성 플랜에 넣을 자리가 없을 때 호출. 제목이나 id 가 겹치는 **활성** 플랜이 이미 있으면 만들지 않고 그 후보(id·제목·hash)를 돌려준다 — 거기에 항목을 더하는 쪽을 먼저 검토할 것(plan_update). 정말 별개 계획이면 allow_similar: true. frontmatter·phase 헤딩·항목 {#id}·plan-log 블록은 서버가 보장 — 파일을 직접 만들지 말 것. 응답의 hash 는 곧바로 이어지는 plan_update 의 base_hash 로 쓸 수 있다.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "plan_id": { "type": "string", "description": "영문 kebab-case ≤40자 — 파일명이자 frontmatter id" },
                    "title": { "type": "string", "description": "사람이 읽는 제목 (한국어 권장)" },
                    "description": { "type": "string", "description": "선택 — 제목 아래 소개 1~2문장" },
                    "phases": {
                        "type": "array",
                        "description": "1개 이상 — 각각 '## 제목 {#id}' 헤딩이 된다. phase 진척은 하위 항목 롤업으로 자동 계산",
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": { "type": "string" },
                                "id": { "type": "string", "description": "kebab id (생략 시 p1, p2…)" },
                                "items": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "text": { "type": "string", "description": "항목 한 줄 (줄바꿈 금지 — 전부 [ ] 할일로 생성됨)" },
                                            "id": { "type": "string", "description": "안정적 kebab id (생략 시 텍스트에서 유도, 한글뿐이면 p<n>-<m>)" },
                                            "children": {
                                                "type": "array",
                                                "description": "선택 — 하위 작업 (최대 1단계 중첩). 부모 상태는 하위 롤업으로 자동 계산되므로 부모를 직접 갱신하지 말 것",
                                                "items": {
                                                    "type": "object",
                                                    "properties": {
                                                        "text": { "type": "string" },
                                                        "id": { "type": "string" }
                                                    },
                                                    "required": ["text"]
                                                }
                                            }
                                        },
                                        "required": ["text"]
                                    }
                                }
                            },
                            "required": ["title"]
                        }
                    },
                    "agent_id": { "type": "string", "description": "생략 시 이 세션을 띄운 에이전트 — frontmatter owner" },
                    "allow_similar": { "type": "boolean", "description": "기본 false — 제목/id 가 겹치는 활성 플랜이 있으면 거부하고 후보를 돌려준다. 그 플랜과 정말 별개일 때만 true" }
                },
                "required": ["plan_id", "title", "phases"]
            }
        },
        {
            "name": "project_init",
            "description": "이 프로젝트를 ocul-pm 추적 대상으로 초기화한다 (.oculpm/ 스캐폴드 + 에이전트 규칙 파일 생성). 반드시 사용자가 추적 시작을 명시적으로 요청하고 확인한 뒤에만 호출할 것 — 조용히/선제적으로 호출 금지. 이미 추적 중인 프로젝트에서는 아무것도 바꾸지 않는다.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "confirm": { "type": "boolean", "description": "사용자가 ocul-pm 추적 시작을 명시적으로 확인했으면 true. false/누락이면 도구가 거부한다 — 먼저 사용자에게 물어볼 것." }
                },
                "required": ["confirm"]
            }
        }
    ]);
    // **배열을 나눠 두는 이유**는 `json!` 이 중첩 깊이로 매크로 재귀 한도를
    // 먹기 때문이다. 도구가 하나 늘 때마다 크레이트 전역 `recursion_limit` 을
    // 올리는 것보다, 갈래별로 나눠 이어 붙이는 편이 싸다.
    if let (Some(list), Some(extra)) = (
        tools.as_array_mut(),
        super::a2a_tools::definitions().as_array(),
    ) {
        list.extend(extra.iter().cloned());
    }
    tools
}

pub fn call_tool(root: &Path, name: &str, args: &Value) -> Result<Value, String> {
    // project_init 는 **유일하게** 비추적 프로젝트에서 동작하는 도구다 — A0b
    // 가드(아래)의 명시적 예외. 조용한 생성 금지 원칙은 유지된다: 사용자
    // 확인(confirm=true)을 요구하고, 심볼릭 링크 .oculpm 은 여기서도 거부하며,
    // 이미 추적 중이면 아무것도 바꾸지 않는다. 계약 문서(06-plugin-contract)의
    // 예외 조항과 함께 움직인다.
    if name == "project_init" {
        return project_init(root, args);
    }
    // A0b — 비추적 프로젝트 가드. user 스코프 플러그인 배포에서는 이 서버가
    // 모든 프로젝트에 노출되므로, `.oculpm/` 이 없는 곳에서는 어떤 도구도
    // 동작하지 않는다 — 특히 사용자 동의 없는 조용한 디렉터리 생성 금지.
    // symlink_metadata: 링크를 따라가지 않는다 — 악의적 저장소가 `.oculpm` 을
    // 외부 경로로 심볼릭 링크해 두면 가드를 통과한 쓰기가 프로젝트 밖으로
    // 탈출하므로, 실디렉터리만 인정한다.
    let oculpm_meta = std::fs::symlink_metadata(root.join(".oculpm"));
    let is_real_dir = oculpm_meta
        .as_ref()
        .map(|m| m.file_type().is_dir())
        .unwrap_or(false);
    if !is_real_dir {
        let is_symlink = oculpm_meta
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(false);
        return Err(if is_symlink {
            format!(
                "The .oculpm in {} is a symlink - for safety a linked .oculpm is \
                 기록하지 않습니다 (실제 디렉터리만 지원).",
                root.display()
            )
        } else {
            format!(
                "이 프로젝트는 ocul-pm 추적 대상이 아닙니다 — {} 에 .oculpm/ 이 없습니다. \
                 ocul-pm 앱에서 이 폴더를 프로젝트로 추가한 뒤 다시 시도하세요 \
                 (이 도구는 .oculpm/ 을 임의로 생성하지 않습니다).",
                root.display()
            )
        });
    }
    match name {
        "journal_write" => journal_write(root, args),
        "journal_search" => journal_search(root, args),
        "journal_read" => journal_read(root, args),
        "plan_status" => plan_status(root, args),
        "plan_update" => plan_update(root, args),
        "plan_create" => plan_create(root, args),
        "agent_register" => super::a2a_tools::agent_register(root, args),
        "agent_list" => super::a2a_tools::agent_list(root),
        "agent_inbox" => super::a2a_tools::agent_inbox(root, args),
        "agent_send" => super::a2a_tools::agent_send(root, args),
        "task_create" => super::a2a_tools::task_create(root, args),
        "task_update" => super::a2a_tools::task_update(root, args),
        "claim_paths" => super::a2a_tools::claim_paths(root, args),
        other => Err(format!("unknown tool: {other}")),
    }
}

/// 플러그인-온리 그린필드의 시작점 — `.oculpm/` 스캐폴드를 만든다.
///
/// 앱의 `init_project` 중 **디스크 부분만** 재현한다: config + schema-version +
/// gitignore managed block + `.oculpm/README.md` + 에이전트 규칙 동기화
/// (AGENTS.md 어댑터·마스터 템플릿·discussion-spec). 락/세션 감지/워처/DB
/// 캐시는 앱 몫 — 앱을 열면 기존 초기화를 그대로 이어받는다 (idempotent).
fn project_init(root: &Path, args: &Value) -> Result<Value, String> {
    if !args
        .get("confirm")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return Err(
            "project_init may only be called after the user explicitly confirms starting \
             있습니다 — 사용자에게 물어보고 동의를 받은 경우에만 confirm=true 로 다시 호출하세요."
                .to_string(),
        );
    }
    if !root.is_dir() {
        return Err(format!(
            "Project root is not a directory: {}",
            root.display()
        ));
    }
    // 폭발 반경 가드 — --root 를 홈/파일시스템 루트로 잘못 고정한 설정 사고가
    // ~/.gitignore(core.excludesFile 관행)·~/AGENTS.md 오염으로 번지지 않게.
    let canonical = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    if canonical.parent().is_none() {
        return Err(
            "The filesystem root cannot be initialized - check your --root setting.".to_string(),
        );
    }
    if let Ok(home) = std::env::var("HOME") {
        if !home.is_empty() && canonical == home {
            return Err(
                "The home directory cannot be initialized - retry from a project folder \
                 (.mcp.json 의 --root 가 프로젝트 경로인지 확인)."
                    .to_string(),
            );
        }
    }

    let oculpm_dir = root.join(".oculpm");
    // 원자적 선점: create_dir(비재귀)은 이미 무언가 있으면 실패한다 — "없음 확인
    // 후 생성" 사이에 심볼릭 링크를 끼워 넣는 TOCTOU 를 원천 차단. 이미 있으면
    // 종류를 판정해 실디렉터리만 ensure 경로로 계속 간다.
    let already = match std::fs::create_dir(&oculpm_dir) {
        Ok(()) => false,
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            let m = std::fs::symlink_metadata(&oculpm_dir).map_err(|e| e.to_string())?;
            if m.file_type().is_symlink() {
                return Err(format!(
                    "The .oculpm in {} is a symlink - not initializing, for safety.",
                    root.display()
                ));
            }
            if !m.file_type().is_dir() {
                return Err(
                    ".oculpm exists as a file, not a directory - remove it and retry.".to_string(),
                );
            }
            true
        }
        Err(e) => return Err(e.to_string()),
    };

    // 여기부터는 **ensure 시맨틱** — 이미 추적 중이든, 이전 호출이 중간에
    // 실패했든, 누락분만 채우고 재호출은 항상 완전 상태로 수렴한다. (초기
    // 구현은 디렉터리 존재 시 전면 스킵이라 반쪽 초기화가 영구 고착됐고,
    // 특히 gitignore 블록 없이 훅 인박스가 커밋될 수 있었다 — 리뷰 지적.)
    // 1. config.toml (있으면 검증만) + `.schema-version`
    let config_path = oculpm_dir.join("config.toml");
    let cfg = if config_path.exists() {
        let cfg =
            crate::oculpm::spec::OculpmConfig::load(&config_path).map_err(|e| e.to_string())?;
        cfg.validate().map_err(|e| e.to_string())?;
        cfg
    } else {
        let cfg = crate::oculpm::spec::OculpmConfig::default_for_new_project();
        cfg.validate().map_err(|e| e.to_string())?;
        cfg.save(&config_path).map_err(|e| e.to_string())?;
        cfg
    };
    let schema_version = oculpm_dir.join(".schema-version");
    if !schema_version.exists() {
        write_atomic(&schema_version, b"1\n").map_err(|e| e.to_string())?;
    }

    // 2. `.gitignore` managed block — 앱과 동일한 union 병합 + 다운그레이드 가드.
    let gitignore = root.join(".gitignore");
    let existing = crate::oculpm::atomic_io::read_managed_block(
        &gitignore,
        "oculpm",
        crate::oculpm::spec::CommentStyle::Hash,
    )
    .map_err(|e| e.to_string())?;
    let body = crate::oculpm::manager::merged_gitignore_body(
        existing.as_ref().map(|b| b.content.as_str()),
    );
    crate::oculpm::atomic_io::write_managed_block(
        &gitignore,
        "oculpm",
        &body,
        crate::oculpm::spec::CommentStyle::Hash,
    )
    .map_err(|e| e.to_string())?;

    // 3. 방문자용 README (실패 무해).
    crate::oculpm::readme::ensure_oculpm_readme(root);

    // 4. 에이전트 규칙 — 마스터 템플릿 시드 + AGENTS.md 등 활성 어댑터 렌더.
    //    sync_active 는 await 이 없는 async 서명이라 executor block_on 이 안전.
    let report = futures::executor::block_on(crate::oculpm::agents::sync_active(root, &cfg))
        .map_err(|e| e.to_string())?;

    Ok(json!({
        "initialized": !already,
        "root": canonical.display().to_string(),
        "adapters_synced": report.results.len(),
        "note": if already {
            "이미 추적 중인 프로젝트 — 누락된 구성(설정·gitignore 보호·규칙 파일)을 보완했습니다."
        } else {
            "이제 journal_write · plan_create 등 ocul-pm 도구를 쓸 수 있습니다. \
             ocul-pm 앱에서 이 폴더를 열면 타임라인·세션 감지·인덱싱이 활성화됩니다."
        }
    }))
}

pub(super) fn arg_str<'a>(args: &'a Value, key: &str) -> Option<&'a str> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

/// 문자열 배열 인수를 꺼낸다. 없거나 배열이 아니면 빈 벡터 — 호출자는
/// "비었으면 제약 없음" 으로 읽는다.
fn str_array<'a>(args: &'a Value, key: &str) -> Vec<&'a str> {
    args.get(key)
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

pub(super) fn load_config(root: &Path) -> OculpmConfig {
    OculpmConfig::load(&root.join(".oculpm").join("config.toml"))
        .unwrap_or_else(|_| OculpmConfig::default_for_new_project())
}

fn resolver_of(cfg: &OculpmConfig) -> WorkdayResolver {
    WorkdayResolver::new(&cfg.workday.timezone, &cfg.workday.day_starts_at)
        .unwrap_or_else(|_| WorkdayResolver::new("UTC", "00:00").expect("UTC resolver"))
}

// ─── journal_write ───────────────────────────────────────────────────────────

fn parse_entry_type(s: &str) -> Result<EntryType, String> {
    Ok(match s {
        "bug" => EntryType::Bug,
        "feature" => EntryType::Feature,
        "error" => EntryType::Error,
        "refactor" => EntryType::Refactor,
        "chore" => EntryType::Chore,
        other => {
            return Err(format!(
                "invalid type '{other}' (bug|feature|error|refactor|chore)"
            ))
        }
    })
}

fn parse_entry_status(s: &str) -> Result<EntryStatus, String> {
    Ok(match s {
        "planned" => EntryStatus::Planned,
        "in_progress" => EntryStatus::InProgress,
        "done" => EntryStatus::Done,
        "abandoned" => EntryStatus::Abandoned,
        other => return Err(format!("invalid status '{other}'")),
    })
}

/// `parse_entry_status` 의 역방향 — 응답에 실을 상태 토큰.
fn entry_status_token(s: EntryStatus) -> &'static str {
    match s {
        EntryStatus::Planned => "planned",
        EntryStatus::InProgress => "in_progress",
        EntryStatus::Done => "done",
        EntryStatus::Abandoned => "abandoned",
    }
}

fn parse_file_op(s: &str) -> FileOp {
    match s {
        "create" => FileOp::Create,
        "delete" => FileOp::Delete,
        "rename" => FileOp::Rename,
        "correct" => FileOp::Correct,
        _ => FileOp::Update,
    }
}

/// slug 를 ASCII kebab 으로 강제 (journal_draft::sanitize_slug 와 동일 규칙을
/// 여기서 재사용하기엔 의존 방향이 어색해 로컬 구현 — 규칙은 스키마에 명시).
fn sanitize_slug(raw: &str) -> Result<String, String> {
    let mut out = String::new();
    let mut prev_dash = true;
    for ch in raw.trim().to_lowercase().chars() {
        let mapped = if ch.is_ascii_alphanumeric() {
            Some(ch)
        } else if ch == '-' || ch == '_' || ch.is_whitespace() {
            Some('-')
        } else {
            None
        };
        match mapped {
            Some('-') if prev_dash => {}
            Some('-') => {
                out.push('-');
                prev_dash = true;
            }
            Some(c) => {
                out.push(c);
                prev_dash = false;
            }
            None => {}
        }
        if out.len() >= 60 {
            break;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        Err("slug must contain ASCII letters/digits (kebab-case)".into())
    } else {
        Ok(trimmed)
    }
}

fn journal_write(root: &Path, args: &Value) -> Result<Value, String> {
    let entry_type = parse_entry_type(arg_str(args, "type").ok_or("'type' is required")?)?;
    let slug = sanitize_slug(arg_str(args, "slug").ok_or("'slug' is required")?)?;
    let title = arg_str(args, "title")
        .ok_or("'title' is required")?
        .to_string();
    let body = args
        .get("body_markdown")
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .ok_or("'body_markdown' is required")?;
    let status = match arg_str(args, "status") {
        Some(s) => parse_entry_status(s)?,
        None => EntryStatus::Done,
    };
    let difficulty = arg_str(args, "difficulty").and_then(|s| match s {
        "verylow" => Some(Difficulty::Verylow),
        "low" => Some(Difficulty::Low),
        "medium" => Some(Difficulty::Medium),
        "high" => Some(Difficulty::High),
        "superhigh" => Some(Difficulty::Superhigh),
        _ => None,
    });

    let cfg = load_config(root);
    let resolver = resolver_of(&cfg);
    let now = Utc::now();
    let workday = resolver.workday_of(now);
    let local = now.with_timezone(&resolver.tz);

    // files_touched + forbidden 검사 (manager 의 create 경로와 동일 계약).
    let files: Vec<FileTouched> = args
        .get("files_touched")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|f| {
                    let path = f.get("path")?.as_str()?.trim().to_string();
                    if path.is_empty() {
                        return None;
                    }
                    Some(FileTouched {
                        path,
                        op: parse_file_op(f.get("op").and_then(Value::as_str).unwrap_or("update")),
                        bytes_added: None,
                        bytes_removed: None,
                        rename_from: None,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    if !cfg.git.forbid_journal_for_paths.is_empty() && !files.is_empty() {
        let matcher = build_forbidden_matcher(root, &cfg.git.forbid_journal_for_paths);
        let hits: Vec<String> = files
            .iter()
            .filter(|f| is_forbidden_path(&matcher, &f.path))
            .map(|f| f.path.clone())
            .collect();
        if !hits.is_empty() {
            return Err(format!(
                "files_touched contains forbidden paths (git.forbid_journal_for_paths): {}",
                hits.join(", ")
            ));
        }
    }

    // redact — MCP 로 들어온 본문에도 프로젝트 시크릿 패턴을 적용. 마스킹이
    // 일어났으면 응답에 알린다 — AGENTS.md 는 "감지 시 거부" 라 적혀 있었지만
    // 실제론 조용히 마스킹만 했고, 에이전트는 자기가 무엇을 흘렸는지 몰랐다.
    let patterns = compile_redact_patterns(&cfg.git.auto_redact_patterns);
    let (title, title_hits) = redact_text(&title, &patterns);
    let (body, body_hits) = redact_text(body, &patterns);
    let redacted = title_hits.len() + body_hits.len();

    let mut tags: Vec<String> = args
        .get("tags")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|t| t.as_str())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    if !tags.iter().any(|t| t == "mcp-tool") {
        tags.push("mcp-tool".to_string()); // 출처 표식 — 파일 자기신고와 구분
    }

    // related — 인자 파싱도 자동 연결도 `related.rs` 가 소유한다. 자동 연결은
    // related 를 **안 준** bug/error 일지에만 붙고, 붙었으면 응답이 말한다
    // ({#related-auto}).
    let mut warnings: Vec<String> = Vec::new();
    let mut related = self::related::parse_related_arg(root, args, &mut warnings);
    let auto_related = self::related::auto_relate(root, entry_type, &files, &mut related);
    if redacted > 0 {
        warnings.push(format!(
            "시크릿 패턴 {redacted}건이 마스킹됐다 — 일지에 비밀을 적지 말 것 (git.auto_redact_patterns)"
        ));
    }

    let fm = JournalFrontmatter {
        schema_version: 1,
        entry_type,
        slug: slug.clone(),
        status,
        difficulty,
        created_at: local.to_rfc3339_opts(SecondsFormat::Secs, false),
        updated_at: None,
        // Session id, best first: an explicit argument, then the watcher's own
        // live session read off `sessions.json`, then a synthetic fallback.
        //
        // The middle arm is the point (dogfooding 2026-08-20): a synthetic id
        // can never join against a real session, so entries stamped `mcp-…`
        // left `matched` / `jaccard_index` dead and made the honesty audit
        // report every changed file as unrecorded. We run out-of-process and
        // can't ask the SessionActor, but `sessions.json` is on disk — so read
        // it and attribute by write time. Empty (app not running / no activity
        // yet) falls through to the synthetic id as before.
        session_id: arg_str(args, "session_id")
            .map(str::to_string)
            .or_else(|| {
                let sessions = read_sessions_sync(root, &resolver, &workday);
                resolve_session_for_timestamp(
                    &sessions,
                    &local.to_rfc3339_opts(SecondsFormat::Secs, false),
                )
            })
            .unwrap_or_else(|| {
                crate::oculpm::session_id::SessionId::mcp(&workday, local).into_string()
            }),
        agent: AgentRef {
            id: arg_str(args, "agent_id")
                .map(str::to_string)
                .unwrap_or_else(default_agent_id),
            version: arg_str(args, "agent_version").map(str::to_string),
            // 인자로 준 값이 이기고, 없으면 우리를 띄운 대화를 적는다. 에이전트에게
            // 물어보지 않는 이유는 자기 대화 id 를 모르기 때문이다 — 환경변수는 안다.
            session: arg_str(args, "agent_session")
                .map(str::to_string)
                .or_else(claude_session_id),
        },
        // 프로젝트의 AI 작성 언어 — 영문 프로젝트도 "ko" 로 색인되던 것을 바로잡는다.
        language: cfg.agents.template_language.clone(),
        verified_by_user: false,
        verified_hash: None,
        files_touched: files,
        related,
        tags,
    };

    // 첫 줄 체크박스 제목 (AGENTS.md §4) — 본문이 이미 체크박스로 시작하면 존중.
    let marker = if matches!(fm.status, EntryStatus::Done) {
        "[x]"
    } else {
        "[ ]"
    };
    let full_body = if body.trim_start().starts_with("[x]") || body.trim_start().starts_with("[ ]")
    {
        body.trim().to_string()
    } else {
        format!("{marker} {title}\n\n{}", body.trim())
    };

    let dir = root
        .join(".oculpm")
        .join("journal")
        .join(&workday)
        .join(category_subdir(entry_type));
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir failed: {e}"))?;
    let base = format!(
        "{:02}{:02}_{}_{}",
        local.hour(),
        local.minute(),
        entry_type_filename_token(entry_type),
        slug
    );
    let markdown = write_frontmatter_and_body(&fm, &full_body);
    // 배타적 생성 — 병렬 세션의 MCP 서버 둘이 같은 이름을 골라도 뒤가 앞을
    // 덮지 않는다 (`manager::create_journal_file` 주석).
    let (_, file_name) =
        create_journal_file(&dir, &base, markdown.as_bytes()).map_err(|e| e.to_string())?;

    let rel = format!(
        ".oculpm/journal/{workday}/{}/{file_name}",
        category_subdir(entry_type)
    );
    // A2 활성화 배선 — 앱 없이 플러그인만으로 기록이 시작된 저장소에도
    // `.oculpm/` 정체를 설명하는 README 가 생기게 한다 (있으면 불변, 실패 무해).
    crate::oculpm::readme::ensure_oculpm_readme(root);
    Ok(json!({
        "path": rel,
        "session_id": fm.session_id,
        "language": fm.language,
        "related": fm.related.len(),
        "auto_related": auto_related,
        "redacted": redacted,
        "warnings": warnings,
    }))
}

// ─── journal_search · journal_read → search.rs ──────────────────────────────

mod search;
pub(crate) use search::*;

// ─── journal_write 의 related → related.rs ──────────────────────────────────

mod related;

// ─── plan_status · plan_update → plan_ops.rs ─────────────────────────────────

mod plan_ops;
pub(crate) use plan_ops::*;

// ─── plan_create → plan_create.rs ───────────────────────────────────────────

mod plan_create;
pub(crate) use plan_create::*;

#[cfg(test)]
mod tests;
