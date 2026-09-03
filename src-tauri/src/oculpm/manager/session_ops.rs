//! 세션 — 현재 세션·수동 시작/종료·목록·파일 변경·인덱스 스냅샷·좀비 복구.
//!
//! `manager/mod.rs` 의 단일 `impl OculpmManager` 에서 갈라 나온 조각이다 —
//! 순수 파일 이동이며 동작·시그니처 변경은 없다.

use super::*;

impl OculpmManager {
    // ─── W2-PR4: crash recovery ─────────────────────────────────────────────

    /// Scan the most recent `max_workdays` workday directories for zombie
    /// sessions (`ended_at == null`) and finalize each as `crash_recovered`.
    ///
    /// `ended_at` is set to the timestamp of the last `FileChangeEvent` for
    /// that session (reverse ndjson scan), falling back to `started_at` if the
    /// session has zero recorded events.
    ///
    /// This is a static method on `OculpmManager` rather than an instance
    /// method so it can be called during `init_project` before the
    /// `ProjectEntry` is inserted into the projects map.
    pub(crate) async fn recover_zombie_sessions(
        index_writer: &IndexWriter,
        max_workdays: usize,
    ) -> Result<u32, OculpmError> {
        let all_workdays = index_writer.list_workdays().await?;
        let recent: Vec<&str> = all_workdays
            .iter()
            .take(max_workdays)
            .map(|s| s.as_str())
            .collect();

        let mut recovered_count: u32 = 0;

        for workday in &recent {
            let sessions = index_writer.list_sessions(workday).await?;
            for s in sessions.iter().filter(|s| s.ended_at.is_none()) {
                let last_ts = index_writer.last_event_ts(workday, &s.id).await?;
                let ended_at = last_ts.unwrap_or_else(|| s.started_at.clone());

                index_writer
                    .finalize_session(
                        &s.id,
                        SessionEnd {
                            ended_at,
                            ended_reason: EndedReason::CrashRecovered,
                        },
                    )
                    .await?;

                recovered_count += 1;
                tracing::info!(
                    target: "oculpm::manager",
                    session_id = %s.id,
                    workday,
                    "recovered zombie session"
                );
            }
        }

        if recovered_count > 0 {
            tracing::info!(
                target: "oculpm::manager",
                recovered_count,
                workdays_scanned = recent.len(),
                "crash recovery complete"
            );
        }

        Ok(recovered_count)
    }

    /// Get the current active session (if any). Returns None if idle/closing
    /// or if the project hasn't started a watcher yet.
    pub async fn get_current_session(
        &self,
        project_id: u32,
    ) -> Result<Option<Session>, OculpmError> {
        let projects = self.projects.read().await;
        let entry = projects
            .get(&project_id)
            .ok_or(OculpmError::NotInitialized(project_id))?;
        match &entry.session {
            Some(actor) => actor.get_current_session().await,
            None => Ok(None),
        }
    }

    /// Manually start a session. Idempotent — if already active, returns the
    /// existing session. If no watcher is running, starts one first.
    /// 터미널에서 코딩 에이전트 실행이 감지됐다 (2026-07-30, OSC 133;C/D).
    ///
    /// 훅 브리지(`claude_hooks`)와 **같은 신호**를 쓰되 출처가 PTY 라는 점만
    /// 다르다 — 덕분에 훅이 없는 에이전트(cursor·gemini·codex)도 세션 경계와
    /// 라벨을 휴리스틱이 아닌 실측으로 갖는다.
    ///
    /// 세션 액터가 없으면(감시 미시작) 조용히 `false` — 터미널을 쓴다는 이유로
    /// 감시를 켜는 부작용을 내지 않는다. 반환값은 "신호가 전달됐는가".
    pub async fn agent_run_signal(
        &self,
        project_id: u32,
        started: bool,
        agent_label: &str,
    ) -> Result<bool, OculpmError> {
        let projects = self.projects.read().await;
        let Some(entry) = projects.get(&project_id) else {
            return Ok(false);
        };
        let Some(actor) = &entry.session else {
            return Ok(false);
        };
        // 대화 id 는 빈 문자열로 둔다. 이 신호는 셸 통합(OSC 133)이 만든
        // 것이라 어느 대화인지 알 길이 없다 — 추측해 채우면 없는 참여자를
        // 지어내는 셈이고, 액터가 빈 값을 버려 준다.
        if started {
            actor.hook_agent_active(agent_label, "")?;
        } else {
            actor.hook_agent_ended("")?;
        }
        Ok(true)
    }

    pub async fn start_session_manual(
        &self,
        project_id: u32,
    ) -> Result<Option<Session>, OculpmError> {
        {
            let projects = self.projects.read().await;
            let entry = projects
                .get(&project_id)
                .ok_or(OculpmError::NotInitialized(project_id))?;
            if let Some(actor) = &entry.session {
                actor.manual_start()?;
                // Give the actor a moment to process.
                tokio::task::yield_now().await;
                return actor.get_current_session().await;
            }
        }
        // No session actor → need to start watcher first.
        self.watcher_start(project_id, None).await?;
        let projects = self.projects.read().await;
        let entry = projects
            .get(&project_id)
            .ok_or(OculpmError::NotInitialized(project_id))?;
        if let Some(actor) = &entry.session {
            actor.manual_start()?;
            tokio::task::yield_now().await;
            return actor.get_current_session().await;
        }
        Ok(None)
    }

    /// Manually end a session. The session_id must match the active session.
    pub async fn end_session_manual(
        &self,
        project_id: u32,
        session_id: String,
    ) -> Result<(), OculpmError> {
        let projects = self.projects.read().await;
        let entry = projects
            .get(&project_id)
            .ok_or(OculpmError::NotInitialized(project_id))?;
        match &entry.session {
            Some(actor) => actor.manual_end(session_id),
            None => Err(OculpmError::InvalidConfig(
                "no active session actor".to_string(),
            )),
        }
    }

    /// List sessions for a given workday (or today if None).
    pub async fn list_sessions(
        &self,
        db: &Db,
        project_id: u32,
        workday: Option<String>,
    ) -> Result<Vec<Session>, OculpmError> {
        let (writer, wd) = {
            let projects = self.projects.read().await;
            let entry = projects
                .get(&project_id)
                .ok_or(OculpmError::NotInitialized(project_id))?;
            let wd = workday.unwrap_or_else(|| entry.resolver.workday_of(chrono::Utc::now()));
            (entry.index_writer.clone(), wd)
        };
        let mut sessions = writer.list_sessions(&wd).await?;
        attach_journal_links(db, project_id, &wd, &mut sessions).await;
        Ok(sessions)
    }

    /// Get file changes for a workday, optionally filtered by session_id.
    pub async fn get_file_changes(
        &self,
        project_id: u32,
        workday: String,
        session_id: Option<String>,
    ) -> Result<Vec<FileChangeEvent>, OculpmError> {
        let projects = self.projects.read().await;
        let entry = projects
            .get(&project_id)
            .ok_or(OculpmError::NotInitialized(project_id))?;
        let events = entry.index_writer.read_file_changes(&workday, None).await?;
        Ok(match session_id {
            Some(sid) => events.into_iter().filter(|e| e.session_id == sid).collect(),
            None => events,
        })
    }

    /// Read a snapshot (open or close) for a given workday.
    pub async fn get_index_snapshot(
        &self,
        project_id: u32,
        workday: String,
        kind: SnapshotKind,
    ) -> Result<Snapshot, OculpmError> {
        let projects = self.projects.read().await;
        let entry = projects
            .get(&project_id)
            .ok_or(OculpmError::NotInitialized(project_id))?;
        entry
            .index_writer
            .read_snapshot(&workday, kind)
            .await?
            .ok_or_else(|| {
                OculpmError::InvalidConfig(format!(
                    "snapshot not captured for workday={workday}, kind={kind:?}"
                ))
            })
    }
}
