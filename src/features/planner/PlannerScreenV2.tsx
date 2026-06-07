import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Toolbar } from "@/components/Toolbar";
import {
  Plus,
  TriangleAlert,
  ChevronDown,
  ChevronRight,
  Clock,
  RefreshCw,
} from "@/components/Icons";
import {
  commands,
  type PlanSummary,
  type PlanDetail,
  type PlanItemDto,
  type PlanItemUpdateDto,
} from "@/lib/bindings";
import { agentColor, agentLabel } from "@/features/today/agentColor";
import { toast } from "@/lib/toast";
import { OculSpinner } from "@/components/OculSpinner";
import { type UiV2View } from "@/contexts/WorkspaceContext";

// Planner Upgrade (PR-PLN 3) — document-style living checklist over the file
// `.oculpm/planner/*.md` SSOT. Reads via plan_list/plan_get; edits via
// plan_apply_edit (status cycle / add item) and plan_create. Per-item
// attribution chips reuse Today's agentColor. Legacy PlannerPanel untouched.

const STATUS_META: Record<string, { glyph: string; label: string; color: string }> = {
  todo: { glyph: "☐", label: "할 일", color: "var(--text-3)" },
  in_progress: { glyph: "▣", label: "진행중", color: "var(--accent)" },
  done: { glyph: "☑", label: "완료", color: "var(--accent)" },
  blocked: { glyph: "⚠", label: "막힘", color: "var(--t-bug)" },
  deferred: { glyph: "→", label: "이월", color: "var(--text-3)" },
  dropped: { glyph: "✗", label: "폐기", color: "var(--text-3)" },
};

// Forward-progress click cycle; the off-path states fold back to todo.
const NEXT_STATUS: Record<string, string> = {
  todo: "in_progress",
  in_progress: "done",
  done: "todo",
  blocked: "todo",
  deferred: "todo",
  dropped: "todo",
};

function weightOf(status: string): number | null {
  if (status === "done") return 1;
  if (status === "in_progress") return 0.5;
  if (status === "todo") return 0;
  return null; // blocked / deferred / dropped — excluded from rollup
}

function phaseProgress(items: PlanItemDto[]): number {
  let sum = 0;
  let n = 0;
  for (const it of items) {
    const w = weightOf(it.status);
    if (w !== null) {
      sum += w;
      n += 1;
    }
  }
  return n === 0 ? 0 : Math.round((sum / n) * 100);
}

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}일 전`;
  return new Date(t).toLocaleDateString();
}

interface PlannerScreenV2Props {
  projectId: number;
  onNavigate: (view: UiV2View) => void;
  /** Open a specific journal entry (path relative to the journal root). */
  onOpenJournal?: (relativePath: string) => void;
}

export function PlannerScreenV2({ projectId, onNavigate, onOpenJournal }: PlannerScreenV2Props) {
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PlanDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [history, setHistory] = useState<PlanItemUpdateDto[] | null>(null);

  const [newPlanOpen, setNewPlanOpen] = useState(false);
  const [newPlanTitle, setNewPlanTitle] = useState("");
  const [composer, setComposer] = useState<{ phase: string; title: string } | null>(null);

  const refreshPlans = useCallback(async () => {
    const res = await commands.planList(projectId);
    if (res.status === "ok") {
      setPlans(res.data ?? []);
      setSelectedId((cur) => cur ?? res.data?.[0]?.plan_id ?? null);
    } else {
      setError(res.error);
      setPlans([]);
    }
  }, [projectId]);

  const refreshDetail = useCallback(async () => {
    if (selectedId == null) {
      setDetail(null);
      return;
    }
    setLoadingDetail(true);
    const res = await commands.planGet(projectId, selectedId);
    setLoadingDetail(false);
    if (res.status === "ok") setDetail(res.data);
    else setError(res.error);
  }, [projectId, selectedId]);

  useEffect(() => {
    void refreshPlans();
  }, [refreshPlans]);

  useEffect(() => {
    setHistoryFor(null);
    void refreshDetail();
  }, [refreshDetail]);

  const applyStatus = async (item: PlanItemDto, status: string) => {
    if (busy || selectedId == null) return;
    setBusy(true);
    const res = await commands.planApplyEdit(
      projectId,
      selectedId,
      { kind: "set_status", item_id: item.item_id, status },
      "user",
    );
    setBusy(false);
    if (res.status === "ok") {
      if (res.data) setDetail(res.data);
      void refreshPlans();
    } else {
      toast.destructive(`상태 변경 실패: ${res.error}`);
    }
  };

  // plan-log journal refs are written relative to `.oculpm/` (e.g.
  // "journal/2026…/Bugs/…md"); the journal screen focuses paths relative to the
  // journal root, so strip the leading "journal/".
  const openJournal = (ref: string) => {
    const path = ref.replace(/^journal\//, "");
    if (onOpenJournal) onOpenJournal(path);
    else onNavigate("journal");
  };

  const submitNewItem = async () => {
    if (!composer || selectedId == null || !composer.title.trim()) return;
    setBusy(true);
    const res = await commands.planApplyEdit(
      projectId,
      selectedId,
      {
        kind: "add_item",
        phase: composer.phase.trim() || "할 일",
        title: composer.title.trim(),
        item_id: null,
        status: null,
      },
      "user",
    );
    setBusy(false);
    if (res.status === "ok") {
      if (res.data) setDetail(res.data);
      setComposer(null);
      void refreshPlans();
    } else {
      toast.destructive(`항목 추가 실패: ${res.error}`);
    }
  };

  const submitNewPlan = async () => {
    if (!newPlanTitle.trim()) return;
    setBusy(true);
    const res = await commands.planCreate(projectId, newPlanTitle.trim());
    setBusy(false);
    if (res.status === "ok") {
      setNewPlanOpen(false);
      setNewPlanTitle("");
      setSelectedId(res.data.plan_id);
      void refreshPlans();
    } else {
      toast.destructive(`계획 생성 실패: ${res.error}`);
    }
  };

  const toggleHistory = async (itemId: string) => {
    if (historyFor === itemId) {
      setHistoryFor(null);
      return;
    }
    setHistoryFor(itemId);
    setHistory(null);
    if (selectedId == null) return;
    const res = await commands.planItemHistory(projectId, selectedId, itemId);
    if (res.status === "ok") setHistory(res.data);
  };

  const phases = useMemo(() => {
    const map = new Map<string, PlanItemDto[]>();
    for (const it of detail?.items ?? []) {
      const key = it.phase ?? "(기타)";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    }
    return [...map.entries()];
  }, [detail]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const it of detail?.items ?? []) c[it.status] = (c[it.status] ?? 0) + 1;
    return c;
  }, [detail]);

  const existingPhases = useMemo(
    () => [...new Set((detail?.items ?? []).map((i) => i.phase).filter((p): p is string => !!p))],
    [detail],
  );

  return (
    <>
      <Toolbar title="Planner" sub="AI 가 갱신하는 계획 — 항목별 진척·귀속">
        <button
          className="scope-chip"
          style={{ height: 30 }}
          onClick={() => setComposer((c) => (c ? null : { phase: existingPhases[0] ?? "할 일", title: "" }))}
          disabled={selectedId == null || busy}
          title="새 항목"
        >
          <Plus size={13} /> 항목
        </button>
        <button className="btn primary" onClick={() => setNewPlanOpen((v) => !v)} disabled={busy}>
          <Plus size={15} /> 새 계획
        </button>
      </Toolbar>

      <div className="scroll">
        <div className="page fade-in" style={{ maxWidth: 880 }}>
          {error ? (
            <div className="card card-pad" style={{ marginBottom: 16 }}>
              <div className="stat-top" style={{ color: "var(--t-bug)" }}>
                <TriangleAlert size={14} /> 문제가 발생했어요
              </div>
              <div className="today-date" style={{ marginTop: 8 }}>{error}</div>
              <button className="btn sm" style={{ marginTop: 12 }} onClick={() => { setError(null); void refreshPlans(); }}>
                다시 시도
              </button>
            </div>
          ) : null}

          {/* New plan composer */}
          {newPlanOpen ? (
            <div className="card card-pad" style={{ marginBottom: 16, display: "flex", gap: 8 }}>
              <input
                autoFocus
                className="set-input"
                style={{ flex: 1 }}
                placeholder="계획 제목 (예: fastembed 안정화)"
                value={newPlanTitle}
                onChange={(e) => setNewPlanTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void submitNewPlan(); if (e.key === "Escape") setNewPlanOpen(false); }}
              />
              <button className="btn primary" onClick={() => void submitNewPlan()} disabled={busy || !newPlanTitle.trim()}>만들기</button>
              <button className="btn sm" onClick={() => setNewPlanOpen(false)}>취소</button>
            </div>
          ) : null}

          {/* Plan selector */}
          {plans && plans.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
              {plans.map((p) => (
                <button
                  key={p.plan_id}
                  className={"scope-chip" + (p.plan_id === selectedId ? " on" : "")}
                  onClick={() => setSelectedId(p.plan_id)}
                  title={`${p.done_count}/${p.item_count} · ${Math.round((p.progress ?? 0) * 100)}%`}
                >
                  {p.title}
                  <span className="dotsep">·</span>
                  {Math.round((p.progress ?? 0) * 100)}%
                </button>
              ))}
            </div>
          ) : null}

          {plans == null ? (
            <OculSpinner label="불러오는 중…" />
          ) : plans.length === 0 ? (
            <div className="empty-hint">
              아직 계획이 없어요. 새 계획을 만들면, 이후 AI(외부 에이전트·인앱)가 작업하며 항목을 스스로 갱신합니다.
            </div>
          ) : detail == null ? (
            loadingDetail ? <OculSpinner label="불러오는 중…" /> : null
          ) : (
            <PlanBody
              detail={detail}
              counts={counts}
              phases={phases}
              collapsed={collapsed}
              setCollapsed={setCollapsed}
              onSetStatus={applyStatus}
              busy={busy}
              historyFor={historyFor}
              history={history}
              onToggleHistory={toggleHistory}
              onRefresh={() => void refreshDetail()}
              onOpenJournalRef={openJournal}
            />
          )}

          {/* New item composer */}
          {composer && detail ? (
            <div className="card card-pad" style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                className="set-input"
                style={{ width: 180 }}
                list="phase-suggestions"
                placeholder="단계 (Phase)"
                value={composer.phase}
                onChange={(e) => setComposer({ ...composer, phase: e.target.value })}
              />
              <datalist id="phase-suggestions">
                {existingPhases.map((p) => <option key={p} value={p} />)}
              </datalist>
              <input
                autoFocus
                className="set-input"
                style={{ flex: 1, minWidth: 200 }}
                placeholder="새 항목 제목"
                value={composer.title}
                onChange={(e) => setComposer({ ...composer, title: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") void submitNewItem(); if (e.key === "Escape") setComposer(null); }}
              />
              <button className="btn primary" onClick={() => void submitNewItem()} disabled={busy || !composer.title.trim()}>추가</button>
              <button className="btn sm" onClick={() => setComposer(null)}>취소</button>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

// ── Plan body (header + phases + decisions) ──────────────────────────────────

interface PlanBodyProps {
  detail: PlanDetail;
  counts: Record<string, number>;
  phases: [string, PlanItemDto[]][];
  collapsed: Record<string, boolean>;
  setCollapsed: Dispatch<SetStateAction<Record<string, boolean>>>;
  onSetStatus: (item: PlanItemDto, status: string) => void;
  busy: boolean;
  historyFor: string | null;
  history: PlanItemUpdateDto[] | null;
  onToggleHistory: (itemId: string) => void;
  onRefresh: () => void;
  onOpenJournalRef: (ref: string) => void;
}

function PlanBody(props: PlanBodyProps) {
  const { detail, counts, phases, collapsed, setCollapsed, onSetStatus, busy, historyFor, history, onToggleHistory, onRefresh, onOpenJournalRef } = props;
  const pct = Math.round((detail.plan.progress ?? 0) * 100);

  return (
    <>
      {/* Header */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div className="goal-title" style={{ fontSize: 17 }}>{detail.plan.title}</div>
            <div className="goal-due" style={{ marginTop: 4 }}>
              <span className={"goal-status " + (detail.plan.status === "active" ? "active" : "planned")}>
                {detail.plan.status === "active" ? "진행중" : detail.plan.status}
              </span>
              <span className="dotsep">·</span>
              {detail.plan.done_count}/{detail.plan.item_count} 완료
            </div>
          </div>
          <button className="btn sm" onClick={onRefresh} title="새로고침"><RefreshCw size={13} /></button>
        </div>

        <div className="goal-prog-wrap" style={{ marginTop: 12 }}>
          <div className="prog-track" style={{ flex: 1 }}><i style={{ width: `${pct}%` }} /></div>
          <span className="prog-pct">{pct}%</span>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
          {(["done", "in_progress", "blocked", "deferred", "todo", "dropped"] as const)
            .filter((s) => (counts[s] ?? 0) > 0)
            .map((s) => (
              <span key={s} style={{ fontSize: 12, color: "var(--text-2)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span style={{ color: STATUS_META[s].color, fontSize: 14 }}>{STATUS_META[s].glyph}</span>
                {STATUS_META[s].label} {counts[s]}
              </span>
            ))}
        </div>
      </div>

      {/* Warnings */}
      {detail.warnings.length > 0 ? (
        <div className="card card-pad" style={{ marginBottom: 16, borderColor: "var(--t-bug)" }}>
          <div className="stat-top" style={{ color: "var(--t-bug)" }}>
            <TriangleAlert size={14} /> 형식 경고 {detail.warnings.length}건
          </div>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12, color: "var(--text-2)" }}>
            {detail.warnings.slice(0, 8).map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      ) : null}

      {/* Phases */}
      {phases.map(([phase, items]) => {
        const isOpen = collapsed[phase] !== true;
        return (
          <div className="card goal-card" key={phase} style={{ marginBottom: 12 }}>
            <button
              type="button"
              className="goal-head"
              onClick={() => setCollapsed((c) => ({ ...c, [phase]: isOpen }))}
              aria-expanded={isOpen}
            >
              {isOpen ? <ChevronDown size={16} color="var(--text-3)" /> : <ChevronRight size={16} color="var(--text-3)" />}
              <div style={{ flex: 1 }}>
                <div className="goal-title">{phase}</div>
              </div>
              <span className="prog-pct">{phaseProgress(items)}%</span>
            </button>

            {isOpen
              ? items.map((it) => (
                  <PlanItemRow
                    key={it.item_id}
                    item={it}
                    busy={busy}
                    onSetStatus={onSetStatus}
                    historyOpen={historyFor === it.item_id}
                    history={historyFor === it.item_id ? history : null}
                    onToggleHistory={onToggleHistory}
                    onOpenJournalRef={onOpenJournalRef}
                  />
                ))
              : null}
          </div>
        );
      })}

      {/* Decisions */}
      {detail.decisions.length > 0 ? (
        <div style={{ marginTop: 20 }}>
          <div className="today-date" style={{ marginBottom: 8, fontWeight: 600 }}>결정 (Decisions)</div>
          {detail.decisions.map((d) => (
            <div className="card card-pad" key={d.decision_id} style={{ marginBottom: 10 }}>
              <div className="goal-title" style={{ fontSize: 14 }}>{d.title}</div>
              {d.body ? <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 6, whiteSpace: "pre-wrap" }}>{d.body}</div> : null}
              <div className="goal-due" style={{ marginTop: 8 }}>
                {d.locked_at ? <>🔒 {d.locked_at}{d.agent_id ? ` · ${agentLabel(d.agent_id)}` : ""}<span className="dotsep">·</span></> : null}
                {d.affects.length > 0 ? `영향 ${d.affects.map((a) => `#${a}`).join(", ")}` : "영향 없음"}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}

// ── Item row ─────────────────────────────────────────────────────────────────

interface PlanItemRowProps {
  item: PlanItemDto;
  busy: boolean;
  onSetStatus: (item: PlanItemDto, status: string) => void;
  historyOpen: boolean;
  history: PlanItemUpdateDto[] | null;
  onToggleHistory: (itemId: string) => void;
  onOpenJournalRef: (ref: string) => void;
}

function PlanItemRow({ item, busy, onSetStatus, historyOpen, history, onToggleHistory, onOpenJournalRef }: PlanItemRowProps) {
  const meta = STATUS_META[item.status] ?? STATUS_META.todo;
  const indent = item.parent_item ? 22 : 0;
  const linked = item.journal_refs ?? [];
  // Suggestion (never auto-applied): journal work is logged against this item
  // but it isn't closed out yet → offer a one-click "완료?".
  const suggestDone = linked.length > 0 && !["done", "dropped", "deferred"].includes(item.status);
  return (
    <div className="subtask" style={{ alignItems: "flex-start", paddingLeft: 14 + indent, cursor: "default" }}>
      <button
        type="button"
        onClick={() => onSetStatus(item, NEXT_STATUS[item.status] ?? "in_progress")}
        disabled={busy}
        title={`${meta.label} — 클릭하여 진행`}
        style={{
          background: "none", border: "none", cursor: busy ? "default" : "pointer",
          color: meta.color, fontSize: 16, lineHeight: "20px", padding: 0, width: 22, flexShrink: 0,
        }}
      >
        {meta.glyph}
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        <span className={"sub-title" + (item.status === "done" ? " done" : "")}>{item.title}</span>
        {item.note ? <span style={{ fontSize: 12, color: "var(--text-3)", marginLeft: 8 }}>— {item.note}</span> : null}
        {linked.length > 0 ? (
          <button
            type="button"
            onClick={() => onOpenJournalRef(linked[0])}
            title={`연결된 일지 ${linked.length}건 — 열기`}
            style={{ marginLeft: 8, background: "none", border: "none", cursor: "pointer", color: "var(--text-3)", fontSize: 11, padding: 0 }}
          >
            📓 {linked.length}
          </button>
        ) : null}
        {suggestDone ? (
          <button
            type="button"
            onClick={() => onSetStatus(item, "done")}
            title="관련 일지가 있어요 — 완료로 표시할까요?"
            style={{ marginLeft: 8, background: "var(--accent-ring)", border: "1px solid var(--accent)", color: "var(--accent)", borderRadius: 99, fontSize: 11, padding: "1px 8px", cursor: "pointer" }}
          >
            완료?
          </button>
        ) : null}

        {historyOpen ? (
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-2)" }}>
            {history == null ? (
              <span style={{ color: "var(--text-3)" }}>이력 불러오는 중…</span>
            ) : history.length === 0 ? (
              <span style={{ color: "var(--text-3)" }}>갱신 이력이 없어요.</span>
            ) : (
              history.map((u, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0" }}>
                  <span style={{ width: 7, height: 7, borderRadius: 99, background: agentColor(u.agent_id), flexShrink: 0 }} />
                  <span>{agentLabel(u.agent_id)}</span>
                  <span style={{ color: "var(--text-3)" }}>
                    {u.from_status ?? "?"}→{u.to_status ?? "?"} · {relativeTime(u.ts)}
                  </span>
                  {u.journal_ref ? (
                    <button
                      type="button"
                      onClick={() => onOpenJournalRef(u.journal_ref!)}
                      title={`일지로 이동: ${u.journal_ref}`}
                      style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--text-3)" }}
                    >
                      📓
                    </button>
                  ) : null}
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>

      {item.last_agent ? (
        <button
          type="button"
          onClick={() => onToggleHistory(item.item_id)}
          title="갱신 이력"
          style={{
            display: "inline-flex", alignItems: "center", gap: 5, background: "none", border: "none",
            cursor: "pointer", fontSize: 11, color: "var(--text-3)", flexShrink: 0, padding: 0,
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: 99, background: agentColor(item.last_agent) }} />
          {agentLabel(item.last_agent)}
          <span style={{ color: "var(--text-3)" }}>· {relativeTime(item.last_update)}</span>
          <Clock size={11} />
        </button>
      ) : null}
    </div>
  );
}
