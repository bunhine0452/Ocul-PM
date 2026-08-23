//! 프런트로 건네는 좁은 타입 + 어댑터 응답 변환.
//!
//! LSP 의 `lsp/spec.rs` 와 같은 역할이다: 서버가 준 JSON 을 그대로 IPC 에 태우지
//! 않고, 화면이 쓰는 모양으로 좁혀서 보낸다. 여기 있는 변환은 전부 순수 함수라
//! 어댑터 없이 테스트된다.
//!
//! **줄·열은 1-based 다** (docs/dap/00-master-plan.md #one-based). LSP 층의
//! 0-based 와 다르므로, 두 숫자가 만나는 자리에는 반드시 주석을 단다.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;

/// 디버그 세션의 상태. 화면의 버튼 활성화가 전부 여기서 파생된다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum DapState {
    /// 세션 없음.
    Idle,
    /// 어댑터를 띄우고 initialize 협상 중.
    Starting,
    /// `initialized` 를 받아 중단점을 밀어 넣는 중.
    Configuring,
    /// 프로그램이 돌고 있다.
    Running,
    /// 중단점·스텝으로 멈췄다. 스택과 변수를 볼 수 있는 유일한 상태.
    Stopped,
    /// 끝났다 (정상 종료·크래시·사용자 중단 모두).
    Ended,
}

/// 세션 한 건의 겉모습 — 화면이 폴링 없이 이벤트로 받는다.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct DapSessionInfo {
    pub state: DapState,
    /// `rust` · `python` … 어떤 어댑터인지.
    pub language_id: String,
    /// 디버그 중인 프로그램 (프로젝트 상대면 상대로).
    pub program: String,
    /// 멈춘 이유 (`breakpoint` · `step` · `exception` …). Stopped 일 때만.
    pub stopped_reason: Option<String>,
    /// 멈춘 스레드. 스택·변수 조회의 기준.
    ///
    /// **핸들은 `f64` 로 내보낸다.** DAP 의 id 는 JSON 숫자(=JS number)라 이쪽이
    /// 오히려 원본에 충실하고, specta 는 `i64` 를 IPC 로 내보내는 것을 막는다
    /// (정밀도 손실 우려). 어댑터로 되돌릴 때만 정수로 캐스팅한다 — 실수로
    /// 직렬화하면 `682093.0` 이 되어 정수를 기대하는 어댑터가 거절한다.
    pub thread_id: Option<f64>,
    /// 사람이 읽을 부가 설명 (미설치 안내·오류 사유).
    pub detail: Option<String>,
}

/// 호출 스택 한 칸.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct DapFrame {
    /// 어댑터가 준 프레임 id — `scopes` 요청의 키. `f64` 인 이유는 위와 같다.
    pub id: f64,
    pub name: String,
    /// 프로젝트 상대 경로. 밖(표준 라이브러리·런타임)이면 `None` — 지우지 않고
    /// 흐리게 그린다 (코드 트리가 gitignore 항목을 다루는 방식과 같다).
    pub path: Option<String>,
    /// 소스가 아예 없는 프레임(최적화·인라인)도 있다.
    pub display_source: Option<String>,
    /// **1-based**.
    pub line: u32,
    pub column: u32,
}

/// 변수 하나. 트리는 펼칠 때 읽는다 — 큰 구조체를 한 번에 다 읽으면 멈춘 순간
/// 앱이 굳는다 (코드 트리의 지연 로딩과 같은 원칙).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct DapVariable {
    pub name: String,
    pub value: String,
    pub type_name: Option<String>,
    /// 0 이 아니면 펼칠 수 있다 — 그 값으로 자식을 묻는다.
    pub variables_reference: f64,
}

/// 스코프(Locals · Globals · Registers …) 한 칸.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct DapScope {
    pub name: String,
    pub variables_reference: f64,
    /// 어댑터가 "읽는 데 비싸다" 고 표시한 것 (Registers 등) — 자동으로 펼치지 않는다.
    pub expensive: bool,
}

/// 중단점 하나의 확정 상태.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct DapBreakpoint {
    /// 프로젝트 상대 경로.
    pub path: String,
    /// **1-based**. 어댑터가 다른 줄로 옮겼으면 옮긴 줄이 온다.
    pub line: u32,
    /// 어댑터가 실제로 걸 수 있다고 확인했나. `false` 면 그 줄에 코드가 없다는
    /// 뜻이라 **거터에 그 사실을 그린다** — 찍었는데 안 걸리는 이유를 모르면
    /// 사용자는 고장으로 읽는다.
    pub verified: bool,
    /// 왜 못 거는지 (어댑터가 줄 때만).
    pub message: Option<String>,
}

/// 디버그 콘솔 한 줄.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct DapOutput {
    /// `stdout` · `stderr` · `console` · `important`.
    pub category: String,
    pub text: String,
}

/// IPC 의 핸들(`f64`) → 어댑터로 보낼 **정수**.
///
/// 이걸 빼먹으면 `serde_json` 이 `3.0` 으로 직렬화하고 어댑터가 요청을 거절한다.
/// 실제로 이 라운드에서 한 번 밟았고, 통합 테스트가 `scopes` 실패로 잡았다 —
/// 그래서 캐스팅을 흩뿌리지 않고 이름 붙은 한 곳에 둔다.
pub fn wire_id(handle: f64) -> i64 {
    handle as i64
}

// ─── 변환 ───────────────────────────────────────────────────────────────────

/// `stackTrace` 응답 → 프레임 목록.
pub fn frames_from_json(body: &Value, project_root: &std::path::Path) -> Vec<DapFrame> {
    let Some(items) = body.get("stackFrames").and_then(Value::as_array) else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|f| {
            let id = f.get("id").and_then(Value::as_i64)? as f64;
            let source_path = f
                .get("source")
                .and_then(|s| s.get("path"))
                .and_then(Value::as_str);
            let rel = source_path.and_then(|p| {
                std::path::Path::new(p)
                    .strip_prefix(project_root)
                    .ok()
                    .map(|r| r.to_string_lossy().replace('\\', "/"))
            });
            // 소스가 없는 프레임도 목록에는 남긴다 — 스택의 깊이 자체가 정보다.
            let display_source = rel.clone().or_else(|| {
                source_path.map(|p| {
                    std::path::Path::new(p)
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_else(|| p.to_string())
                })
            });
            Some(DapFrame {
                id,
                name: f
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("<이름 없음>")
                    .to_string(),
                path: rel,
                display_source,
                line: f.get("line").and_then(Value::as_u64).unwrap_or(0) as u32,
                column: f.get("column").and_then(Value::as_u64).unwrap_or(0) as u32,
            })
        })
        .collect()
}

pub fn scopes_from_json(body: &Value) -> Vec<DapScope> {
    let Some(items) = body.get("scopes").and_then(Value::as_array) else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|s| {
            Some(DapScope {
                name: s.get("name").and_then(Value::as_str)?.to_string(),
                variables_reference: s
                    .get("variablesReference")
                    .and_then(Value::as_i64)
                    .unwrap_or(0) as f64,
                expensive: s.get("expensive").and_then(Value::as_bool).unwrap_or(false),
            })
        })
        .collect()
}

pub fn variables_from_json(body: &Value) -> Vec<DapVariable> {
    let Some(items) = body.get("variables").and_then(Value::as_array) else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|v| {
            Some(DapVariable {
                name: v.get("name").and_then(Value::as_str)?.to_string(),
                value: v
                    .get("value")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                type_name: v
                    .get("type")
                    .and_then(Value::as_str)
                    .filter(|t| !t.is_empty())
                    .map(str::to_string),
                variables_reference: v
                    .get("variablesReference")
                    .and_then(Value::as_i64)
                    .unwrap_or(0) as f64,
            })
        })
        .collect()
}

/// `setBreakpoints` 응답 → 확정 상태. 요청한 줄과 **순서로 짝을 맞춘다**
/// (명세가 그렇게 정한다: 응답 배열은 요청 배열과 같은 길이·같은 순서).
pub fn breakpoints_from_json(body: &Value, path: &str, requested: &[u32]) -> Vec<DapBreakpoint> {
    let items = body
        .get("breakpoints")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    requested
        .iter()
        .enumerate()
        .map(|(i, &line)| {
            let item = items.get(i);
            DapBreakpoint {
                path: path.to_string(),
                // 어댑터가 다른 줄로 옮겼으면 옮긴 줄이 진실이다.
                line: item
                    .and_then(|b| b.get("line"))
                    .and_then(Value::as_u64)
                    .unwrap_or(line as u64) as u32,
                verified: item
                    .and_then(|b| b.get("verified"))
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                message: item
                    .and_then(|b| b.get("message"))
                    .and_then(Value::as_str)
                    .filter(|m| !m.is_empty())
                    .map(str::to_string),
            }
        })
        .collect()
}

/// `output` 이벤트 → 콘솔 한 줄. 내용이 없으면 `None`.
pub fn output_from_json(body: &Value) -> Option<DapOutput> {
    let text = body.get("output").and_then(Value::as_str)?;
    if text.is_empty() {
        return None;
    }
    Some(DapOutput {
        category: body
            .get("category")
            .and_then(Value::as_str)
            .unwrap_or("console")
            .to_string(),
        text: text.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::path::Path;

    fn root() -> &'static Path {
        Path::new("/proj")
    }

    #[test]
    fn frames_mark_out_of_project_sources() {
        // 실측 스택의 모양 그대로 — 세 번째는 표준 라이브러리다.
        let body = json!({ "stackFrames": [
            { "id": 1, "name": "demo::add", "line": 2, "column": 5,
              "source": { "path": "/proj/src/demo.rs" } },
            { "id": 2, "name": "core::ops::function::FnOnce::call_once", "line": 250,
              "source": { "path": "/rustc/lib/core/src/ops/function.rs" } },
            // 소스가 아예 없는 프레임 (최적화·인라인).
            { "id": 3, "name": "<unknown>", "line": 0, "column": 0 },
        ]});
        let got = frames_from_json(&body, root());
        assert_eq!(got.len(), 3, "소스가 없어도 목록에는 남는다 — 깊이 자체가 정보다");
        assert_eq!(got[0].path.as_deref(), Some("src/demo.rs"));
        assert_eq!(got[0].line, 2, "1-based 그대로 (LSP 와 달리 여기서 +1 하지 않는다)");
        assert!(got[1].path.is_none(), "프로젝트 밖은 열 수 없다");
        assert_eq!(got[1].display_source.as_deref(), Some("function.rs"), "그래도 어디인지는 말한다");
        assert!(got[2].display_source.is_none());
    }

    #[test]
    fn scopes_and_variables_keep_the_expansion_handle() {
        let scopes = scopes_from_json(&json!({ "scopes": [
            { "name": "Locals", "variablesReference": 1, "expensive": false },
            { "name": "Registers", "variablesReference": 3, "expensive": true },
        ]}));
        assert_eq!(scopes.len(), 2);
        assert!(!scopes[0].expensive);
        assert!(scopes[1].expensive, "비싼 스코프는 자동으로 펼치지 않는다");

        let vars = variables_from_json(&json!({ "variables": [
            { "name": "a", "value": "2", "type": "long", "variablesReference": 0 },
            { "name": "list", "value": "Vec(3)", "variablesReference": 7 },
        ]}));
        assert_eq!(vars[0].variables_reference, 0.0, "0 = 펼칠 것 없음");
        assert_eq!(vars[1].variables_reference, 7.0);
        assert_eq!(vars[1].type_name, None, "빈 type 은 없는 것으로");
    }

    #[test]
    fn breakpoints_pair_by_order_and_follow_the_adapter() {
        // 어댑터가 12행 요청을 13행으로 옮겼다 — 옮긴 줄이 진실이다.
        let body = json!({ "breakpoints": [
            { "verified": true, "line": 13 },
            { "verified": false, "message": "no code at this line" },
        ]});
        let got = breakpoints_from_json(&body, "src/a.rs", &[12, 40]);
        assert_eq!(got.len(), 2);
        assert_eq!((got[0].line, got[0].verified), (13, true));
        // 못 거는 중단점은 요청한 줄에 남기되 이유를 들고 있다.
        assert_eq!((got[1].line, got[1].verified), (40, false));
        assert_eq!(got[1].message.as_deref(), Some("no code at this line"));
    }

    #[test]
    fn breakpoints_survive_a_short_or_missing_response() {
        // 어댑터가 응답을 덜 보내도 요청한 자리는 전부 남는다 (미확정으로).
        let got = breakpoints_from_json(&json!({}), "src/a.rs", &[3, 9]);
        assert_eq!(got.len(), 2);
        assert!(got.iter().all(|b| !b.verified));
        assert_eq!(got[1].line, 9);
    }

    #[test]
    fn handles_go_back_to_the_adapter_as_integers() {
        // 정수가 아니면 어댑터가 요청을 거절한다 (실측).
        assert_eq!(serde_json::json!({ "frameId": wire_id(3.0) }).to_string(), r#"{"frameId":3}"#);
        assert_eq!(wire_id(682093.0), 682093);
    }

    #[test]
    fn output_events_drop_empty_text() {
        assert!(output_from_json(&json!({ "output": "" })).is_none());
        assert!(output_from_json(&json!({})).is_none());
        let got = output_from_json(&json!({ "category": "stderr", "output": "쾅\n" })).unwrap();
        assert_eq!((got.category.as_str(), got.text.as_str()), ("stderr", "쾅\n"));
        // category 가 없으면 console 로 본다.
        assert_eq!(output_from_json(&json!({ "output": "x" })).unwrap().category, "console");
    }
}
