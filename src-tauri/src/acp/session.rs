//! PR-ACP2 — 세션 업데이트 → 프런트 이벤트 (docs/acp-panel/00-master-plan.md §5).
//!
//! ACP 의 `session/update` 는 종류가 계속 늘어난다 — 어댑터가 2주에 6회 배포되는
//! 0.x 이기 때문이다(리스크 R2). 그래서 **모르는 종류를 에러로 다루지 않고**
//! `Other` 로 흘린다. 새 종류가 생겨도 패널이 죽지 않고, 로그에는 남는다.
//!
//! 이 라운드가 그리는 것은 텍스트뿐이다. 툴콜·플랜은 PR-ACP3/4 가 `Other` 를
//! 대체하며 채운다.

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
        /// `read` · `edit` · `execute` … (아이콘 선택용).
        tool_kind: String,
        /// `pending` · `in_progress` · `completed` · `failed`.
        status: String,
        /// 이 호출이 건드리는 파일들 (절대경로).
        locations: Vec<String>,
    },
    /// 진행 중인 도구 호출의 상태·제목이 바뀌었다. 없는 필드는 그대로 둔다.
    ToolUpdate {
        id: String,
        title: Option<String>,
        status: Option<String>,
    },
    /// 사용자 승인이 필요하다. 응답 전까지 에이전트는 멈춰 있다.
    Permission {
        request_id: String,
        title: String,
        tool_kind: String,
        /// 승인 대상 파일 — "무엇을 허용하는가"의 절반은 경로다.
        locations: Vec<String>,
        options: Vec<AcpPermissionOption>,
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
                        SessionConfigSelectOptions::Grouped(groups) => {
                            groups.iter().flat_map(|g| g.options.iter()).map(choice).collect()
                        }
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
        // 사용자 메시지 반향은 우리가 이미 그린 것이라 UI 가 무시한다.
        SessionUpdate::UserMessageChunk(_) => AcpEvent::Other {
            update: "user_message_chunk".to_string(),
        },
        SessionUpdate::ToolCall(call) => AcpEvent::ToolCall {
            id: call.tool_call_id.0.to_string(),
            title: call.title.clone(),
            tool_kind: label(&call.kind),
            status: label(&call.status),
            locations: call
                .locations
                .iter()
                .map(|l| l.path.display().to_string())
                .collect(),
        },
        SessionUpdate::ToolCallUpdate(update) => AcpEvent::ToolUpdate {
            id: update.tool_call_id.0.to_string(),
            title: update.fields.title.clone(),
            status: update.fields.status.as_ref().map(label),
        },
        SessionUpdate::Plan(_) => AcpEvent::Other {
            update: "plan".to_string(),
        },
        SessionUpdate::AvailableCommandsUpdate(_) => AcpEvent::Other {
            update: "available_commands_update".to_string(),
        },
        SessionUpdate::CurrentModeUpdate(_) => AcpEvent::Other {
            update: "current_mode_update".to_string(),
        },
        SessionUpdate::ConfigOptionUpdate(_) => AcpEvent::Other {
            update: "config_option_update".to_string(),
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
        let AcpEvent::Usage { cost_usd, used, size } = map_update(&SessionUpdate::UsageUpdate(usage))
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

        let AcpEvent::ToolUpdate { id, title, status } =
            map_update(&SessionUpdate::ToolCallUpdate(update))
        else {
            panic!("ToolUpdate 이벤트여야 한다");
        };

        assert_eq!(id, "call-1");
        assert_eq!(title, None, "제목은 안 왔으니 None 이어야 한다");
        assert_eq!(status.as_deref(), Some("completed"));
    }

    #[test]
    fn stop_reason_uses_the_wire_spelling() {
        assert_eq!(stop_reason_label(&StopReason::EndTurn), "end_turn");
        assert_eq!(stop_reason_label(&StopReason::Cancelled), "cancelled");
    }
}
