import { ErrorCard } from "@/components/ErrorCard";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction } from "react";
import { Toolbar } from "@/components/Toolbar";
import {
  Plus,
  TriangleAlert,
  ChevronDown,
  ChevronUpIcon as ChevronUp,
  ChevronRight,
  Clock,
  RefreshCw,
  Sparkles,
  Lock,
  NotebookText,
  PanelLeft,
  Pencil,
  Play,
  Trash2,
} from "@/components/Icons";
import {
  commands,
  type PlanSummary,
  type PlanDetail,
  type PlanItemDto,
  type PlanItemUpdateDto,
  type PlanEditOp,
} from "@/lib/bindings";
import { agentColor, agentLabel } from "@/features/today/agentColor";
import { useOculpmDataEvents } from "@/features/oculpm/useOculpmLive";
import { oculpmApi } from "@/api/oculpm";
import { toast } from "@/lib/toast";
import { handoffDispatch, terminalOnScreen } from "@/features/terminal/dispatchTarget";
import { SkeletonList } from "@/components/ui/Skeleton";
import { AppDialog } from "@/components/ui/AppDialog";
import { InlineMarkdown } from "@/components/InlineMarkdown";
import { useTerminalSessions, useWorkspace, type UiV2View } from "@/contexts/WorkspaceContext";
import { PlanRail } from "./PlanRail";
import {
  facetsOf,
  latestActivityByPlan,
  type PlanGroup,
  type PlanSort,
} from "./planList";
import { getLang, t, useT, type I18nKey } from "@/i18n";
import { relativeTime as formatRelativeTime } from "@/lib/format";
import { tError } from "@/i18n/errors";

// Planner Upgrade (PR-PLN 3) — document-style living checklist over the file
// `.oculpm/planner/*.md` SSOT. Reads via plan_list/plan_get; edits via
// plan_apply_edit (status cycle / add item) and plan_create. Per-item
// attribution chips reuse Today's agentColor. Legacy PlannerPanel untouched.

const STATUS_META: Record<string, { glyph: string; labelKey: I18nKey; color: string }> = {
  todo: { glyph: "☐", labelKey: "plan.status.todo", color: "var(--text-3)" },
  in_progress: { glyph: "▣", labelKey: "plan.status.in_progress", color: "var(--accent)" },
  done: { glyph: "☑", labelKey: "plan.status.done", color: "var(--accent)" },
  // U+FE0E (text presentation selector): ⚠ 는 기본이 컬러 이모지라 나머지
  // 글리프(☐ ▣ ☑ → ✗)와 달리 OS 이모지 폰트로 그려지고 color 를 무시한다.
  blocked: { glyph: "⚠︎", labelKey: "plan.status.blocked", color: "var(--t-bug)" },
  deferred: { glyph: "→", labelKey: "plan.status.deferred", color: "var(--text-3)" },
  dropped: { glyph: "✗", labelKey: "plan.status.dropped", color: "var(--text-3)" },
};

// A linked journal resolved to display metadata for the multi-journal picker.
interface JournalRefMeta {
  /** The raw ref as stored on the plan item (passed back to onOpenJournalRef). */
  ref: string;
  /** Ref with `.oculpm/`/`journal/` prefixes stripped — relative to journal root. */
  path: string;
  /** Leading path segment, e.g. "20260615". */
  workday: string;
  /** First line of the entry (real title), falling back to the file name. */
  title: string;
}

const weekdays = () => {
  const f = new Intl.DateTimeFormat(getLang(), { weekday: "short" });
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(Date.UTC(1970, 0, 4 + i))));
};

// Synthetic bucket for items written before any `## ` heading — it has no real
// heading on disk, so phase rename/delete/reorder are not offered for it.
/** 단계 없는 항목의 **그룹 키**. 표시 라벨은 `t("plan.noPhase")` 로 따로 그린다
 *  — 키를 번역하면 언어를 바꿀 때 그룹이 갈라진다. */
const NO_PHASE = "__no_phase__";

/** "20260615" → "2026.06.15 (월)". Returns the input unchanged if not 8 digits. */
function fmtWorkday(wd: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(wd);
  if (!m) return wd;
  const [, y, mo, d] = m;
  const dt = new Date(Number(y), Number(mo) - 1, Number(d));
  return `${y}.${mo}.${d} (${weekdays()[dt.getDay()] ?? ""})`;
}

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
  return formatRelativeTime(iso, Date.now(), { beyondDays: 30 });
}

interface PlannerScreenV2Props {
  projectId: number;
  onNavigate: (view: UiV2View) => void;
  /** Open a specific journal entry (path relative to the journal root). */
  onOpenJournal?: (relativePath: string) => void;
}

export function PlannerScreenV2({ projectId, onNavigate, onOpenJournal }: PlannerScreenV2Props) {
  // 언어 전환 시 이 화면 전체가 다시 그려지도록 구독한다 (표시는 모듈 t 로도 되지만
  // 훅이 없으면 언어를 바꿔도 리렌더가 안 걸린다).
  useT();
  const { state, setState } = useWorkspace();
  const sessions = useTerminalSessions();
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  // Restore the last-viewed plan (persisted) so returning from a linked journal
  // lands back on the SAME plan instead of resetting to the first one.
  const [selectedId, setSelectedId] = useState<string | null>(state.plannerPlanId);
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

  // 계획 레일 (2026-07-30 스케일 라운드). 검색어만 휘발 — 나머지는 영속.
  const [query, setQuery] = useState("");

  /**
   * 계획별 마지막 **실제** 활동 시각 (plan-log 기반).
   *
   * `PlanSummary.updated_at` 은 frontmatter `updated:` 인데 항목 편집으로는
   * 갱신되지 않아 사실상 생성일에 고정돼 있다 — 그 값으로 '멈춤' 을 주장하면
   * 거짓 경고가 된다. 그래서 멈춤 배지는 이 맵에 기록이 있는 계획에만 붙고,
   * 없으면 아무 주장도 하지 않는다 (planList.ts 참고).
   *
   * 마운트당 1회만 부른다: 이 커맨드도 plan 파일 전량 재읽기를 한다.
   */
  const [activity, setActivity] = useState<Record<string, string>>({});

  const refreshPlans = useCallback(async () => {
    const res = await commands.planList(projectId);
    if (res.status === "ok") {
      setPlans(res.data ?? []);
      // Keep the current selection if it still exists; otherwise fall back to
      // the first plan. (A persisted id may point at a since-deleted plan.)
      setSelectedId((cur) =>
        cur && res.data?.some((p) => p.plan_id === cur)
          ? cur
          : res.data?.[0]?.plan_id ?? null,
      );
    } else {
      setError(tError(res.error));
      setPlans([]);
    }
  }, [projectId]);

  // Persist the active plan so it survives navigating away (e.g. to a linked
  // journal) and back.
  useEffect(() => {
    setState((prev) => (prev.plannerPlanId === selectedId ? prev : { ...prev, plannerPlanId: selectedId }));
  }, [selectedId, setState]);

  // `silent` — 스켈레톤 없이 조용히 다시 읽는다. 디스크 변경(에이전트가 계획을
  // 고침)으로 도는 갱신은 사용자가 요청한 적이 없으므로, 읽고 있던 내용이
  // 로딩 뼈대로 깜빡이면 안 된다.
  const refreshDetail = useCallback(async (silent = false) => {
    if (selectedId == null) {
      setDetail(null);
      return;
    }
    if (!silent) setLoadingDetail(true);
    const res = await commands.planGet(projectId, selectedId);
    if (!silent) setLoadingDetail(false);
    if (res.status === "ok") setDetail(res.data);
    else setError(tError(res.error));
  }, [projectId, selectedId]);

  // 에이전트(또는 다른 창)가 `.oculpm/planner/*.md` 를 건드리면 즉시 다시 읽는다.
  // 이 구독이 없던 동안 계획 화면은 마운트 때 읽은 내용에 그대로 머물렀다.
  const refreshFromDisk = useCallback(() => {
    void refreshPlans();
    void refreshDetail(true);
  }, [refreshPlans, refreshDetail]);
  useOculpmDataEvents("planner", projectId, true, refreshFromDisk);

  useEffect(() => {
    void refreshPlans();
  }, [refreshPlans]);

  useEffect(() => {
    let alive = true;
    void commands.planRecentUpdates(projectId, 500).then((res) => {
      // 응답 모양을 신뢰하지 않는다 — 실패하면 조용히 비워 두고, 레일은
      // 활동 정보 없이도 완전히 동작한다 (멈춤 배지만 안 붙는다).
      if (!alive || res.status !== "ok") return;
      setActivity(latestActivityByPlan(res.data));
    });
    return () => {
      alive = false;
    };
  }, [projectId]);

  useEffect(() => {
    setHistoryFor(null);
    void refreshDetail();
  }, [refreshDetail]);

  // v2 U9 (docs/20260706_v2/01-ux-spec.md §4) — 낙관적 업데이트: 글리프를
  // 즉시 바꾸고 백그라운드로 기록한다. 파생 상태(phases/counts)는 detail 의
  // useMemo 라 자동 추종. 성공 시 응답의 정규화된 detail 로 치환하고 진행률
  // 롤업(plans 목록)만 비차단 refetch; 실패 시 이전 detail 로 롤백 + 토스트.
  // busy 게이트를 걸지 않아 연속 토글이 즉각 반응한다 (백엔드는 N4 공유
  // plan-write 락이 직렬화).
  // PR-CI6 (EDD-lite) — 완료 소프트 게이트: plan-log 에 검증 일지가 연결되지
  // 않은 항목을 done 으로 바꾸려 하면 확인을 한 번 거친다. 소프트 — "검증
  // 없이 완료" 를 누르면 그대로 진행되고, 어떤 상태도 강제로 막지 않는다.
  const [confirmDone, setConfirmDone] = useState<PlanItemDto | null>(null);

  const applyStatus = async (item: PlanItemDto, status: string) => {
    if (status === "done" && item.status !== "done" && item.journal_refs.length === 0) {
      setConfirmDone(item);
      return;
    }
    await doApplyStatus(item, status);
  };

  // IN2 — 항목 실행: 백엔드가 프롬프트를 조립·저장하고, 터미널에 프리필할 한 줄
  // 명령 + 프롬프트 본문을 돌려준다. 실행(Enter)은 사용자가 한다.
  //
  // 어디에 무엇으로 꽂을지는 `dispatchTarget` 이 판단한다 — 돌고 있는 에이전트가
  // 있으면 본문을 붙여넣고, 아니면 셸에 한 줄 명령. 그리고 터미널이 이미 화면에
  // 있으면(⌘J 도크·터미널 화면·분리 창) **여기 화면을 빼앗지 않는다**.
  const dispatchItem = async (item: PlanItemDto) => {
    if (selectedId == null) return;
    const res = await commands.planDispatchPrompt(projectId, selectedId, item.item_id);
    if (res.status !== "ok") {
      toast.destructive(t("plan.dispatchFailed", { error: res.error }));
      return;
    }
    // 이동 여부는 **쓰기 전에** 정한다 — 프리필이 성공했더라도 터미널이 안
    // 보이는 사람에게는 어디로 갔는지 보여줘야 한다.
    const onScreen = terminalOnScreen(state);
    const done = await handoffDispatch(
      { projectId, command: res.data.command, prompt: res.data.prompt },
      sessions.terminalTabs,
      sessions.terminalActiveId,
    );
    toast.info(
      done.kind === "pasted"
        ? t("plan.dispatchPasted", { title: res.data.item_title, agent: done.agent })
        : t("plan.dispatchReady", { title: res.data.item_title }),
    );
    if (!onScreen) onNavigate("terminal");
  };

  const doApplyStatus = async (item: PlanItemDto, status: string) => {
    if (selectedId == null || item.status === status) return;
    const prevDetail = detail;
    setDetail((d) =>
      d
        ? {
            ...d,
            items: d.items.map((it) =>
              it.item_id === item.item_id ? { ...it, status } : it,
            ),
          }
        : d,
    );
    const res = await commands.planApplyEdit(
      projectId,
      selectedId,
      { kind: "set_status", item_id: item.item_id, status },
      "user",
    );
    if (res.status === "ok") {
      if (res.data) setDetail(res.data);
      void refreshPlans();
    } else {
      setDetail(prevDetail);
      toast.destructive(t("plan.statusFailed", { error: res.error }));
    }
  };

  // plan-log journal refs are written relative to `.oculpm/` (e.g.
  // "journal/2026…/Bugs/…md"); the journal screen resolves paths relative to the
  // journal root, so strip a leading ".oculpm/" and/or "journal/" prefix. The
  // journal screen then opens the entry by its workday (window-independent).
  const openJournal = (ref: string) => {
    const path = ref.replace(/^\.oculpm\//, "").replace(/^journal\//, "");
    if (onOpenJournal) onOpenJournal(path);
    else onNavigate("journal");
  };

  // Resolve a plan item's linked journal refs to {date, title} for the picker
  // shown when an item links MORE THAN ONE journal. The workday comes free from
  // the path; the real title is the entry's first line (getJournalEntry).
  const resolveJournalRefs = useCallback(
    async (refs: string[]): Promise<JournalRefMeta[]> =>
      Promise.all(
        refs.map(async (ref) => {
          const path = ref.replace(/^\.oculpm\//, "").replace(/^journal\//, "");
          const workday = path.split("/")[0] ?? "";
          const fallback = path.split("/").pop()?.replace(/\.md$/, "") || path;
          try {
            const entry = await oculpmApi.getJournalEntry(projectId, path);
            return { ref, path, workday, title: entry?.title?.trim() || fallback };
          } catch {
            return { ref, path, workday, title: fallback };
          }
        }),
      ),
    [projectId],
  );

  const submitNewItem = async () => {
    if (!composer || selectedId == null || !composer.title.trim()) return;
    setBusy(true);
    const res = await commands.planApplyEdit(
      projectId,
      selectedId,
      {
        kind: "add_item",
        phase: composer.phase.trim() || t("plan.defaultPhase"),
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
      toast.destructive(t("plan.addItemFailed", { error: res.error }));
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
      toast.destructive(t("plan.createFailed", { error: res.error }));
    }
  };

  // Plan-level CRUD: rename (frontmatter title) + delete (.md unlink + reproject).
  const renamePlan = async (title: string) => {
    if (busy || selectedId == null || !title.trim()) return;
    setBusy(true);
    const res = await commands.planRename(projectId, selectedId, title.trim());
    setBusy(false);
    if (res.status === "ok") {
      if (res.data) setDetail(res.data);
      void refreshPlans();
    } else {
      toast.destructive(t("plan.renameFailed", { error: res.error }));
    }
  };

  const deletePlan = async () => {
    if (busy || selectedId == null) return;
    setBusy(true);
    const res = await commands.planDelete(projectId, selectedId);
    setBusy(false);
    if (res.status === "ok") {
      setSelectedId(null);
      setDetail(null);
      void refreshPlans();
    } else {
      toast.destructive(t("plan.deleteFailed", { error: res.error }));
    }
  };

  // Item-level remove / rename (reuses plan_apply_edit; locked plans rejected).
  const removeItem = async (item: PlanItemDto) => {
    if (busy || selectedId == null) return;
    setBusy(true);
    const res = await commands.planApplyEdit(
      projectId,
      selectedId,
      { kind: "remove_item", item_id: item.item_id },
      "user",
    );
    setBusy(false);
    if (res.status === "ok") {
      if (res.data) setDetail(res.data);
      void refreshPlans();
    } else {
      toast.destructive(t("plan.removeItemFailed", { error: res.error }));
    }
  };

  const renameItem = async (item: PlanItemDto, title: string) => {
    if (busy || selectedId == null || !title.trim()) return;
    setBusy(true);
    const res = await commands.planApplyEdit(
      projectId,
      selectedId,
      { kind: "rename_item", item_id: item.item_id, title: title.trim() },
      "user",
    );
    setBusy(false);
    if (res.status === "ok") {
      if (res.data) setDetail(res.data);
      void refreshPlans();
    } else {
      toast.destructive(t("plan.renameFailed", { error: res.error }));
    }
  };

  // Phase-level CRUD — rename / delete / reorder a `## ` section. Phases were
  // previously only creatable (implicitly, via add_item); these close the gap.
  const editPhase = async (op: PlanEditOp, failMsg: string) => {
    if (busy || selectedId == null) return;
    setBusy(true);
    const res = await commands.planApplyEdit(projectId, selectedId, op, "user");
    setBusy(false);
    if (res.status === "ok") {
      if (res.data) setDetail(res.data);
      void refreshPlans();
    } else {
      toast.destructive(`${failMsg}: ${res.error}`);
    }
  };

  const renamePhase = (from: string, to: string) => {
    if (!to.trim() || to.trim() === from) return;
    void editPhase({ kind: "rename_phase", from, to: to.trim() }, t("plan.phaseRenameFailed"));
  };
  const removePhase = (phase: string) => void editPhase({ kind: "remove_phase", phase }, t("plan.phaseRemoveFailed"));
  const movePhase = (phase: string, up: boolean) =>
    void editPhase({ kind: "move_phase", phase, up }, t("plan.phaseMoveFailed"));

  // Dogfooding 2026-06-07 (Planner #1) — 완료·잠금: mark the plan done (read-only).
  // Locked plans reject in-app edits + AI refresh (backend guard) and AGENTS.md
  // tells external agents the same, so finished plans freeze and work moves on.
  const setPlanLock = async (lock: boolean) => {
    if (selectedId == null || busy) return;
    setBusy(true);
    const res = await commands.planSetStatus(projectId, selectedId, lock ? "done" : "active");
    setBusy(false);
    if (res.status === "ok") {
      if (res.data) setDetail(res.data);
      void refreshPlans();
      toast.info(lock ? t("plan.lockedDone") : t("plan.unlocked"));
    } else {
      toast.destructive(tError(res.error));
    }
  };

  // PR-PLN 5 — in-app AI updates item statuses from recent journal activity.
  const aiRefresh = async () => {
    if (selectedId == null || busy) return;
    const provR = await commands.settingsGet("default_provider");
    const provider = provR.status === "ok" ? provR.data : null;
    if (!provider) {
      toast.warning(t("plan.needProvider"));
      return;
    }
    const mR = await commands.settingsGet(`model_${provider}`);
    let model = mR.status === "ok" ? mR.data : null;
    if (!model) {
      const dm = await commands.settingsGet("default_model");
      model = dm.status === "ok" ? dm.data : null;
    }
    if (!model) {
      toast.warning(t("plan.needModel"));
      return;
    }
    setBusy(true);
    const res = await commands.planAiRefresh(projectId, selectedId, provider, model);
    setBusy(false);
    if (res.status === "ok") {
      if (res.data) setDetail(res.data);
      void refreshPlans();
      toast.info(t("plan.aiDone"));
    } else {
      toast.destructive(t("plan.aiFailed", { error: res.error }));
    }
  };

  // PR-PLN 5 — one-time import of legacy goals/subtasks into _imported.md.
  const importGoals = async () => {
    if (busy) return;
    setBusy(true);
    const res = await commands.planMigrateGoals(projectId);
    setBusy(false);
    if (res.status === "ok") {
      setSelectedId(res.data.plan_id);
      void refreshPlans();
      toast.info(t("plan.goalsImported"));
    } else {
      toast.destructive(tError(res.error));
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
      const key = it.phase ?? NO_PHASE;
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

  // A plan whose frontmatter status isn't "active" is locked (done/archived):
  // edits + AI refresh are disabled in the UI (and refused by the backend).
  const locked = (detail?.plan.status ?? "active") !== "active";

  // 레일과 툴바 카운트가 같은 계산을 공유하도록 패싯은 여기서 한 번만 만든다.
  // `now` 를 렌더마다 새로 읽으면 useMemo 가 매번 무효화되므로 마운트에 고정한다
  // (상대 시각 표시는 분 단위 정확도를 요구하지 않는다).
  const now = useMemo(() => Date.now(), [projectId]);
  const facets = useMemo(
    () => facetsOf(plans ?? [], now, activity),
    [plans, now, activity],
  );

  const railStats = useMemo(() => {
    let active = 0;
    let stale = 0;
    for (const f of facets.values()) {
      if (f.bucket === "active") active += 1;
      if (f.staleDays != null) stale += 1;
    }
    return { active, stale };
  }, [facets]);

  // 계획이 하나뿐이면 레일은 제목만 되풀이하므로 가로폭만 낭비한다.
  const railEligible = (plans?.length ?? 0) >= 2;
  const railVisible = railEligible && !state.plannerRailCollapsed;

  const setSort = (sort: PlanSort) => setState((p) => ({ ...p, plannerSort: sort }));
  const setGroup = (group: PlanGroup) => setState((p) => ({ ...p, plannerGroup: group }));
  const toggleSection = (key: string, nextOpen: boolean) =>
    setState((p) => ({ ...p, plannerRailOpen: { ...p.plannerRailOpen, [key]: nextOpen } }));

  return (
    <>
      <Toolbar
        title={t("nav.planner")}
        sub={
          plans && plans.length > 0
            ? `${t("plan.toolbarSub", { n: plans.length, active: railStats.active })}${railStats.stale ? t("plan.toolbarStale", { n: railStats.stale }) : ""}`
            : t("plan.toolbarIdle")
        }
        leading={
          railEligible ? (
            <button
              className="pln-iconbtn"
              aria-label={railVisible ? t("plan.railCollapse") : t("plan.railExpand")}
              aria-expanded={railVisible}
              title={railVisible ? t("plan.railCollapse") : t("plan.railExpand")}
              onClick={() =>
                setState((p) => ({ ...p, plannerRailCollapsed: !p.plannerRailCollapsed }))
              }
            >
              <PanelLeft size={15} />
            </button>
          ) : undefined
        }
      >
        <button
          className="scope-chip"
          style={{ height: 30 }}
          onClick={() => void aiRefresh()}
          disabled={selectedId == null || busy || locked}
          title={locked ? t("plan.aiLockedTitle") : t("plan.aiTitle")}
        >
          <Sparkles size={13} /> {t("plan.aiRefresh")}
        </button>
        <button
          className="scope-chip"
          style={{ height: 30 }}
          onClick={() => setComposer((c) => (c ? null : { phase: existingPhases[0] ?? t("plan.defaultPhase"), title: "" }))}
          disabled={selectedId == null || busy || locked}
          title={locked ? t("plan.addLockedTitle") : t("plan.addItemTitle")}
        >
          <Plus size={13} /> {t("plan.addItem")}
        </button>
        <button className="btn primary" onClick={() => setNewPlanOpen((v) => !v)} disabled={busy}>
          <Plus size={15} /> {t("plan.newPlan")}
        </button>
      </Toolbar>

      <div className="pln-body">
        {railVisible && plans ? (
          <PlanRail
            plans={plans}
            facets={facets}
            selectedId={selectedId}
            onSelect={setSelectedId}
            sort={state.plannerSort}
            onSortChange={setSort}
            group={state.plannerGroup}
            onGroupChange={setGroup}
            query={query}
            onQueryChange={setQuery}
            openOverride={state.plannerRailOpen}
            onToggleSection={toggleSection}
            now={now}
          />
        ) : null}

        <div className="pln-main">
        <div className="pln-doc fade-in">
          {error ? (
            <ErrorCard
              title={t("plan.error")}
              error={error}
              onRetry={() => {
                setError(null);
                void refreshPlans();
              }}
              style={{ marginBottom: 16 }}
            />
          ) : null}

          {/* New plan composer */}
          {newPlanOpen ? (
            <div className="card card-pad" style={{ marginBottom: 16, display: "flex", gap: 8 }}>
              <input
                autoFocus
                className="set-input"
                style={{ flex: 1 }}
                placeholder={t("plan.newPlanPlaceholder")}
                value={newPlanTitle}
                onChange={(e) => setNewPlanTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void submitNewPlan(); if (e.key === "Escape") setNewPlanOpen(false); }}
              />
              <button className="btn primary" onClick={() => void submitNewPlan()} disabled={busy || !newPlanTitle.trim()}>{t("plan.create")}</button>
              <button className="btn sm" onClick={() => setNewPlanOpen(false)}>{t("common.cancel")}</button>
            </div>
          ) : null}

          {plans == null ? (
            <SkeletonList rows={3} height={44} />
          ) : plans.length === 0 ? (
            <div className="empty-hint">
              {t("plan.empty")}
              <div style={{ marginTop: 12 }}>
                <button className="btn sm" onClick={() => void importGoals()} disabled={busy}>
                  {t("plan.importGoals")}
                </button>
              </div>
            </div>
          ) : detail == null ? (
            loadingDetail ? <SkeletonList rows={6} height={30} gap={8} /> : null
          ) : (
            <PlanBody
              detail={detail}
              counts={counts}
              phases={phases}
              collapsed={collapsed}
              setCollapsed={setCollapsed}
              onSetStatus={applyStatus}
              onDispatch={dispatchItem}
              busy={busy}
              locked={locked}
              onToggleLock={setPlanLock}
              onRename={renamePlan}
              onDelete={deletePlan}
              onRemoveItem={removeItem}
              onRenameItem={renameItem}
              onRenamePhase={renamePhase}
              onRemovePhase={removePhase}
              onMovePhase={movePhase}
              historyFor={historyFor}
              history={history}
              onToggleHistory={toggleHistory}
              onRefresh={() => void refreshDetail()}
              onOpenJournalRef={openJournal}
              resolveJournalRefs={resolveJournalRefs}
            />
          )}

          {/* New item composer */}
          {composer && detail ? (
            <div className="card card-pad" style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                className="set-input"
                style={{ width: 180 }}
                list="phase-suggestions"
                placeholder={t("plan.phasePlaceholder")}
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
                placeholder={t("plan.itemPlaceholder")}
                value={composer.title}
                onChange={(e) => setComposer({ ...composer, title: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") void submitNewItem(); if (e.key === "Escape") setComposer(null); }}
              />
              <button className="btn primary" onClick={() => void submitNewItem()} disabled={busy || !composer.title.trim()}>{t("plan.add")}</button>
              <button className="btn sm" onClick={() => setComposer(null)}>{t("common.cancel")}</button>
            </div>
          ) : null}
        </div>
        </div>
      </div>

      {/* PR-CI6 (EDD-lite) — 완료 소프트 게이트: 검증 일지 미연결 경고 (무시 가능). */}
      <AppDialog
        open={confirmDone != null}
        onClose={() => setConfirmDone(null)}
        label={t("plan.confirmDoneTitle")}
        width={480}
      >
        {confirmDone ? (
          <>
            <div style={{ display: "flex", gap: 10, padding: "18px 20px 4px" }}>
              <TriangleAlert size={18} style={{ flexShrink: 0, marginTop: 2, color: "var(--t-bug, #d97706)" }} />
              <div style={{ fontSize: 13, lineHeight: 1.65 }}>
                <strong>{confirmDone.title}</strong> {t("plan.confirmDoneBody1")} <strong>{t("plan.confirmDoneBody2")}</strong>.
                <br />
                <span style={{ color: "var(--text-3)" }}>
                  {t("plan.confirmDoneHint")}
                </span>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "12px 20px 16px" }}>
              <button className="btn sm" onClick={() => setConfirmDone(null)}>
                {t("common.cancel")}
              </button>
              <button
                className="btn primary sm"
                onClick={() => {
                  const item = confirmDone;
                  setConfirmDone(null);
                  void doApplyStatus(item, "done");
                }}
              >
                {t("plan.confirmDoneAction")}
              </button>
            </div>
          </>
        ) : null}
      </AppDialog>
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
  onDispatch: (item: PlanItemDto) => void;
  busy: boolean;
  locked: boolean;
  onToggleLock: (lock: boolean) => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  onRemoveItem: (item: PlanItemDto) => void;
  onRenameItem: (item: PlanItemDto, title: string) => void;
  onRenamePhase: (from: string, to: string) => void;
  onRemovePhase: (phase: string) => void;
  onMovePhase: (phase: string, up: boolean) => void;
  historyFor: string | null;
  history: PlanItemUpdateDto[] | null;
  onToggleHistory: (itemId: string) => void;
  onRefresh: () => void;
  onOpenJournalRef: (ref: string) => void;
  resolveJournalRefs: (refs: string[]) => Promise<JournalRefMeta[]>;
}

function PlanBody(props: PlanBodyProps) {
  const { detail, counts, phases, collapsed, setCollapsed, onSetStatus, onDispatch, busy, locked, onToggleLock, onRename, onDelete, onRemoveItem, onRenameItem, onRenamePhase, onRemovePhase, onMovePhase, historyFor, history, onToggleHistory, onRefresh, onOpenJournalRef, resolveJournalRefs } = props;
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pct = Math.round((detail.plan.progress ?? 0) * 100);
  const phaseMeta = new Map((detail.phases ?? []).map((p) => [p.name, p] as const));

  return (
    <>
      {/* Header */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="pln-plan-head">
          <div className="pln-plan-headtitle">
            {renaming ? (
              <input
                autoFocus
                className="goal-title-input"
                defaultValue={detail.plan.title}
                style={{ fontSize: 16, fontWeight: 660 }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    onRename((e.target as HTMLInputElement).value);
                    setRenaming(false);
                  }
                  if (e.key === "Escape") setRenaming(false);
                }}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== detail.plan.title) onRename(v);
                  setRenaming(false);
                }}
              />
            ) : locked ? (
              <InlineMarkdown className="goal-title pln-plan-title" text={detail.plan.title} />
            ) : (
              <button
                type="button"
                className="plan-title-btn"
                onClick={() => setRenaming(true)}
                disabled={busy}
                title={t("plan.renameTitle")}
              >
                <InlineMarkdown className="goal-title pln-plan-title" text={detail.plan.title} linkable={false} />
                <span className="plan-title-pen"><Pencil size={13} /></span>
              </button>
            )}
            <div className="goal-due" style={{ marginTop: 4 }}>
              <span className={"goal-status " + (locked ? "planned" : "active")}>
                {locked ? (
                  <>
                    <Lock size={11} /> {t("plan.locked")}
                  </>
                ) : (
                  t("plan.inProgress")
                )}
              </span>
              <span className="dotsep">·</span>
              {t("plan.doneOf", { done: detail.plan.done_count, total: detail.plan.item_count })}
            </div>
          </div>
          {/* 액션은 한 덩어리다 — 좁아지면 제목 아래로 통째로 내려간다
              (버튼이 하나씩 흩어져 접히면 어디가 어딘지 안 보인다). */}
          <div className="pln-plan-headactions">
            <button
              className="btn sm"
              onClick={() => onToggleLock(!locked)}
              disabled={busy}
              title={locked ? t("plan.unlockTitle") : t("plan.lockTitle")}
            >
              {locked ? t("plan.unlock") : t("plan.locked")}
            </button>
            {confirmDelete ? (
              <>
                <button type="button" className="pln-textbtn danger" onClick={() => { setConfirmDelete(false); onDelete(); }} disabled={busy} title={t("plan.deleteConfirmTitle")}>
                  {t("plan.deleteConfirm")}
                </button>
                <button type="button" className="pln-textbtn" onClick={() => setConfirmDelete(false)}>{t("common.cancel")}</button>
              </>
            ) : (
              <button type="button" className="pln-iconbtn danger" onClick={() => setConfirmDelete(true)} disabled={busy} title={t("plan.deleteTitle")}>
                <Trash2 size={14} />
              </button>
            )}
            <button type="button" className="pln-iconbtn" onClick={onRefresh} title={t("plan.refresh")}><RefreshCw size={14} /></button>
          </div>
        </div>
        {locked ? (
          <div className="today-date" style={{ marginTop: 8, color: "var(--text-3)" }}>
            {t("plan.lockedNote")}
          </div>
        ) : null}

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
                {t(STATUS_META[s].labelKey)} {counts[s]}
              </span>
            ))}
        </div>
      </div>

      {/* Warnings */}
      {detail.warnings.length > 0 ? (
        <div className="card card-pad" style={{ marginBottom: 16, borderColor: "var(--t-bug)" }}>
          <div className="stat-top" style={{ color: "var(--t-bug)" }}>
            <TriangleAlert size={14} /> {t("plan.warnings", { n: detail.warnings.length })}
          </div>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12, color: "var(--text-2)" }}>
            {detail.warnings.slice(0, 8).map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      ) : null}

      {/* Phases — reorder bounds are computed among real (on-disk) headings so
          the synthetic 기타 bucket never blocks moving the last real phase. */}
      {phases.map(([phase, items]) => {
        const realPhases = phases.map(([p]) => p).filter((p) => p !== NO_PHASE);
        const ri = realPhases.indexOf(phase);
        const canEdit = phase !== NO_PHASE;
        return (
        <PhaseCard
          key={phase}
          phase={phase}
          items={items}
          meta={phaseMeta.get(phase)}
          isOpen={collapsed[phase] !== true}
          onToggle={() => setCollapsed((c) => ({ ...c, [phase]: c[phase] !== true }))}
          busy={busy}
          locked={locked}
          canEdit={canEdit}
          canMoveUp={ri > 0}
          canMoveDown={ri >= 0 && ri < realPhases.length - 1}
          onRenamePhase={onRenamePhase}
          onRemovePhase={onRemovePhase}
          onMovePhase={onMovePhase}
          onSetStatus={onSetStatus}
          onDispatch={onDispatch}
          onRemoveItem={onRemoveItem}
          onRenameItem={onRenameItem}
          historyFor={historyFor}
          history={history}
          onToggleHistory={onToggleHistory}
          onOpenJournalRef={onOpenJournalRef}
          resolveJournalRefs={resolveJournalRefs}
        />
        );
      })}

      {/* Decisions */}
      {detail.decisions.length > 0 ? (
        <div style={{ marginTop: 20 }}>
          <div className="today-date" style={{ marginBottom: 8, fontWeight: 600 }}>{t("plan.decisions")}</div>
          {detail.decisions.map((d) => (
            <div className="card card-pad" key={d.decision_id} style={{ marginBottom: 10 }}>
              <div className="goal-title" style={{ fontSize: 14 }}>{d.title}</div>
              {d.body ? <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 6, whiteSpace: "pre-wrap" }}>{d.body}</div> : null}
              <div className="goal-due" style={{ marginTop: 8 }}>
                {d.locked_at ? <><Lock size={10} /> {d.locked_at}{d.agent_id ? ` · ${agentLabel(d.agent_id)}` : ""}<span className="dotsep">·</span></> : null}
                {d.affects.length > 0 ? t("plan.affects", { list: d.affects.map((a) => `#${a}`).join(", ") }) : t("plan.noAffects")}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}

// ── Phase card (collapsible section + inline rename / reorder / delete) ──────

interface PhaseCardProps {
  phase: string;
  items: PlanItemDto[];
  meta: NonNullable<PlanDetail["phases"]>[number] | undefined;
  isOpen: boolean;
  onToggle: () => void;
  busy: boolean;
  locked: boolean;
  canEdit: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onRenamePhase: (from: string, to: string) => void;
  onRemovePhase: (phase: string) => void;
  onMovePhase: (phase: string, up: boolean) => void;
  onSetStatus: (item: PlanItemDto, status: string) => void;
  onDispatch: (item: PlanItemDto) => void;
  onRemoveItem: (item: PlanItemDto) => void;
  onRenameItem: (item: PlanItemDto, title: string) => void;
  historyFor: string | null;
  history: PlanItemUpdateDto[] | null;
  onToggleHistory: (itemId: string) => void;
  onOpenJournalRef: (ref: string) => void;
  resolveJournalRefs: (refs: string[]) => Promise<JournalRefMeta[]>;
}

function PhaseCard(props: PhaseCardProps) {
  const {
    phase, items, meta, isOpen, onToggle, busy, locked, canEdit, canMoveUp, canMoveDown,
    onRenamePhase, onRemovePhase, onMovePhase,
    onSetStatus, onDispatch, onRemoveItem, onRenameItem, historyFor, history, onToggleHistory,
    onOpenJournalRef, resolveJournalRefs,
  } = props;
  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  // Phases are matched by name, so a rename must fire exactly once: Enter blurs
  // the input and the single onBlur commits; Escape blurs with this flag set so
  // the commit is skipped. (A double submit would re-target the old, now-gone
  // name and surface a spurious "not found".)
  const cancelEditRef = useRef(false);

  const sm = STATUS_META[meta?.status ?? "todo"] ?? STATUS_META.todo;
  const phasePct = meta ? Math.round((meta.progress ?? 0) * 100) : phaseProgress(items);

  return (
    <div className="card goal-card" style={{ marginBottom: 12 }}>
      <div className={"goal-head-row" + (confirmDel ? " is-active" : "")}>
        {editing ? (
          <div className="goal-head-edit">
            <span className="goal-glyph" style={{ color: sm.color }}>{sm.glyph}</span>
            <input
              autoFocus
              className="goal-title-input"
              defaultValue={phase}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
                if (e.key === "Escape") { cancelEditRef.current = true; (e.target as HTMLInputElement).blur(); }
              }}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (!cancelEditRef.current && v && v !== phase) onRenamePhase(phase, v);
                cancelEditRef.current = false;
                setEditing(false);
              }}
            />
          </div>
        ) : (
          <button type="button" className="goal-head-toggle" onClick={onToggle} aria-expanded={isOpen}>
            {isOpen ? <ChevronDown size={16} color="var(--text-3)" /> : <ChevronRight size={16} color="var(--text-3)" />}
            <span className="goal-glyph" style={{ color: sm.color }}>{sm.glyph}</span>
            <InlineMarkdown
              className="goal-title goal-title-clip"
              text={phase === NO_PHASE ? t("plan.noPhase") : phase}
              linkable={false}
            />
            {meta?.last_agent ? (
              <span
                className="phase-agent"
                title={`${agentLabel(meta.last_agent)} · ${relativeTime(meta.last_update)}`}
              >
                <span style={{ width: 7, height: 7, borderRadius: 99, background: agentColor(meta.last_agent) }} />
                {agentLabel(meta.last_agent)}
              </span>
            ) : null}
          </button>
        )}

        {!locked && !editing && canEdit ? (
          <div className="phase-actions">
            {confirmDel ? (
              <>
                <button type="button" className="pln-textbtn danger" onClick={() => { setConfirmDel(false); onRemovePhase(phase); }} disabled={busy}>
                  {t("plan.phaseRemove")}
                </button>
                <button type="button" className="pln-textbtn" onClick={() => setConfirmDel(false)}>{t("common.cancel")}</button>
              </>
            ) : (
              <>
                <button type="button" className="pln-iconbtn" title={t("plan.phaseRename")} onClick={() => setEditing(true)} disabled={busy}>
                  <Pencil size={13} />
                </button>
                <button type="button" className="pln-iconbtn" title={t("plan.phaseUp")} onClick={() => onMovePhase(phase, true)} disabled={busy || !canMoveUp}>
                  <ChevronUp size={14} />
                </button>
                <button type="button" className="pln-iconbtn" title={t("plan.phaseDown")} onClick={() => onMovePhase(phase, false)} disabled={busy || !canMoveDown}>
                  <ChevronDown size={14} />
                </button>
                <button type="button" className="pln-iconbtn danger" title={t("plan.phaseRemoveTitle")} onClick={() => setConfirmDel(true)} disabled={busy}>
                  <Trash2 size={13} />
                </button>
              </>
            )}
          </div>
        ) : null}

        <span className="prog-pct">{phasePct}%</span>
      </div>

      {isOpen
        ? items.map((it) => (
            <PlanItemRow
              key={it.item_id}
              item={it}
              busy={busy}
              locked={locked}
              isParent={items.some((c) => c.parent_item === it.item_id)}
              onSetStatus={onSetStatus}
              onDispatch={onDispatch}
              onRemove={onRemoveItem}
              onRename={onRenameItem}
              historyOpen={historyFor === it.item_id}
              history={historyFor === it.item_id ? history : null}
              onToggleHistory={onToggleHistory}
              onOpenJournalRef={onOpenJournalRef}
              resolveJournalRefs={resolveJournalRefs}
            />
          ))
        : null}
    </div>
  );
}

// ── Item row ─────────────────────────────────────────────────────────────────

interface PlanItemRowProps {
  item: PlanItemDto;
  busy: boolean;
  locked: boolean;
  /** 3-depth — 하위를 가진 부모: 상태는 롤업 파생이라 직접 조작 불가. */
  isParent: boolean;
  onSetStatus: (item: PlanItemDto, status: string) => void;
  /** IN2 — 이 항목을 터미널에서 Claude Code 로 실행 (프롬프트 프리필). */
  onDispatch: (item: PlanItemDto) => void;
  onRemove: (item: PlanItemDto) => void;
  onRename: (item: PlanItemDto, title: string) => void;
  historyOpen: boolean;
  history: PlanItemUpdateDto[] | null;
  onToggleHistory: (itemId: string) => void;
  onOpenJournalRef: (ref: string) => void;
  resolveJournalRefs: (refs: string[]) => Promise<JournalRefMeta[]>;
}

function PlanItemRow({ item, busy, locked, isParent, onSetStatus, onDispatch, onRemove, onRename, historyOpen, history, onToggleHistory, onOpenJournalRef, resolveJournalRefs }: PlanItemRowProps) {
  const meta = STATUS_META[item.status] ?? STATUS_META.todo;
  const indent = item.parent_item ? 22 : 0;
  const linked = item.journal_refs ?? [];
  const multiLinked = linked.length > 1;

  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  // Multi-journal picker: one linked entry opens directly; several show a
  // date+title chooser. Metas resolve lazily on first open.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [refMetas, setRefMetas] = useState<JournalRefMeta[] | null>(null);
  const jrefWrap = useRef<HTMLSpanElement>(null);

  const handleJournalBtn = () => {
    if (!multiLinked) {
      onOpenJournalRef(linked[0]);
      return;
    }
    setPickerOpen((o) => !o);
    if (refMetas == null) void resolveJournalRefs(linked).then(setRefMetas);
  };

  // Close the picker on an outside click (only while open).
  useEffect(() => {
    if (!pickerOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (jrefWrap.current && !jrefWrap.current.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [pickerOpen]);

  // Suggestion (never auto-applied): journal work is logged against this item
  // but it isn't closed out yet → offer a one-click "완료?". Suppressed on a
  // locked plan (no edits allowed).
  const suggestDone =
    !locked && !isParent && linked.length > 0 && !["done", "dropped", "deferred"].includes(item.status);
  return (
    <div className="subtask pln-item" style={{ "--pln-indent": `${indent}px` } as CSSProperties}>
      <button
        type="button"
        className="pln-item-glyph"
        onClick={() => onSetStatus(item, NEXT_STATUS[item.status] ?? "in_progress")}
        disabled={busy || locked || isParent}
        title={
          isParent
            ? t("plan.statusParent", { label: t(meta.labelKey) })
            : locked
              ? t("plan.statusLocked", { label: t(meta.labelKey) })
              : t("plan.statusClick", { label: t(meta.labelKey) })
        }
        style={{ color: meta.color, cursor: busy || locked || isParent ? "default" : "pointer" }}
      >
        {meta.glyph}
      </button>

      <div className="pln-item-main">
        {/* 제목 묶음과 메타 묶음은 **한 줄에서 시작해 좁아지면 접힌다** —
            `.pln-item-line` 이 wrap 이고 제목 쪽에 flex-basis 가 있어서, 남는
            폭이 그 아래로 내려가면 실행/에이전트/액션이 통째로 다음 줄로
            빠진다. 예전처럼 제목만 0px 로 눌려 세로로 서는 일이 없다. */}
        <div className="pln-item-line">
          <div className="pln-item-text">
            {editing ? (
              <input
                autoFocus
                className="sub-title-input"
                defaultValue={item.title}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    onRename(item, (e.target as HTMLInputElement).value);
                    setEditing(false);
                  }
                  if (e.key === "Escape") setEditing(false);
                }}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== item.title) onRename(item, v);
                  setEditing(false);
                }}
              />
            ) : (
              // 제목은 `.oculpm/planner/*.md` 에서 온 마크다운이다 — `**강조**`
              // 와 `` `코드` `` 를 기호째 노출하지 않고 렌더한다.
              <InlineMarkdown className={"sub-title" + (item.status === "done" ? " done" : "")} text={item.title} />
            )}
            {item.note ? (
              <InlineMarkdown className="pln-item-note" text={`— ${item.note}`} />
            ) : null}
            {linked.length > 0 ? (
              <span className="jref-wrap" ref={jrefWrap}>
                <button
                  type="button"
                  className="jref-btn"
                  onClick={handleJournalBtn}
                  title={multiLinked ? t("plan.linkedMulti", { n: linked.length }) : t("plan.linkedOne")}
                  aria-haspopup={multiLinked ? "menu" : undefined}
                  aria-expanded={multiLinked ? pickerOpen : undefined}
                >
                  <NotebookText size={13} strokeWidth={2} />
                  <span>{t("plan.entryLabel")}{multiLinked ? ` ${linked.length}` : ""}</span>
                  {multiLinked ? <ChevronDown size={12} /> : null}
                </button>
                {multiLinked && pickerOpen ? (
                  <div className="jref-pop" role="menu">
                    {refMetas == null ? (
                      <div className="jref-pop-loading">{t("common.loading")}</div>
                    ) : (
                      refMetas.map((m) => (
                        <button
                          key={m.ref}
                          type="button"
                          role="menuitem"
                          className="jref-pop-item"
                          onClick={() => {
                            setPickerOpen(false);
                            onOpenJournalRef(m.ref);
                          }}
                        >
                          <span className="jref-pop-date">{fmtWorkday(m.workday)}</span>
                          <span className="jref-pop-title">{m.title}</span>
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
              </span>
            ) : null}
            {suggestDone ? (
              <button
                type="button"
                className="pln-done-hint"
                onClick={() => onSetStatus(item, "done")}
                title={t("plan.markDoneTitle")}
              >
                {t("plan.markDone")}
              </button>
            ) : null}
          </div>

          <div className="pln-item-meta">
            {!locked && !["done", "dropped"].includes(item.status) ? (
              <button
                type="button"
                className="jref-btn"
                onClick={() => onDispatch(item)}
                title={t("plan.dispatchTitle")}
              >
                <Play size={12} strokeWidth={2} />
                <span>{t("plan.dispatch")}</span>
              </button>
            ) : null}
            {item.last_agent ? (
              <button
                type="button"
                className="pln-item-agent"
                onClick={() => onToggleHistory(item.item_id)}
                title={t("plan.history")}
              >
                <span className="pln-agent-dot" style={{ background: agentColor(item.last_agent) }} />
                <span className="pln-agent-name">{agentLabel(item.last_agent)}</span>
                <span className="pln-agent-time">· {relativeTime(item.last_update)}</span>
                <Clock size={11} />
              </button>
            ) : null}

            {!locked && !editing ? (
              <div className={"item-actions" + (confirmDel ? " is-active" : "")}>
                {confirmDel ? (
                  <>
                    <button type="button" className="pln-textbtn danger" onClick={() => { setConfirmDel(false); onRemove(item); }} disabled={busy} title={t("plan.itemDeleteConfirm")}>
                      {t("plan.itemDeleteConfirm")}
                    </button>
                    <button type="button" className="pln-textbtn" onClick={() => setConfirmDel(false)}>{t("common.cancel")}</button>
                  </>
                ) : (
                  <>
                    <button type="button" className="pln-iconbtn" onClick={() => setEditing(true)} disabled={busy} title={t("plan.itemRename")}>
                      <Pencil size={12} />
                    </button>
                    <button type="button" className="pln-iconbtn danger" onClick={() => setConfirmDel(true)} disabled={busy} title={t("plan.itemDelete")}>
                      <Trash2 size={12} />
                    </button>
                  </>
                )}
              </div>
            ) : null}
          </div>
        </div>

        {historyOpen ? (
          <div className="pln-item-history">
            {history == null ? (
              <span style={{ color: "var(--text-3)" }}>{t("plan.historyLoading")}</span>
            ) : history.length === 0 ? (
              <span style={{ color: "var(--text-3)" }}>{t("plan.noHistory")}</span>
            ) : (
              history.map((u, i) => (
                <div key={i} className="pln-hist-row">
                  <span className="pln-agent-dot" style={{ background: agentColor(u.agent_id) }} />
                  <span>{agentLabel(u.agent_id)}</span>
                  <span style={{ color: "var(--text-3)" }}>
                    {u.from_status ?? "?"}→{u.to_status ?? "?"} · {relativeTime(u.ts)}
                  </span>
                  {u.journal_ref ? (
                    <button
                      type="button"
                      className="jref-btn"
                      onClick={() => onOpenJournalRef(u.journal_ref!)}
                      title={t("plan.gotoEntry", { ref: u.journal_ref })}
                    >
                      <NotebookText size={13} strokeWidth={2} />
                      <span>{t("plan.entryLabel")}</span>
                    </button>
                  ) : null}
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
