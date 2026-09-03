//! 일지에서 **반복 결함 클러스터**를 캔다 (플랜 `evidence-based-rules`).
//!
//! block/buzz 의 `AGENTS.md` "Review-Proven Rules" 에서 가져온 생각이다. 저쪽은
//! 최근 25개 PR 의 리뷰 스레드를 캐서 반복 클러스터 8개를 뽑고, 각 규칙에 근거
//! PR 번호와 **지적당한 뒤 실제로 고쳐진 비율**을 붙였다. "이건 취향이 아니라
//! 저자가 보자마자 인정하는 결함"이라는 주장을 데이터로 한 것이다.
//!
//! 우리에게는 리뷰 스레드가 없고 **일지**가 있다. 그래서 지표가 다르다:
//!
//! - buzz: 수정률(지적 → 수정) — 우리 표본에는 그 짝이 없다. **못 낸다.**
//! - 우리: **재발 간격** — 같은 클러스터가 며칠 만에 다시 나왔나.
//!
//! 다른 지표이므로 다른 이름으로 부른다. 없는 숫자를 흉내 내지 않는다.
//!
//! ## 클러스터를 어디서 얻었나
//!
//! 상상해서 만들지 않았다. 이 저장소의 버그 일지 126건을 실제로 훑어 반복되는
//! 낱말을 모았다 (2026-09-03). 표지는 그 corpus 에서 나온 것이고, 새 프로젝트에
//! 그대로 맞을 것이라 주장하지 않는다.
//!
//! ## 휴리스틱이므로 근거를 함께 낸다
//!
//! [`rule_negation`](crate::oculpm::rule_negation) 과 같은 규율이다 — 판정은
//! 사람이 한다. 그래서 이 모듈은 아무것도 고치지 않고, 발췌를 반드시 싣고,
//! 표본이 모자라면 **아무것도 주장하지 않는다.**

use std::path::Path;

use serde::Serialize;

use crate::oculpm::rule_negation::sections;

/// 클러스터 하나를 주장하기 위한 최소 표본.
///
/// 둘로는 "반복"이라고 말할 수 없다 — 우연히 두 번 쓰인 낱말과 구별되지 않는다.
pub const MIN_HITS: usize = 3;

/// 발췌 길이 상한 (문자).
const EXCERPT_CHARS: usize = 160;

/// 결함 클러스터의 정의 — id, 사람이 읽는 이름, 그리고 표지.
///
/// 표지는 **한국어 일지 본문**을 겨냥한다. 이 저장소의 기록 언어가 한국어이기
/// 때문이고, 영어 프로젝트에서는 표지가 달라져야 한다는 뜻이기도 하다.
struct ClusterDef {
    id: &'static str,
    label: &'static str,
    markers: &'static [&'static str],
}

const CLUSTERS: &[ClusterDef] = &[
    ClusterDef {
        id: "orphan-process",
        label: "고아·좀비 프로세스 — 정리되지 않는 자식",
        markers: &[
            "고아",
            "좀비",
            "죽지 않",
            "안 죽",
            "정리되지 않",
            "회수하지 않",
            "먹통",
        ],
    },
    ClusterDef {
        id: "silent-failure",
        label: "조용한 실패 — 삼켜진 오류",
        markers: &["조용히", "조용한", "로그 한 줄", "무반응", "no-op", "삼키"],
    },
    ClusterDef {
        id: "scope-leak",
        label: "경계를 넘어 새는 상태 — 탭·프로젝트·창 격리",
        markers: &[
            "가로질러",
            "다른 프로젝트",
            "덮어쓰",
            "새던",
            "새고 있",
            "나눠 쓰",
        ],
    },
    ClusterDef {
        id: "runaway-calls",
        label: "폭주하는 호출 — 폴링·중복 조회",
        markers: &["초당", "폴링", "두들", "두드리", "중복 조회", "이중 조회"],
    },
    ClusterDef {
        id: "path-escape",
        label: "경로·권한 경계를 넘음",
        markers: &["밖으로 나갈", "경로 탈출", "상위 경로", "권한 누락"],
    },
    ClusterDef {
        id: "version-skew",
        label: "버전·프로토콜 불일치 — 살아남은 구버전",
        markers: &["구버전", "버전 불일치", "PROTO_VERSION", "살아남은"],
    },
    ClusterDef {
        id: "false-display",
        label: "화면이 거짓을 말함 — 하드코딩·이중 집계",
        markers: &["하드코딩", "거짓 표시", "이중 집계", "실제와 다"],
    },
];

/// 한 클러스터에 걸린 일지 하나.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct ClusterHit {
    /// `.oculpm/journal/` 기준 상대경로.
    pub rel_path: String,
    /// `YYYYMMDD`.
    pub workday: String,
    /// 그 일지의 제목 (`[x] …` 첫 줄).
    pub title: String,
    /// 무엇이 걸렸는지 — 사람이 판정할 근거.
    pub excerpt: String,
    /// 걸린 표지.
    pub marker: String,
}

/// 반복 결함 클러스터 하나.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
pub struct DefectCluster {
    pub id: String,
    pub label: String,
    /// 최신순.
    pub hits: Vec<ClusterHit>,
    /// **재발 간격** — 이어진 두 건 사이 날짜 차의 중앙값 (일).
    ///
    /// buzz 의 「수정률」이 아니다. 우리 표본에는 "지적 → 수정" 짝이 없다.
    pub typical_gap_days: u32,
    /// 가장 최근 두 건 사이 간격 (일). 최근이 빨라졌는지 보는 값.
    pub last_gap_days: u32,
    /// 마지막으로 나온 날 (`YYYYMMDD`).
    pub last_seen: String,
}

fn excerpt_around(text: &str, at: usize) -> String {
    let start = text[..at].rfind('\n').map(|i| i + 1).unwrap_or(0);
    let rest = &text[start..];
    let cut: String = rest.chars().take(EXCERPT_CHARS).collect();
    let trimmed = cut.trim().to_string();
    if rest.chars().count() > EXCERPT_CHARS {
        format!("{trimmed}…")
    } else {
        trimmed
    }
}

/// 본문 첫 줄의 `[x] 제목` 에서 제목만.
fn title_of(body: &str) -> String {
    body.lines()
        .find(|l| l.starts_with("[x]") || l.starts_with("[ ]"))
        .map(|l| l[3..].trim().to_string())
        .unwrap_or_default()
}

/// `YYYYMMDD/TypeFolder/HHMM_type_slug.md` 에서 날짜.
fn workday_of(rel: &str) -> Option<&str> {
    let first = rel.split('/').next()?;
    (first.len() == 8 && first.chars().all(|c| c.is_ascii_digit())).then_some(first)
}

/// 날짜 문자열(`YYYYMMDD`) 두 개 사이의 일수.
fn days_between(a: &str, b: &str) -> u32 {
    let parse = |s: &str| chrono::NaiveDate::parse_from_str(s, "%Y%m%d").ok();
    match (parse(a), parse(b)) {
        (Some(x), Some(y)) => (x - y).num_days().unsigned_abs() as u32,
        _ => 0,
    }
}

fn median(mut values: Vec<u32>) -> u32 {
    if values.is_empty() {
        return 0;
    }
    values.sort_unstable();
    values[values.len() / 2]
}

/// 일지 하나를 클러스터에 건다.
///
/// 제목과 **본문 섹션**을 함께 본다 — `rule_negation` 이 문단이 아니라 섹션
/// 단위로 보는 것과 같은 이유다. 사람은 제목에 증상을 적고 두 문단 뒤에 원인을
/// 적는다.
fn classify(body: &str) -> Vec<(&'static ClusterDef, String, String)> {
    let title = title_of(body);
    // **제목과 「발생 원인」절만** 본다.
    //
    // 처음에는 본문 전체를 훑었는데, 실측(이 저장소 일지 126건)에서 오탐이
    // 쏟아졌다 — 해결 방법 절에 적힌 "격리했다"가 격리 결함으로, 메모의
    // "노출"이 권한 결함으로 잡혔다. 결함의 이름은 증상(제목)과 원인 절에
    // 적힌다. 나머지는 대부분 **고친 이야기**라 반대 신호에 가깝다.
    let cause: Vec<String> = sections(body)
        .into_iter()
        .filter(|sec| {
            sec.lines()
                .next()
                .is_some_and(|h| h.starts_with('#') && h.contains("원인"))
        })
        .collect();
    let haystack: String = std::iter::once(title.clone())
        .chain(cause)
        .collect::<Vec<_>>()
        .join("\n");

    let mut out = Vec::new();
    for def in CLUSTERS {
        if let Some((marker, at)) = def
            .markers
            .iter()
            .find_map(|m| haystack.find(m).map(|at| (*m, at)))
        {
            out.push((def, marker.to_string(), excerpt_around(&haystack, at)));
        }
    }
    out
}

/// 프로젝트의 버그·에러 일지를 훑어 클러스터를 낸다.
///
/// 표본이 [`MIN_HITS`] 에 못 미치는 클러스터는 **내지 않는다.** 두 건으로
/// "반복된다"고 말하면 그 숫자를 믿은 사람이 규칙을 만든다.
pub fn mine(project_root: &Path) -> Vec<DefectCluster> {
    let journal = project_root.join(".oculpm/journal");
    let mut per_cluster: std::collections::HashMap<&str, Vec<ClusterHit>> =
        std::collections::HashMap::new();

    for entry in walk_entries(&journal) {
        let Ok(body) = std::fs::read_to_string(journal.join(&entry)) else {
            continue;
        };
        // frontmatter 는 건너뛰고 본문만 본다.
        let body = body
            .split_once("\n---\n")
            .map(|(_, rest)| rest.to_string())
            .unwrap_or(body);
        let Some(workday) = workday_of(&entry) else {
            continue;
        };
        let title = title_of(&body);
        for (def, marker, excerpt) in classify(&body) {
            per_cluster.entry(def.id).or_default().push(ClusterHit {
                rel_path: entry.clone(),
                workday: workday.to_string(),
                title: title.clone(),
                excerpt,
                marker,
            });
        }
    }

    let mut out: Vec<DefectCluster> = CLUSTERS
        .iter()
        .filter_map(|def| {
            let mut hits = per_cluster.remove(def.id)?;
            if hits.len() < MIN_HITS {
                return None;
            }
            hits.sort_by(|a, b| b.workday.cmp(&a.workday));
            let gaps: Vec<u32> = hits
                .windows(2)
                .map(|w| days_between(&w[0].workday, &w[1].workday))
                .collect();
            Some(DefectCluster {
                id: def.id.to_string(),
                label: def.label.to_string(),
                last_seen: hits[0].workday.clone(),
                last_gap_days: gaps.first().copied().unwrap_or(0),
                typical_gap_days: median(gaps),
                hits,
            })
        })
        .collect();
    // 최근에 다시 난 것이 위로.
    out.sort_by(|a, b| b.last_seen.cmp(&a.last_seen));
    out
}

/// `Bugs`·`Errors` 폴더의 일지 상대경로 (`YYYYMMDD/Type/파일.md`).
fn walk_entries(journal: &Path) -> Vec<String> {
    let Ok(days) = std::fs::read_dir(journal) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for day in days.flatten() {
        let day_name = day.file_name().to_string_lossy().to_string();
        for folder in ["Bugs", "Errors"] {
            let Ok(files) = std::fs::read_dir(day.path().join(folder)) else {
                continue;
            };
            for file in files.flatten() {
                let name = file.file_name().to_string_lossy().to_string();
                if name.ends_with(".md") {
                    out.push(format!("{day_name}/{folder}/{name}"));
                }
            }
        }
    }
    out.sort();
    out
}

/// 이 규칙이 어떤 클러스터를 막고 있다고 볼 수 있는가.
///
/// 규칙 본문이 클러스터의 표지를 쓰고 있으면 **후보**로 본다. 휴리스틱이라
/// 단정하지 않고, 화면은 근거 일지를 함께 보여 사람이 판정하게 한다.
pub fn clusters_for_rule(rule_body: &str, clusters: &[DefectCluster]) -> Vec<String> {
    clusters
        .iter()
        .filter(|cluster| {
            CLUSTERS
                .iter()
                .find(|d| d.id == cluster.id)
                .is_some_and(|def| def.markers.iter().any(|m| rule_body.contains(m)))
        })
        .map(|c| c.id.clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn write_bug(root: &Path, workday: &str, slug: &str, title: &str, body: &str) {
        let dir = root.join(".oculpm/journal").join(workday).join("Bugs");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join(format!("1000_bug_{slug}.md")),
            format!(
                "---\nschema_version: 1\ntype: bug\n---\n\n[x] {title}\n\n## 발생 원인\n{body}\n"
            ),
        )
        .unwrap();
    }

    /// **표본이 모자라면 아무것도 주장하지 않는다** — 이 규율이 먼저다.
    #[test]
    fn two_hits_are_not_a_pattern() {
        let dir = TempDir::new().unwrap();
        write_bug(
            dir.path(),
            "20260901",
            "a",
            "셸이 고아로 남았다",
            "정리 실패",
        );
        write_bug(dir.path(), "20260902", "b", "좀비가 쌓였다", "회수 못 함");
        assert!(mine(dir.path()).is_empty(), "둘로는 반복이라 말할 수 없다");
    }

    #[test]
    fn three_hits_make_a_cluster_with_evidence() {
        let dir = TempDir::new().unwrap();
        write_bug(
            dir.path(),
            "20260901",
            "a",
            "셸이 고아로 남았다",
            "정리 실패",
        );
        write_bug(
            dir.path(),
            "20260903",
            "b",
            "좀비가 쌓였다",
            "아무도 회수하지 않았다",
        );
        write_bug(
            dir.path(),
            "20260909",
            "c",
            "끝난 셸이 먹통으로 남았다",
            "정리 경로 누락",
        );

        let found = mine(dir.path());
        let cluster = found
            .iter()
            .find(|c| c.id == "orphan-process")
            .expect("고아 클러스터가 나와야 한다");
        assert_eq!(cluster.hits.len(), 3);
        // 근거는 **반드시** 함께 온다 — 휴리스틱이라 사람이 판정해야 한다.
        assert!(cluster.hits.iter().all(|h| !h.excerpt.is_empty()));
        assert!(cluster.hits.iter().all(|h| !h.marker.is_empty()));
        // 최신순.
        assert_eq!(cluster.last_seen, "20260909");
        assert_eq!(cluster.hits[0].workday, "20260909");
    }

    /// 재발 간격 — 이어진 두 건 사이 날짜 차. 「수정률」이 아니다.
    #[test]
    fn gaps_are_measured_between_consecutive_hits() {
        let dir = TempDir::new().unwrap();
        write_bug(dir.path(), "20260901", "a", "셸이 고아로 남았다", "x");
        write_bug(dir.path(), "20260903", "b", "좀비가 쌓였다", "x"); // +2
        write_bug(dir.path(), "20260913", "c", "먹통으로 남았다", "x"); // +10

        let cluster = mine(dir.path())
            .into_iter()
            .find(|c| c.id == "orphan-process")
            .unwrap();
        assert_eq!(cluster.last_gap_days, 10);
        assert_eq!(cluster.typical_gap_days, 10); // median([10, 2]) = 10
    }

    #[test]
    fn a_rule_that_speaks_the_cluster_language_is_linked() {
        let dir = TempDir::new().unwrap();
        write_bug(dir.path(), "20260901", "a", "셸이 고아로 남았다", "x");
        write_bug(dir.path(), "20260903", "b", "좀비가 쌓였다", "x");
        write_bug(dir.path(), "20260905", "c", "먹통으로 남았다", "x");
        let clusters = mine(dir.path());

        assert_eq!(
            clusters_for_rule(
                "자식 프로세스가 고아로 남지 않게 종료 경로마다 정리한다",
                &clusters
            ),
            vec!["orphan-process".to_string()]
        );
        assert!(clusters_for_rule("커밋 메시지는 한국어로 쓴다", &clusters).is_empty());
    }

    /// **실측** — 이 저장소의 진짜 일지에 대고 돌려 본다.
    ///
    /// 자동 게이트가 아니라 표지를 다듬을 때 쓰는 자다 (`cargo test -p ocul-pm
    /// mines_this_repository -- --ignored --nocapture`). 저장소 내용에 따라
    /// 결과가 바뀌므로 단언하지 않는다 — 사람이 읽고 판단하는 출력이다.
    #[test]
    #[ignore = "저장소 내용에 의존하는 수동 실측"]
    fn mines_this_repository() {
        let repo = Path::new("..");
        for cluster in mine(repo) {
            println!(
                "{:24} {:2}건 · 최근 {} · 재발 중앙값 {}일 · 직전 간격 {}일",
                cluster.id,
                cluster.hits.len(),
                cluster.last_seen,
                cluster.typical_gap_days,
                cluster.last_gap_days
            );
            for hit in cluster.hits.iter().take(3) {
                println!("    [{}] {} — {}", hit.marker, hit.workday, hit.title);
            }
        }
    }

    #[test]
    fn title_and_workday_are_read_from_the_layout() {
        assert_eq!(title_of("[x] 제목입니다\n\n## 발생 원인\n"), "제목입니다");
        assert_eq!(workday_of("20260903/Bugs/1000_bug_x.md"), Some("20260903"));
        assert_eq!(workday_of("Bugs/1000_bug_x.md"), None);
    }
}
