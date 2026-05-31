/* ============================================================ PLANNER */
function PlannerScreen({ go }) {
  const [open, setOpen] = useState(() => PLANNER.reduce((a, g) => ({ ...a, [g.id]: g.status === "active" }), {}));

  return (
    <React.Fragment>
      <Toolbar title="Planner" sub="goal → subtask → 작업 일지로 자동 연결">
        <button className="btn"><Icon name="Filter" size={15} /> 진행중</button>
        <button className="btn primary"><Icon name="Plus" size={15} /> 새 목표</button>
      </Toolbar>

      <div className="scroll">
        <div className="page fade-in" style={{ maxWidth: 880 }}>
          {PLANNER.map((g) => {
            const doneCount = g.subtasks.filter((s) => s.done).length;
            const isOpen = open[g.id];
            return (
              <div className="card goal-card" key={g.id}>
                <div className="goal-head" onClick={() => setOpen((o) => ({ ...o, [g.id]: !o[g.id] }))} style={{ cursor: "pointer" }}>
                  <Icon name={isOpen ? "ChevronDown" : "ChevronRight"} size={16} color="var(--text-3)" />
                  <Icon name="Target" size={17} color={g.status === "active" ? "var(--accent)" : "var(--text-3)"} />
                  <div>
                    <div className="goal-title">{g.title}</div>
                    <div className="goal-due" style={{ marginTop: 3 }}>
                      <Icon name="Calendar" size={12} /> 마감 {g.due}
                      <span className="dotsep">·</span>
                      {doneCount}/{g.subtasks.length} 완료
                    </div>
                  </div>
                  <div className="goal-prog-wrap">
                    <span className={"goal-status " + g.status}>{g.status === "active" ? "진행중" : "예정"}</span>
                    <div className="prog-track"><i style={{ width: Math.round(g.progress * 100) + "%" }} /></div>
                    <span className="prog-pct">{Math.round(g.progress * 100)}%</span>
                  </div>
                </div>

                {isOpen ? g.subtasks.map((s) => (
                  <div className="subtask" key={s.id}>
                    <span className={"sub-check" + (s.done ? " done" : s.active ? " active" : "")}>
                      {s.done ? <Icon name="Check" size={12} sw={3} /> : s.active ? <Icon name="Loader" size={11} color="var(--accent)" /> : null}
                    </span>
                    <span className={"sub-title" + (s.done ? " done" : "")}>{s.title}</span>
                    {s.active ? <span className="sub-active-pill">진행중</span> : null}
                    {s.entries > 0 ? (
                      <span className="sub-entries" title="연결된 작업 일지" onClick={() => go("journal")} style={{ cursor: "pointer" }}>
                        <Icon name="NotebookText" size={13} /> {s.entries}건 기록
                      </span>
                    ) : <span className="sub-entries" style={{ opacity: 0.5 }}>기록 없음</span>}
                  </div>
                )) : null}
              </div>
            );
          })}
        </div>
      </div>
    </React.Fragment>
  );
}

Object.assign(window, { PlannerScreen });

/* ============================================================ SEARCH */
function SearchScreen({ go }) {
  const [q, setQ] = useState(SEARCH_QUERY);
  const [scope, setScope] = useState("semantic");
  const inputRef = useRef(null);
  useEffect(() => { if (inputRef.current) inputRef.current.focus(); }, []);
  const show = q.trim().length > 0;

  return (
    <React.Fragment>
      <Toolbar title="시맨틱 코드 검색" sub={`${PROJECT.name} · 로컬 인덱스`}>
        <span className="chip"><Icon name="Database" size={13} /> 1,284개 심볼 인덱싱됨</span>
      </Toolbar>

      <div className="scroll">
        <div className="page fade-in">
          <div className="search-hero">
            <div className="search-big">
              <Icon name="Search" size={19} color="var(--text-3)" />
              <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="자연어 또는 코드로 검색…" />
              {q ? <button className="iconbtn" onClick={() => setQ("")}><Icon name="X" size={15} /></button> : null}
            </div>
            <div className="search-scope">
              {[
                { id: "semantic", label: "의미 검색", icon: "Sparkles" },
                { id: "symbol", label: "심볼", icon: "Variable" },
                { id: "text", label: "정확히 일치", icon: "CaseSensitive" },
              ].map((s) => (
                <button key={s.id} className={"scope-chip" + (scope === s.id ? " on" : "")} onClick={() => setScope(s.id)}>
                  <Icon name={s.icon} size={13} /> {s.label}
                </button>
              ))}
            </div>
          </div>

          {show ? (
            <div className="search-results">
              <div className="section-title" style={{ marginBottom: 12 }}>
                {SEARCH_RESULTS.length}개 결과 · 의미 유사도순
              </div>
              {SEARCH_RESULTS.map((r) => (
                <div className="card sresult" key={r.path + r.symbol}>
                  <div className="sresult-head">
                    <Icon name="FileCode2" size={15} color="var(--text-2)" />
                    <span className="sresult-path">{r.path}</span>
                    <span className="sresult-sym">{r.symbol}</span>
                    <span className="sresult-lines">L{r.lines}</span>
                    <div className="score" style={{ marginLeft: 14 }}>
                      <div className="score-bar"><i style={{ width: r.score * 100 + "%" }} /></div>
                      {(r.score * 100).toFixed(0)}%
                    </div>
                  </div>
                  <div className="scode">
                    {r.snippet.map((line, i) => (
                      <div key={i} className={i === 0 ? "hl" : ""}>
                        <span className="ln">{i + 1}</span>{line}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-hint">검색어를 입력하면 의미 기반으로 관련 코드를 찾아줍니다.</div>
          )}
        </div>
      </div>
    </React.Fragment>
  );
}

Object.assign(window, { SearchScreen });
