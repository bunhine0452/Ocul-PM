//! PR-ACP2 — 세션 업데이트 → 프런트 이벤트 (docs/acp-panel/00-master-plan.md §5).
//!
//! ACP 의 `session/update` 는 종류가 계속 늘어난다 — 어댑터가 2주에 6회 배포되는
//! 0.x 이기 때문이다(리스크 R2). 그래서 **모르는 종류를 에러로 다루지 않고**
//! `Other` 로 흘린다. 새 종류가 생겨도 패널이 죽지 않고, 로그에는 남는다.
//!
//! 이 라운드가 그리는 것은 텍스트뿐이다. 툴콜·플랜은 PR-ACP3/4 가 `Other` 를
//! 대체하며 채운다.

use super::AcpProvider;
use agent_client_protocol::schema::v1::{ContentBlock, SessionUpdate};
use serde::{Deserialize, Serialize};

/// 에이전트 화면이 받는 스트리밍 이벤트.
// 태그 이름·표기는 `ChatEvent`(llm/mod.rs)와 맞춘다 — 프런트가 두 스트림을
// 같은 방식으로 분기한다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AcpEvent {
    /// 답변 조각.
    Chunk { text: String },
    /// 사용자 발화 조각. 평소엔 우리가 이미 그린 것이라 무시되지만,
    /// `session/load` 의 **대화 재생**에서는 이걸로 지난 질문을 복원한다.
    UserChunk { text: String },
    /// 내부 추론 조각 (UI 는 기본 접어 둔다).
    Thought { text: String },
    /// 컨텍스트 사용량·누적 비용.
    ///
    /// 토큰 수가 `u32` 인 건 specta 가 정밀도 손실을 이유로 64비트 정수 내보내기를
    /// 막기 때문이다 — 컨텍스트 창은 백만 단위라 `u32` 로 충분하고, 넘치면
    /// 포화시킨다(잘못된 작은 수보다 최대값이 덜 거짓말이다).
    Usage {
        used: u32,
        size: u32,
        cost_usd: Option<f64>,
    },
    /// 도구 호출이 시작됐다.
    ToolCall {
        id: String,
        title: String,
        /// 도구 이름 (`Bash` · `Read` · `Grep` …). 어댑터가 `_meta.claudeCode`
        /// 로만 알려 준다 — 프로토콜 본문에는 없다.
        name: Option<String>,
        /// 한 줄 설명. Bash 는 모델이 적어 준 `description` 이 여기 온다.
        subtitle: Option<String>,
        /// `read` · `edit` · `execute` … (아이콘 선택용).
        tool_kind: String,
        /// `pending` · `in_progress` · `completed` · `failed`.
        status: String,
        /// 이 호출이 건드리는 파일들 (절대경로).
        locations: Vec<String>,
        /// 도구에 들어간 것 (명령줄·인자). 카드의 `IN`.
        input: Option<String>,
        /// 도구가 내놓은 것. 카드의 `OUT`. 시작 시점엔 대개 비어 있고
        /// `tool_update` 로 채워진다.
        output: Option<String>,
        /// 편집 도구가 실어 온 파일 변경 — 예전엔 `"[diff]"` 문자열로 버렸다.
        /// 무엇이 어떻게 바뀌는지는 이 화면의 핵심 정보라 구조 그대로 넘긴다.
        diffs: Vec<AcpToolDiff>,
    },
    /// 진행 중인 도구 호출의 상태·제목이 바뀌었다. 없는 필드는 그대로 둔다.
    ToolUpdate {
        id: String,
        name: Option<String>,
        subtitle: Option<String>,
        title: Option<String>,
        status: Option<String>,
        /// 온 것만 실린다 — `None` 은 "안 왔다"이지 "비었다"가 아니다.
        input: Option<String>,
        output: Option<String>,
        /// `None` 은 "content 가 안 왔다" — 이미 받은 diff 를 지우면 안 된다.
        diffs: Option<Vec<AcpToolDiff>>,
    },
    /// 사용자 승인이 필요하다. 응답 전까지 에이전트는 멈춰 있다.
    Permission {
        request_id: String,
        title: String,
        tool_kind: String,
        /// 승인 대상 파일 — "무엇을 허용하는가"의 절반은 경로다.
        locations: Vec<String>,
        options: Vec<AcpPermissionOption>,
        /// 승인 대상 변경 내용. 편집 승인에서 이것이 없으면 **무엇을 허용하는지
        /// 못 본 채** 허용을 누르게 된다.
        diffs: Vec<AcpToolDiff>,
        /// 도구에 들어갈 것 (실행 승인이면 명령줄) — diff 와 같은 이유로 싣는다.
        input: Option<String>,
    },
    /// 세션 설정이 **에이전트 쪽에서** 바뀌었다.
    ///
    /// 우리가 바꾼 것만이 아니다: 모델을 바꾸면 새 모델이 지원하지 않는 권한
    /// 모드는 어댑터가 조용히 `default` 로 내린다(소스 확인). 이 이벤트를
    /// 버리면 UI 는 "Auto" 라 적힌 채 실제로는 Manual 로 도는 상태가 된다 —
    /// 사용자가 자동 승인될 거라 믿는 순간이라 안전 문제다.
    ConfigChanged { options: Vec<AcpConfigOption> },
    /// 세션에 일어난 일 — 한도 초과·인증 실패·모델 폴백 …
    ///
    /// 안 받으면 이런 것이 평범한 오류 문자열이나 **침묵**으로 온다. 특히 모델
    /// 폴백(`warning`)은 알려 주지 않으면 알 길이 없다.
    Failure {
        /// 같은 사건의 갱신을 알아보는 표 — 같은 `id` 는 새 줄이 아니라 갱신이다.
        id: String,
        /// `connection` · `access` · `limit` · `request` · `service` · `unknown`.
        category: String,
        /// `warning` 또는 `error`.
        severity: String,
        title: String,
        details: Option<String>,
    },
    /// 에이전트의 할 일 목록 (TodoWrite).
    ///
    /// **매번 전체가 온다** — 스펙이 "갱신할 때는 모든 항목을 현재 상태와 함께
    /// 보내고, 클라이언트는 통째로 갈아 끼운다"고 못 박는다. 그래서 합치지 않고
    /// 받은 것으로 대체한다.
    Plan { entries: Vec<AcpPlanEntry> },
    /// 이번 턴에 에이전트가 **자기 입으로 신고한** 파일 변경 목록
    /// (어댑터 0.70.0 의 `agentFileChangeReport`).
    ///
    /// watcher·git diff 로 *추론*하는 것과 출처가 다르다: 턴이 끝나기 직전
    /// 어댑터가 숨은 continuation 으로 "이번 턴에 바꾼 워크스페이스 파일을
    /// 전부 신고하라"를 시키고, 그 답이 이 이벤트다. 명령·제너레이터·자식
    /// 프로세스가 바꾼 것까지 포함하라고 지시하므로 watcher 가 놓치거나 다른
    /// 창의 작업과 뒤섞이던 것을 교차 검증할 수 있다.
    ///
    /// **믿되 검증한다** — 모델이 적어 주는 목록이라 틀릴 수 있다. 그래서
    /// `complete`/`uncertainty` 를 그대로 실어 보낸다(모델이 스스로 "불완전할
    /// 수 있다"고 말한 것을 우리가 숨기면 안 된다).
    FileChangeReport {
        /// 우리가 프롬프트에 실어 보낸 요청 표 — 어느 턴의 보고인지 잇는다.
        request_id: String,
        /// 바뀐 파일들의 절대경로. `status != "reported"` 면 빈 목록이다.
        paths: Vec<String>,
        /// 모델이 "이게 전부다"라고 선언했는가.
        complete: bool,
        /// 어댑터가 한도(1024개·256KB)로 잘랐는가.
        truncated: bool,
        /// 모델이 적어 준 불확실성 사유.
        uncertainty: Option<String>,
        /// 보고를 못 받은 사유 — `cancelled`·`timeout`·`invalidOutput`·
        /// `notReported`·`providerError`. 받았으면 `None`.
        unavailable: Option<String>,
    },
    /// 아직 UI 가 없는 업데이트 — 종류만 알려 준다.
    /// (필드 이름이 `kind` 가 아닌 건 내부 태그와 충돌하기 때문이다.)
    Other { update: String },
    /// 턴 종료.
    Done { stop_reason: String },
    /// 턴이 오류로 끝났다.
    Failed { message: String },
}

/// 세션 설정 항목의 선택지 하나.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct AcpConfigChoice {
    pub value: String,
    pub name: String,
    /// 어댑터가 주는 한 줄 설명 ("Standard behavior, prompts for dangerous
    /// operations" 같은). 메뉴를 두 줄로 그릴 때 쓴다 — 우리가 지어내지 않는다.
    pub description: Option<String>,
}

/// 세션 설정 항목 (모델·Effort·Fast mode·권한 모드·서브에이전트 …).
///
/// 목록을 우리가 하드코딩하지 않는 게 핵심이다 — 어댑터가 `session/new` 응답으로
/// 실제 선택지를 통째로 준다. Claude Code 가 모델을 추가하면 우리 코드를 고치지
/// 않아도 셀렉터에 나타난다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct AcpConfigOption {
    pub id: String,
    pub name: String,
    /// `mode` · `model` · `thought_level` … (UI 정렬·아이콘용, 없을 수 있다).
    pub category: Option<String>,
    /// 현재 값. select 면 value id, boolean 이면 `"true"`/`"false"`.
    pub current: Option<String>,
    /// select 의 선택지. boolean 항목은 빈 배열.
    pub choices: Vec<AcpConfigChoice>,
    /// true 면 토글, false 면 select.
    pub is_boolean: bool,
}

/// `session/new` 가 준 설정 항목을 프런트 모양으로 옮긴다.
pub fn map_config_options(
    options: &[agent_client_protocol::schema::v1::SessionConfigOption],
) -> Vec<AcpConfigOption> {
    use agent_client_protocol::schema::v1::{SessionConfigKind, SessionConfigSelectOptions};

    fn choice(
        option: &agent_client_protocol::schema::v1::SessionConfigSelectOption,
    ) -> AcpConfigChoice {
        AcpConfigChoice {
            value: option.value.0.to_string(),
            name: option.name.clone(),
            description: option.description.clone(),
        }
    }

    options
        .iter()
        .map(|option| {
            let (current, choices, is_boolean) = match &option.kind {
                SessionConfigKind::Select(select) => {
                    // 그룹형도 평평하게 편다 — 우리 셀렉터는 한 겹이다.
                    let flat: Vec<AcpConfigChoice> = match &select.options {
                        SessionConfigSelectOptions::Ungrouped(list) => {
                            list.iter().map(choice).collect()
                        }
                        SessionConfigSelectOptions::Grouped(groups) => groups
                            .iter()
                            .flat_map(|g| g.options.iter())
                            .map(choice)
                            .collect(),
                        // 스키마가 표현을 늘려도 셀렉터가 통째로 사라지지 않게.
                        #[allow(unreachable_patterns)]
                        _ => Vec::new(),
                    };
                    (Some(select.current_value.0.to_string()), flat, false)
                }
                SessionConfigKind::Boolean(boolean) => {
                    (Some(boolean.current_value.to_string()), Vec::new(), true)
                }
                // 크레이트가 종류를 늘려도 컴파일이 깨지지 않게 — 값 없이
                // 이름만 흘린다(삼키지 않는다).
                #[allow(unreachable_patterns)]
                _ => (None, Vec::new(), false),
            };

            AcpConfigOption {
                id: option.id.0.to_string(),
                name: option.name.clone(),
                category: option.category.as_ref().map(label),
                current,
                choices,
                is_boolean,
            }
        })
        .collect()
}

/// 한도 하나 (5시간 세션 · 주간 · 주간 Fable …).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct AcpRateLimit {
    /// 어댑터가 준 종류 문자열 (`seven_day` 등) — 우리가 이름을 지어내지 않는다.
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
/// 읽는 모양:
/// ```text
/// Current session: 0% used
/// Current week (all models): 83% used · resets Aug 16 at 4:59am (Asia/Seoul)
/// ```
pub fn parse_usage_report(text: &str) -> Vec<AcpRateLimit> {
    let mut found = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        let Some(rest) = line.strip_prefix("Current ") else {
            continue;
        };
        let Some((label, tail)) = rest.split_once(':') else {
            continue;
        };
        let tail = tail.trim();
        let Some((percent, after)) = tail.split_once("% used") else {
            continue;
        };
        let Ok(percent) = percent.trim().parse::<f64>() else {
            continue;
        };

        // "· resets Aug 16 at 4:59am (Asia/Seoul)" 에서 뒤쪽만.
        let resets_text = after
            .split_once("resets")
            .map(|(_, when)| when.trim().to_string())
            .filter(|when| !when.is_empty());

        found.push(AcpRateLimit {
            kind: label.trim().to_string(),
            utilization: (percent / 100.0).clamp(0.0, 1.0),
            resets_at: None,
            resets_text,
            status: None,
        });
    }
    found
}

/// `/usage` 답변에서 "무엇이 기여했나" 대목만 잘라낸다 (없으면 `None`).
///
/// 머리글 줄 자체는 뺀다 — 카드에 이미 제목이 있어 두 번 쓰면 시끄럽다.
pub fn parse_usage_detail(text: &str) -> Option<String> {
    let head = text.lines().position(|line| {
        line.to_lowercase()
            .contains("contributing to your limits usage")
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

/// `session_info_update` 에 실려 오는 세션 실패 기록.
///
/// 자리는 `_meta.jetbrains.air.sessionFailure` — 그 확장을 그쪽이 먼저 정의해서
/// 이름이 그렇다. `initialize` 에서 켠 클라이언트에게만 온다.
pub fn failure_of(update: &SessionUpdate) -> Option<AcpEvent> {
    let SessionUpdate::SessionInfoUpdate(info) = update else {
        return None;
    };
    let record = serde_json::to_value(info.meta.as_ref()?)
        .ok()?
        .get("jetbrains")?
        .get("air")?
        .get("sessionFailure")?
        .clone();

    let text = |key: &str| record.get(key).and_then(|v| v.as_str()).map(str::to_string);
    Some(AcpEvent::Failure {
        id: text("id")?,
        // 종류를 못 읽어도 버리지 않는다 — 제목만 있어도 사용자에게는 쓸모가
        // 있고, 조용히 삼키는 것이 가장 나쁘다.
        category: text("category").unwrap_or_else(|| "unknown".to_string()),
        severity: text("severity").unwrap_or_else(|| "error".to_string()),
        title: text("title")?,
        details: text("details"),
    })
}

/// `session_info_update` 에 실려 오는 **파일 변경 감사 보고**
/// (어댑터 0.70.0, `_meta.jetbrains.air.agentFileChangeReport`).
///
/// `sessionFailure` 와 같은 봉투·같은 확장 네임스페이스다. `initialize` 에서
/// 능력을 광고하고 프롬프트에 requestId 를 실은 클라이언트에게만 온다.
///
/// 실측 페이로드(스파이크 3):
/// ```json
/// {"version":1,"requestId":"…","status":"reported",
///  "paths":["/abs/path"],"declaredComplete":true,"truncated":false}
/// ```
pub fn file_change_report_of(update: &SessionUpdate) -> Option<AcpEvent> {
    let SessionUpdate::SessionInfoUpdate(info) = update else {
        return None;
    };
    let record = serde_json::to_value(info.meta.as_ref()?)
        .ok()?
        .get("jetbrains")?
        .get("air")?
        .get("agentFileChangeReport")?
        .clone();

    // requestId 가 없으면 어느 턴의 보고인지 이을 수 없다 — 버린다.
    let request_id = record.get("requestId")?.as_str()?.to_string();
    let status = record.get("status").and_then(|v| v.as_str()).unwrap_or("");

    // 못 받은 경우도 **이벤트로 남긴다**. 조용히 삼키면 "보고가 없다"와
    // "보고를 못 받았다"를 구분할 수 없고, 그 둘은 의미가 다르다.
    if status != "reported" {
        return Some(AcpEvent::FileChangeReport {
            request_id,
            paths: Vec::new(),
            complete: false,
            truncated: false,
            uncertainty: None,
            unavailable: Some(
                record
                    .get("reason")
                    .and_then(|v| v.as_str())
                    .unwrap_or("providerError")
                    .to_string(),
            ),
        });
    }

    let paths = record
        .get("paths")
        .and_then(|v| v.as_array())
        .map(|list| {
            list.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();

    Some(AcpEvent::FileChangeReport {
        request_id,
        paths,
        complete: record
            .get("declaredComplete")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
        truncated: record
            .get("truncated")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
        uncertainty: record
            .get("uncertainty")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        unavailable: None,
    })
}

/// 편집 도구가 만드는 파일 변경 하나 (`ToolCallContent::Diff`).
///
/// 원문(old/new) 그대로 넘기고 줄 비교는 프런트가 한다 — 여기서 통합 diff 를
/// 만들어 버리면 화면이 접기·색·통계를 다시 파싱해야 한다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct AcpToolDiff {
    /// 바뀌는 파일의 절대경로.
    pub path: String,
    /// 바뀌기 전 내용. `None` 이면 새 파일.
    pub old_text: Option<String>,
    /// 바뀐 뒤 내용.
    pub new_text: String,
}

/// 할 일 하나.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct AcpPlanEntry {
    pub content: String,
    /// `pending` · `in_progress` · `completed`.
    pub status: String,
    /// `high` · `medium` · `low`.
    pub priority: String,
}

/// 세션 제목 변경 알림에서 제목을 뽑는다.
///
/// 제목은 에이전트가 대화 내용을 보고 **나중에** 붙인다(처음엔 없다). 그래서
/// 알림으로 오고, 상단바가 그걸 따라가려면 갈무리해 둬야 한다.
pub fn title_of(update: &SessionUpdate) -> Option<String> {
    let SessionUpdate::SessionInfoUpdate(info) = update else {
        return None;
    };
    // `MaybeUndefined` 는 "안 옴"과 "null 로 지움"을 구분한다 — JSON 으로 한 번
    // 돌려 문자열일 때만 받는다(스키마가 표현을 바꿔도 안 깨진다).
    serde_json::to_value(&info.title)
        .ok()?
        .as_str()
        .map(str::to_string)
        .filter(|t| !t.is_empty())
}

/// 설정 변경 알림에서 새 설정 한 벌을 뽑는다. 그 밖의 종류면 `None`.
pub fn config_of(update: &SessionUpdate) -> Option<Vec<AcpConfigOption>> {
    match update {
        SessionUpdate::ConfigOptionUpdate(list) => Some(map_config_options(&list.config_options)),
        _ => None,
    }
}

/// 모드 변경 알림에서 새 모드 id 를 뽑는다.
///
/// `config_option_update` 와 별개로 오는 이유가 있다 — 모델 교체가 모드를
/// 무효화하면 어댑터가 모드만 따로 내린다.
pub fn mode_of(update: &SessionUpdate) -> Option<String> {
    match update {
        SessionUpdate::CurrentModeUpdate(update) => Some(update.current_mode_id.0.to_string()),
        _ => None,
    }
}

/// 슬래시 커맨드 하나 (`/plugin` 등). 어댑터가 세션 시작 때 통째로 준다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct AcpCommand {
    pub name: String,
    pub description: String,
    /// 인자 힌트 (있으면 입력창에 무엇을 더 쳐야 하는지 알려 준다).
    pub hint: Option<String>,
}

/// `available_commands_update` 에서 커맨드 목록을 뽑는다. 그 밖의 종류면 `None`.
pub fn commands_of(update: &SessionUpdate) -> Option<Vec<AcpCommand>> {
    let SessionUpdate::AvailableCommandsUpdate(list) = update else {
        return None;
    };
    Some(
        list.available_commands
            .iter()
            .map(|command| AcpCommand {
                name: command.name.clone(),
                description: command.description.clone(),
                hint: command.input.as_ref().and_then(input_hint),
            })
            .collect(),
    )
}

/// 인자 힌트는 표현이 여러 가지라 JSON 으로 한 번 돌려 `hint` 만 집는다 —
/// 스키마가 변형을 늘려도 컴파일이 깨지지 않는다.
fn input_hint(input: &agent_client_protocol::schema::v1::AvailableCommandInput) -> Option<String> {
    serde_json::to_value(input)
        .ok()?
        .get("hint")?
        .as_str()
        .map(str::to_string)
}

/// 권한 요청의 선택지 하나.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct AcpPermissionOption {
    pub id: String,
    pub name: String,
    /// `allow_once` · `allow_always` · `reject_once` … (버튼 강조에 쓴다).
    pub option_kind: String,
}

/// 프로토콜 enum 을 와이어 표기(snake_case) 문자열로. UI 가 아이콘·색을 고르는
/// 열쇠라서, 크레이트가 변형을 늘려도 문자열은 그대로 흘러가야 한다.
fn label<T: Serialize>(value: &T) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_else(|| "unknown".to_string())
}

/// 프로토콜의 `u64` 토큰 수를 프런트가 받는 `u32` 로. 넘치면 최대값.
fn saturate(value: u64) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

/// 카드에 실을 최대 길이. 도구 출력은 수 MB 도 나온다 — 화면에도 IPC 에도
/// 통째로 올릴 이유가 없다. 잘렸다는 사실은 꼬리표로 남긴다.
const TOOL_TEXT_CAP: usize = 20_000;

/// 도구 입력에서 **핵심 한 가지**를 뽑는다.
///
/// 통째로 예쁘게 찍으면 Bash 카드에 `{ "command": "...", "description": "..." }`
/// 가 그대로 뜬다 — 읽고 싶은 건 명령 한 줄인데 JSON 껍데기가 시야를 다 먹는다.
/// 아는 이름이 있으면 그 값만, 없으면 통째로 (모르는 도구의 입력을 숨기는 것보다
/// 지저분하게라도 보이는 편이 낫다).
fn primary_input(value: Option<&serde_json::Value>) -> Option<String> {
    const PRIMARY: [&str; 8] = [
        "command",
        "pattern",
        "file_path",
        "path",
        "query",
        "url",
        "prompt",
        "content",
    ];
    let object = value?.as_object()?;
    PRIMARY
        .iter()
        .find_map(|key| object.get(*key)?.as_str())
        .map(|text| clamp(text.to_string()))
}

/// 통째로 마크다운 코드펜스에 싸여 온 출력의 펜스를 벗긴다.
///
/// 어댑터는 명령 출력을 ```` ```console … ``` ```` 로 감싸 준다. 우리는 이걸
/// `<pre>` 에 평문으로 그리므로 펜스 기호가 내용인 척 그대로 보인다.
/// **전체가 하나의 펜스일 때만** 벗긴다 — 중간에 낀 코드블록은 내용이다.
pub fn strip_fence(text: &str) -> &str {
    let trimmed = text.trim();
    let Some(rest) = trimmed.strip_prefix("```") else {
        return text;
    };
    let Some(body) = rest.split_once('\n').map(|(_lang, body)| body) else {
        return text;
    };
    let Some(inner) = body.strip_suffix("```").map(str::trim_end) else {
        return text;
    };
    // 안쪽에 또 펜스가 있으면 통짜 한 덩어리가 아니다 — 건드리지 않는다.
    if inner.contains("```") {
        return text;
    }
    inner
}

/// `raw_input`/`raw_output` 을 사람이 읽을 문자열로.
///
/// 문자열이면 그대로, 그 밖의 JSON 이면 예쁘게 찍는다 — Bash 의 `{"command":
/// "ls -la"}` 를 한 줄 JSON 으로 보여 주면 카드가 읽히지 않는다.
/// `_meta.claudeCode` 의 문자열 항목 하나.
fn claude_meta<T: Serialize>(meta: Option<&T>, key: &str) -> Option<String> {
    serde_json::to_value(meta?)
        .ok()?
        .get("claudeCode")?
        .get(key)?
        .as_str()
        .map(str::to_string)
}

fn raw_text(value: Option<&serde_json::Value>) -> Option<String> {
    let value = value?;
    let text = match value {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Null => return None,
        other => serde_json::to_string_pretty(other).ok()?,
    };
    Some(clamp(text))
}

/// 도구 결과(content 블록)를 텍스트로. 텍스트가 아닌 블록은 종류만 남긴다.
fn content_text(content: &[agent_client_protocol::schema::v1::ToolCallContent]) -> Option<String> {
    use agent_client_protocol::schema::v1::ToolCallContent;

    let joined = content
        .iter()
        .filter_map(|item| match item {
            ToolCallContent::Content(inner) => block_text(&inner.content).map(str::to_string),
            // diff 는 `content_diffs` 가 구조 그대로 나른다 — 여기 자리표를 남기면
            // 같은 변경이 "[diff]" 와 diff 뷰로 두 번 보인다.
            ToolCallContent::Diff(_) => None,
            ToolCallContent::Terminal(_) => Some("[terminal]".to_string()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n");

    (!joined.is_empty()).then(|| clamp(strip_fence(&joined).to_string()))
}

/// 도구 결과(content 블록)에서 파일 변경만 뽑는다.
///
/// 양쪽 본문을 각각 상한으로 자른다 — Write 도구는 파일 전체를 실어 오는데,
/// 화면도 IPC 도 수 MB 를 받을 이유가 없다.
fn content_diffs(
    content: &[agent_client_protocol::schema::v1::ToolCallContent],
) -> Vec<AcpToolDiff> {
    use agent_client_protocol::schema::v1::ToolCallContent;

    content
        .iter()
        .filter_map(|item| match item {
            ToolCallContent::Diff(diff) => Some(AcpToolDiff {
                path: diff.path.display().to_string(),
                old_text: diff.old_text.clone().map(clamp),
                new_text: clamp(diff.new_text.clone()),
            }),
            _ => None,
        })
        .collect()
}

/// 상한을 넘으면 자르고 잘렸음을 밝힌다 (조용히 자르면 출력이 거짓말이 된다).
fn clamp(text: String) -> String {
    if text.len() <= TOOL_TEXT_CAP {
        return text;
    }
    let cut = text
        .char_indices()
        .map(|(i, _)| i)
        .take_while(|&i| i <= TOOL_TEXT_CAP)
        .last()
        .unwrap_or(0);
    format!("{}\n… (truncated)", &text[..cut])
}

/// 텍스트 블록의 본문. 이미지·오디오 등은 이 라운드에서 그리지 않는다.
fn block_text(block: &ContentBlock) -> Option<&str> {
    match block {
        ContentBlock::Text(text) => Some(text.text.as_str()),
        _ => None,
    }
}

/// `SessionUpdate` 를 프런트 이벤트로 옮긴다.
pub fn map_update(update: &SessionUpdate) -> AcpEvent {
    match update {
        SessionUpdate::AgentMessageChunk(chunk) => match block_text(&chunk.content) {
            Some(text) => AcpEvent::Chunk {
                text: text.to_string(),
            },
            None => AcpEvent::Other {
                update: "agent_message_chunk:non_text".to_string(),
            },
        },
        SessionUpdate::AgentThoughtChunk(chunk) => match block_text(&chunk.content) {
            Some(text) => AcpEvent::Thought {
                text: text.to_string(),
            },
            None => AcpEvent::Other {
                update: "agent_thought_chunk:non_text".to_string(),
            },
        },
        SessionUpdate::UsageUpdate(usage) => AcpEvent::Usage {
            used: saturate(usage.used),
            size: saturate(usage.size),
            cost_usd: usage
                .cost
                .as_ref()
                .filter(|c| c.currency == "USD")
                .map(|c| c.amount),
        },
        SessionUpdate::UserMessageChunk(chunk) => match block_text(&chunk.content) {
            Some(text) => AcpEvent::UserChunk {
                text: text.to_string(),
            },
            None => AcpEvent::Other {
                update: "user_message_chunk:non_text".to_string(),
            },
        },
        SessionUpdate::ToolCall(call) => AcpEvent::ToolCall {
            id: call.tool_call_id.0.to_string(),
            title: call.title.clone(),
            name: claude_meta(call.meta.as_ref(), "toolName"),
            subtitle: claude_meta(call.meta.as_ref(), "title"),
            tool_kind: label(&call.kind),
            status: label(&call.status),
            locations: call
                .locations
                .iter()
                .map(|l| l.path.display().to_string())
                .collect(),
            input: primary_input(call.raw_input.as_ref())
                .or_else(|| raw_text(call.raw_input.as_ref())),
            output: content_text(&call.content).or_else(|| raw_text(call.raw_output.as_ref())),
            diffs: content_diffs(&call.content),
        },
        SessionUpdate::ToolCallUpdate(update) => AcpEvent::ToolUpdate {
            id: update.tool_call_id.0.to_string(),
            title: update.fields.title.clone(),
            name: claude_meta(update.meta.as_ref(), "toolName"),
            subtitle: claude_meta(update.meta.as_ref(), "title"),
            status: update.fields.status.as_ref().map(label),
            input: primary_input(update.fields.raw_input.as_ref())
                .or_else(|| raw_text(update.fields.raw_input.as_ref())),
            output: update
                .fields
                .content
                .as_deref()
                .and_then(content_text)
                .or_else(|| raw_text(update.fields.raw_output.as_ref())),
            // content 자체가 안 왔으면 `None` — 이미 받은 diff 를 지우지 않는다.
            diffs: update.fields.content.as_deref().map(content_diffs),
        },
        SessionUpdate::Plan(plan) => AcpEvent::Plan {
            entries: plan
                .entries
                .iter()
                .map(|entry| AcpPlanEntry {
                    content: entry.content.clone(),
                    status: label(&entry.status),
                    priority: label(&entry.priority),
                })
                .collect(),
        },
        SessionUpdate::AvailableCommandsUpdate(_) => AcpEvent::Other {
            update: "available_commands_update".to_string(),
        },
        SessionUpdate::CurrentModeUpdate(update) => AcpEvent::Other {
            update: format!("current_mode_update:{}", update.current_mode_id.0),
        },
        SessionUpdate::ConfigOptionUpdate(update) => AcpEvent::ConfigChanged {
            options: map_config_options(&update.config_options),
        },
        SessionUpdate::SessionInfoUpdate(_) => AcpEvent::Other {
            update: "session_info_update".to_string(),
        },
        // 크레이트가 변형을 늘려도 컴파일이 깨지지 않게 — R2 대응.
        _ => AcpEvent::Other {
            update: "unknown".to_string(),
        },
    }
}

/// 권한 요청을 프런트 이벤트로. `request_id` 는 우리가 만든 대응 키다 —
/// 프로토콜의 JSON-RPC id 는 크레이트 안에 숨어 있어 프런트가 볼 수 없다.
pub fn permission_event(
    request_id: String,
    request: &agent_client_protocol::schema::v1::RequestPermissionRequest,
) -> AcpEvent {
    AcpEvent::Permission {
        request_id,
        // 제목이 비어 오면 프런트가 자기 폴백 문구를 쓴다 (여기서 번역하지 않는다).
        title: request.tool_call.fields.title.clone().unwrap_or_default(),
        tool_kind: request
            .tool_call
            .fields
            .kind
            .as_ref()
            .map(label)
            .unwrap_or_else(|| "other".to_string()),
        locations: request
            .tool_call
            .fields
            .locations
            .iter()
            .flatten()
            .map(|l| l.path.display().to_string())
            .collect(),
        options: request
            .options
            .iter()
            .map(|option| AcpPermissionOption {
                id: option.option_id.0.to_string(),
                name: option.name.clone(),
                option_kind: label(&option.kind),
            })
            .collect(),
        // 편집 승인이면 변경 내용이 여기 실려 온다 — 카드에 diff 가 보여야
        // "무엇을 허용하는가"에 답할 수 있다.
        diffs: request
            .tool_call
            .fields
            .content
            .as_deref()
            .map(content_diffs)
            .unwrap_or_default(),
        input: primary_input(request.tool_call.fields.raw_input.as_ref())
            .or_else(|| raw_text(request.tool_call.fields.raw_input.as_ref())),
    }
}

/// `StopReason` 을 프런트가 쓰는 문자열로. serde 표현(snake_case)을 그대로 쓴다.
pub fn stop_reason_label(reason: &agent_client_protocol::schema::v1::StopReason) -> String {
    serde_json::to_value(reason)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_else(|| "unknown".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_client_protocol::schema::v1::{
        AvailableCommandsUpdate, ContentChunk, StopReason, TextContent, UsageUpdate,
    };

    fn text_chunk(body: &str) -> ContentChunk {
        ContentChunk::new(ContentBlock::Text(TextContent::new(body.to_string())))
    }

    /// 어댑터가 보내는 `session_info_update` 봉투를 그대로 만든다.
    fn info_update(air: serde_json::Value) -> SessionUpdate {
        let mut meta = serde_json::Map::new();
        meta.insert("jetbrains".to_string(), serde_json::json!({ "air": air }));
        SessionUpdate::SessionInfoUpdate(
            agent_client_protocol::schema::v1::SessionInfoUpdate::new().meta(meta),
        )
    }

    // ── 파일 변경 감사 (어댑터 0.70.0) ─────────────────────────────────────
    // 페이로드는 스파이크 3(docs/acp-panel/spike/acp_file_change_audit_spike.py)
    // 에서 실제 어댑터로 관측한 것을 그대로 쓴다.

    #[test]
    fn file_change_report_carries_paths_and_completeness() {
        let event = file_change_report_of(&info_update(serde_json::json!({
            "agentFileChangeReport": {
                "version": 1,
                "requestId": "req-1",
                "status": "reported",
                "paths": ["/tmp/a.txt", "/tmp/b.rs"],
                "declaredComplete": true,
                "truncated": false
            }
        })));
        assert_eq!(
            event,
            Some(AcpEvent::FileChangeReport {
                request_id: "req-1".to_string(),
                paths: vec!["/tmp/a.txt".to_string(), "/tmp/b.rs".to_string()],
                complete: true,
                truncated: false,
                uncertainty: None,
                unavailable: None,
            })
        );
    }

    #[test]
    fn file_change_report_keeps_the_models_own_uncertainty() {
        // 모델이 "불완전할 수 있다"고 말한 것을 숨기면 일지가 거짓말을 한다.
        let event = file_change_report_of(&info_update(serde_json::json!({
            "agentFileChangeReport": {
                "version": 1,
                "requestId": "req-2",
                "status": "reported",
                "paths": ["/tmp/a.txt"],
                "declaredComplete": false,
                "truncated": true,
                "uncertainty": "빌드 스크립트가 만든 파일은 확인하지 못했습니다"
            }
        })));
        let Some(AcpEvent::FileChangeReport {
            complete,
            truncated,
            uncertainty,
            ..
        }) = event
        else {
            panic!("보고가 아니다: {event:?}");
        };
        assert!(!complete);
        assert!(truncated);
        assert_eq!(
            uncertainty.as_deref(),
            Some("빌드 스크립트가 만든 파일은 확인하지 못했습니다")
        );
    }

    #[test]
    fn file_change_report_surfaces_unavailable_reason() {
        // "보고가 없다"와 "보고를 못 받았다"는 다르다 — 후자도 이벤트로 남긴다.
        let event = file_change_report_of(&info_update(serde_json::json!({
            "agentFileChangeReport": {
                "version": 1,
                "requestId": "req-3",
                "status": "unavailable",
                "reason": "timeout"
            }
        })));
        assert_eq!(
            event,
            Some(AcpEvent::FileChangeReport {
                request_id: "req-3".to_string(),
                paths: Vec::new(),
                complete: false,
                truncated: false,
                uncertainty: None,
                unavailable: Some("timeout".to_string()),
            })
        );
    }

    #[test]
    fn file_change_report_ignores_other_air_extensions() {
        // 같은 봉투로 오는 sessionFailure 를 파일 변경으로 오인하면 안 된다.
        assert_eq!(
            file_change_report_of(&info_update(serde_json::json!({
                "sessionFailure": { "id": "f1", "title": "한도 초과" }
            }))),
            None
        );
        // requestId 가 없으면 어느 턴인지 이을 수 없어 버린다.
        assert_eq!(
            file_change_report_of(&info_update(serde_json::json!({
                "agentFileChangeReport": { "version": 1, "status": "reported", "paths": [] }
            }))),
            None
        );
    }

    #[test]
    fn agent_and_thought_chunks_split_into_distinct_events() {
        assert_eq!(
            map_update(&SessionUpdate::AgentMessageChunk(text_chunk("안녕"))),
            AcpEvent::Chunk {
                text: "안녕".to_string()
            }
        );
        assert_eq!(
            map_update(&SessionUpdate::AgentThoughtChunk(text_chunk("음…"))),
            AcpEvent::Thought {
                text: "음…".to_string()
            }
        );
    }

    /// 툴콜·플랜은 아직 UI 가 없지만 **삼켜지면 안 된다** — 종류가 프런트까지
    /// 가야 PR-ACP3 에서 무엇을 채울지 로그로 확인할 수 있다.
    #[test]
    fn unhandled_updates_surface_as_other_with_their_kind() {
        let event = map_update(&SessionUpdate::AvailableCommandsUpdate(
            AvailableCommandsUpdate::new(vec![]),
        ));
        assert_eq!(
            event,
            AcpEvent::Other {
                update: "available_commands_update".to_string()
            }
        );
    }

    /// 비용은 USD 만 통과시킨다 — 통화가 다른데 숫자만 뽑아 "$" 를 붙이면 거짓말이 된다.
    #[test]
    fn usage_cost_is_dropped_when_currency_is_not_usd() {
        let mut usage = UsageUpdate::new(100, 1000);
        usage.cost = Some(agent_client_protocol::schema::v1::Cost::new(
            1.5,
            "EUR".to_string(),
        ));
        let AcpEvent::Usage {
            cost_usd,
            used,
            size,
        } = map_update(&SessionUpdate::UsageUpdate(usage))
        else {
            panic!("Usage 이벤트여야 한다");
        };
        assert_eq!((used, size), (100, 1000));
        assert_eq!(cost_usd, None);
    }

    /// 도구 종류·상태는 UI 가 아이콘과 색을 고르는 열쇠다 — 와이어 표기가
    /// 그대로 흘러야 하고, 경로는 문자열로 평평해져야 한다.
    #[test]
    fn tool_call_carries_kind_status_and_locations() {
        use agent_client_protocol::schema::v1::{
            ToolCall, ToolCallId, ToolCallLocation, ToolCallStatus, ToolKind,
        };

        let mut call = ToolCall::new(ToolCallId::new("call-1"), "파일 고치기".to_string());
        call.kind = ToolKind::Edit;
        call.status = ToolCallStatus::InProgress;
        call.locations = vec![ToolCallLocation::new("/repo/src/main.rs")];

        let AcpEvent::ToolCall {
            id,
            title,
            tool_kind,
            status,
            locations,
            ..
        } = map_update(&SessionUpdate::ToolCall(call))
        else {
            panic!("ToolCall 이벤트여야 한다");
        };

        assert_eq!(id, "call-1");
        assert_eq!(title, "파일 고치기");
        assert_eq!(tool_kind, "edit");
        assert_eq!(status, "in_progress");
        assert_eq!(locations, vec!["/repo/src/main.rs".to_string()]);
    }

    /// 부분 갱신은 **온 필드만** 실어야 한다 — 안 온 필드를 기본값으로 채우면
    /// UI 가 멀쩡한 제목을 빈 문자열로 덮어쓴다.
    #[test]
    fn tool_update_only_carries_the_fields_that_changed() {
        use agent_client_protocol::schema::v1::{
            ToolCallId, ToolCallStatus, ToolCallUpdate, ToolCallUpdateFields,
        };

        let mut fields = ToolCallUpdateFields::new();
        fields.status = Some(ToolCallStatus::Completed);
        let update = ToolCallUpdate::new(ToolCallId::new("call-1"), fields);

        let AcpEvent::ToolUpdate {
            id, title, status, ..
        } = map_update(&SessionUpdate::ToolCallUpdate(update))
        else {
            panic!("ToolUpdate 이벤트여야 한다");
        };

        assert_eq!(id, "call-1");
        assert_eq!(title, None, "제목은 안 왔으니 None 이어야 한다");
        assert_eq!(status.as_deref(), Some("completed"));
    }

    /// 예전에는 객체를 통째로 예쁘게 찍었는데, 그러면 Bash 카드에
    /// `{ "command": …, "description": … }` 껍데기가 그대로 떠서 정작 읽고 싶은
    /// 명령 한 줄이 묻힌다. 아는 모양이면 알맹이만 꺼낸다.
    #[test]
    fn tool_input_pulls_the_command_out_instead_of_dumping_json() {
        use agent_client_protocol::schema::v1::{ToolCall, ToolCallId};

        let mut call = ToolCall::new(ToolCallId::new("c1"), "Bash".to_string());
        call.raw_input = Some(serde_json::json!({ "command": "ls -la", "description": "list" }));

        let AcpEvent::ToolCall { input, .. } = map_update(&SessionUpdate::ToolCall(call)) else {
            panic!("ToolCall 이어야 한다");
        };
        assert_eq!(
            input.as_deref(),
            Some("ls -la"),
            "JSON 껍데기가 남으면 안 된다"
        );

        // 모르는 모양은 통째로라도 보인다 — 숨기면 카드가 거짓말을 한다.
        let mut odd = ToolCall::new(ToolCallId::new("c3"), "Odd".to_string());
        odd.raw_input = Some(serde_json::json!({ "whatever": 3 }));
        let AcpEvent::ToolCall { input, .. } = map_update(&SessionUpdate::ToolCall(odd)) else {
            panic!("ToolCall 이어야 한다");
        };
        assert!(
            input.as_deref().unwrap_or_default().contains("whatever"),
            "모르는 입력도 보여야 한다"
        );

        let mut plain = ToolCall::new(ToolCallId::new("c2"), "Bash".to_string());
        plain.raw_input = Some(serde_json::json!("ls -la"));
        let AcpEvent::ToolCall { input, .. } = map_update(&SessionUpdate::ToolCall(plain)) else {
            panic!("ToolCall 이어야 한다");
        };
        assert_eq!(input.as_deref(), Some("ls -la"), "문자열은 그대로여야 한다");
    }

    /// 편집 도구의 변경은 구조 그대로 흘러야 한다 — 예전엔 "[diff]" 문자열로
    /// 버려서, 승인 카드도 도구 카드도 무엇이 바뀌는지 보여 줄 수 없었다.
    #[test]
    fn tool_call_carries_structured_diffs_not_a_placeholder() {
        use agent_client_protocol::schema::v1::{Diff, ToolCall, ToolCallContent, ToolCallId};

        let mut call = ToolCall::new(ToolCallId::new("c1"), "Edit".to_string());
        call.content = vec![ToolCallContent::Diff(
            Diff::new("/repo/src/lib.rs", "let x = 2;").old_text("let x = 1;".to_string()),
        )];

        let AcpEvent::ToolCall { diffs, output, .. } = map_update(&SessionUpdate::ToolCall(call))
        else {
            panic!("ToolCall 이어야 한다");
        };
        assert_eq!(diffs.len(), 1);
        assert_eq!(diffs[0].path, "/repo/src/lib.rs");
        assert_eq!(diffs[0].old_text.as_deref(), Some("let x = 1;"));
        assert_eq!(diffs[0].new_text, "let x = 2;");
        assert_eq!(
            output, None,
            "\"[diff]\" 자리표가 남으면 같은 변경이 두 번 보인다"
        );
    }

    /// content 가 안 온 갱신에서 diffs 는 `None` 이어야 한다 — `Some(vec![])` 로
    /// 오면 UI 가 이미 받은 diff 를 빈 것으로 덮어쓴다.
    #[test]
    fn tool_update_distinguishes_no_content_from_empty_diffs() {
        use agent_client_protocol::schema::v1::{
            Diff, ToolCallContent, ToolCallId, ToolCallUpdate, ToolCallUpdateFields,
        };

        let update = ToolCallUpdate::new(ToolCallId::new("c1"), ToolCallUpdateFields::new());
        let AcpEvent::ToolUpdate { diffs, .. } = map_update(&SessionUpdate::ToolCallUpdate(update))
        else {
            panic!("ToolUpdate 여야 한다");
        };
        assert_eq!(diffs, None, "content 가 안 왔으면 None");

        let mut fields = ToolCallUpdateFields::new();
        fields.content = Some(vec![ToolCallContent::Diff(Diff::new("/a", "b"))]);
        let update = ToolCallUpdate::new(ToolCallId::new("c1"), fields);
        let AcpEvent::ToolUpdate { diffs, .. } = map_update(&SessionUpdate::ToolCallUpdate(update))
        else {
            panic!("ToolUpdate 여야 한다");
        };
        assert_eq!(diffs.map(|d| d.len()), Some(1));
    }

    /// 편집 승인 카드에는 변경 내용이 실려야 한다 — 없으면 무엇을 허용하는지
    /// 못 본 채 허용을 누르게 된다.
    #[test]
    fn permission_event_carries_the_diff_being_approved() {
        use agent_client_protocol::schema::v1::{
            Diff, PermissionOption, PermissionOptionId, PermissionOptionKind,
            RequestPermissionRequest, SessionId, ToolCallContent, ToolCallId, ToolCallUpdate,
            ToolCallUpdateFields,
        };

        let mut fields = ToolCallUpdateFields::new();
        fields.content = Some(vec![ToolCallContent::Diff(
            Diff::new("/repo/a.ts", "new").old_text("old".to_string()),
        )]);
        fields.raw_input = Some(serde_json::json!({ "command": "rm -rf build" }));
        let request = RequestPermissionRequest::new(
            SessionId::new("s1"),
            ToolCallUpdate::new(ToolCallId::new("c1"), fields),
            vec![PermissionOption::new(
                PermissionOptionId::new("allow"),
                "허용".to_string(),
                PermissionOptionKind::AllowOnce,
            )],
        );

        let AcpEvent::Permission { diffs, input, .. } =
            permission_event("r1".to_string(), &request)
        else {
            panic!("Permission 이어야 한다");
        };
        assert_eq!(diffs.len(), 1);
        assert_eq!(diffs[0].path, "/repo/a.ts");
        assert_eq!(
            input.as_deref(),
            Some("rm -rf build"),
            "실행 승인은 명령이 보여야 한다"
        );
    }

    /// 조용히 자르면 출력이 거짓말이 된다 — 잘렸다는 사실이 남아야 한다.
    #[test]
    fn oversized_tool_output_is_clamped_with_a_marker() {
        use agent_client_protocol::schema::v1::{ToolCall, ToolCallId};

        let mut call = ToolCall::new(ToolCallId::new("c3"), "Bash".to_string());
        call.raw_output = Some(serde_json::json!("x".repeat(60_000)));

        let AcpEvent::ToolCall { output, .. } = map_update(&SessionUpdate::ToolCall(call)) else {
            panic!("ToolCall 이어야 한다");
        };
        let output = output.expect("출력이 실려야 한다");
        assert!(output.len() < 60_000, "상한을 넘겨서는 안 된다");
        assert!(output.ends_with("(truncated)"), "잘렸음을 밝혀야 한다");
    }

    /// `_meta` 는 확장 지점이라 벤더가 자리를 옮길 수 있다 — 키 이름이 아니라
    /// **모양**(utilization 을 가진 객체)으로 찾는지 본다.
    #[test]
    fn rate_limits_are_found_wherever_they_sit_in_meta() {
        use agent_client_protocol::schema::v1::UsageUpdate;

        let mut usage = UsageUpdate::new(52_243, 1_000_000);
        usage.meta = serde_json::from_value(serde_json::json!({
            "_claude/rateLimit": {
                "status": "allowed_warning",
                "resetsAt": 1_786_824_000_i64,
                "rateLimitType": "seven_day",
                "utilization": 0.83
            },
            "vendor": { "nested": { "rateLimitType": "five_hour", "utilization": 0.1 } }
        }))
        .expect("meta");

        let found = usage_of(&SessionUpdate::UsageUpdate(usage)).expect("Usage 여야 한다");
        let kinds: Vec<&str> = found.limits.iter().map(|l| l.kind.as_str()).collect();
        assert!(kinds.contains(&"seven_day"), "관측: {kinds:?}");
        assert!(
            kinds.contains(&"five_hour"),
            "중첩된 것도 찾아야 한다: {kinds:?}"
        );
        assert_eq!(found.used, 52_243);
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

    #[test]
    fn primary_input_picks_the_one_field_worth_reading() {
        let bash = serde_json::json!({ "command": "pnpm test", "description": "Run tests" });
        assert_eq!(primary_input(Some(&bash)).as_deref(), Some("pnpm test"));

        let read = serde_json::json!({ "file_path": "src/lib.rs", "offset": 1 });
        assert_eq!(primary_input(Some(&read)).as_deref(), Some("src/lib.rs"));
    }

    /// 모르는 도구의 입력을 숨기면 카드가 거짓말을 한다 — 통짜로라도 보인다.
    #[test]
    fn primary_input_gives_up_on_shapes_it_does_not_know() {
        let odd = serde_json::json!({ "whatever": 3 });
        assert_eq!(primary_input(Some(&odd)), None);
        assert_eq!(primary_input(Some(&serde_json::json!("plain"))), None);
    }

    #[test]
    fn strip_fence_unwraps_a_whole_fenced_block() {
        assert_eq!(strip_fence("```console\nhello\nworld\n```"), "hello\nworld");
        assert_eq!(strip_fence("```\nbare\n```"), "bare");
    }

    /// 중간에 낀 코드블록은 **내용**이다 — 벗기면 글이 망가진다.
    #[test]
    fn strip_fence_leaves_anything_that_is_not_one_whole_block() {
        let mixed = "설명\n```rs\nlet x = 1;\n```\n뒷말";
        assert_eq!(strip_fence(mixed), mixed);
        assert_eq!(strip_fence("no fence at all"), "no fence at all");
        let two = "```a\none\n```\n```b\ntwo\n```";
        assert_eq!(strip_fence(two), two);
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

    #[test]
    fn stop_reason_uses_the_wire_spelling() {
        assert_eq!(stop_reason_label(&StopReason::EndTurn), "end_turn");
        assert_eq!(stop_reason_label(&StopReason::Cancelled), "cancelled");
    }
}

/// 세션·어댑터의 **생명주기**가 바뀌었다 (완성도 라운드 Phase 4). 프롬프트
/// 스트림(`AcpEvent`, 채널)은 턴이 도는 동안만 흐르므로 제목·설정·어댑터
/// 생사·대화 목록 변화는 실을 곳이 없었고, 화면은 4초마다 세 커맨드를 물었다.
/// 이 이벤트가 그 폴링을 대신한다 — 어느 창·탭이든 같은 프로젝트면 듣는다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum AcpSessionChangeKind {
    AgentReady,
    AgentGone,
    Title,
    Options,
    Usage,
    Created,
    Selected,
    Loaded,
    Deleted,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
pub struct AcpSessionChanged {
    pub project_id: u32,
    pub provider: AcpProvider,
    pub session_id: Option<String>,
    pub kind: AcpSessionChangeKind,
}

/// 실패해도 조용히 — 이벤트는 힌트다. 놓치면 화면이 깨어날 때(`useRefetchOnWake`) 다시 읽는다.
pub fn emit_session_changed(
    app: &tauri::AppHandle,
    project_id: u32,
    provider: AcpProvider,
    session_id: Option<String>,
    kind: AcpSessionChangeKind,
) {
    use tauri_specta::Event;
    let _ = AcpSessionChanged {
        project_id,
        provider,
        session_id,
        kind,
    }
    .emit(app);
}
