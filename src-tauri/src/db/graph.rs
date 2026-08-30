//! 의존성·코드 그래프 — 파일 의존, 심볼 관계, 그래프 재구축·조회·변경영향·호출.
//!
//! `db/mod.rs` 의 단일 `impl Db` 에서 갈라 나온 조각이다 — 순수 파일 이동이며
//! 동작·시그니처 변경은 없다.

use super::*;

impl Db {
    // ---------- AST & Code Analysis ----------

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

    pub async fn get_dependency_graph(&self, project_id: u32) -> Result<DependencyGraph> {
        let graph = self
            .conn
            .call(move |c| {
                // Get nodes (files in project)
                let mut stmt = c.prepare(
                    "SELECT id, path, language, size FROM files WHERE project_id = ?"
                )?;
                let nodes = stmt
                    .query_map([project_id as i64], |r| {
                        Ok(DependencyNode {
                            file_id: r.get::<_, i64>(0)? as u32,
                            path: r.get(1)?,
                            language: r.get(2)?,
                            size: r.get::<_, i64>(3)? as u32,
                        })
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;

                // Get edges
                let mut stmt = c.prepare(
                    "SELECT source_file_id, target_file_id FROM file_dependencies WHERE project_id = ?"
                )?;
                let edges = stmt
                    .query_map([project_id as i64], |r| {
                        Ok(DependencyEdge {
                            source_file_id: r.get::<_, i64>(0)? as u32,
                            target_file_id: r.get::<_, i64>(1)? as u32,
                        })
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;

                Ok(DependencyGraph { nodes, edges })
            })
            .await?;
        Ok(graph)
    }

    pub async fn get_file_symbols(&self, file_id: u32) -> Result<Vec<crate::ast::SymbolDef>> {
        let symbols = self
            .conn
            .call(move |c| {
                let mut stmt = c.prepare(
                    "SELECT name, kind, start_line, end_line, start_byte, end_byte
                     FROM symbol_definitions
                     WHERE file_id = ?
                     ORDER BY start_line ASC",
                )?;
                let rows = stmt
                    .query_map([file_id as i64], |r| {
                        Ok(crate::ast::SymbolDef {
                            name: r.get(0)?,
                            kind: r.get(1)?,
                            start_line: r.get::<_, i64>(2)? as u32,
                            end_line: r.get::<_, i64>(3)? as u32,
                            start_byte: r.get::<_, i64>(4)? as u32,
                            end_byte: r.get::<_, i64>(5)? as u32,
                        })
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                Ok(rows)
            })
            .await?;
        Ok(symbols)
    }

    /// PR-GR2 — replace a file's raw relations (delete + insert in one tx) so
    /// re-indexing a changed file doesn't duplicate rows. Resolved into edges by
    /// rebuild_code_graph. `relations` is (kind, name) — already de-duped.
    pub async fn replace_symbol_relations(
        &self,
        file_id: u32,
        relations: Vec<(String, Option<String>, String)>, // (kind, from_symbol, name)
    ) -> Result<()> {
        self.conn
            .call(move |c| {
                let tx = c.transaction()?;
                tx.execute(
                    "DELETE FROM symbol_relations WHERE file_id = ?",
                    params![file_id as i64],
                )?;
                {
                    let mut ins = tx.prepare(
                        "INSERT INTO symbol_relations (file_id, kind, from_symbol, name) VALUES (?, ?, ?, ?)",
                    )?;
                    for (kind, from_symbol, name) in &relations {
                        ins.execute(params![file_id as i64, kind, from_symbol, name])?;
                    }
                }
                tx.commit()?;
                Ok(())
            })
            .await?;
        Ok(())
    }

    /// PR-GR1 — rebuild the code graph (graph_nodes/graph_edges) for a project
    /// from the already-indexed files / symbol_definitions / file_dependencies.
    /// Pure SQL, LLM-free, deterministic (docs/graph-upgrade D-A). Full rebuild
    /// in one transaction, run at the end of indexing. Fills `contains`
    /// (file→symbol) + `imports` (file→file); calls/inherits land in PR-GR2.
    pub async fn rebuild_code_graph(&self, project_id: u32) -> Result<()> {
        self.conn
            .call(move |c| {
                let tx = c.transaction()?;
                tx.execute(
                    "DELETE FROM graph_edges WHERE project_id = ?",
                    params![project_id as i64],
                )?;
                tx.execute(
                    "DELETE FROM graph_nodes WHERE project_id = ?",
                    params![project_id as i64],
                )?;

                // file nodes
                let files: Vec<(i64, String, Option<String>)> = {
                    let mut s = tx.prepare("SELECT id, path, language FROM files WHERE project_id = ?")?;
                    let rows = s.query_map([project_id as i64], |r| {
                        Ok((
                            r.get::<_, i64>(0)?,
                            r.get::<_, String>(1)?,
                            r.get::<_, Option<String>>(2)?,
                        ))
                    })?;
                    rows.collect::<rusqlite::Result<Vec<_>>>()?
                };
                let mut file_node: std::collections::HashMap<i64, i64> = std::collections::HashMap::new();
                {
                    let mut ins = tx.prepare(
                        "INSERT INTO graph_nodes (project_id, kind, file_id, symbol_id, label, sub_kind, language, start_line, end_line)
                         VALUES (?, 'file', ?, NULL, ?, NULL, ?, NULL, NULL)",
                    )?;
                    for (fid, path, lang) in &files {
                        let label = path.rsplit('/').next().unwrap_or(path.as_str()).to_string();
                        ins.execute(params![project_id as i64, fid, label, lang])?;
                        file_node.insert(*fid, tx.last_insert_rowid());
                    }
                }

                // symbol nodes + `contains` edges (file → its symbols)
                let syms: Vec<(i64, i64, String, String, i64, i64)> = {
                    let mut s = tx.prepare(
                        "SELECT sd.id, sd.file_id, sd.name, sd.kind, sd.start_line, sd.end_line
                         FROM symbol_definitions sd JOIN files f ON f.id = sd.file_id
                         WHERE f.project_id = ?",
                    )?;
                    let rows = s.query_map([project_id as i64], |r| {
                        Ok((
                            r.get::<_, i64>(0)?,
                            r.get::<_, i64>(1)?,
                            r.get::<_, String>(2)?,
                            r.get::<_, String>(3)?,
                            r.get::<_, i64>(4)?,
                            r.get::<_, i64>(5)?,
                        ))
                    })?;
                    rows.collect::<rusqlite::Result<Vec<_>>>()?
                };
                {
                    let mut ins = tx.prepare(
                        "INSERT INTO graph_nodes (project_id, kind, file_id, symbol_id, label, sub_kind, language, start_line, end_line)
                         VALUES (?, 'symbol', ?, ?, ?, ?, NULL, ?, ?)",
                    )?;
                    let mut ins_edge = tx.prepare(
                        "INSERT OR IGNORE INTO graph_edges (project_id, edge_type, source_id, target_id, weight, direction, estimated)
                         VALUES (?, 'contains', ?, ?, 1.0, 'forward', 0)",
                    )?;
                    for (sid, fid, name, kind, sl, el) in &syms {
                        ins.execute(params![project_id as i64, fid, sid, name, kind, sl, el])?;
                        let node_id = tx.last_insert_rowid();
                        if let Some(&fnode) = file_node.get(fid) {
                            ins_edge.execute(params![project_id as i64, fnode, node_id])?;
                        }
                    }
                }

                // `imports` edges (file → file), mapped onto file nodes
                {
                    let deps: Vec<(i64, i64)> = {
                        let mut s = tx.prepare(
                            "SELECT source_file_id, target_file_id FROM file_dependencies WHERE project_id = ?",
                        )?;
                        let rows = s.query_map([project_id as i64], |r| {
                            Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))
                        })?;
                        rows.collect::<rusqlite::Result<Vec<_>>>()?
                    };
                    let mut ins_edge = tx.prepare(
                        "INSERT OR IGNORE INTO graph_edges (project_id, edge_type, source_id, target_id, weight, direction, estimated)
                         VALUES (?, 'imports', ?, ?, 1.0, 'forward', 0)",
                    )?;
                    for (src, tgt) in &deps {
                        if let (Some(&s), Some(&t)) = (file_node.get(src), file_node.get(tgt)) {
                            ins_edge.execute(params![project_id as i64, s, t])?;
                        }
                    }
                }

                // calls / inherits / implements edges (file → file), resolved
                // from raw symbol_relations (PR-GR2). File-level for readability:
                // a callee/parent `name` resolves to the file(s) defining a
                // symbol of that name. Confident (estimated=0) when the source
                // file imports that file; else a single global definer is an
                // estimated guess (estimated=1). Ambiguous (>1, not imported) is
                // skipped to avoid noise.
                {
                    let mut defs: std::collections::HashMap<String, Vec<i64>> =
                        std::collections::HashMap::new();
                    {
                        let mut s = tx.prepare(
                            "SELECT sd.name, sd.file_id FROM symbol_definitions sd
                             JOIN files f ON f.id = sd.file_id WHERE f.project_id = ?",
                        )?;
                        let rows = s.query_map([project_id as i64], |r| {
                            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
                        })?;
                        for row in rows {
                            let (name, fid) = row?;
                            defs.entry(name).or_default().push(fid);
                        }
                    }
                    let mut imports_of: std::collections::HashMap<i64, std::collections::HashSet<i64>> =
                        std::collections::HashMap::new();
                    {
                        let mut s = tx.prepare(
                            "SELECT source_file_id, target_file_id FROM file_dependencies WHERE project_id = ?",
                        )?;
                        let rows = s.query_map([project_id as i64], |r| {
                            Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))
                        })?;
                        for row in rows {
                            let (sfid, tfid) = row?;
                            imports_of.entry(sfid).or_default().insert(tfid);
                        }
                    }
                    let rels: Vec<(i64, String, String)> = {
                        let mut s = tx.prepare(
                            "SELECT sr.file_id, sr.kind, sr.name FROM symbol_relations sr
                             JOIN files f ON f.id = sr.file_id WHERE f.project_id = ?",
                        )?;
                        let rows = s.query_map([project_id as i64], |r| {
                            Ok((
                                r.get::<_, i64>(0)?,
                                r.get::<_, String>(1)?,
                                r.get::<_, String>(2)?,
                            ))
                        })?;
                        rows.collect::<rusqlite::Result<Vec<_>>>()?
                    };
                    let mut ins_edge = tx.prepare(
                        "INSERT OR IGNORE INTO graph_edges (project_id, edge_type, source_id, target_id, weight, direction, estimated)
                         VALUES (?, ?, ?, ?, ?, 'forward', ?)",
                    )?;
                    for (src_fid, kind, name) in &rels {
                        let candidates = match defs.get(name) {
                            Some(c) => c,
                            None => continue,
                        };
                        let imported = imports_of.get(src_fid);
                        let mut targets: Vec<i64> = Vec::new();
                        let mut estimated = 0i64;
                        for &cand in candidates {
                            if cand != *src_fid && imported.is_some_and(|s| s.contains(&cand)) {
                                targets.push(cand);
                            }
                        }
                        if targets.is_empty() {
                            let others: Vec<i64> =
                                candidates.iter().copied().filter(|&c| c != *src_fid).collect();
                            if others.len() == 1 {
                                targets.push(others[0]);
                                estimated = 1;
                            }
                        }
                        let weight: f64 = if estimated == 1 { 0.5 } else { 0.8 };
                        for tgt in targets {
                            if let (Some(&s), Some(&t)) = (file_node.get(src_fid), file_node.get(&tgt)) {
                                ins_edge.execute(params![project_id as i64, kind, s, t, weight, estimated])?;
                            }
                        }
                    }
                }

                tx.commit()?;
                Ok(())
            })
            .await?;
        Ok(())
    }

    /// PR-GR1 — read the code graph for rendering. `symbol_level=false` returns
    /// only file nodes + file→file (`imports`) edges (equivalent to
    /// get_dependency_graph but typed); `true` also includes symbol nodes +
    /// `contains` edges.
    pub async fn get_code_graph(&self, project_id: u32, symbol_level: bool) -> Result<CodeGraph> {
        // Lazy backfill: projects indexed before PR-GR1 have empty graph tables
        // (they fill on the next index). If the graph is empty but the project
        // has files, build it once now so the Code Map works without a reindex.
        let needs_backfill = self
            .conn
            .call(move |c| {
                let nodes: i64 = c.query_row(
                    "SELECT COUNT(*) FROM graph_nodes WHERE project_id = ?",
                    [project_id as i64],
                    |r| r.get(0),
                )?;
                let files: i64 = c.query_row(
                    "SELECT COUNT(*) FROM files WHERE project_id = ?",
                    [project_id as i64],
                    |r| r.get(0),
                )?;
                Ok(nodes == 0 && files > 0)
            })
            .await?;
        if needs_backfill {
            self.rebuild_code_graph(project_id).await?;
        }

        let graph = self
            .conn
            .call(move |c| {
                let node_sql = if symbol_level {
                    "SELECT gn.id, gn.kind, gn.label, gn.sub_kind, gn.language, gn.file_id, f.path, gn.start_line, gn.end_line
                     FROM graph_nodes gn JOIN files f ON f.id = gn.file_id WHERE gn.project_id = ?"
                } else {
                    "SELECT gn.id, gn.kind, gn.label, gn.sub_kind, gn.language, gn.file_id, f.path, gn.start_line, gn.end_line
                     FROM graph_nodes gn JOIN files f ON f.id = gn.file_id WHERE gn.project_id = ? AND gn.kind = 'file'"
                };
                let mut stmt = c.prepare(node_sql)?;
                let nodes = stmt
                    .query_map([project_id as i64], |r| {
                        Ok(GraphNodeDto {
                            id: r.get::<_, i64>(0)? as u32,
                            kind: r.get(1)?,
                            label: r.get(2)?,
                            sub_kind: r.get(3)?,
                            language: r.get(4)?,
                            file_id: r.get::<_, i64>(5)? as u32,
                            file_path: r.get(6)?,
                            start_line: r.get::<_, Option<i64>>(7)?.map(|v| v as u32),
                            end_line: r.get::<_, Option<i64>>(8)?.map(|v| v as u32),
                        })
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;

                let edge_sql = if symbol_level {
                    "SELECT id, edge_type, source_id, target_id, weight, direction, estimated
                     FROM graph_edges WHERE project_id = ?"
                } else {
                    "SELECT ge.id, ge.edge_type, ge.source_id, ge.target_id, ge.weight, ge.direction, ge.estimated
                     FROM graph_edges ge
                     JOIN graph_nodes s ON s.id = ge.source_id
                     JOIN graph_nodes t ON t.id = ge.target_id
                     WHERE ge.project_id = ? AND s.kind = 'file' AND t.kind = 'file'"
                };
                let mut stmt = c.prepare(edge_sql)?;
                let edges = stmt
                    .query_map([project_id as i64], |r| {
                        Ok(GraphEdgeDto {
                            id: r.get::<_, i64>(0)? as u32,
                            edge_type: r.get(1)?,
                            source: r.get::<_, i64>(2)? as u32,
                            target: r.get::<_, i64>(3)? as u32,
                            weight: r.get::<_, f64>(4)? as f32,
                            direction: r.get(5)?,
                            estimated: r.get::<_, i64>(6)? != 0,
                        })
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;

                Ok(CodeGraph { nodes, edges })
            })
            .await?;
        Ok(graph)
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

    /// PR-GR3 — symbol-level calls for one file's symbols ("which function calls
    /// which"). Resolves each callee name to a defining file: same file →
    /// imported file → single global definer (estimated). Read-only.
    pub async fn get_file_calls(&self, file_id: u32) -> Result<Vec<SymbolCall>> {
        let calls = self
            .conn
            .call(move |c| {
                use std::collections::{HashMap, HashSet};
                let project_id: i64 = c.query_row(
                    "SELECT project_id FROM files WHERE id = ?",
                    [file_id as i64],
                    |r| r.get(0),
                )?;
                // name -> [(path, file_id)] defining a symbol of that name
                let mut defs: HashMap<String, Vec<(String, i64)>> = HashMap::new();
                {
                    let mut s = c.prepare(
                        "SELECT sd.name, f.path, f.id FROM symbol_definitions sd
                         JOIN files f ON f.id = sd.file_id WHERE f.project_id = ?",
                    )?;
                    let rows = s.query_map([project_id], |r| {
                        Ok((
                            r.get::<_, String>(0)?,
                            r.get::<_, String>(1)?,
                            r.get::<_, i64>(2)?,
                        ))
                    })?;
                    for row in rows {
                        let (n, p, fid) = row?;
                        defs.entry(n).or_default().push((p, fid));
                    }
                }
                let mut imported: HashSet<i64> = HashSet::new();
                {
                    let mut s = c.prepare(
                        "SELECT target_file_id FROM file_dependencies WHERE source_file_id = ?",
                    )?;
                    let rows = s.query_map([file_id as i64], |r| r.get::<_, i64>(0))?;
                    for row in rows {
                        imported.insert(row?);
                    }
                }
                let rels: Vec<(String, Option<String>, String)> = {
                    let mut s = c.prepare(
                        "SELECT kind, from_symbol, name FROM symbol_relations WHERE file_id = ?
                         ORDER BY from_symbol IS NULL, from_symbol, kind, name",
                    )?;
                    let rows = s.query_map([file_id as i64], |r| {
                        Ok((
                            r.get::<_, String>(0)?,
                            r.get::<_, Option<String>>(1)?,
                            r.get::<_, String>(2)?,
                        ))
                    })?;
                    rows.collect::<rusqlite::Result<Vec<_>>>()?
                };
                let self_id = file_id as i64;
                let mut out = Vec::new();
                for (kind, from_symbol, name) in rels {
                    let (target_path, estimated) = match defs.get(&name) {
                        None => (None, false),
                        Some(list) => {
                            if let Some((p, _)) = list.iter().find(|(_, fid)| *fid == self_id) {
                                (Some(p.clone()), false)
                            } else if let Some((p, _)) =
                                list.iter().find(|(_, fid)| imported.contains(fid))
                            {
                                (Some(p.clone()), false)
                            } else {
                                let others: Vec<&(String, i64)> =
                                    list.iter().filter(|(_, fid)| *fid != self_id).collect();
                                if others.len() == 1 {
                                    (Some(others[0].0.clone()), true)
                                } else {
                                    (None, false)
                                }
                            }
                        }
                    };
                    out.push(SymbolCall {
                        from_symbol,
                        kind,
                        callee: name,
                        target_path,
                        estimated,
                    });
                }
                Ok(out)
            })
            .await?;
        Ok(calls)
    }

    pub async fn clear_project_dependencies(&self, project_id: u32) -> Result<()> {
        self.conn
            .call(move |c| {
                c.execute(
                    "DELETE FROM file_dependencies WHERE project_id = ?",
                    [project_id as i64],
                )?;
                Ok(())
            })
            .await?;
        Ok(())
    }
}
