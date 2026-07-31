//! C2 — 결정적 스택 감지 (LLM 0 · 네트워크 0).
//!
//! 프로젝트 루트 + **하위 1단계 디렉터리의 매니페스트**를 읽어 언어/프레임워크
//! 태그를 뽑는다 (Tauri 의 src-tauri/Cargo.toml 같은 표준 레이아웃 커버).
//! 루트가 워크스페이스를 선언하면(pnpm-workspace.yaml · package.json workspaces
//! · Cargo [workspace]) 2단계까지 내려가 apps/web 류 멤버도 커버한다 — 순회는
//! 이름순·개수 상한으로 결정적이다. 스킬 카탈로그 추천의 매칭 키로 쓰인다.
//! 매니페스트가 하나도 없으면 얕은(2단계) 확장자 스캔 폴백으로 상위 언어
//! 1~2개를 태그로 채택한다. 언어 태그는 매니페스트 **존재 기반**(깨져 있어도
//! 유지), 프레임워크 태그만 파싱 기반 — 감지가 실패해도 앱 동작에는 지장이
//! 없어야 한다.
//!
//! 주의: "testing" 같은 축은 태그로 넣지 않는다 — 태그는 스택(언어/프레임워크)
//! 만이고, 테스팅 여부는 카탈로그 쪽 축이다.

use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::path::{Path, PathBuf};

use crate::indexer::language_for;

/// 매니페스트 읽기 크기 상한 — 정상 매니페스트는 이보다 훨씬 작다.
const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;
/// 폴백 확장자 스캔에서 살펴볼 파일 수 상한.
const FALLBACK_MAX_FILES: usize = 500;
/// 폴백 스캔 깊이 (루트 디렉터리 = 0, 그 아래 2단계까지).
const FALLBACK_MAX_DEPTH: usize = 2;
/// 폴백이 태그로 채택하는 상위 언어 수.
const FALLBACK_TOP_LANGUAGES: usize = 2;
/// 폴백 스캔에서 건너뛰는 디렉터리 — 벤더/빌드 산출물은 스택 신호가 아니다.
const FALLBACK_SKIP_DIRS: &[&str] = &[
    "node_modules",
    "target",
    "vendor",
    "dist",
    "build",
    "out",
    "__pycache__",
];
/// 폴백이 태그로 인정하는 프로그래밍 언어 — `language_for` 결과 중 마크업/설정
/// 계열(markdown·json·yaml·…)은 스택 태그로 무의미해서 제외한다.
const FALLBACK_LANGUAGES: &[&str] = &[
    "c",
    "cpp",
    "csharp",
    "go",
    "java",
    "javascript",
    "kotlin",
    "php",
    "python",
    "ruby",
    "rust",
    "swift",
    "typescript",
];

/// 멤버 디렉터리 순회 상한 — 워크스페이스가 아무리 커도 이 수를 넘지 않는다.
const MEMBER_MAX_DIRS: usize = 200;

/// 프로젝트 루트에서 언어/프레임워크 태그를 결정적으로 감지한다.
/// 반환: 중복 제거·정렬된 소문자 태그.
pub fn detect_stack(root: &Path) -> Vec<String> {
    let mut tags: BTreeSet<String> = BTreeSet::new();

    detect_dir(root, &mut tags);
    for dir in member_dirs(root) {
        detect_dir(&dir, &mut tags);
    }

    // 매니페스트가 아무 신호도 못 냈을 때만 확장자 폴백.
    if tags.is_empty() {
        tags.extend(fallback_languages(root));
    }

    // BTreeSet 이라 이미 정렬 + 중복 제거 상태.
    tags.into_iter().collect()
}

/// 한 디렉터리의 매니페스트들에 전체 감지기를 돌린다.
fn detect_dir(dir: &Path, tags: &mut BTreeSet<String>) {
    detect_node(dir, tags);
    detect_rust(dir, tags);
    detect_go(dir, tags);
    detect_python(dir, tags);
    detect_php(dir, tags);
    detect_java(dir, tags);
    detect_ruby(dir, tags);
}

/// 매니페스트를 추가로 살필 멤버 디렉터리 목록 (이름순 → 결정적).
/// 하위 1단계는 항상 — Tauri 표준 레이아웃(src-tauri/Cargo.toml)이 여기 있다.
/// 루트가 워크스페이스를 선언한 경우에만 2단계까지 — pnpm/yarn 모노레포의
/// apps/web · packages/ui 류. 숨김/벤더 폴더는 제외, 총 개수 상한 적용.
fn member_dirs(root: &Path) -> Vec<PathBuf> {
    let deep = has_workspace_declaration(root);
    let mut dirs: Vec<PathBuf> = Vec::new();
    for level1 in sorted_subdirs(root) {
        if dirs.len() >= MEMBER_MAX_DIRS {
            break;
        }
        if deep {
            for level2 in sorted_subdirs(&level1) {
                if dirs.len() >= MEMBER_MAX_DIRS {
                    break;
                }
                dirs.push(level2);
            }
        }
        dirs.push(level1);
    }
    dirs
}

/// 정렬된 하위 디렉터리 (숨김·벤더/빌드 산출물·심링크 제외).
fn sorted_subdirs(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut subdirs: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            let Some(name) = p.file_name().and_then(|n| n.to_str()) else {
                return false;
            };
            if name.starts_with('.') || FALLBACK_SKIP_DIRS.contains(&name) {
                return false;
            }
            // 심링크는 순환 방지를 위해 건너뛴다.
            fs::symlink_metadata(p).is_ok_and(|m| m.file_type().is_dir())
        })
        .collect();
    subdirs.sort();
    subdirs
}

/// 루트가 워크스페이스(멀티 패키지)를 선언했는가 — 2단계 순회의 게이트.
fn has_workspace_declaration(root: &Path) -> bool {
    if root.join("pnpm-workspace.yaml").is_file() || root.join("pnpm-workspace.yml").is_file() {
        return true;
    }
    if let Some(raw) = read_manifest(&root.join("package.json")) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&raw) {
            if json.get("workspaces").is_some() {
                return true;
            }
        }
    }
    if let Some(raw) = read_manifest(&root.join("Cargo.toml")) {
        if let Ok(value) = raw.parse::<toml::Value>() {
            if value.get("workspace").is_some() {
                return true;
            }
        }
    }
    false
}

/// 루트 바로 아래의 매니페스트 파일을 읽는다. 없거나, 너무 크거나, 읽기에
/// 실패하면 `None` — 어떤 경우에도 에러를 내지 않는다.
fn read_manifest(path: &Path) -> Option<String> {
    let metadata = fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_MANIFEST_BYTES {
        return None;
    }
    fs::read_to_string(path).ok()
}

fn insert(tags: &mut BTreeSet<String>, tag: &str) {
    tags.insert(tag.to_string());
}

// ---------- 매니페스트별 감지 ----------

/// package.json (+ tsconfig.json) — JS/TS 생태계.
fn detect_node(root: &Path, tags: &mut BTreeSet<String>) {
    // tsconfig.json 존재는 그 자체로 typescript 신호 (package.json 이 깨져
    // 있거나 없어도 유효 — 존재 기반이라 파싱이 필요 없다).
    if root.join("tsconfig.json").is_file() {
        insert(tags, "typescript");
    }

    let path = root.join("package.json");
    if !path.is_file() {
        return;
    }
    // 언어 태그는 존재 기반 — python/java 감지와 일관되게, 깨진 매니페스트여도
    // package.json 이 있으면 명백한 JS 프로젝트다.
    insert(tags, "javascript");
    let Some(raw) = read_manifest(&path) else {
        return;
    };
    // 파싱 실패 시 프레임워크 감지만 포기.
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return;
    };

    // peerDependencies 포함 — 라이브러리 패키지는 프레임워크를 peer 로만 선언한다.
    let dep_names: Vec<&str> = ["dependencies", "devDependencies", "peerDependencies"]
        .iter()
        .filter_map(|k| json.get(*k).and_then(|v| v.as_object()))
        .flat_map(|obj| obj.keys().map(String::as_str))
        .collect();

    for name in dep_names {
        match name {
            "react" => {
                insert(tags, "react");
                insert(tags, "frontend");
            }
            "vue" => {
                insert(tags, "vue");
                insert(tags, "frontend");
            }
            "@angular/core" => {
                insert(tags, "angular");
                insert(tags, "frontend");
            }
            "svelte" => {
                insert(tags, "svelte");
                insert(tags, "frontend");
            }
            "next" => insert(tags, "nextjs"),
            "typescript" => insert(tags, "typescript"),
            _ => {}
        }
    }
}

/// Cargo.toml — Rust (+ tauri).
fn detect_rust(root: &Path, tags: &mut BTreeSet<String>) {
    let path = root.join("Cargo.toml");
    if !path.is_file() {
        return;
    }
    // 언어 태그는 존재 기반.
    insert(tags, "rust");
    let Some(raw) = read_manifest(&path) else {
        return;
    };
    // 파싱 실패 시 프레임워크 감지만 포기.
    let Ok(value) = raw.parse::<toml::Value>() else {
        return;
    };
    let has_tauri = value
        .get("dependencies")
        .and_then(|d| d.as_table())
        .is_some_and(|t| t.contains_key("tauri"));
    if has_tauri {
        insert(tags, "tauri");
    }
}

/// go.mod — Go. (존재 기반 — 내용 파싱 불필요.)
fn detect_go(root: &Path, tags: &mut BTreeSet<String>) {
    if root.join("go.mod").is_file() {
        insert(tags, "go");
    }
}

/// pyproject.toml | requirements.txt | setup.py — Python (+ django/fastapi).
fn detect_python(root: &Path, tags: &mut BTreeSet<String>) {
    let manifest_names = ["pyproject.toml", "requirements.txt", "setup.py"];
    let mut is_python = false;
    for name in manifest_names {
        let path = root.join(name);
        if !path.is_file() {
            continue;
        }
        is_python = true;
        // 프레임워크는 관대한 소문자 부분 문자열 매칭 — requirements 라인,
        // pyproject 의존 배열, setup.py install_requires 를 모두 커버한다.
        if let Some(raw) = read_manifest(&path) {
            let lowered = raw.to_lowercase();
            if lowered.contains("django") {
                insert(tags, "django");
            }
            if lowered.contains("fastapi") {
                insert(tags, "fastapi");
            }
        }
    }
    if is_python {
        insert(tags, "python");
    }
}

/// composer.json — PHP (+ laravel).
fn detect_php(root: &Path, tags: &mut BTreeSet<String>) {
    let path = root.join("composer.json");
    if !path.is_file() {
        return;
    }
    // 언어 태그는 존재 기반.
    insert(tags, "php");
    let Some(raw) = read_manifest(&path) else {
        return;
    };
    // 파싱 실패 시 프레임워크 감지만 포기.
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return;
    };
    let has_laravel = ["require", "require-dev"]
        .iter()
        .filter_map(|k| json.get(*k).and_then(|v| v.as_object()))
        .any(|obj| obj.contains_key("laravel/framework"));
    if has_laravel {
        insert(tags, "laravel");
    }
}

/// build.gradle | build.gradle.kts | pom.xml — Java (+ springboot).
fn detect_java(root: &Path, tags: &mut BTreeSet<String>) {
    let manifest_names = ["build.gradle", "build.gradle.kts", "pom.xml"];
    let mut is_java = false;
    for name in manifest_names {
        let path = root.join(name);
        if !path.is_file() {
            continue;
        }
        is_java = true;
        if let Some(raw) = read_manifest(&path) {
            if raw.to_lowercase().contains("spring-boot") {
                insert(tags, "springboot");
            }
        }
    }
    if is_java {
        insert(tags, "java");
    }
}

/// Gemfile — Ruby. (존재 기반.)
fn detect_ruby(root: &Path, tags: &mut BTreeSet<String>) {
    if root.join("Gemfile").is_file() {
        insert(tags, "ruby");
    }
}

// ---------- 확장자 폴백 ----------

/// 매니페스트가 전무할 때: 루트에서 2단계 깊이까지(파일 500개 상한) 확장자를
/// `language_for` 에 통과시켜 상위 언어 1~2개를 태그로 쓴다. 결정성을 위해
/// 디렉터리 엔트리는 이름순으로 순회하고, 동률은 이름순으로 가른다.
fn fallback_languages(root: &Path) -> Vec<String> {
    let mut counts: HashMap<&'static str, u32> = HashMap::new();
    let mut scanned = 0usize;
    // (디렉터리, 깊이) 큐 — 루트가 깊이 0.
    let mut queue: Vec<(PathBuf, usize)> = vec![(root.to_path_buf(), 0)];

    while let Some((dir, depth)) = queue.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        let mut children: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
        children.sort();

        for child in children {
            if scanned >= FALLBACK_MAX_FILES {
                return top_languages(&counts);
            }
            let Some(name) = child.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            // 숨김 파일/폴더(.git 포함)와 벤더 폴더는 스택 신호가 아니다.
            if name.starts_with('.') {
                continue;
            }
            // 심링크는 순환 방지를 위해 건너뛴다.
            let Ok(file_type) = fs::symlink_metadata(&child).map(|m| m.file_type()) else {
                continue;
            };
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                if depth < FALLBACK_MAX_DEPTH && !FALLBACK_SKIP_DIRS.contains(&name) {
                    queue.push((child, depth + 1));
                }
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            scanned += 1;
            if let Some(lang) = language_for(&child) {
                if FALLBACK_LANGUAGES.contains(&lang) {
                    *counts.entry(lang).or_insert(0) += 1;
                }
            }
        }
    }
    top_languages(&counts)
}

/// 빈도 상위 언어를 (빈도 내림차순 → 이름 오름차순) 결정적으로 고른다.
fn top_languages(counts: &HashMap<&'static str, u32>) -> Vec<String> {
    let mut ranked: Vec<(&str, u32)> = counts.iter().map(|(l, c)| (*l, *c)).collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(b.0)));
    ranked
        .into_iter()
        .take(FALLBACK_TOP_LANGUAGES)
        .map(|(lang, _)| lang.to_string())
        .collect()
}

// ---------- 테스트 ----------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write(dir: &Path, name: &str, content: &str) {
        let path = dir.join(name);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    #[test]
    fn detects_react_typescript_from_package_json() {
        let tmp = tempfile::tempdir().unwrap();
        write(
            tmp.path(),
            "package.json",
            r#"{"dependencies":{"react":"^18.0.0","react-dom":"^18.0.0"},"devDependencies":{"typescript":"^5.4.0"}}"#,
        );
        let tags = detect_stack(tmp.path());
        assert_eq!(tags, vec!["frontend", "javascript", "react", "typescript"]);
    }

    #[test]
    fn detects_rust_and_tauri_from_cargo_toml() {
        let tmp = tempfile::tempdir().unwrap();
        write(
            tmp.path(),
            "Cargo.toml",
            "[package]\nname = \"demo\"\nversion = \"0.1.0\"\n\n[dependencies]\ntauri = { version = \"2\" }\nserde = \"1\"\n",
        );
        let tags = detect_stack(tmp.path());
        assert_eq!(tags, vec!["rust", "tauri"]);
    }

    #[test]
    fn detects_python_django_from_requirements() {
        let tmp = tempfile::tempdir().unwrap();
        write(tmp.path(), "requirements.txt", "Django==5.0\npsycopg2-binary\n");
        let tags = detect_stack(tmp.path());
        assert_eq!(tags, vec!["django", "python"]);
    }

    #[test]
    fn falls_back_to_extension_scan_without_manifests() {
        let tmp = tempfile::tempdir().unwrap();
        write(tmp.path(), "main.go", "package main\n\nfunc main() {}\n");
        write(tmp.path(), "internal/util.go", "package internal\n");
        write(tmp.path(), "README.md", "# demo\n"); // markdown 은 태그로 안 침
        let tags = detect_stack(tmp.path());
        assert_eq!(tags, vec!["go"]);
    }

    #[test]
    fn fallback_picks_top_two_languages_deterministically() {
        let tmp = tempfile::tempdir().unwrap();
        write(tmp.path(), "a.py", "x = 1\n");
        write(tmp.path(), "b.py", "y = 2\n");
        write(tmp.path(), "c.py", "z = 3\n");
        write(tmp.path(), "d.ts", "export const n = 1\n");
        write(tmp.path(), "e.ts", "export const m = 2\n");
        write(tmp.path(), "f.rb", "puts 1\n");
        let tags = detect_stack(tmp.path());
        // 상위 2개(python 3, typescript 2)만 — ruby(1) 는 탈락.
        assert_eq!(tags, vec!["python", "typescript"]);
    }

    #[test]
    fn broken_package_json_still_counts_as_javascript() {
        let tmp = tempfile::tempdir().unwrap();
        write(tmp.path(), "package.json", "{ this is not json !!");
        write(
            tmp.path(),
            "Cargo.toml",
            "[package]\nname = \"demo\"\nversion = \"0.1.0\"\n",
        );
        let tags = detect_stack(tmp.path());
        // 언어 태그는 존재 기반 — 깨진 package.json 도 javascript 신호는 유지,
        // 프레임워크 감지만 포기한다 (python/java 감지와 일관).
        assert_eq!(tags, vec!["javascript", "rust"]);
    }

    #[test]
    fn tauri_layout_detects_rust_in_subdir() {
        // 이 저장소(ai-pm) 자체의 레이아웃: 루트 package.json + src-tauri/Cargo.toml.
        let tmp = tempfile::tempdir().unwrap();
        write(
            tmp.path(),
            "package.json",
            r#"{"dependencies":{"react":"^19.0.0"}}"#,
        );
        write(
            tmp.path(),
            "src-tauri/Cargo.toml",
            "[package]\nname = \"app\"\nversion = \"0.1.0\"\n\n[dependencies]\ntauri = \"2\"\n",
        );
        let tags = detect_stack(tmp.path());
        assert_eq!(tags, vec!["frontend", "javascript", "react", "rust", "tauri"]);
    }

    #[test]
    fn pnpm_workspace_detects_depth2_member() {
        // 루트에 pnpm-workspace.yaml 만 있고 프레임워크는 apps/web (2단계)에.
        let tmp = tempfile::tempdir().unwrap();
        write(tmp.path(), "pnpm-workspace.yaml", "packages:\n  - \"apps/*\"\n");
        write(
            tmp.path(),
            "apps/web/package.json",
            r#"{"dependencies":{"react":"^19.0.0","next":"15.0.0"}}"#,
        );
        let tags = detect_stack(tmp.path());
        assert_eq!(tags, vec!["frontend", "javascript", "nextjs", "react"]);
    }

    #[test]
    fn workspaces_field_scans_depth2_members() {
        // yarn/npm 모노레포: 루트 package.json 에 workspaces 필드만, 멤버는 packages/ui.
        let tmp = tempfile::tempdir().unwrap();
        write(tmp.path(), "package.json", r#"{"workspaces":["packages/*"]}"#);
        write(
            tmp.path(),
            "packages/ui/package.json",
            r#"{"dependencies":{"vue":"^3.4.0"}}"#,
        );
        let tags = detect_stack(tmp.path());
        assert_eq!(tags, vec!["frontend", "javascript", "vue"]);
    }

    #[test]
    fn peer_dependencies_count_for_framework_detection() {
        // 라이브러리 템플릿 관례: react 를 peerDependencies 로만 선언.
        let tmp = tempfile::tempdir().unwrap();
        write(
            tmp.path(),
            "package.json",
            r#"{"peerDependencies":{"react":">=18"},"devDependencies":{"vite":"^5.0.0"}}"#,
        );
        let tags = detect_stack(tmp.path());
        assert_eq!(tags, vec!["frontend", "javascript", "react"]);
    }

    #[test]
    fn tsconfig_alone_still_marks_typescript() {
        let tmp = tempfile::tempdir().unwrap();
        write(tmp.path(), "package.json", r#"{"dependencies":{"next":"14.2.0"}}"#);
        write(tmp.path(), "tsconfig.json", "{}");
        let tags = detect_stack(tmp.path());
        assert_eq!(tags, vec!["javascript", "nextjs", "typescript"]);
    }

    #[test]
    fn detects_php_laravel_and_java_springboot_together() {
        let tmp = tempfile::tempdir().unwrap();
        write(
            tmp.path(),
            "composer.json",
            r#"{"require":{"php":"^8.2","laravel/framework":"^11.0"}}"#,
        );
        write(
            tmp.path(),
            "build.gradle",
            "plugins { id 'org.springframework.boot' version '3.3.0' }\ndependencies { implementation 'org.springframework.boot:spring-boot-starter-web' }\n",
        );
        write(tmp.path(), "Gemfile", "source 'https://rubygems.org'\n");
        let tags = detect_stack(tmp.path());
        assert_eq!(tags, vec!["java", "laravel", "php", "ruby", "springboot"]);
    }

    #[test]
    fn tags_are_sorted_and_deduped() {
        let tmp = tempfile::tempdir().unwrap();
        // react + vue 둘 다 → "frontend" 는 한 번만.
        write(
            tmp.path(),
            "package.json",
            r#"{"dependencies":{"react":"^18.0.0","vue":"^3.4.0","svelte":"^4.0.0"}}"#,
        );
        let tags = detect_stack(tmp.path());
        assert_eq!(tags.iter().filter(|t| t.as_str() == "frontend").count(), 1);
        let mut resorted = tags.clone();
        resorted.sort();
        resorted.dedup();
        assert_eq!(tags, resorted);
    }

    #[test]
    fn empty_directory_returns_no_tags() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(detect_stack(tmp.path()).is_empty());
    }
}
