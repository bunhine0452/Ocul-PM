//! Core Model — 배경 작업 전용 모델 슬롯 (Decision 2).
//!
//! # 왜 별도 슬롯인가
//!
//! 자동 화해·일지 초안·스케줄·감시는 **배경에서 조용히, 자주, 과금되며** 돈다.
//! 지금까지 이들은 대화용 `default_provider`/`default_model` 을 그대로 썼다 —
//! 사용자가 대화 모델을 비싼 것으로 바꾸면 배경 비용이 말없이 따라 올랐고,
//! 그 사실이 어디에도 보이지 않았다.
//!
//! 그래서 `core_provider`/`core_model` 을 신설한다. 배경 작업은 **오직** 이
//! 슬롯을 읽는다. 미설정이면 그 작업은 성립 불가 → 조용히 스킵
//! (`journal_draft` 의 "자격증명 없으면 조용히 스킵" 과 같은 규약).
//!
//! # 신규엔 게이트, 기존엔 시드
//!
//! 강제만 하면 이미 `auto_reconcile` 을 켜 둔 사용자는 업데이트 순간 그 기능을
//! **말없이 잃는다.** D2 의 취지는 "몰랐는데 과금됐다" 를 막는 것이지 "잘 되던 게
//! 멈췄다" 를 만드는 게 아니다. [`seed_if_automation_enabled`] 이 그 다리다 —
//! 자동화가 켜져 있는데 `core_*` 가 비었으면 `default_*` 를 **1회** 복사한다.
//! 동작 변화 0. 둘 다 꺼져 있으면 시드하지 않는다 (처음 켤 때 고르게).

use crate::commands::llm::ProviderModel;
use crate::db::Db;

/// 배경 작업 모델 슬롯 (SQLite `settings`).
pub const CORE_PROVIDER_KEY: &str = "core_provider";
pub const CORE_MODEL_KEY: &str = "core_model";
/// 1회 시드가 일어났다는 표식 — 업데이트 뒤 안내 카드가 이걸 보고 한 번 뜬다.
/// 카드를 닫으면 빈 문자열로 되돌린다 (`lastSeenVersion` 과 같은 규약).
pub const CORE_MODEL_SEEDED_KEY: &str = "core_model_seeded";

/// 사용자가 고른 실패 대비 체인 (`Settings → LLM → 폴백 체인`). 프런트의
/// `parseFallbacks` 와 **같은 문법**을 읽는다 — 한 줄에 `provider:model`.
const FALLBACK_MODELS_KEY: &str = "fallback_models";

/// `llm::create` 가 아는 프로바이더. 프런트 `PROVIDERS` 와 같은 목록이며,
/// 모르는 이름의 폴백 줄은 조용히 버린다.
const KNOWN_PROVIDERS: &[&str] = &["anthropic", "openai", "gemini", "nim", "openrouter"];

/// 배경 작업이 부를 대상 — 1순위 + 폴백 체인.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CoreTarget {
    pub provider: String,
    pub model: String,
    /// 1순위가 실패하면 순서대로 재시도한다 (`commands::llm::chat` 가 소비).
    pub fallbacks: Vec<ProviderModel>,
}

impl CoreTarget {
    /// 시도 목록 중 키체인에 키가 있는 것이 하나라도 있는가. 하나도 없으면
    /// 이 작업은 성립 불가 → 호출부가 조용히 스킵한다.
    pub fn has_any_key(&self) -> bool {
        std::iter::once((self.provider.as_str(), self.model.as_str()))
            .chain(
                self.fallbacks
                    .iter()
                    .map(|f| (f.provider.as_str(), f.model.as_str())),
            )
            .any(|(p, _)| {
                matches!(
                    crate::secrets::get(&format!("{p}_api_key")),
                    Ok(Some(k)) if !k.trim().is_empty()
                )
            })
    }
}

async fn setting(db: &Db, key: &str) -> Result<Option<String>, String> {
    Ok(db
        .settings_get(key.to_string())
        .await
        .map_err(|e| e.to_string())?
        .filter(|v| !v.trim().is_empty())
        .map(|v| v.trim().to_string()))
}

/// 폴백 체인 텍스트를 파싱한다. 프런트 `parseFallbacks` 의 Rust 판 —
/// 한 줄에 `provider:model`, `#` 주석과 빈 줄은 무시, 모르는 프로바이더는 버린다.
/// 모델 id 자체에 `:` 가 있을 수 있으므로 **첫** 콜론에서만 자른다.
pub fn parse_fallbacks(raw: &str) -> Vec<ProviderModel> {
    raw.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .filter_map(|line| {
            let (provider, model) = line.split_once(':')?;
            let provider = provider.trim().to_ascii_lowercase();
            let model = model.trim();
            if model.is_empty() || !KNOWN_PROVIDERS.contains(&provider.as_str()) {
                return None;
            }
            Some(ProviderModel {
                provider,
                model: model.to_string(),
            })
        })
        .collect()
}

/// 배경 작업의 모델 대상. `None` = Core Model 미설정 → 작업 성립 불가.
///
/// **`default_provider`/`default_model` 을 읽지 않는다.** 그 폴백을 두면
/// D2 의 게이트가 무의미해진다 — 미설정 사용자가 자기도 모르게 대화 모델로
/// 배경 작업을 돌리게 된다. 기존 사용자는 [`seed_if_automation_enabled`] 가
/// 진짜 값을 넣어 준다.
pub async fn resolve(db: &Db) -> Result<Option<CoreTarget>, String> {
    let (Some(provider), Some(model)) = (
        setting(db, CORE_PROVIDER_KEY).await?,
        setting(db, CORE_MODEL_KEY).await?,
    ) else {
        return Ok(None);
    };
    let fallbacks = match setting(db, FALLBACK_MODELS_KEY).await? {
        Some(raw) => parse_fallbacks(&raw),
        None => Vec::new(),
    };
    Ok(Some(CoreTarget {
        provider,
        model,
        fallbacks,
    }))
}

/// D2 의 다리 — 자동화가 이미 켜져 있는 프로젝트를 열 때, `core_*` 가 비었으면
/// 대화 모델을 **1회** 복사한다. 반환값 `true` = 이번에 시드했다.
///
/// `automation_enabled` 는 그 프로젝트의 `agents.auto_reconcile ||
/// agents.auto_journal_draft`. 호출부는 `oculpm_init`(프로젝트 열기)다 —
/// 설정은 전역인데 판정 재료가 프로젝트 config 라 여기가 유일한 합류점이다.
pub async fn seed_if_automation_enabled(db: &Db, automation_enabled: bool) -> Result<bool, String> {
    if !automation_enabled {
        return Ok(false);
    }
    if setting(db, CORE_PROVIDER_KEY).await?.is_some()
        || setting(db, CORE_MODEL_KEY).await?.is_some()
    {
        return Ok(false); // 이미 골랐다 — 사용자의 선택을 덮지 않는다.
    }
    let Some(provider) = setting(db, "default_provider").await? else {
        return Ok(false);
    };
    // 대화 모델 해석은 프런트 `providerModel()` 과 같은 순서:
    // 프로바이더별 오버라이드 → 레거시 `default_model`.
    let model = match setting(db, &format!("model_{provider}")).await? {
        Some(m) => m,
        None => match setting(db, "default_model").await? {
            Some(m) => m,
            None => return Ok(false), // 복사할 값이 없다 — 게이트로 남긴다.
        },
    };

    db.settings_set(CORE_PROVIDER_KEY.to_string(), provider.clone())
        .await
        .map_err(|e| e.to_string())?;
    db.settings_set(CORE_MODEL_KEY.to_string(), model.clone())
        .await
        .map_err(|e| e.to_string())?;
    db.settings_set(
        CORE_MODEL_SEEDED_KEY.to_string(),
        format!("{provider}:{model}"),
    )
    .await
    .map_err(|e| e.to_string())?;
    tracing::info!(
        target: "oculpm::automation",
        provider = %provider,
        model = %model,
        "core model seeded from the chat model (D2 — 동작 변화 0)"
    );
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    async fn db(dir: &tempfile::TempDir) -> Db {
        Db::open(dir.path().join("ocul-pm.db")).await.unwrap()
    }

    #[test]
    fn fallback_parsing_matches_the_frontend_grammar() {
        let got = parse_fallbacks(
            "openai:gpt-4o-mini\n  anthropic:claude-3.5-haiku-latest  \n\
             # 주석\n\nbogus:whatever\nopenrouter:openai/gpt-4o\nnomodel:\nnocolon",
        );
        assert_eq!(
            got.iter()
                .map(|f| (f.provider.as_str(), f.model.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("openai", "gpt-4o-mini"),
                ("anthropic", "claude-3.5-haiku-latest"),
                ("openrouter", "openai/gpt-4o"),
            ]
        );
    }

    #[tokio::test]
    async fn unset_core_model_resolves_to_none_even_with_a_chat_model() {
        let dir = tempdir().unwrap();
        let db = db(&dir).await;
        db.settings_set("default_provider".into(), "anthropic".into())
            .await
            .unwrap();
        db.settings_set("model_anthropic".into(), "claude-sonnet-4-6".into())
            .await
            .unwrap();
        assert_eq!(
            resolve(&db).await.unwrap(),
            None,
            "대화 모델로 조용히 대체하면 D2 게이트가 무의미해진다"
        );
    }

    #[tokio::test]
    async fn seeds_only_when_automation_is_on_and_slot_is_empty() {
        let dir = tempdir().unwrap();
        let db = db(&dir).await;
        db.settings_set("default_provider".into(), "anthropic".into())
            .await
            .unwrap();
        db.settings_set("model_anthropic".into(), "claude-sonnet-4-6".into())
            .await
            .unwrap();

        // 자동화 off → 시드하지 않는다 (처음 켤 때 고르게).
        assert!(!seed_if_automation_enabled(&db, false).await.unwrap());
        assert_eq!(resolve(&db).await.unwrap(), None);

        // 자동화 on → 1회 시드. 동작 변화 0.
        assert!(seed_if_automation_enabled(&db, true).await.unwrap());
        let target = resolve(&db).await.unwrap().expect("시드 후에는 해석된다");
        assert_eq!(target.provider, "anthropic");
        assert_eq!(target.model, "claude-sonnet-4-6");

        // 두 번째 호출은 no-op — 사용자가 나중에 싼 모델로 바꿔도 덮지 않는다.
        db.settings_set(CORE_MODEL_KEY.into(), "claude-3.5-haiku-latest".into())
            .await
            .unwrap();
        assert!(!seed_if_automation_enabled(&db, true).await.unwrap());
        assert_eq!(
            resolve(&db).await.unwrap().unwrap().model,
            "claude-3.5-haiku-latest"
        );
    }

    #[tokio::test]
    async fn seed_carries_the_failover_chain_into_the_core_target() {
        let dir = tempdir().unwrap();
        let db = db(&dir).await;
        db.settings_set("default_provider".into(), "openai".into())
            .await
            .unwrap();
        db.settings_set("default_model".into(), "gpt-4o-mini".into())
            .await
            .unwrap();
        db.settings_set(
            "fallback_models".into(),
            "anthropic:claude-3.5-haiku-latest".into(),
        )
        .await
        .unwrap();
        assert!(seed_if_automation_enabled(&db, true).await.unwrap());

        let target = resolve(&db).await.unwrap().unwrap();
        assert_eq!(target.model, "gpt-4o-mini", "레거시 default_model 로 폴백");
        assert_eq!(target.fallbacks.len(), 1, "배경 작업도 체인을 쓴다");
        assert_eq!(target.fallbacks[0].provider, "anthropic");
    }
}
