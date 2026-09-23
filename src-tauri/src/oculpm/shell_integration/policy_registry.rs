//! Windows — 실행 정책의 범위별 값을 레지스트리·설정 파일에서 읽는다.
//! 판정 규칙과 근거는 [`super::policy_scopes`]. 여기는 읽기만 한다.
//!
//! 읽기 실패는 전부 [`Scope::Unsure`] 로 — 조용히 Undefined 로 두면 뒤 범위가
//! 잘못 이긴다.

use std::path::Path;
use std::ptr::null_mut;

use windows_sys::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS};
use windows_sys::Win32::System::Registry::{
    RegCloseKey, RegGetValueW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE,
    KEY_READ, RRF_RT_ANY, RRF_RT_REG_SZ,
};

use super::policy_scopes::{
    core_config, core_default, desktop_default, first_decided, scope_value, CoreConfig, Scope,
    Scopes,
};
use super::powershell::Edition;

/// 5.1 의 CurrentUser/LocalMachine (`ExecutionPolicy` 값).
const SHELL_IDS: &str = r"Software\Microsoft\PowerShell\1\ShellIds\Microsoft.PowerShell";
/// 5.1 의 그룹 정책 "Turn on Script Execution".
const WINDOWS_POWERSHELL_POLICIES: &str = r"Software\Policies\Microsoft\Windows\PowerShell";
/// PowerShell 7 의 그룹 정책 (PowerShellCoreExecutionPolicy.admx).
const CORE_POLICIES: &str = r"Software\Policies\Microsoft\PowerShellCore";
/// 워크스테이션·서버 판별.
const PRODUCT_OPTIONS: &str = r"SYSTEM\CurrentControlSet\Control\ProductOptions";
/// PowerShell 7 의 설정 파일 이름.
const CONFIG_FILE: &str = "powershell.config.json";

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}

fn root_name(root: HKEY) -> &'static str {
    if root == HKEY_LOCAL_MACHINE {
        "HKLM"
    } else {
        "HKCU"
    }
}

/// REG_SZ 값 하나. 키나 값이 없으면 `Ok(None)`.
fn reg_sz(root: HKEY, subkey: &str, value: &str) -> Result<Option<String>, String> {
    let (sk, v) = (wide(subkey), wide(value));
    let where_ = || format!(r"{}\{subkey}\{value}", root_name(root));
    let mut bytes: u32 = 0;
    // SAFETY: 키·값 이름은 NUL 로 끝나는 살아 있는 UTF-16 버퍼다. 데이터 포인터가
    // null 이면 크기만 돌려받는다 (pcbData 는 null 이 아니다).
    let rc = unsafe {
        RegGetValueW(
            root,
            sk.as_ptr(),
            v.as_ptr(),
            RRF_RT_REG_SZ,
            null_mut(),
            null_mut(),
            &mut bytes,
        )
    };
    if rc == ERROR_FILE_NOT_FOUND {
        return Ok(None);
    }
    if rc != ERROR_SUCCESS {
        return Err(format!("{}: RegGetValueW error {rc}", where_()));
    }
    let mut buf = vec![0u16; (bytes as usize).div_ceil(2) + 1];
    let mut len = u32::try_from(buf.len() * 2).unwrap_or(u32::MAX);
    // SAFETY: `buf` 는 `len` 바이트를 담을 수 있고 호출 동안 살아 있다.
    let rc = unsafe {
        RegGetValueW(
            root,
            sk.as_ptr(),
            v.as_ptr(),
            RRF_RT_REG_SZ,
            null_mut(),
            buf.as_mut_ptr().cast(),
            &mut len,
        )
    };
    if rc == ERROR_FILE_NOT_FOUND {
        return Ok(None);
    }
    if rc != ERROR_SUCCESS {
        return Err(format!("{}: RegGetValueW error {rc}", where_()));
    }
    let chars = (len as usize / 2).min(buf.len());
    Ok(Some(
        String::from_utf16_lossy(&buf[..chars])
            .trim_end_matches('\0')
            .to_string(),
    ))
}

/// 값이 (형식과 상관없이) 있는가.
fn value_exists(root: HKEY, subkey: &str, value: &str) -> Result<bool, String> {
    let (sk, v) = (wide(subkey), wide(value));
    // SAFETY: 데이터·크기 포인터가 둘 다 null 이면 존재만 확인한다 (문서화된 사용).
    let rc = unsafe {
        RegGetValueW(
            root,
            sk.as_ptr(),
            v.as_ptr(),
            RRF_RT_ANY,
            null_mut(),
            null_mut(),
            null_mut(),
        )
    };
    match rc {
        ERROR_SUCCESS => Ok(true),
        ERROR_FILE_NOT_FOUND => Ok(false),
        rc => Err(format!(
            r"{}\{subkey}\{value}: RegGetValueW error {rc}",
            root_name(root)
        )),
    }
}

/// 키가 있는가.
fn key_exists(root: HKEY, subkey: &str) -> Result<bool, String> {
    let sk = wide(subkey);
    let mut key: HKEY = null_mut();
    // SAFETY: 이름은 NUL 로 끝나는 UTF-16, 결과 핸들은 성공했을 때만 닫는다.
    let rc = unsafe { RegOpenKeyExW(root, sk.as_ptr(), 0, KEY_READ, &mut key) };
    match rc {
        ERROR_SUCCESS => {
            // SAFETY: 방금 연 유효한 핸들.
            unsafe { RegCloseKey(key) };
            Ok(true)
        }
        ERROR_FILE_NOT_FOUND => Ok(false),
        rc => Err(format!(
            r"{}\{subkey}: RegOpenKeyExW error {rc}",
            root_name(root)
        )),
    }
}

fn unsure(e: String) -> Scope {
    Scope::Unsure(e)
}

/// 5.1 의 그룹 정책 — "Turn on Script Execution" 값이 하나라도 있으면 모른다.
fn windows_powershell_gpo(root: HKEY) -> Scope {
    for value in ["EnableScripts", "ExecutionPolicy"] {
        match value_exists(root, WINDOWS_POWERSHELL_POLICIES, value) {
            Ok(false) => {}
            Ok(true) => {
                return unsure(format!(
                    r#"Group Policy "Turn on Script Execution" is configured ({}\{WINDOWS_POWERSHELL_POLICIES}\{value})"#,
                    root_name(root)
                ))
            }
            Err(e) => return unsure(e),
        }
    }
    Scope::Undefined
}

/// PowerShell 7 의 그룹 정책 — 키가 있으면 모른다
/// (`Use Windows PowerShell Policy setting` 의 해석이 문서에 없다).
fn core_gpo(root: HKEY) -> Scope {
    match key_exists(root, CORE_POLICIES) {
        Ok(false) => Scope::Undefined,
        Ok(true) => unsure(format!(
            r"PowerShell 7 Group Policy is configured ({}\{CORE_POLICIES})",
            root_name(root)
        )),
        Err(e) => unsure(e),
    }
}

fn registry_scope(root: HKEY, subkey: &str, value: &str) -> Scope {
    match reg_sz(root, subkey, value) {
        Ok(v) => scope_value(v.as_deref()),
        Err(e) => unsure(e),
    }
}

/// `powershell.config.json` 하나 (없으면 두 범위 모두 Undefined).
fn config_file(path: &Path) -> CoreConfig {
    match std::fs::read_to_string(path) {
        Ok(text) => core_config(Some(&text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => core_config(None),
        Err(e) => {
            let why = format!("{}: {e}", path.display());
            CoreConfig {
                policies: unsure(why.clone()),
                execution_policy: unsure(why),
            }
        }
    }
}

/// 이 셸의 범위들을 읽는다. `documents` 는 알려진 폴더 "문서".
pub(super) fn read_scopes(edition: Edition, shell_path: &str, documents: Option<&Path>) -> Scopes {
    let process = scope_value(std::env::var("PSExecutionPolicyPreference").ok().as_deref());
    match edition {
        Edition::Desktop => Scopes {
            machine_policy: windows_powershell_gpo(HKEY_LOCAL_MACHINE),
            user_policy: windows_powershell_gpo(HKEY_CURRENT_USER),
            process,
            current_user: registry_scope(HKEY_CURRENT_USER, SHELL_IDS, "ExecutionPolicy"),
            local_machine: registry_scope(HKEY_LOCAL_MACHINE, SHELL_IDS, "ExecutionPolicy"),
            default: match reg_sz(HKEY_LOCAL_MACHINE, PRODUCT_OPTIONS, "ProductType") {
                Ok(t) => desktop_default(t.as_deref()),
                Err(e) => unsure(e),
            },
        },
        Edition::Core => {
            let user = match documents {
                Some(docs) => config_file(&docs.join("PowerShell").join(CONFIG_FILE)),
                None => {
                    let why = "the Documents folder is unknown".to_string();
                    CoreConfig {
                        policies: unsure(why.clone()),
                        execution_policy: unsure(why),
                    }
                }
            };
            // $PSHOME = pwsh.exe 옆에 pwsh.dll 이 있는 설치 폴더. 앱 실행 별칭
            // (WindowsApps) 같은 다른 자리면 설정 파일 자리를 모른다.
            let all_users = match Path::new(shell_path).parent() {
                Some(home) if home.join("pwsh.dll").is_file() => {
                    config_file(&home.join(CONFIG_FILE))
                }
                _ => {
                    let why = format!("$PSHOME is not next to {shell_path}");
                    CoreConfig {
                        policies: unsure(why.clone()),
                        execution_policy: unsure(why),
                    }
                }
            };
            Scopes {
                machine_policy: first_decided(core_gpo(HKEY_LOCAL_MACHINE), all_users.policies),
                user_policy: first_decided(core_gpo(HKEY_CURRENT_USER), user.policies),
                process,
                current_user: user.execution_policy,
                local_machine: all_users.execution_policy,
                default: core_default(),
            }
        }
    }
}
