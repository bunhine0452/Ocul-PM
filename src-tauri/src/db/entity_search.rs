//! ⌘K 팔레트의 엔티티 점프 — 일지·플랜·플랜 항목·토의 제목 통합 검색.
//!
//! `db/code_index.rs` 에 살던 조각이다. 코드 색인(파일·청크·임베딩·심볼)을 4.0 에서
//! 걷으며 그 파일을 지웠고, 색인과 무관한 이 질의만 옮겨 왔다 — 동작·시그니처는 그대로.

use super::*;

impl Db {
    /// v2 U7 — 팔레트 엔티티 점프: 일지·플랜·플랜 항목·토의 제목 통합 검색.
    /// 각 kind 를 개별 쿼리(prefix 매치 우선 스코어)로 뽑아 Rust 에서 병합
    /// 정렬(score ASC, 최신 ASC 문자열 비교 역순)한다. docs 파일은 캐시
    /// 테이블이 없어 프런트가 `docs_tree` 로 별도 처리한다.
    pub async fn search_oculpm_entities(
        &self,
        project_id: u32,
        query: String,
        limit: u32,
    ) -> Result<Vec<EntityHit>> {
        let q = query.trim().to_string();
        if q.is_empty() {
            return Ok(Vec::new());
        }
        let prefix = format!("{}%", escape_like(&q));
        let sub = format!("%{}%", escape_like(&q));
        let lim = limit.clamp(1, 50) as i64;
        let hits = self
            .conn
            .call(move |c| {
                // (score, recency, hit) — recency 는 RFC3339 문자열 (사전순 ≈ 시간순).
                let mut acc: Vec<(i64, String, EntityHit)> = Vec::new();

                {
                    let mut stmt = c.prepare(
                        "SELECT relative_path, title, workday, type, created_at,
                                CASE WHEN title LIKE ?2 ESCAPE '\\' THEN 0 ELSE 1 END
                         FROM oculpm_journal
                         WHERE project_id = ?1
                           AND (title LIKE ?3 ESCAPE '\\' OR slug LIKE ?3 ESCAPE '\\')
                         ORDER BY 6 ASC, created_at DESC LIMIT ?4",
                    )?;
                    let rows =
                        stmt.query_map(params![project_id as i64, prefix, sub, lim], |r| {
                            let workday: String = r.get(2)?;
                            let ty: String = r.get(3)?;
                            Ok((
                                r.get::<_, i64>(5)?,
                                r.get::<_, String>(4)?,
                                EntityHit {
                                    kind: EntityKind::Journal,
                                    id: r.get(0)?,
                                    title: r.get(1)?,
                                    subtitle: format!("{workday} · {ty}"),
                                },
                            ))
                        })?;
                    for row in rows {
                        acc.push(row?);
                    }
                }

                {
                    let mut stmt = c.prepare(
                        "SELECT plan_id, title, status, updated_at,
                                CASE WHEN title LIKE ?2 ESCAPE '\\' THEN 0 ELSE 1 END
                         FROM oculpm_plans
                         WHERE project_id = ?1
                           AND (title LIKE ?3 ESCAPE '\\' OR plan_id LIKE ?3 ESCAPE '\\')
                         ORDER BY 5 ASC, updated_at DESC LIMIT ?4",
                    )?;
                    let rows =
                        stmt.query_map(params![project_id as i64, prefix, sub, lim], |r| {
                            let status: String = r.get(2)?;
                            Ok((
                                r.get::<_, i64>(4)?,
                                r.get::<_, String>(3)?,
                                EntityHit {
                                    kind: EntityKind::Plan,
                                    id: r.get(0)?,
                                    title: r.get(1)?,
                                    subtitle: format!("플랜 · {status}"),
                                },
                            ))
                        })?;
                    for row in rows {
                        acc.push(row?);
                    }
                }

                {
                    let mut stmt = c.prepare(
                        "SELECT i.plan_id, i.item_id, i.title, p.title,
                                COALESCE(i.last_update, p.updated_at),
                                CASE WHEN i.title LIKE ?2 ESCAPE '\\' THEN 0 ELSE 1 END
                         FROM oculpm_plan_items i
                         JOIN oculpm_plans p
                           ON p.project_id = i.project_id AND p.plan_id = i.plan_id
                         WHERE i.project_id = ?1 AND i.title LIKE ?3 ESCAPE '\\'
                         ORDER BY 6 ASC, 5 DESC LIMIT ?4",
                    )?;
                    let rows =
                        stmt.query_map(params![project_id as i64, prefix, sub, lim], |r| {
                            let plan_id: String = r.get(0)?;
                            let item_id: String = r.get(1)?;
                            Ok((
                                r.get::<_, i64>(5)?,
                                r.get::<_, String>(4)?,
                                EntityHit {
                                    kind: EntityKind::PlanItem,
                                    id: format!("{plan_id}#{item_id}"),
                                    title: r.get(2)?,
                                    subtitle: r.get(3)?,
                                },
                            ))
                        })?;
                    for row in rows {
                        acc.push(row?);
                    }
                }

                // prefix 매치 우선, 동점이면 최신 우선.
                acc.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| b.1.cmp(&a.1)));
                acc.truncate(lim as usize);
                Ok(acc.into_iter().map(|(_, _, h)| h).collect::<Vec<_>>())
            })
            .await?;
        Ok(hits)
    }
}
