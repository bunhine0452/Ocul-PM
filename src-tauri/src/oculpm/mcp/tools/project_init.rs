//! `project_init` — 플러그인-온리 그린필드의 시작점.
//!
//! `tools/mod.rs` 에서 떼어 나왔다 (love-round-20261123 — 저 파일이 800줄 한계 바로 밑이라 plan_update
//! 의 새 인자를 들일 자리가 없었다). 옮기면서 거절 문구를 해요체 한 언어로 고쳤다: 사용자 확인 없이 부르면
//! 돌아오던 문장이 「…explicitly confirms starting 있습니다 — …」 로 영어와 한국어가 섞여 깨져 있었고,
//! 에이전트는 그 문장을 사람에게 그대로 옮긴다.

use super::*;

/// 앱의 `init_project` 중 **디스크 부분만** 재현한다: config + schema-version + gitignore managed
/// block + `.oculpm/README.md` + 에이전트 규칙 동기화 (AGENTS.md 어댑터·마스터 템플릿·journal-spec).
/// 락/세션 감지/워처/DB 캐시는 앱 몫 — 앱을 열면 기존 초기화를 그대로 이어받는다 (idempotent).
pub(super) fn project_init(root: &Path, args: &Value) -> Result<Value, String> {
    if !args
        .get("confirm")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return Err(
            "project_init 은 사용자가 추적 시작에 분명히 동의한 뒤에만 불러요 — 먼저 사용자에게 \
             물어보고, 동의하면 confirm=true 로 다시 불러 주세요."
                .to_string(),
        );
    }
    if !root.is_dir() {
        return Err(format!(
            "프로젝트 루트가 폴더가 아니에요: {}",
            root.display()
        ));
    }
    // 폭발 반경 가드 — --root 를 홈/파일시스템 루트로 잘못 고정한 설정 사고가
    // ~/.gitignore(core.excludesFile 관행)·~/AGENTS.md 오염으로 번지지 않게.
    let canonical = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    if canonical.parent().is_none() {
        return Err(
            "파일 시스템 루트(/)는 추적하지 않아요 — .mcp.json 의 --root 가 프로젝트 폴더인지 \
             확인해 주세요."
                .to_string(),
        );
    }
    // 홈은 `HOME` 이 아니라 `paths::is_home_dir` — Windows 에는 `HOME` 이 없다.
    if crate::oculpm::paths::is_home_dir(&canonical) {
        return Err(
            "홈 폴더(home directory)는 추적하지 않아요 — 프로젝트 폴더에서 다시 불러 주세요 \
             (.mcp.json 의 --root 가 프로젝트 경로인지 확인)."
                .to_string(),
        );
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
                    "{} 의 .oculpm 이 심볼릭 링크(symlink)예요 — 안전을 위해 초기화하지 않아요.",
                    root.display()
                ));
            }
            if !m.file_type().is_dir() {
                return Err(
                    ".oculpm 이 폴더가 아니라 파일로 있어요 — 지운 뒤 다시 불러 주세요."
                        .to_string(),
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
            "이미 추적 중인 프로젝트예요 — 빠진 구성(설정·gitignore 보호·규칙 파일)만 채웠어요."
        } else {
            "이제 journal_write · plan_create 등 ocul-pm 도구를 쓸 수 있어요. \
             ocul-pm 앱에서 이 폴더를 열면 타임라인·세션 감지·인덱싱이 켜져요."
        }
    }))
}
