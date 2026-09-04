//! 프로젝트 생명주기 — init / status / config / 종료 · 워처 기동·정지·건강성.
//!
//! `manager/mod.rs` 의 단일 `impl OculpmManager` 에서 갈라 나온 조각이다 —
//! 순수 파일 이동이며 동작·시그니처 변경은 없다.

use super::*;

impl OculpmManager {
    /// Initialise `.oculpm/` for a project. Idempotent — calling twice with
    /// the same `project_id` returns a no-op report on the second call.
    /// `template_lang` 은 **최초 시드 때만** 쓰인다 — 이미 config 가 있으면
    /// 무시된다. AGENTS.md 마스터(`master_ko` / `master_en`)를 고르는 값이고,
    /// 한 번 시드된 `_template.md` 는 사용자 소유라 나중에 바꿔도 안 갈린다
    /// (그래서 여기서 정하는 게 유일한 기회다).
    pub async fn init_project(
        &self,
        project_id: u32,
        root: &Path,
        template_lang: &str,
    ) -> Result<OculpmInitReport, OculpmError> {
        // 엔트리 생성은 `watcher_start_with` 의 느린 구간(맵 락 밖에서 도는 락
        // 파일 획득)과 배타여야 한다 — 안 그러면 한 프로세스에 같은 경로의
        // `LockGuard` 가 둘 생긴다 (`lifecycle_locks` 필드 주석).
        let lifecycle = self.lifecycle_lock(project_id).await;
        let _lifecycle = lifecycle.lock().await;

        // Fast path: already initialised in this session.
        {
            let projects = self.projects.read().await;
            if let Some(entry) = projects.get(&project_id) {
                return Ok(OculpmInitReport {
                    created_dirs: Vec::new(),
                    wrote_config: false,
                    // W1-PR8 will populate this; for now stay false on idempotent calls.
                    wrote_gitignore: false,
                    lock_state: lock_state_from_guard(&entry.lock),
                    agent_files: Vec::new(),
                });
            }
        }

        // First-time init for this session.
        let mut report = OculpmInitReport {
            created_dirs: Vec::new(),
            wrote_config: false,
            wrote_gitignore: false,
            lock_state: LockStateView::Uninitialized,
            agent_files: Vec::new(),
        };

        // 1. Build (or load) the config + resolver. Resolver is built from
        //    the same config so any tz/HH:MM error surfaces here, not later.
        let config_path = root.join(".oculpm").join("config.toml");
        let mut wrote_config = false;
        let config = if config_path.exists() {
            let cfg = OculpmConfig::load(&config_path)?;
            cfg.validate()?;
            cfg
        } else {
            let mut cfg = OculpmConfig::default_for_new_project();
            cfg.agents.template_language = match template_lang {
                "en" => "en".to_string(),
                _ => "ko".to_string(),
            };
            // Defaults are validated by `roundtrip_default` (W1-PR4), so this
            // can't fail in practice — kept as a guard.
            cfg.validate()?;
            wrote_config = true;
            cfg
        };
        let resolver =
            WorkdayResolver::new(&config.workday.timezone, &config.workday.day_starts_at)?;

        // 2. Ensure `.oculpm/` exists.
        let oculpm_dir = resolver.project_oculpm_dir(root);
        let dir_existed_before = oculpm_dir.exists();
        std::fs::create_dir_all(&oculpm_dir).map_err(|source| OculpmError::Io {
            path: oculpm_dir.clone(),
            source,
        })?;
        if !dir_existed_before {
            report.created_dirs.push(".oculpm".to_string());
        }

        // 3. `.schema-version`. Only write if missing — preserve user/migration tooling intent.
        let schema_version_path = resolver.schema_version_path(root);
        if !schema_version_path.exists() {
            write_atomic(&schema_version_path, b"1\n")?;
        }

        // 4. Persist config (atomic) only if we just generated defaults.
        if wrote_config {
            config.save(&config_path)?;
            report.wrote_config = true;
        }

        // 5. Acquire the lock. Storing the guard in `ProjectEntry` keeps the
        //    heartbeat task alive for the duration of the project being open.
        let lock_path = resolver.lock_path(root);
        let acq =
            LockGuard::acquire_with(&lock_path, AcquirePolicy::Polite, self.lock_evicted.clone())
                .await?;
        let (guard, lock_state) = match acq {
            LockAcquisition::Acquired(g) => (Some(g), LockStateView::Healthy),
            LockAcquisition::Recovered { guard, .. } => (Some(guard), LockStateView::Recovered),
            // init 은 언제나 양보한다 — 가져오기는 앱 시작의 `watcher_start`
            // 가 정책으로 결정한다 (한 곳에서만 결정해야 예측 가능하다).
            LockAcquisition::TakenOver { guard, .. } => (Some(guard), LockStateView::Recovered),
            LockAcquisition::Held { .. } => (None, LockStateView::HeldByOther),
        };
        report.lock_state = lock_state;

        // 5.5 (W2-PR4) Crash recovery — scan recent workdays for zombie
        //     sessions (ended_at == null) and finalize them as
        //     `crash_recovered`. Runs *before* the watcher boots so there is
        //     no race with new events being appended.
        //     Only runs when we hold the lock (Acquired or Recovered).
        let index_writer = Arc::new(IndexWriter::new(root.to_path_buf(), resolver.clone()));
        if guard.is_some() {
            if let Err(e) = Self::recover_zombie_sessions(&index_writer, RECOVERY_WORKDAYS).await {
                tracing::warn!(
                    target: "oculpm::manager",
                    project_id,
                    error = %e,
                    "crash recovery failed (non-fatal) — continuing init"
                );
            }
        }

        // 6. `.gitignore` managed block. Idempotent: only flips `wrote_gitignore`
        //    when we actually inserted or updated. An orphan begin/end marker
        //    raises `ManagedBlockMismatch`, which we surface to the caller —
        //    the rest of init has already succeeded but the lock-acquire side
        //    effects (file + heartbeat) need to be undone before we return.
        let gitignore_path = root.join(".gitignore");
        // Union-merge with whatever the block already holds (A0a) — see
        // `merged_gitignore_body`. A newer-versioned block is additionally
        // left untouched by `write_managed_block`'s downgrade guard.
        let gitignore_body = match read_managed_block(&gitignore_path, "oculpm", CommentStyle::Hash)
        {
            Ok(existing) => merged_gitignore_body(existing.as_ref().map(|b| b.content.as_str())),
            Err(e) => {
                drop(guard);
                return Err(e);
            }
        };
        match write_managed_block(
            &gitignore_path,
            "oculpm",
            &gitignore_body,
            CommentStyle::Hash,
        ) {
            Ok(result) => {
                report.wrote_gitignore = matches!(
                    result,
                    ManagedBlockResult::Inserted | ManagedBlockResult::Updated
                );
            }
            Err(e) => {
                // Drop the just-acquired guard so the on-disk `.lock` file and
                // heartbeat task don't outlive a failed init.
                drop(guard);
                return Err(e);
            }
        }

        // 6.5. `.oculpm/README.md` — 저장소 방문자용 안내 (A2 활성화 배선).
        //      없을 때만 생성, 실패 무해 (본 init 을 막지 않는다).
        crate::oculpm::readme::ensure_oculpm_readme(root);

        // 7. Stash the entry.
        let entry = ProjectEntry {
            root: root.to_path_buf(),
            config,
            resolver,
            lock: guard,
            index_writer,
            session: None,
            watcher: None,
            watcher_epoch: next_watcher_epoch(),
        };
        self.projects.write().await.insert(project_id, entry);

        Ok(report)
    }

    /// Snapshot of the project's current `.oculpm/` state. Safe to call for an
    /// uninitialised project — returns a default `Uninitialized` status.
    pub async fn get_status(&self, project_id: u32) -> OculpmStatus {
        let projects = self.projects.read().await;
        match projects.get(&project_id) {
            Some(entry) => OculpmStatus {
                initialized: true,
                // We validated on init; assume still valid until set_config
                // re-validates. Future PRs may add disk re-checks here.
                config_valid: true,
                lock_state: lock_state_from_guard(&entry.lock),
                current_workday: entry.resolver.workday_of(chrono::Utc::now()),
                // 실제 워처 상태. 예전엔 "W2 가 바꾼다" 는 주석과 함께 `Stopped`
                // 로 박혀 있어 터미널 상태바가 늘 "감시 꺼짐" 을 그렸다
                // (2026-08-30 감사) — 워처는 잘 돌고 있었는데도.
                watcher_state: entry
                    .watcher
                    .as_ref()
                    .map(|w| w.status().state)
                    .unwrap_or(WatcherStateView::Stopped),
            },
            None => OculpmStatus {
                initialized: false,
                config_valid: false,
                lock_state: LockStateView::Uninitialized,
                current_workday: String::new(),
                watcher_state: WatcherStateView::Stopped,
            },
        }
    }

    /// Read the in-memory `OculpmConfig` for an initialised project. Errors
    /// with `NotInitialized` if `init_project` hasn't been called.
    pub async fn get_config(&self, project_id: u32) -> Result<OculpmConfig, OculpmError> {
        let projects = self.projects.read().await;
        projects
            .get(&project_id)
            .map(|e| e.config.clone())
            .ok_or(OculpmError::NotInitialized(project_id))
    }

    /// Validate + persist + update in-memory state. Also refreshes the
    /// `WorkdayResolver` so subsequent `get_status` calls reflect any tz
    /// change immediately.
    pub async fn set_config(
        &self,
        project_id: u32,
        new_config: OculpmConfig,
    ) -> Result<(), OculpmError> {
        new_config.validate()?;
        let new_resolver = WorkdayResolver::new(
            &new_config.workday.timezone,
            &new_config.workday.day_starts_at,
        )?;

        // 설정 교체도 생명주기다 — `watcher_start_with` 가 스냅샷으로 뜬 config
        // 로 워처를 세우는 중에 끼어들면 방금 뜬 워처가 태어나면서부터 낡는다.
        let lifecycle = self.lifecycle_lock(project_id).await;
        let _lifecycle = lifecycle.lock().await;

        let mut projects = self.projects.write().await;
        let entry = projects
            .get_mut(&project_id)
            .ok_or(OculpmError::NotInitialized(project_id))?;

        let config_path = entry.root.join(".oculpm").join("config.toml");
        new_config.save(&config_path)?;
        entry.config = new_config;
        entry.resolver = new_resolver;
        Ok(())
    }

    /// Release the lock and forget this project's in-memory state. Idempotent:
    /// a no-op if the project was never initialised. The actual cleanup happens
    /// in `LockGuard::drop` when the removed `ProjectEntry` falls out of scope.
    pub async fn on_project_closed(&self, project_id: u32) -> Result<(), OculpmError> {
        // 엔트리 제거도 `watcher_start_with` 의 느린 구간과 배타여야 한다 —
        // 여기서 가드를 떨어뜨리는 사이 저쪽이 같은 파일의 새 가드를 잡으면
        // 두 가드가 같은 pid 로 같은 파일을 두고 다툰다.
        let lifecycle = self.lifecycle_lock(project_id).await;
        let _lifecycle = lifecycle.lock().await;

        let mut projects = self.projects.write().await;
        if projects.remove(&project_id).is_some() {
            tracing::info!(
                target: "oculpm::manager",
                project_id,
                "released lock for closed project"
            );
        }
        Ok(())
    }

    /// Sync best-effort shutdown for `RunEvent::ExitRequested` — drops every
    /// `ProjectEntry`, which fires `LockGuard::drop` synchronously and removes
    /// the on-disk lock file.
    ///
    /// We use `try_write` with a short retry loop because we cannot `await`
    /// from inside Tauri's run-event callback. If every retry contends (which
    /// would mean some other tokio task is mid-mutation at shutdown), the
    /// `OculpmManager` will still get dropped when Tauri's `State` container
    /// tears down — `LockGuard::drop` covers us via RAII as a last resort.
    pub fn shutdown_all_blocking(&self) {
        for attempt in 0..10 {
            if let Ok(mut projects) = self.projects.try_write() {
                let count = projects.len();
                projects.clear();
                if count > 0 {
                    tracing::info!(
                        target: "oculpm::manager",
                        project_count = count,
                        "released project locks on shutdown"
                    );
                }
                return;
            }
            if attempt < 9 {
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
        }
        tracing::warn!(
            target: "oculpm::manager",
            "shutdown_all_blocking: projects map locked after 10 retries — relying on Drop"
        );
    }

    // ─── W2-PR6: watcher / session / index commands ─────────────────────────

    /// Start the filesystem watcher + session actor for the given project.
    /// Idempotent — if already running, returns Ok.
    ///
    /// W4 dogfooding follow-up (2026-05-26) — reuses an existing
    /// `entry.session` if one is alive. Together with `watcher_stop` no
    /// longer shutting down the session actor, this means rapidly toggling
    /// between the Start screen and a project view keeps the *same*
    /// session_id across cycles, instead of multiplying sessions per
    /// toggle (the user-visible repro of W4 §발견 2 bis).
    pub async fn watcher_start(
        &self,
        project_id: u32,
        app_handle: Option<tauri::AppHandle>,
    ) -> Result<(), OculpmError> {
        self.watcher_start_with(project_id, app_handle, AcquirePolicy::Polite)
            .await
    }

    /// 락 정책을 지정해 감시를 시작한다.
    ///
    /// `TakeOver` 는 **앱이 새로 뜰 때만** 쓴다 — "가장 최근에 연 인스턴스가
    /// 주인" 규칙이라야 사용자가 결과를 예측할 수 있다. 재시도 경로가 이걸
    /// 쓰면 두 인스턴스가 60초마다 서로를 쫓아내며 무한히 주고받는다.
    ///
    /// **락 스코프** — 예전에는 전역 프로젝트 맵의 write 락을 쥔 채로 락 파일
    /// 획득(`ps` fork)과 OS 워치 등록까지 갔다. 그동안 *다른 모든 프로젝트의*
    /// manager 접근이 read 조차 막혔다. 지금은 셋으로 나뉜다:
    ///
    /// 1. 맵 write 락 — 스냅샷만 뜬다 (IO 없음).
    /// 2. 맵 락 밖 — 느린 일 전부 (락 파일 · 세션 · 워처).
    /// 3. 맵 write 락 재획득 — **세대가 그대로일 때만** 설치 (CAS).
    ///
    /// 1↔3 사이에 상태가 변할 수 있으므로 두 겹으로 막는다: 프로젝트 단위
    /// `lifecycle_lock` 이 엔트리 생성·제거·설정 교체를 배제하고, `watcher_epoch`
    /// 가 그사이 도착한 "그만"(`watcher_stop` 등)을 잡는다.
    pub async fn watcher_start_with(
        &self,
        project_id: u32,
        app_handle: Option<tauri::AppHandle>,
        policy: AcquirePolicy,
    ) -> Result<(), OculpmError> {
        let lifecycle = self.lifecycle_lock(project_id).await;
        let _lifecycle = lifecycle.lock().await;

        // ── 1. 맵 락은 여기까지. 이 블록 안에서는 IO 를 하지 않는다. ────────
        let (snapshot, epoch, needs_lock, existing_session, lock_only) = {
            let mut projects = self.projects.write().await;
            let entry = projects
                .get_mut(&project_id)
                .ok_or(OculpmError::NotInitialized(project_id))?;

            // 인계당한 가드는 더 이상 권한이 없다 — 들고 있어 봐야 남의 락이다.
            // 여기서 놓아야 아래 재시도가 정직하게 "지금 누가 주인인가" 를 묻는다.
            if entry.lock.as_ref().is_some_and(|l| l.is_evicted()) {
                entry.lock = None;
            }

            // Idempotent: already running — **살아 있을 때만**. 처리 태스크가 죽은
            // 워처를 "돌고 있음" 으로 읽으면 되살릴 길이 없어진다 (재기동이 유일한
            // 치료였다). 죽었으면 기다리지 않고 끊고 새로 무장한다.
            let mut lock_only = false;
            if let Some(w) = entry.watcher.take() {
                if w.is_alive() {
                    entry.watcher = Some(w);
                    if entry.lock.is_some() {
                        tracing::debug!(
                            target: "oculpm::manager",
                            project_id,
                            "watcher_start: already running, no-op"
                        );
                        return Ok(());
                    }
                    // 살아 있는데 주인 자리가 비었다 — 방금 위에서 인계당한 가드를
                    // 놓은 직후다. 감시를 이어 가려면 **락부터** 되찾아야 한다
                    // (주인이 아닌 채로 계속 감시하면 세션 활동이 이중 기록된다).
                    // 워처는 살아 있으니 새로 세우지 않고 락만 꽂는다.
                    lock_only = true;
                } else {
                    tracing::warn!(
                        target: "oculpm::manager",
                        project_id,
                        "[FLOW] 죽은 워처 발견 — 끊고 다시 무장한다 (실시간 갱신 복구)"
                    );
                    w.abort();
                }
            }

            (
                ProjectSnapshot {
                    root: entry.root.clone(),
                    resolver: entry.resolver.clone(),
                    config: entry.config.clone(),
                    index_writer: entry.index_writer.clone(),
                },
                entry.watcher_epoch,
                entry.lock.is_none(),
                entry.session.clone(),
                lock_only,
            )
        };

        // ── 2. 맵 락 밖 — 느린 일. ─────────────────────────────────────────
        //
        // 읽기 전용으로 떨어져 있었다면 **락을 다시 노려본다**.
        //
        // 락은 `init_project` 에서 한 번만 잡았고, 그 시점에 다른 인스턴스가
        // 쥐고 있었으면 이 프로세스는 그 프로젝트를 영영 감시하지 못했다 —
        // 저쪽이 진작 끝났어도. 개발 빌드와 설치본을 같이 띄우는 흔한 상황에서
        // 나중에 뜬 쪽이 **모든 프로젝트의 실시간 갱신을 잃는** 원인이었다
        // (도그푸딩 2026-08-23). 재시도는 여기가 옳다: 워처를 켜려는 순간이
        // 곧 "쓰기 주인이 필요해진" 순간이다.
        let acquired_lock = if needs_lock {
            let lock_path = snapshot.resolver.lock_path(&snapshot.root);
            match LockGuard::acquire_with(&lock_path, policy, self.lock_evicted.clone()).await? {
                LockAcquisition::Acquired(g) | LockAcquisition::Recovered { guard: g, .. } => {
                    tracing::info!(
                        target: "oculpm::manager",
                        project_id,
                        "[FLOW] read-only 였던 프로젝트가 락을 회수했다 — 감시를 시작한다"
                    );
                    Some(g)
                }
                LockAcquisition::TakenOver {
                    guard,
                    previous_pid,
                    previous_exe,
                } => {
                    tracing::info!(
                        target: "oculpm::manager",
                        project_id,
                        previous_pid,
                        previous_exe = previous_exe.as_deref().unwrap_or("?"),
                        "[FLOW] 살아 있는 인스턴스에게서 락을 가져왔다 — 이 앱이 감시한다"
                    );
                    Some(guard)
                }
                LockAcquisition::Held {
                    by_pid, holder_exe, ..
                } => {
                    return Err(OculpmError::InvalidConfig(format!(
                        "read-only mode: lock held by another instance (pid {by_pid}{})",
                        holder_exe.map(|e| format!(", {e}")).unwrap_or_default()
                    )));
                }
            }
        } else {
            None
        };

        // 살아 있는 워처는 그대로 두고 되찾은 락만 꽂고 끝낸다 (1단계 참고).
        if lock_only {
            let _ = self
                .commit_watcher_start(project_id, epoch, acquired_lock, None)
                .await;
            tracing::info!(
                target: "oculpm::manager",
                project_id,
                "[FLOW] 살아 있는 워처의 주인 자리를 되찾았다"
            );
            return Ok(());
        }

        // Reuse the existing session actor if one survived a prior
        // watcher_stop. This is the bug fix for "navigate-out-and-back
        // multiplies sessions": before, every cycle spawned a fresh
        // SessionActor and lost the resume baseline.
        let reused_session = existing_session.is_some();
        let session = match existing_session {
            Some(s) => s,
            None => SessionActor::spawn(
                project_id,
                snapshot.resolver.clone(),
                snapshot.index_writer.clone(),
                snapshot.config.session.clone(),
                app_handle.clone(),
            ),
        };
        let started = ProjectWatcher::start(
            project_id,
            snapshot.root.clone(),
            session.clone(),
            snapshot.index_writer.clone(),
            snapshot.config.clone(),
            app_handle,
        )
        .await;

        // ── 3. 맵 락 재획득 + CAS. ─────────────────────────────────────────
        let watcher = match started {
            Ok(w) => w,
            Err(e) => {
                // 워처가 못 떴다고 방금 잡은 락까지 버리지는 않는다 — 예전 코드도
                // 여기 도달했을 땐 락이 이미 엔트리에 꽂힌 뒤였다. 버리면 다음
                // 재시도가 근거 없이 read-only 로 떨어진다.
                let _ = self
                    .commit_watcher_start(project_id, epoch, acquired_lock, None)
                    .await;
                return Err(e);
            }
        };
        let installed = self
            .commit_watcher_start(
                project_id,
                epoch,
                acquired_lock,
                Some((session, watcher, reused_session)),
            )
            .await?;
        if installed {
            tracing::info!(
                target: "oculpm::manager",
                project_id,
                reused_session,
                "[FLOW] watcher_start: watcher + session attached (reused_session={reused_session})"
            );
        }
        Ok(())
    }

    /// Stop the watcher. **Does not shut down the session actor** — see
    /// the note below.
    ///
    /// Why: `watcher_stop` is called by the frontend whenever the UI
    /// unmounts the project view (e.g. user navigates back to the Start
    /// screen and forward again). Previously this also called
    /// `session.shutdown()` which finalised the active session with
    /// `AppQuit`. The resume mechanism (see `try_resume_session`) only
    /// rescues sessions closed with `InactivityTimeout`, so every
    /// navigation cycle produced a fresh session id — the exact bug from
    /// W4 dogfooding §발견 2 reappeared in a different shape (2026-05-26).
    ///
    /// Now: stop the fs watcher (so we're not paying for OS-watch threads
    /// while the user is off the project view) but keep the session actor
    /// alive. The session's own inactivity timer governs end-of-session:
    /// if the user comes back fast, the same session continues; if they
    /// stay away past `inactivity_timeout_minutes`, the session naturally
    /// ends with `InactivityTimeout` and the next activity within
    /// `session_resume_grace_minutes` rescues it via the existing path.
    ///
    /// Real app shutdown still finalises sessions:
    /// - `on_project_closed` calls `session.shutdown()` explicitly.
    /// - Process exit drops every `ProjectEntry`; the session actor's
    ///   sender drops, the receive loop ends, and `recover_zombie_sessions`
    ///   on next launch finalises anything stuck in Active.
    ///
    /// Idempotent — calling twice is a no-op the second time.
    pub async fn watcher_stop(&self, project_id: u32) -> Result<(), OculpmError> {
        let mut projects = self.projects.write().await;
        let entry = projects
            .get_mut(&project_id)
            .ok_or(OculpmError::NotInitialized(project_id))?;

        // 세대를 올린다 — 지금 기동 중인 `watcher_start_with` 가 있으면 그쪽이
        // 설치를 포기한다 (나중 의도인 "그만" 이 이긴다).
        entry.watcher_epoch = next_watcher_epoch();
        let had_watcher = entry.watcher.is_some();
        if let Some(watcher) = entry.watcher.take() {
            watcher.stop().await?;
        }
        tracing::info!(
            target: "oculpm::manager",
            project_id,
            had_watcher,
            session_alive = entry.session.is_some(),
            "[FLOW] watcher_stop: watcher halted, session actor kept alive (will end via inactivity timer if user doesn't return)"
        );
        Ok(())
    }

    /// 인계당한 락을 **놓는다** — 그 프로젝트의 감시를 접고 읽기 전용이 된다.
    ///
    /// 두 인스턴스가 같은 프로젝트를 동시에 감시하면 세션 활동이 이중으로
    /// 기록된다. 락을 가져간 쪽이 주인이고, 이쪽은 즉시 물러나는 게 맞다.
    /// 되찾기는 감독관의 정기 재시도가 맡는다 (저쪽이 끝나면 자동 복귀).
    ///
    /// 놓은 프로젝트 id 를 돌려준다 — 호출측이 사용자에게 알리기 위해.
    pub async fn yield_evicted_locks(&self) -> Vec<u32> {
        let evicted: Vec<u32> = {
            let projects = self.projects.read().await;
            projects
                .iter()
                .filter(|(_, e)| e.lock.as_ref().is_some_and(|l| l.is_evicted()))
                .map(|(&id, _)| id)
                .collect()
        };
        for &project_id in &evicted {
            // 감시부터 끊는다 — 응답을 기다리지 않는다 (인계는 이미 끝났고,
            // 여기서 멈추면 이중 감시가 그만큼 길어진다).
            let mut projects = self.projects.write().await;
            if let Some(entry) = projects.get_mut(&project_id) {
                entry.watcher_epoch = next_watcher_epoch();
                if let Some(watcher) = entry.watcher.take() {
                    watcher.abort();
                }
                // 가드를 놓는다. 인계당한 가드는 락 파일을 지우지 않는다
                // (`LockGuard::owns_file_on_disk`) — 지금 그 파일은 남의 것이다.
                entry.lock = None;
            }
            tracing::warn!(
                target: "oculpm::manager",
                project_id,
                "[FLOW] 락을 인계당해 감시를 접는다 — 이 프로젝트는 읽기 전용"
            );
        }
        evicted
    }

    /// 감독관(`oculpm::supervisor`)용 스냅샷 — 추적 중인 프로젝트별 감시 상태.
    /// 추적 중인 모든 프로젝트의 (id, 현재 워크데이) — 감독관의 날 넘김 감지용.
    pub async fn current_workdays(&self) -> Vec<(u32, String)> {
        let now = chrono::Utc::now();
        let projects = self.projects.read().await;
        projects
            .iter()
            .map(|(id, entry)| (*id, entry.resolver.workday_of(now)))
            .collect()
    }

    /// 프로젝트 하나의 현재 워크데이 (`OculpmStatus.current_workday` 와 같은 값).
    pub async fn current_workday(&self, project_id: u32) -> Result<String, OculpmError> {
        let projects = self.projects.read().await;
        let entry = projects
            .get(&project_id)
            .ok_or(OculpmError::NotInitialized(project_id))?;
        Ok(entry.resolver.workday_of(chrono::Utc::now()))
    }

    /// **임의 시각**이 속한 워크데이. 지금이 아닌 시각을 묻는 유일한 자리이며,
    /// 들여온 대화가 어느 날 폴더로 갈지를 여기서 정한다 (Phase 7).
    ///
    /// 쓰기 경로(`create_manual_journal_entry`)와 **같은 리졸버**를 지나는 것이
    /// 핵심이다. 대화의 원본 오프셋으로 날짜를 계산하면 프로젝트 타임존과
    /// 어긋나 (예: 23:00Z 는 서울에서 다음 날) 중복 판정이 엉뚱한 날을 뒤진다.
    pub async fn workday_at(
        &self,
        project_id: u32,
        instant_utc: chrono::DateTime<chrono::Utc>,
    ) -> Result<String, OculpmError> {
        let projects = self.projects.read().await;
        let entry = projects
            .get(&project_id)
            .ok_or(OculpmError::NotInitialized(project_id))?;
        Ok(entry.resolver.workday_of(instant_utc))
    }

    pub async fn watcher_health(&self) -> Vec<WatcherHealth> {
        let projects = self.projects.read().await;
        projects
            .iter()
            .map(|(&project_id, entry)| WatcherHealth {
                project_id,
                root: entry.root.clone(),
                has_lock: entry.lock.is_some(),
                events_seen: entry
                    .watcher
                    .as_ref()
                    .filter(|w| w.is_alive())
                    .map(|w| w.events_seen()),
            })
            .collect()
    }

    /// **살아 있는 것처럼 보이지만 귀가 먹은** 워처를 끊는다 (다음
    /// `watcher_start` 가 새로 무장한다).
    ///
    /// `watcher_stop` 과 달리 처리 태스크의 종료를 기다리지 않는다 — 애초에
    /// "응답이 없다" 가 이 함수를 부르는 이유라, 기다리면 감독관이 함께 멈춘다.
    pub async fn watcher_drop_unresponsive(&self, project_id: u32) {
        let mut projects = self.projects.write().await;
        let Some(entry) = projects.get_mut(&project_id) else {
            return;
        };
        // 기동 중인 `watcher_start_with` 가 있으면 그쪽 설치도 무효로 만든다 —
        // "응답 없음" 판정 이전에 뜬 워처는 이 판정의 대상이 아니다.
        entry.watcher_epoch = next_watcher_epoch();
        if let Some(watcher) = entry.watcher.take() {
            tracing::warn!(
                target: "oculpm::manager",
                project_id,
                "[FLOW] 응답 없는 워처를 끊는다 — 프로브가 처리 루프에 닿지 않았다"
            );
            watcher.abort();
        }
    }

    /// Watcher status. Safe to call before init — returns Stopped + 0 counters.
    pub async fn watcher_status(&self, project_id: u32) -> WatcherStatus {
        let projects = self.projects.read().await;
        match projects.get(&project_id) {
            Some(entry) => match &entry.watcher {
                Some(w) => w.status(),
                None => WatcherStatus {
                    state: WatcherStateView::Stopped,
                    events_seen_total: 0,
                    events_ignored_total: 0,
                    last_event_at: None,
                    debounce_ms: entry.config.watcher.debounce_ms,
                },
            },
            None => WatcherStatus {
                state: WatcherStateView::Stopped,
                events_seen_total: 0,
                events_ignored_total: 0,
                last_event_at: None,
                debounce_ms: 0,
            },
        }
    }
}
