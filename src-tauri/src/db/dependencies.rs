//! 파일 의존 — import 해석 결과(`file_dependencies`)와 그 위의 변경 영향.
//!
//! 변경 화면의 「이 파일을 바꾸면 영향받는 파일」이 유일한 소비처다. 코드 맵
//! 화면과 그것만 쓰던 그래프 재구축·심볼 관계·호출 조회는 2026-10-24 에
//! 걷어냈다 (`graph_nodes`·`graph_edges`·`symbol_relations` 테이블은 마이그레이션
//! 없이 남아 있다 — 더는 쓰지 않는다).

use super::*;

impl Db {
    pub async fn insert_file_dependency(
        &self,
        project_id: u32,
        source_file_id: u32,
        target_file_id: u32,
    ) -> Result<()> {
        self.conn
            .call(move |c| {
                c.execute(
                    "INSERT OR IGNORE INTO file_dependencies (project_id, source_file_id, target_file_id)
                     VALUES (?, ?, ?)",
                    params![project_id as i64, source_file_id as i64, target_file_id as i64],
                )?;
                Ok(())
            })
            .await?;
        Ok(())
    }

    /// PR-GR4 — change-impact analysis. Given changed file paths, return the
    /// files that (transitively) import them (reverse-dependency BFS over
    /// file_dependencies). `depth` = hops from the nearest changed file.
    pub async fn get_change_impact(
        &self,
        project_id: u32,
        changed_paths: Vec<String>,
    ) -> Result<ImpactReport> {
        let report = self
            .conn
            .call(move |c| {
                use std::collections::{HashMap, HashSet, VecDeque};
                // path <-> file_id
                let mut path_to_id: HashMap<String, i64> = HashMap::new();
                let mut id_to_path: HashMap<i64, String> = HashMap::new();
                {
                    let mut s = c.prepare("SELECT id, path FROM files WHERE project_id = ?")?;
                    let rows = s.query_map([project_id as i64], |r| {
                        Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
                    })?;
                    for row in rows {
                        let (id, path) = row?;
                        path_to_id.insert(path.clone(), id);
                        id_to_path.insert(id, path);
                    }
                }
                // reverse adjacency: target_file_id -> [source_file_id] (source imports target)
                let mut importers: HashMap<i64, Vec<i64>> = HashMap::new();
                {
                    let mut s = c.prepare(
                        "SELECT source_file_id, target_file_id FROM file_dependencies WHERE project_id = ?",
                    )?;
                    let rows = s.query_map([project_id as i64], |r| {
                        Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))
                    })?;
                    for row in rows {
                        let (src, tgt) = row?;
                        importers.entry(tgt).or_default().push(src);
                    }
                }
                // seeds = changed files present in the index
                let mut seeds: Vec<i64> = Vec::new();
                let mut matched: Vec<String> = Vec::new();
                for p in &changed_paths {
                    if let Some(&id) = path_to_id.get(p) {
                        seeds.push(id);
                        matched.push(p.clone());
                    }
                }
                let seed_set: HashSet<i64> = seeds.iter().copied().collect();
                let mut depth: HashMap<i64, u32> = HashMap::new();
                let mut queue: VecDeque<i64> = VecDeque::new();
                for &s in &seeds {
                    depth.insert(s, 0);
                    queue.push_back(s);
                }
                while let Some(cur) = queue.pop_front() {
                    let d = depth[&cur];
                    if let Some(srcs) = importers.get(&cur) {
                        for &src in srcs {
                            if let std::collections::hash_map::Entry::Vacant(e) = depth.entry(src) {
                                e.insert(d + 1);
                                queue.push_back(src);
                            }
                        }
                    }
                }
                let mut affected: Vec<ImpactNode> = depth
                    .into_iter()
                    .filter(|(id, _)| !seed_set.contains(id))
                    .filter_map(|(id, d)| {
                        id_to_path.get(&id).map(|p| ImpactNode {
                            file_id: id as u32,
                            path: p.clone(),
                            depth: d,
                        })
                    })
                    .collect();
                affected.sort_by(|a, b| a.depth.cmp(&b.depth).then_with(|| a.path.cmp(&b.path)));
                Ok(ImpactReport { changed: matched, affected })
            })
            .await?;
        Ok(report)
    }
}
