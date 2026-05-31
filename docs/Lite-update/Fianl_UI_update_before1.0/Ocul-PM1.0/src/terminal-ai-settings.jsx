/* ============================================================ TERMINAL */
function TerminalScreen() {
  const [lines, setLines] = useState(() => TERM_LINES.slice(0, 1));
  const [cmd, setCmd] = useState("");
  const screenRef = useRef(null);

  useEffect(() => {
    let i = 1;
    const id = setInterval(() => {
      if (i >= TERM_LINES.length) { clearInterval(id); return; }
      setLines((prev) => [...prev, TERM_LINES[i]]);
      i++;
    }, 240);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (screenRef.current) screenRef.current.scrollTop = screenRef.current.scrollHeight;
  }, [lines]);

  const cls = { prompt: "t-prompt", cmd: "t-cmd", cmd2: "t-cmd2", dim: "t-dim", ok: "t-ok", out: "t-out", journal: "t-journal" };

  return (
    <React.Fragment>
      <Toolbar title="터미널" sub="에이전트 실행을 감지해 자동으로 일지를 작성합니다">
        <span className="chip"><Icon name="Activity" size={13} color="var(--accent-text)" /> 변경 감시중</span>
        <button className="btn"><Icon name="Plus" size={15} /> 새 세션</button>
      </Toolbar>

      <div className="term-wrap">
        <div className="term-tabs">
          <div className="term-tab active"><Icon name="SquareTerminal" size={14} /> zsh — aurora-web</div>
          <div className="term-tab"><Icon name="Bot" size={14} /> claude-code</div>
          <div className="term-watch"><span className="term-cursor" style={{ height: 9, width: 9, borderRadius: "50%", background: "#57c98a" }} /> .oculpm 감시중</div>
        </div>

        <div className="term-screen" ref={screenRef}>
          {lines.map((l, i) => {
            if (l.k === "prompt") {
              return <div className="tl-line" key={i}><span className="t-prompt">➜ </span><span className="t-cmd2">{l.x}</span></div>;
            }
            return <div className={"tl-line " + cls[l.k]} key={i}>{l.k === "cmd" ? "➜ " : ""}{l.x}</div>;
          })}
        </div>

        <div className="term-input-row">
          <span className="t-prompt">➜ aurora-web</span>
          <input value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder="" autoFocus />
          {!cmd ? <span className="term-cursor" /> : null}
        </div>
      </div>
    </React.Fragment>
  );
}

Object.assign(window, { TerminalScreen });

/* ============================================================ AI PANEL */
function AIPanelScreen() {
  const [model, setModel] = useState("claude");
  const [draft, setDraft] = useState("");

  return (
    <React.Fragment>
      <Toolbar title="AI 패널" sub="여러 LLM에 같은 컨텍스트로 질문">
        <button className="btn"><Icon name="History" size={15} /> 대화 기록</button>
      </Toolbar>

      <div className="ai-wrap">
        <div className="ai-models">
          <span className="section-title" style={{ marginRight: 4 }}>모델</span>
          {AI_MODELS.map((m) => (
            <div key={m.id} className={"model-chip" + (model === m.id ? " active" : "")} onClick={() => setModel(m.id)}>
              <span className="model-dot" style={{ background: m.color }} />
              {m.name}
              <span className="model-vendor">{m.vendor}</span>
            </div>
          ))}
        </div>

        <div className="ai-thread">
          <div className="ai-thread-inner">
            {AI_CHAT.map((msg, i) => (
              <div className={"msg " + msg.role} key={i}>
                <div className="msg-av" style={msg.role === "assistant" ? { background: AI_MODELS.find((m) => m.name === msg.model)?.color || "var(--accent)" } : null}>
                  {msg.role === "user" ? "나" : <Icon name="Sparkles" size={15} />}
                </div>
                <div className="msg-body">
                  <div className="msg-name">
                    {msg.role === "user" ? "나" : <React.Fragment>{msg.model}<span className="vendor">로컬 컨텍스트 첨부됨</span></React.Fragment>}
                  </div>
                  <div className="msg-text">
                    {msg.text}
                    {msg.points ? (
                      <ul className="msg-points">
                        {msg.points.map((p, pi) => <li key={pi} dangerouslySetInnerHTML={{ __html: p.replace(/`([^`]+)`/g, "<code>$1</code>") }} />)}
                      </ul>
                    ) : null}
                    {msg.foot ? <div style={{ marginTop: 12, color: "var(--text-2)" }}>{msg.foot}</div> : null}
                    {msg.refs ? (
                      <div className="msg-refs">
                        {msg.refs.map((r) => <span className="ref-pill" key={r}><Icon name="FileCode2" size={12} /> {r}</span>)}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
            <div className="msg assistant" style={{ opacity: 0.5 }}>
              <div className="msg-av" style={{ background: "var(--accent)" }}><Icon name="Sparkles" size={15} /></div>
              <div className="msg-body">
                <div className="msg-name">Claude Sonnet 4.5</div>
                <div className="msg-text" style={{ display: "flex", gap: 5 }}>
                  <span className="term-cursor" style={{ background: "var(--text-3)", height: 14 }} />
                  <span style={{ color: "var(--text-3)" }}>패치 생성 대기중…</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="ai-compose">
          <div className="compose-ctx">
            <Icon name="Paperclip" size={13} />
            컨텍스트: <span className="chip" style={{ height: 20 }}><Icon name="FileCode2" size={11} /> workday.ts</span>
            <span className="chip" style={{ height: 20 }}><Icon name="GitCompareArrows" size={11} /> 오늘 diff</span>
            <span style={{ marginLeft: "auto" }}>전체 코드베이스는 로컬에만 저장됩니다</span>
          </div>
          <div className="compose-box">
            <textarea rows={1} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="코드베이스에 대해 무엇이든 물어보세요…" />
            <button className="btn primary icon" style={{ width: 34, height: 34 }}><Icon name="ArrowUp" size={16} sw={2.2} /></button>
          </div>
        </div>
      </div>
    </React.Fragment>
  );
}

Object.assign(window, { AIPanelScreen });

/* ============================================================ SETTINGS */
function Toggle({ on, onClick }) {
  return <div className={"toggle" + (on ? " on" : "")} onClick={onClick}><i /></div>;
}

function SettingsScreen({ theme, setTheme }) {
  const [redact, setRedact] = useState(true);
  const [autoJournal, setAutoJournal] = useState(true);
  const [rollover, setRollover] = useState(true);
  const [telemetry, setTelemetry] = useState(false);

  return (
    <React.Fragment>
      <Toolbar title="설정" sub="모든 데이터는 이 기기에만 저장됩니다" />
      <div className="scroll">
        <div className="page fade-in" style={{ maxWidth: 760 }}>

          <div className="section-title" style={{ margin: "4px 2px 10px" }}>일반</div>
          <div className="card set-section">
            <div className="set-row">
              <div><div className="set-label">테마</div><div className="set-desc">라이트 · 다크 모드 전환</div></div>
              <div className="set-ctl" style={{ display: "flex", gap: 6 }}>
                {["light", "dark"].map((t) => (
                  <button key={t} className={"scope-chip" + (theme === t ? " on" : "")} onClick={() => setTheme(t)}>
                    <Icon name={t === "light" ? "Sun" : "Moon"} size={13} /> {t === "light" ? "라이트" : "다크"}
                  </button>
                ))}
              </div>
            </div>
            <div className="set-row">
              <div><div className="set-label">워크데이 시작 시각</div><div className="set-desc">이 시각을 기준으로 'Today'가 롤오버됩니다 ({PROJECT.tz})</div></div>
              <div className="set-ctl"><input className="set-input" defaultValue="00:00" style={{ minWidth: 90 }} /></div>
            </div>
            <div className="set-row">
              <div><div className="set-label">자정 자동 롤오버</div><div className="set-desc">워크데이 경계를 넘기면 자동으로 일지를 정리</div></div>
              <div className="set-ctl"><Toggle on={rollover} onClick={() => setRollover(!rollover)} /></div>
            </div>
          </div>

          <div className="section-title" style={{ margin: "4px 2px 10px" }}>기록 & 보안</div>
          <div className="card set-section">
            <div className="set-row">
              <div><div className="set-label">자동 일지 작성</div><div className="set-desc">에이전트 실행을 감지해 trigger별로 분류·기록</div></div>
              <div className="set-ctl"><Toggle on={autoJournal} onClick={() => setAutoJournal(!autoJournal)} /></div>
            </div>
            <div className="set-row">
              <div><div className="set-label">시크릿 자동 마스킹</div><div className="set-desc">API 키·토큰을 일지 작성 전 30+ 패턴으로 감지·치환</div></div>
              <div className="set-ctl"><Toggle on={redact} onClick={() => setRedact(!redact)} /></div>
            </div>
            <div className="set-row">
              <div><div className="set-label">익명 사용 통계 전송</div><div className="set-desc">로컬-우선 원칙에 따라 기본 비활성화</div></div>
              <div className="set-ctl"><Toggle on={telemetry} onClick={() => setTelemetry(!telemetry)} /></div>
            </div>
          </div>

          <div className="section-title" style={{ margin: "4px 2px 10px" }}>API 키 · 키체인 저장</div>
          <div className="card set-section">
            {[
              { name: "Anthropic", env: "ANTHROPIC_API_KEY", set: true },
              { name: "OpenAI", env: "OPENAI_API_KEY", set: true },
              { name: "Google AI", env: "GEMINI_API_KEY", set: false },
            ].map((k) => (
              <div className="set-row" key={k.env}>
                <div>
                  <div className="set-label">{k.name}</div>
                  <div className="set-desc mono">{k.env}</div>
                </div>
                <div className="set-ctl" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {k.set
                    ? <span className="chip" style={{ color: "var(--accent-text)", background: "var(--accent-soft)" }}><Icon name="ShieldCheck" size={13} /> 키체인에 저장됨</span>
                    : <span className="chip"><Icon name="ShieldAlert" size={13} /> 미설정</span>}
                  <button className="btn sm">{k.set ? "변경" : "추가"}</button>
                </div>
              </div>
            ))}
          </div>

        </div>
      </div>
    </React.Fragment>
  );
}

Object.assign(window, { SettingsScreen });
