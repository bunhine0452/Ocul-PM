/* ============================================================ shared helpers */
function entryById(id) { return JOURNAL.find((e) => e.id === id); }
function subtaskById(id) {
  for (const g of PLANNER) {
    const s = g.subtasks.find((x) => x.id === id);
    if (s) return { ...s, goal: g };
  }
  return null;
}
function fileSummary(files) {
  const add = files.reduce((s, f) => s + f.add, 0);
  const del = files.reduce((s, f) => s + f.del, 0);
  return { count: files.length, add, del };
}

Object.assign(window, { entryById, subtaskById, fileSummary });

/* ============================================================ TODAY */
function MiniEntry({ id, go }) {
  const e = entryById(id);
  if (!e) return null;
  const fs = fileSummary(e.files);
  return (
    <div className="mini-entry" onClick={() => go("journal", { focus: id })}>
      <TriggerBadge type={e.trigger} withLabel={false} />
      <div className="mini-entry-body">
        <div className="mini-entry-title">{e.title}</div>
        <div className="mini-entry-meta">
          <span className="mono">{e.time}</span>
          <span className="dotsep">·</span>
          <span>{e.agent}</span>
          <span className="dotsep">·</span>
          <span>{fs.count}개 파일</span>
          <span className="diff-add">+{fs.add}</span>
          <span className="diff-del">−{fs.del}</span>
        </div>
      </div>
      <Icon name="ChevronRight" size={15} color="var(--text-3)" />
    </div>
  );
}

function StatCard({ icon, tint, label, value, unit, sub }) {
  return (
    <div className="stat">
      <div className="stat-top">
        <span className="stat-ico" style={{ background: tint.bg, color: tint.fg }}>
          <Icon name={icon} size={14} sw={2} />
        </span>
        {label}
      </div>
      <div className="stat-val">{value}{unit ? <span className="unit">{unit}</span> : null}</div>
      {sub ? <div className="stat-sub">{sub}</div> : null}
    </div>
  );
}

function TodayScreen({ go }) {
  const maxAct = Math.max(...TODAY.activity, 1);
  const maxWeek = Math.max(...TODAY.week.map((w) => w.v), 1);
  const totalAgent = TODAY.agents.reduce((s, a) => s + a.entries, 0);

  return (
    <React.Fragment>
      <Toolbar title="Today" sub={PROJECT.today}>
        <div className="search-box" style={{ minWidth: 200 }} onClick={() => go("search")}>
          <Icon name="Search" size={15} color="var(--text-3)" />
          <span style={{ color: "var(--text-3)" }}>코드 검색…</span>
          <span className="kbd" style={{ marginLeft: "auto" }}>⌘K</span>
        </div>
        <button className="btn" onClick={() => go("journal")}>
          <Icon name="NotebookText" size={15} /> 전체 일지
        </button>
      </Toolbar>

      <div className="scroll">
        <div className="page fade-in">
          <div className="today-hero">
            <div>
              <div className="today-greet">오늘 <span className="accent">{TODAY.changedToday}건</span>의 작업이 기록됐어요</div>
              <div className="today-date">AI 에이전트가 코드를 쓰는 동안 Ocul-PM이 자동으로 일지를 작성했습니다 · {PROJECT.tz}</div>
            </div>
            <button className="btn primary" onClick={() => go("diff")}>
              <Icon name="GitCompareArrows" size={15} /> 오늘 변경 검토
            </button>
          </div>

          <div className="stat-row">
            <StatCard icon="GitCommitVertical" tint={{ bg: "var(--accent-soft)", fg: "var(--accent-text)" }}
              label="기록된 작업" value={TODAY.changedToday} unit="건"
              sub={<span><Icon name="TrendingUp" size={12} /> 어제보다 +2</span>} />
            <StatCard icon="FileCode2" tint={{ bg: "var(--t-chore-soft)", fg: "var(--t-chore)" }}
              label="변경된 파일" value={TODAY.filesTouched} unit="개"
              sub={<span className="mono"><span className="diff-add">+{TODAY.linesAdded}</span> <span className="diff-del">−{TODAY.linesRemoved}</span> 라인</span>} />
            <StatCard icon="TriangleAlert" tint={{ bg: "var(--t-error-soft)", fg: "var(--t-error)" }}
              label="에러 사이클 복구" value={TODAY.cyclesRecovered} unit="회"
              sub={<span>tree-sitter 로드 실패 → 해결</span>} />
            <StatCard icon="Bot" tint={{ bg: "var(--t-refactor-soft)", fg: "var(--t-refactor)" }}
              label="참여 에이전트" value={TODAY.agents.length} unit="개"
              sub={<span>Claude · Cursor · Gemini</span>} />
          </div>

          <div className="grid-2">
            {/* LEFT: highlights + yesterday */}
            <div>
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="panel-head">
                  <Icon name="Star" size={16} color="var(--accent-text)" />
                  <h3>오늘의 하이라이트</h3>
                  <span className="count">{TODAY.highlights.length}</span>
                  <button className="btn ghost sm right" onClick={() => go("journal")}>모두 보기 <Icon name="ArrowRight" size={13} /></button>
                </div>
                <div className="panel-body">
                  {TODAY.highlights.map((id) => <MiniEntry key={id} id={id} go={go} />)}
                </div>
              </div>

              <div className="card">
                <div className="panel-head">
                  <Icon name="History" size={16} color="var(--text-2)" />
                  <h3>어제 마무리한 작업</h3>
                  <span className="count">{TODAY.yesterdayDone.length}</span>
                </div>
                <div className="panel-body">
                  {TODAY.yesterdayDone.map((id) => <MiniEntry key={id} id={id} go={go} />)}
                </div>
              </div>
            </div>

            {/* RIGHT: activity + agents + next */}
            <div>
              <div className="card card-pad" style={{ marginBottom: 16 }}>
                <div className="section-title" style={{ marginBottom: 12 }}>이번 주 작업량</div>
                <div className="week-row">
                  {TODAY.week.map((w, i) => {
                    const isToday = i === TODAY.week.length - 1;
                    return (
                      <div className="week-col" key={w.d}>
                        <div className="week-val">{w.v}</div>
                        <div className={"week-bar" + (isToday ? " is-today" : "")} style={{ flex: 1 }}>
                          <i style={{ height: (w.v / maxWeek * 100) + "%" }} />
                        </div>
                        <div className={"week-lbl" + (isToday ? " is-today" : "")}>{w.d}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="card" style={{ marginBottom: 16 }}>
                <div className="panel-head"><Icon name="Bot" size={16} color="var(--text-2)" /><h3>에이전트별 기여</h3></div>
                <div className="panel-body" style={{ padding: 10 }}>
                  <div className="agent-list">
                    {TODAY.agents.map((a) => (
                      <div className="agent-item" key={a.name}>
                        <span className="agent-swatch" style={{ background: a.color }} />
                        <span className="agent-name">{a.name}</span>
                        <span className="agent-bar"><i style={{ width: (a.entries / totalAgent * 100) + "%", background: a.color }} /></span>
                        <span className="agent-count">{a.entries}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="panel-head">
                  <Icon name="ListTodo" size={16} color="var(--text-2)" />
                  <h3>다음 할 일</h3>
                  <button className="btn ghost sm right" onClick={() => go("planner")}>Planner <Icon name="ArrowRight" size={13} /></button>
                </div>
                <div className="panel-body">
                  {TODAY.next.map((id) => {
                    const s = subtaskById(id);
                    if (!s) return null;
                    return (
                      <div className="next-item" key={id} onClick={() => go("planner")}>
                        <span className={"next-check" + (s.active ? " active" : "")}>
                          {s.active ? <Icon name="Loader" size={11} color="var(--accent)" /> : null}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="next-title">{s.title}</div>
                          <div className="next-goal">{s.goal.title}</div>
                        </div>
                        {s.active ? <span className="sub-active-pill">진행중</span> : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </React.Fragment>
  );
}

Object.assign(window, { TodayScreen, MiniEntry });
