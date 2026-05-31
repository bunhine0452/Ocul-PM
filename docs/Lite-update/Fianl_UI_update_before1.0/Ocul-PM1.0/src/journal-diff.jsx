/* ============================================================ JOURNAL */
function JournalCard({ entry, go, focused }) {
  const fs = fileSummary(entry.files);
  const ref = useRef(null);
  useEffect(() => {
    if (focused && ref.current) {
      ref.current.style.boxShadow = "0 0 0 2px var(--accent), var(--shadow-pop)";
      const t = setTimeout(() => { if (ref.current) ref.current.style.boxShadow = ""; }, 1600);
      return () => clearTimeout(t);
    }
  }, [focused]);

  return (
    <article className="jcard" ref={ref} onClick={() => go("diff", { entry: entry.id })}>
      <div className="jcard-top">
        <TriggerBadge type={entry.trigger} />
        <span className="jcard-agent"><Icon name="Bot" size={13} /> {entry.agent}</span>
        {entry.cycles ? <span className="cycle-flag"><Icon name="RotateCcw" size={13} /> {entry.cycles}회 재시도</span> : null}
        <span className="jcard-time">{entry.time}</span>
      </div>
      <div className="jcard-title">{entry.title}</div>
      <div className="jcard-summary">{entry.summary}</div>
      <div className="jcard-foot">
        {entry.files.slice(0, 3).map((f) => (
          <span className="file-pill" key={f.path}>
            <Icon name="FileCode2" size={12} color="var(--text-3)" />
            <b>{f.path.split("/").pop()}</b>
            <span className="diff-add">+{f.add}</span>
            {f.del > 0 ? <span className="diff-del">−{f.del}</span> : null}
          </span>
        ))}
        {entry.files.length > 3 ? <span className="tag" style={{ alignSelf: "center" }}>+{entry.files.length - 3} more</span> : null}
        <span style={{ flex: 1 }} />
        {entry.tags.map((t) => <span className="tag" key={t}>{t}</span>)}
      </div>
    </article>
  );
}

function JournalScreen({ go, route }) {
  const [filter, setFilter] = useState("all");
  const focus = route.params.focus;

  const filtered = JOURNAL.filter((e) => filter === "all" || e.trigger === filter);
  const days = [
    { key: "today", label: "오늘 · " + PROJECT.today },
    { key: "yesterday", label: "어제 · 5월 30일 (토)" },
  ];

  const filters = [
    { id: "all", label: "전체" },
    { id: "feature", label: "기능" },
    { id: "bugfix", label: "버그" },
    { id: "refactor", label: "리팩토링" },
    { id: "error", label: "에러" },
    { id: "chore", label: "잡일" },
  ];

  return (
    <React.Fragment>
      <Toolbar title="작업 일지" sub={`${JOURNAL.length}건의 자동 기록`}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {filters.map((f) => (
            <button key={f.id}
              className={"scope-chip" + (filter === f.id ? " on" : "")}
              style={{ height: 28 }}
              onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
      </Toolbar>

      <div className="scroll">
        <div className="page fade-in" style={{ maxWidth: 820 }}>
          {days.map((day) => {
            const items = filtered.filter((e) => e.day === day.key);
            if (!items.length) return null;
            return (
              <div key={day.key}>
                <div className="day-label">{day.label}</div>
                <div className="tl">
                  {items.map((e) => (
                    <div className="tl-node" key={e.id}>
                      <span className="tl-dot">
                        <Icon name={TRIGGER_META[e.trigger].icon} size={11} sw={2.2}
                          color={`var(--t-${e.trigger === "bugfix" ? "bug" : e.trigger})`} />
                      </span>
                      <JournalCard entry={e} go={go} focused={focus === e.id} />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </React.Fragment>
  );
}

Object.assign(window, { JournalScreen, JournalCard });

/* ============================================================ DIFF */
function DiffScreen({ go, route }) {
  const [active, setActive] = useState(
    DIFF_FILES.find((f) => f.active)?.path || DIFF_FILES[0].path
  );
  const [mode, setMode] = useState("unified");
  const total = fileSummary(DIFF_FILES);
  const cur = DIFF_FILES.find((f) => f.path === active);

  return (
    <React.Fragment>
      <Toolbar title="변경 diff" sub={
        <span><span className="mono">{PROJECT.branch}</span> · {DIFF_FILES.length}개 파일 변경</span>
      }>
        <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>
          <span className="diff-add">+{total.add}</span> <span className="diff-del">−{total.del}</span>
        </span>
        <div style={{ display: "flex", border: "1px solid var(--border-card)", borderRadius: 7, overflow: "hidden" }}>
          {["unified", "split"].map((m) => (
            <button key={m}
              className="btn ghost sm"
              style={{ borderRadius: 0, background: mode === m ? "var(--accent-soft)" : "transparent", color: mode === m ? "var(--accent-text)" : "var(--text-2)" }}
              onClick={() => setMode(m)}>
              {m === "unified" ? "통합" : "분할"}
            </button>
          ))}
        </div>
        <button className="btn primary"><Icon name="Check" size={15} /> 검토 완료</button>
      </Toolbar>

      <div className="diff-screen">
        <div className="diff-files">
          <div className="diff-files-head">변경된 파일</div>
          {DIFF_FILES.map((f) => (
            <div key={f.path}
              className={"dfile" + (f.path === active ? " active" : "")}
              onClick={() => setActive(f.path)}>
              <span className={"dstatus " + f.status}>{f.status === "added" ? "A" : "M"}</span>
              <span className="dfile-name">{f.path}</span>
              <span className="dfile-stat">
                <span className="diff-add">+{f.add}</span>
                {f.del > 0 ? <span className="diff-del">−{f.del}</span> : null}
              </span>
            </div>
          ))}
        </div>

        <div className="diff-main">
          <div className="diff-bar">
            <Icon name="FileCode2" size={15} color="var(--text-2)" />
            <span className="fname">{cur.path}</span>
            <span className="chip" style={{ height: 20 }}>
              {cur.status === "added" ? "새 파일" : "수정됨"}
            </span>
            <span style={{ flex: 1 }} />
            <span className="mono" style={{ fontSize: 12 }}>
              <span className="diff-add">+{cur.add}</span> <span className="diff-del">−{cur.del}</span>
            </span>
            <button className="iconbtn" title="에디터에서 열기"><Icon name="ExternalLink" size={15} /></button>
          </div>

          <div className="diff-code">
            {DIFF_HUNKS.map((h, hi) => (
              <div key={hi}>
                <div className="hunk-head">{h.header}</div>
                {h.lines.map((ln, i) => (
                  <div key={i} className={"dl " + ln.t}>
                    <span className="dl-gut">{ln.o ?? ""}</span>
                    <span className="dl-gut">{ln.n ?? ""}</span>
                    <span className="dl-x">
                      <span className="sign">{ln.t === "add" ? "+ " : ln.t === "del" ? "− " : "  "}</span>
                      {ln.x}
                    </span>
                  </div>
                ))}
              </div>
            ))}
            <div style={{ padding: "14px 16px", color: "var(--text-3)", fontFamily: "var(--font)", fontSize: 12, borderTop: "1px solid var(--sep)" }}>
              <Icon name="GitBranch" size={13} /> 이 diff는 로컬 작업 폴더 스냅샷 기준입니다. 커밋 전 변경분을 검증하세요.
            </div>
          </div>
        </div>
      </div>
    </React.Fragment>
  );
}

Object.assign(window, { DiffScreen });
