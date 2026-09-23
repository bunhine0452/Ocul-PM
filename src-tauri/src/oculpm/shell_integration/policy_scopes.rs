//! 실행 정책을 **셸 없이** 판정한다 — 저장소에서 범위(scope)별 값을 읽어 문서의
//! 우선순위대로 접는다. 셸을 띄워 묻는 길([`super::policy`])은 부하 걸린 PC 에서
//! 콜드 스타트만 45초를 넘겼다(run 35893773736 뒤, PR #35 의 `[policy-probe]` 계측).
//!
//! # 근거 (Microsoft Learn)
//!
//! - 우선순위: MachinePolicy → UserPolicy → Process → CurrentUser → LocalMachine,
//!   전부 Undefined 면 기본값.
//!   <https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_execution_policies?view=powershell-5.1>
//! - Windows PowerShell 5.1: CurrentUser/LocalMachine 은 `HK{CU,LM}\Software\Microsoft\
//!   PowerShell\1\ShellIds\Microsoft.PowerShell` 의 `ExecutionPolicy`, Process 는
//!   `$Env:PSExecutionPolicyPreference`, 기본값은 **클라이언트 Restricted · 서버
//!   RemoteSigned** (같은 문서 — 일관된다).
//! - PowerShell 7: CurrentUser/LocalMachine 은 사용자 폴더와 `$PSHOME` 의
//!   `powershell.config.json` 의 `Microsoft.PowerShell:ExecutionPolicy`, 그리고
//!   `PowerShellPolicies.ScriptExecution` 이 그보다 앞선다.
//!   <https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_powershell_config?view=powershell-7.5>
//!
//! 판정 표는 세 OS 러너에서 테스트하지만 저장소를 읽어 쓰는 곳은 Windows 뿐이다.
//!
//! # 모르는 것은 모른다고 한다 ([`Scope::Unsure`])
//!
//! 셸로 물러서는 경우 — 판정이 틀리면 창마다 오류가 뜨는 프로필을 쓰게 되므로:
//!
//! - **그룹 정책**이 조금이라도 걸려 있으면. 문서는 GPO 의 효과는 적지만 레지스트리
//!   값 이름·`Use Windows PowerShell Policy setting` 의 해석은 적지 않는다.
//! - **PowerShell 7 에서 아무 범위도 정해지지 않았을 때.** 7.5 문서가 스스로
//!   어긋난다 — `Default` 는 "RemoteSigned for Windows clients and servers" 라면서
//!   `Undefined` 는 "Restricted for Windows clients" 라고 한다. 설치본은 `$PSHOME`
//!   의 설정 파일로 LocalMachine 을 정해 두므로 보통은 여기까지 오지 않는다.
//! - 알 수 없는 값, 읽기 오류, 깨진 JSON, `$PSHOME` 을 못 찾음.

#![cfg_attr(not(windows), allow(dead_code))]

/// 정해진 실행 정책.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Policy {
    Restricted,
    AllSigned,
    RemoteSigned,
    Unrestricted,
    Bypass,
}

impl Policy {
    pub(super) fn name(self) -> &'static str {
        match self {
            Policy::Restricted => "Restricted",
            Policy::AllSigned => "AllSigned",
            Policy::RemoteSigned => "RemoteSigned",
            Policy::Unrestricted => "Unrestricted",
            Policy::Bypass => "Bypass",
        }
    }

    fn parse(raw: &str) -> Option<Policy> {
        [
            Policy::Restricted,
            Policy::AllSigned,
            Policy::RemoteSigned,
            Policy::Unrestricted,
            Policy::Bypass,
        ]
        .into_iter()
        .find(|p| p.name().eq_ignore_ascii_case(raw.trim()))
    }
}

/// 한 범위에서 읽은 것.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Scope {
    /// 이 범위는 정하지 않았다 — 다음 범위로.
    Undefined,
    Set(Policy),
    /// 무엇인지 확실하지 않다 — 이유. 셸로 물러선다.
    Unsure(String),
}

/// 우선순위 순서 그대로의 범위들 + 기본값.
#[derive(Debug, Clone)]
pub(super) struct Scopes {
    pub(super) machine_policy: Scope,
    pub(super) user_policy: Scope,
    pub(super) process: Scope,
    pub(super) current_user: Scope,
    pub(super) local_machine: Scope,
    /// 전부 Undefined 일 때.
    pub(super) default: Scope,
}

/// 실효 정책 — 첫 번째로 정해진 범위. 그 앞에 확실하지 않은 범위가 있으면 `Err`.
/// 순수 함수.
pub(super) fn effective(s: &Scopes) -> Result<Policy, String> {
    let ordered = [
        ("MachinePolicy", &s.machine_policy),
        ("UserPolicy", &s.user_policy),
        ("Process", &s.process),
        ("CurrentUser", &s.current_user),
        ("LocalMachine", &s.local_machine),
        ("default", &s.default),
    ];
    for (name, scope) in ordered {
        match scope {
            Scope::Undefined => continue,
            Scope::Set(policy) => return Ok(*policy),
            Scope::Unsure(why) => return Err(format!("{name}: {why}")),
        }
    }
    Err("default: no default was given".to_string())
}

/// 저장된 값 하나(레지스트리 문자열·환경변수·JSON 문자열)를 범위로.
pub(super) fn scope_value(raw: Option<&str>) -> Scope {
    let Some(raw) = raw else {
        return Scope::Undefined;
    };
    let value = raw.trim();
    if value.is_empty() || value.eq_ignore_ascii_case("Undefined") {
        return Scope::Undefined;
    }
    match Policy::parse(value) {
        Some(policy) => Scope::Set(policy),
        None => Scope::Unsure(format!("unrecognised value {value:?}")),
    }
}

/// Windows PowerShell 5.1 의 기본값 — `ProductOptions\ProductType` 으로 클라이언트와
/// 서버를 가른다 (`WinNT` = 워크스테이션, `ServerNT`·`LanmanNT` = 서버·DC).
pub(super) fn desktop_default(product_type: Option<&str>) -> Scope {
    match product_type.map(str::trim) {
        Some(t) if t.eq_ignore_ascii_case("WinNT") => Scope::Set(Policy::Restricted),
        Some(t) if t.eq_ignore_ascii_case("ServerNT") || t.eq_ignore_ascii_case("LanmanNT") => {
            Scope::Set(Policy::RemoteSigned)
        }
        other => Scope::Unsure(format!("unknown Windows product type {other:?}")),
    }
}

/// PowerShell 7 의 기본값 — 문서가 어긋나 모른다 (모듈 문서).
pub(super) fn core_default() -> Scope {
    Scope::Unsure(
        "no scope is set, and the PowerShell 7 docs disagree on the default \
         (Restricted vs RemoteSigned on Windows clients)"
            .to_string(),
    )
}

/// `powershell.config.json` 하나에서 읽은 두 가지.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct CoreConfig {
    /// `PowerShellPolicies.ScriptExecution` — 정책(GPO) 급. 있으면 Unsure.
    pub(super) policies: Scope,
    /// `Microsoft.PowerShell:ExecutionPolicy` — 이 파일의 범위(CurrentUser/LocalMachine).
    pub(super) execution_policy: Scope,
}

const EXECUTION_POLICY_KEY: &str = "Microsoft.PowerShell:ExecutionPolicy";

/// `powershell.config.json` 의 내용(없으면 `None`)을 읽는다. 순수 함수.
pub(super) fn core_config(text: Option<&str>) -> CoreConfig {
    let Some(text) = text else {
        return CoreConfig {
            policies: Scope::Undefined,
            execution_policy: Scope::Undefined,
        };
    };
    let unsure = |why: String| CoreConfig {
        policies: Scope::Unsure(why.clone()),
        execution_policy: Scope::Unsure(why),
    };
    let json: serde_json::Value = match serde_json::from_str(text.trim_start_matches('\u{feff}')) {
        Ok(v) => v,
        Err(e) => return unsure(format!("powershell.config.json is not plain JSON ({e})")),
    };
    let Some(map) = json.as_object() else {
        return unsure("powershell.config.json is not a JSON object".to_string());
    };
    let key_like = |want: &str| map.iter().find(|(k, _)| k.eq_ignore_ascii_case(want));

    let policies = match key_like("PowerShellPolicies").and_then(|(_, v)| v.as_object()) {
        Some(p) if p.keys().any(|k| k.eq_ignore_ascii_case("ScriptExecution")) => {
            Scope::Unsure("PowerShellPolicies.ScriptExecution is set".to_string())
        }
        _ => Scope::Undefined,
    };
    let execution_policy = match map.get(EXECUTION_POLICY_KEY) {
        Some(serde_json::Value::String(s)) => scope_value(Some(s)),
        Some(other) => Scope::Unsure(format!("{EXECUTION_POLICY_KEY} is not a string: {other}")),
        None => match key_like(EXECUTION_POLICY_KEY) {
            Some((k, _)) => Scope::Unsure(format!("key spelled {k:?}")),
            None => Scope::Undefined,
        },
    };
    CoreConfig {
        policies,
        execution_policy,
    }
}

/// 두 출처가 한 범위를 이룰 때(그룹 정책 + 설정 파일의 정책) — 먼저 정해진 쪽.
pub(super) fn first_decided(first: Scope, second: Scope) -> Scope {
    if first == Scope::Undefined {
        second
    } else {
        first
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scopes(m: Scope, u: Scope, p: Scope, cu: Scope, lm: Scope, d: Scope) -> Scopes {
        Scopes {
            machine_policy: m,
            user_policy: u,
            process: p,
            current_user: cu,
            local_machine: lm,
            default: d,
        }
    }
    use Scope::{Set, Undefined};

    fn unsure(why: &str) -> Scope {
        Scope::Unsure(why.to_string())
    }

    /// 문서의 예 — CurrentUser RemoteSigned 가 LocalMachine AllSigned 를 이긴다.
    #[test]
    fn precedence_follows_the_documented_order() {
        let docs_example = scopes(
            Undefined,
            Undefined,
            Undefined,
            Set(Policy::RemoteSigned),
            Set(Policy::AllSigned),
            Set(Policy::Restricted),
        );
        assert_eq!(effective(&docs_example), Ok(Policy::RemoteSigned));

        let process_wins = scopes(
            Undefined,
            Undefined,
            Set(Policy::Bypass),
            Set(Policy::Restricted),
            Undefined,
            Set(Policy::Restricted),
        );
        assert_eq!(effective(&process_wins), Ok(Policy::Bypass));

        let policy_wins = scopes(
            Set(Policy::AllSigned),
            Set(Policy::Unrestricted),
            Set(Policy::Bypass),
            Undefined,
            Undefined,
            Undefined,
        );
        assert_eq!(effective(&policy_wins), Ok(Policy::AllSigned));

        let nothing_set = scopes(
            Undefined,
            Undefined,
            Undefined,
            Undefined,
            Undefined,
            Set(Policy::Restricted),
        );
        assert_eq!(effective(&nothing_set), Ok(Policy::Restricted));
    }

    /// 앞 범위가 확실하지 않으면 뒤를 보지 않는다 — 뒤의 값이 이긴다는 보장이 없다.
    #[test]
    fn an_unsure_scope_before_the_answer_means_we_do_not_know() {
        let gpo = scopes(
            unsure("Group Policy"),
            Undefined,
            Undefined,
            Set(Policy::RemoteSigned),
            Undefined,
            Undefined,
        );
        assert_eq!(
            effective(&gpo),
            Err("MachinePolicy: Group Policy".to_string())
        );

        // 앞에서 정해졌으면 뒤의 모름은 상관없다.
        let decided_first = scopes(
            Undefined,
            Undefined,
            Undefined,
            Set(Policy::RemoteSigned),
            unsure("broken json"),
            unsure("docs disagree"),
        );
        assert_eq!(effective(&decided_first), Ok(Policy::RemoteSigned));

        let core_nothing = scopes(
            Undefined,
            Undefined,
            Undefined,
            Undefined,
            Undefined,
            core_default(),
        );
        assert!(effective(&core_nothing)
            .unwrap_err()
            .starts_with("default:"));
    }

    #[test]
    fn stored_values_are_read_case_insensitively_and_unknown_ones_are_unsure() {
        assert_eq!(scope_value(None), Undefined);
        assert_eq!(scope_value(Some("")), Undefined);
        assert_eq!(scope_value(Some("Undefined")), Undefined);
        assert_eq!(
            scope_value(Some(" remotesigned ")),
            Set(Policy::RemoteSigned)
        );
        assert_eq!(scope_value(Some("Unrestricted")), Set(Policy::Unrestricted));
        assert!(matches!(scope_value(Some("Default")), Scope::Unsure(_)));
        assert!(matches!(scope_value(Some("Whatever")), Scope::Unsure(_)));
    }

    /// 5.1 의 기본값 — 문서: 클라이언트 Restricted, 서버 RemoteSigned.
    #[test]
    fn windows_powershell_default_depends_on_the_sku() {
        assert_eq!(desktop_default(Some("WinNT")), Set(Policy::Restricted));
        assert_eq!(desktop_default(Some("ServerNT")), Set(Policy::RemoteSigned));
        assert_eq!(desktop_default(Some("LanmanNT")), Set(Policy::RemoteSigned));
        assert!(matches!(desktop_default(None), Scope::Unsure(_)));
        assert!(matches!(desktop_default(Some("Other")), Scope::Unsure(_)));
        assert!(matches!(core_default(), Scope::Unsure(_)));
    }

    #[test]
    fn powershell_7_config_files() {
        assert_eq!(
            core_config(None),
            CoreConfig {
                policies: Undefined,
                execution_policy: Undefined
            }
        );
        // 설치본이 $PSHOME 에 두는 모양 (BOM 포함).
        let shipped = "\u{feff}{\"Microsoft.PowerShell:ExecutionPolicy\":\"RemoteSigned\",\
                       \"WindowsPowerShellCompatibilityModuleDenyList\":[\"PSScheduledJob\"]}";
        assert_eq!(
            core_config(Some(shipped)),
            CoreConfig {
                policies: Undefined,
                execution_policy: Set(Policy::RemoteSigned)
            }
        );
        let no_key = core_config(Some("{\"ExperimentalFeatures\":[]}"));
        assert_eq!(no_key.execution_policy, Undefined);

        let policy_set = core_config(Some(
            "{\"PowerShellPolicies\":{\"ScriptExecution\":{\"ExecutionPolicy\":\"AllSigned\"}}}",
        ));
        assert!(matches!(policy_set.policies, Scope::Unsure(_)));

        for broken in [
            "{ // comment\n \"Microsoft.PowerShell:ExecutionPolicy\": \"RemoteSigned\" }",
            "[1,2]",
            "{\"Microsoft.PowerShell:ExecutionPolicy\": 3}",
            "{\"microsoft.powershell:executionpolicy\": \"RemoteSigned\"}",
        ] {
            assert!(
                matches!(core_config(Some(broken)).execution_policy, Scope::Unsure(_)),
                "{broken}"
            );
        }
    }

    #[test]
    fn group_policy_and_config_policy_form_one_scope() {
        assert_eq!(first_decided(Undefined, Undefined), Undefined);
        assert_eq!(first_decided(Undefined, unsure("cfg")), unsure("cfg"));
        assert_eq!(first_decided(unsure("gpo"), Undefined), unsure("gpo"));
    }
}
