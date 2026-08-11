// v2.3.0 메뉴바 팝오버 (docs/menubar/00-master-plan.md D2·D3·D5).
//
// "앱을 열지 않고 답이 되는 5초" — 위에서 아래로: 프로젝트 스위처 → 활성
// 세션 → 오늘 한 줄 → 최근 일지 → 활성 플랜 → 빠른 액션. 읽기 전용 +
// 딥링크가 원칙이고, 쓰기는 스탠드업 복사와 트레이 설정 토글(상단바에서
// 끝낼 수 있는 것은 상단바에서 — 전체 설정은 앱으로 딥링크)뿐이다.
//
// 데이터는 팝오버가 열릴 때만 기존 커맨드로 당긴다 (폴링 없음 — 백엔드가
// show 시점에 "tray-popover-shown" 을 쏜다). 신규 백엔드 집계 커맨드 없음.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { safeUnlistenPromise } from "@/lib/unlisten";
import { listen } from "@tauri-apps/api/event";
import { ArrowLeft, Check, ChevronDown, ExternalLink } from "lucide-react";
import {
  commands,
  events,
  type JournalEntrySummary,
  type PlanItemDto,
  type PlanSummary,
  type Session,
} from "@/lib/bindings";
// 모듈 t() 는 순수 헬퍼 `elapsedLabel` 용, useT() 는 각 컴포넌트용.
import { t, useT, type I18nKey } from "@/i18n";
import "./tray.css";

interface ActivePlan {
  summary: PlanSummary;
  /** 진행중 우선, 없으면 첫 todo — "다음 할 일" 1줄. */
  next: string | null;
}

interface ProjectSnapshot {
  id: number;
  name: string;
  rootPath: string;
  workday: string | null;
  sessions: Session[];
  entries: JournalEntrySummary[];
  plans: ActivePlan[];
}

/** 일지 목록 렌더 상한 — 팝오버에는 6행 남짓만 보이고 나머지는 세로 스크롤로
    거슬러 올라간다. 전체(수백 건)를 DOM 에 얹지 않기 위한 상한. */
const ENTRY_LIST_MAX = 50;

/** 일지 타입 → 배지 라벨 키. 표시만 사전을 거치고 타입 자체는 판별자로 남는다. */
const TYPE_LABEL: Record<string, I18nKey> = {
  feature: "entryType.feature",
  bug: "entryType.bug",
  error: "entryType.error",
  refactor: "entryType.refactor",
  chore: "entryType.chore",
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function elapsedLabel(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return t("tray.justStarted");
  if (min < 60) return t("tray.elapsedMinutes", { n: min });
  return t("tray.elapsedHours", { h: Math.floor(min / 60), m: min % 60 });
}

/** 로컬 달력 기준 오늘 YYYYMMDD — 자정 넘김 감지용. */
function localDayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** 어제 workday (YYYYMMDD 산술 — 스탠드업 since 용). */
function yesterdayOf(workday: string): string {
  const y = new Date(
    Number(workday.slice(0, 4)),
    Number(workday.slice(4, 6)) - 1,
    Number(workday.slice(6, 8)) - 1,
  );
  return `${y.getFullYear()}${String(y.getMonth() + 1).padStart(2, "0")}${String(
    y.getDate(),
  ).padStart(2, "0")}`;
}

async function loadProject(p: {
  id: number;
  name: string;
  root_path: string;
}): Promise<ProjectSnapshot> {
  const [status, sessions, entries, plans] = await Promise.all([
    commands.oculpmGetStatus(p.id),
    commands.oculpmListSessions(p.id, null),
    commands.oculpmListJournalEntries(p.id, null, null),
    commands.planList(p.id),
  ]);
  // 활성 플랜(표시 상한 2)은 항목까지 당겨 "다음 할 일"을 계산한다.
  const active = plans.status === "ok" ? plans.data.filter((x) => x.status === "active") : [];
  const enriched: ActivePlan[] = await Promise.all(
    active.slice(0, 2).map(async (summary) => {
      const d = await commands.planGet(p.id, summary.plan_id);
      let next: string | null = null;
      if (d.status === "ok" && d.data) {
        const items = [...d.data.items].sort((a, b) => a.order_idx - b.order_idx);
        next =
          (items.find((i) => i.status === "in_progress") ??
            items.find((i) => i.status === "todo"))?.title ?? null;
      }
      return { summary, next };
    }),
  );
  return {
    id: p.id,
    name: p.name,
    rootPath: p.root_path,
    workday: status.status === "ok" ? status.data.current_workday : null,
    sessions: sessions.status === "ok" ? sessions.data : [],
    entries: entries.status === "ok" ? entries.data : [],
    plans: enriched,
  };
}

// ─── 프로젝트 스위처 (커스텀 드롭다운 — 네이티브 select 는 팝오버 톤과 어긋남) ──

function ProjectPicker({
  snapshots,
  selected,
  onSelect,
}: {
  snapshots: ProjectSnapshot[];
  selected: number | "all";
  onSelect: (v: number | "all") => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const todayCount = (s: ProjectSnapshot) =>
    s.entries.filter((e) => e.workday === s.workday).length;
  const label =
    selected === "all"
      ? t("tray.allProjects")
      : (snapshots.find((s) => s.id === selected)?.name ?? t("tray.projectFallback"));

  const row = (
    key: string,
    active: boolean,
    name: string,
    count: number,
    live: boolean,
    onClick: () => void,
  ) => (
    <button key={key} className="tp-picker-row" role="option" aria-selected={active} onClick={onClick}>
      <span className="tp-picker-check">{active && <Check size={13} strokeWidth={2.6} />}</span>
      <span className="tp-picker-name">{name}</span>
      {live && <span className="tp-live-dot tp-live-dot-sm" />}
      {count > 0 && <span className="tp-picker-count">{count}</span>}
    </button>
  );

  return (
    <div className="tp-picker" ref={rootRef}>
      <button
        className="tp-picker-btn"
        aria-label={t("tray.projectAria")}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="tp-picker-label">{label}</span>
        <ChevronDown size={14} className={`tp-picker-chev ${open ? "is-open" : ""}`} />
      </button>
      {open && (
        <div className="tp-picker-menu" role="listbox">
          {row(
            "all",
            selected === "all",
            t("tray.allProjects"),
            snapshots.reduce((n, s) => n + todayCount(s), 0),
            snapshots.some((s) => s.sessions.some((x) => x.ended_at === null)),
            () => {
              onSelect("all");
              setOpen(false);
            },
          )}
          <div className="tp-picker-sep" />
          {snapshots.map((s) =>
            row(
              String(s.id),
              selected === s.id,
              s.name,
              todayCount(s),
              s.sessions.some((x) => x.ended_at === null),
              () => {
                onSelect(s.id);
                setOpen(false);
              },
            ),
          )}
        </div>
      )}
    </div>
  );
}

// ─── 일지 상세 (팝오버 안에서 읽기) ──────────────────────────────────────────

/**
 * 마크다운 라이트 렌더 — 트레이 팝오버 전용. 일지 본문의 지배적 패턴(##
 * 헤딩·불릿·코드펜스·**굵게**·`코드`)만 처리하고 나머지는 문단 그대로.
 * 본 앱의 풀 마크다운 스택을 트레이 번들에 끌어오지 않기 위한 의도적 축소.
 */
function inlineMd(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  // `코드` 우선 분리 후 **굵게** 처리.
  const parts = text.split(/(`[^`]+`)/g);
  parts.forEach((part, i) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      out.push(<code key={i}>{part.slice(1, -1)}</code>);
      return;
    }
    const bolds = part.split(/(\*\*[^*]+\*\*)/g);
    bolds.forEach((b, j) => {
      if (b.startsWith("**") && b.endsWith("**") && b.length > 4) {
        out.push(<b key={`${i}-${j}`}>{b.slice(2, -2)}</b>);
      } else if (b) {
        out.push(<span key={`${i}-${j}`}>{b}</span>);
      }
    });
  });
  return out;
}

/**
 * 일지 본문 첫 줄은 규격상 `[x] 제목` 체크박스 라인 (AGENTS.md §4) — 상세
 * 패널이 제목을 이미 헤더로 보여주므로 본문에서는 중복이라 잘라낸다.
 */
function stripTitleLine(body: string): string {
  const lines = body.split("\n");
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i += 1;
  if (i < lines.length && /^\s*\[(x| )\]\s/.test(lines[i])) {
    return lines.slice(i + 1).join("\n");
  }
  return body;
}

function MdLite({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split("\n");
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trimStart().startsWith("```")) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1; // 닫는 펜스
      blocks.push(
        <pre className="tp-md-code" key={key++}>
          {code.join("\n")}
        </pre>,
      );
      continue;
    }
    if (/^#{1,4}\s/.test(line)) {
      blocks.push(
        <div className="tp-md-h" key={key++}>
          {inlineMd(line.replace(/^#{1,4}\s+/, ""))}
        </div>,
      );
    } else if (/^\s*[-*]\s+/.test(line)) {
      blocks.push(
        <div className="tp-md-li" key={key++}>
          <span className="tp-md-dot">•</span>
          <span>{inlineMd(line.replace(/^\s*[-*]\s+/, ""))}</span>
        </div>,
      );
    } else if (line.trim()) {
      blocks.push(
        <p className="tp-md-p" key={key++}>
          {inlineMd(line)}
        </p>,
      );
    }
    i += 1;
  }
  return <div className="tp-md">{blocks}</div>;
}

function EntryDetail({
  projectId,
  projectName,
  path,
  onBack,
  onOpenApp,
}: {
  projectId: number;
  projectName: string;
  path: string;
  onBack: () => void;
  onOpenApp: () => void;
}) {
  const { t } = useT();
  const [entry, setEntry] = useState<{
    title: string;
    body: string;
    type: string;
    agent: string;
    model: string | null;
    createdAt: string;
  } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void commands.oculpmGetJournalEntry(projectId, path).then((res) => {
      if (!alive) return;
      if (res.status === "ok" && res.data) {
        setEntry({
          title: res.data.title,
          body: res.data.body_markdown,
          type: res.data.frontmatter.type,
          agent: res.data.frontmatter.agent.id,
          model: res.data.frontmatter.agent.version,
          createdAt: res.data.frontmatter.created_at,
        });
      } else {
        setFailed(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [projectId, path]);

  return (
    <div className="tp-detail">
      <div className="tp-settings-head">
        <button className="tp-back" onClick={onBack} aria-label={t("tray.back")}>
          <ArrowLeft size={14} />
        </button>
        {entry && (
          <span className={`tp-type tp-type-${entry.type}`}>
            {TYPE_LABEL[entry.type] ? t(TYPE_LABEL[entry.type]) : entry.type}
          </span>
        )}
        <span className="tp-detail-proj">{projectName}</span>
      </div>
      {failed ? (
        <div className="tp-empty">{t("tray.entryReadFailed")}</div>
      ) : !entry ? (
        <div className="tp-empty">{t("tray.loading")}</div>
      ) : (
        <div className="tp-detail-body">
          <div className="tp-detail-title">{entry.title}</div>
          <div className="tp-detail-meta">
            {entry.agent}
            {entry.model && ` · ${entry.model}`} · {fmtTime(entry.createdAt)}
          </div>
          <MdLite text={stripTitleLine(entry.body)} />
        </div>
      )}
      <button className="tp-open-settings" onClick={onOpenApp}>
        {t("tray.openInApp")} <ExternalLink size={12} />
      </button>
    </div>
  );
}

// ─── 플랜 상세 (팝오버 안에서 보기) ──────────────────────────────────────────

const ITEM_GLYPH: Record<string, { ch: string; cls: string }> = {
  done: { ch: "✓", cls: "is-done" },
  in_progress: { ch: "◐", cls: "is-progress" },
  todo: { ch: "○", cls: "is-todo" },
  blocked: { ch: "!", cls: "is-blocked" },
  deferred: { ch: "›", cls: "is-muted" },
  dropped: { ch: "×", cls: "is-muted" },
};

function PlanDetail({
  projectId,
  projectName,
  planId,
  onBack,
  onOpenApp,
}: {
  projectId: number;
  projectName: string;
  planId: string;
  onBack: () => void;
  onOpenApp: () => void;
}) {
  const { t } = useT();
  const [plan, setPlan] = useState<{
    title: string;
    done: number;
    total: number;
    items: PlanItemDto[];
  } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void commands.planGet(projectId, planId).then((res) => {
      if (!alive) return;
      if (res.status === "ok" && res.data) {
        setPlan({
          title: res.data.plan.title,
          done: res.data.plan.done_count,
          total: res.data.plan.item_count,
          items: [...res.data.items].sort((a, b) => a.order_idx - b.order_idx),
        });
      } else {
        setFailed(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [projectId, planId]);

  return (
    <div className="tp-detail">
      <div className="tp-settings-head">
        <button className="tp-back" onClick={onBack} aria-label={t("tray.back")}>
          <ArrowLeft size={14} />
        </button>
        <span className="tp-settings-title">{t("tray.planTitle")}</span>
        <span className="tp-detail-proj">{projectName}</span>
      </div>
      {failed ? (
        <div className="tp-empty">{t("tray.planReadFailed")}</div>
      ) : !plan ? (
        <div className="tp-empty">{t("tray.loading")}</div>
      ) : (
        <div className="tp-detail-body">
          <div className="tp-detail-title">{plan.title}</div>
          <div className="tp-plan-head-progress">
            <span className="tp-progress">
              <span
                className="tp-progress-fill"
                style={{ width: `${plan.total ? Math.round((plan.done / plan.total) * 100) : 0}%` }}
              />
            </span>
            <span className="tp-dim">
              {plan.done}/{plan.total}
            </span>
          </div>
          <div className="tp-plan-items">
            {plan.items.map((it) => (
              <div className="tp-plan-item" key={it.item_id}>
                <span className={`tp-item-glyph ${ITEM_GLYPH[it.status]?.cls ?? "is-todo"}`}>
                  {ITEM_GLYPH[it.status]?.ch ?? "○"}
                </span>
                <span className={`tp-item-title ${it.status === "done" ? "is-done" : ""}`}>
                  {it.title}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      <button className="tp-open-settings" onClick={onOpenApp}>
        {t("tray.openInApp")} <ExternalLink size={12} />
      </button>
    </div>
  );
}

// ─── 트레이 설정 (상단바에서 끝낼 수 있는 것) ────────────────────────────────

// `key` 는 SQLite 설정 키라 그대로 두고 표시 문구만 사전 키로 뽑는다.
const TRAY_TOGGLES: Array<{
  key: string;
  labelKey: I18nKey;
  hintKey: I18nKey;
  defaultOn: boolean;
}> = [
  {
    key: "tray.show_icon",
    labelKey: "tray.toggleShowIcon",
    hintKey: "tray.toggleShowIconHint",
    defaultOn: true,
  },
  {
    key: "tray.keep_running",
    labelKey: "tray.toggleKeepRunning",
    hintKey: "tray.toggleKeepRunningHint",
    defaultOn: false,
  },
  {
    key: "tray.hide_dock",
    labelKey: "tray.toggleHideDock",
    hintKey: "tray.toggleHideDockHint",
    defaultOn: false,
  },
  {
    key: "tray.notify_journal",
    labelKey: "tray.toggleNotify",
    hintKey: "tray.toggleNotifyHint",
    defaultOn: false,
  },
];

function TraySettings({ onBack, onOpenApp }: { onBack: () => void; onOpenApp: () => void }) {
  const { t } = useT();
  const [vals, setVals] = useState<Record<string, boolean> | null>(null);

  useEffect(() => {
    void commands.settingsGetAll().then((res) => {
      if (res.status !== "ok") return;
      const m = new Map(res.data);
      setVals(
        Object.fromEntries(
          TRAY_TOGGLES.map((row) => [
            row.key,
            m.has(row.key) ? m.get(row.key) === "1" : row.defaultOn,
          ]),
        ),
      );
    });
  }, []);

  const toggle = (key: string) => {
    if (!vals) return;
    const next = { ...vals, [key]: !vals[key] };
    setVals(next);
    void commands.settingsSet(key, next[key] ? "1" : "0").then(() => commands.trayApplySettings());
  };

  const dockDisabled = vals ? !vals["tray.keep_running"] : true;

  return (
    <div className="tp-settings">
      <div className="tp-settings-head">
        <button className="tp-back" onClick={onBack} aria-label={t("tray.back")}>
          <ArrowLeft size={14} />
        </button>
        <span className="tp-settings-title">{t("tray.settingsTitle")}</span>
      </div>
      <div className="tp-settings-body">
        {TRAY_TOGGLES.map((row) => {
          const disabled = !vals || (row.key === "tray.hide_dock" && dockDisabled);
          const on = !!vals?.[row.key] && !(row.key === "tray.hide_dock" && dockDisabled);
          return (
            <button
              key={row.key}
              className={`tp-toggle-row ${disabled ? "is-disabled" : ""}`}
              disabled={disabled}
              onClick={() => toggle(row.key)}
            >
              <span className={`tp-switch ${on ? "is-on" : ""}`}>
                <span className="tp-switch-knob" />
              </span>
              <span className="tp-toggle-text">
                <span className="tp-toggle-label">{t(row.labelKey)}</span>
                <span className="tp-toggle-hint">{t(row.hintKey)}</span>
              </span>
            </button>
          );
        })}
      </div>
      <button className="tp-open-settings" onClick={onOpenApp}>
        {t("tray.openFullSettings")} <ExternalLink size={12} />
      </button>
    </div>
  );
}

// ─── 팝오버 본체 ─────────────────────────────────────────────────────────────

export function TrayPopover() {
  const { t } = useT();
  const [snapshots, setSnapshots] = useState<ProjectSnapshot[]>([]);
  const [selected, setSelected] = useState<number | "all">("all");
  const [loading, setLoading] = useState(true);
  const [standupState, setStandupState] = useState<"idle" | "busy" | "copied">("idle");
  const [pane, setPane] = useState<"main" | "settings">("main");
  // 일지 상세 — 팝오버 안에서 본문을 읽는다 (앱 열기는 상세 패널의 선택지).
  const [detail, setDetail] = useState<{
    projectId: number;
    projectName: string;
    path: string;
  } | null>(null);
  // 플랜 상세 — 같은 패턴.
  const [planDetail, setPlanDetail] = useState<{
    projectId: number;
    projectName: string;
    planId: string;
  } | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await commands.listProjects();
      if (res.status !== "ok") return;
      const snaps = await Promise.all(res.data.map((p) => loadProject(p)));
      // 활동 많은 순 — 오늘 일지 많은 프로젝트가 위로.
      snaps.sort((a, b) => b.entries.length - a.entries.length);
      setSnapshots(snaps);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    // 팝오버가 다시 열릴 때마다 재조회 + 메인 화면 복귀 (백엔드 show 신호).
    const un = listen("tray-popover-shown", () => {
      setPane("main");
      setDetail(null);
      setPlanDetail(null);
      void reload();
    });
    return () => {
      safeUnlistenPromise(un);
    };
  }, [reload]);

  // 실시간 갱신 — 새 일지가 인덱싱되면 목록을 다시 당긴다. 백필처럼 이벤트가
  // 몰릴 때를 위해 1.2초 트레일링 디바운스 (팝오버가 숨어 있어도 갱신해 두면
  // 다음 오픈이 그만큼 신선하다).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const un = events.oculpmJournalAdded.listen(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void reload(), 1200);
    });
    return () => {
      if (timer) clearTimeout(timer);
      safeUnlistenPromise(un);
    };
  }, [reload]);

  // 자정 롤오버 — 팝오버를 연 채로 workday 경계를 넘기면 "오늘" 수치·활동이
  // 전날에 고정된다 (열 때·새 일지 때만 reload 하므로). 로컬 달력 날짜가
  // 바뀌면 다시 당겨온다 — reload 가 프로젝트별 current_workday 를 백엔드에서
  // 재계산하므로 tz/day_starts_at 도 그때 반영된다. 60초 tick + 포커스/재표시
  // (슬립 복귀로 타이머가 밀렸던 경우 대비).
  useEffect(() => {
    let lastDay = localDayKey();
    const check = () => {
      const now = localDayKey();
      if (now !== lastDay) {
        lastDay = now;
        void reload();
      }
    };
    const id = window.setInterval(check, 60_000);
    const onWake = () => {
      if (document.visibilityState === "visible") check();
    };
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [reload]);

  // Esc = 닫기 (포커스 이탈 hide 는 백엔드 담당).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void commands.trayHidePopover();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const visible = useMemo(
    () => (selected === "all" ? snapshots : snapshots.filter((s) => s.id === selected)),
    [snapshots, selected],
  );

  const activeSessions = useMemo(
    () =>
      visible.flatMap((s) =>
        s.sessions
          .filter((x) => x.ended_at === null)
          .map((x) => ({ project: s, session: x })),
      ),
    [visible],
  );

  // workday=null 조회는 프로젝트 **전체** 일지를 돌려준다 — "오늘" 수치는
  // 프로젝트별 current_workday 로 잘라야 한다 (첫 실기기에서 전체 누적이
  // "오늘 536"으로 표시되던 버그).
  const recentEntries = useMemo(
    () =>
      visible
        .flatMap((s) => s.entries.map((e) => ({ project: s, entry: e })))
        .sort((a, b) => (a.entry.created_at < b.entry.created_at ? 1 : -1)),
    [visible],
  );

  const todayEntries = useMemo(
    () => recentEntries.filter(({ project, entry }) => entry.workday === project.workday),
    [recentEntries],
  );

  const filesTouched = useMemo(
    () => todayEntries.reduce((n, e) => n + e.entry.files_count, 0),
    [todayEntries],
  );

  const warnCount = useMemo(
    () => todayEntries.filter((e) => !e.entry.parse_ok).length,
    [todayEntries],
  );

  const activePlans = useMemo(
    () => visible.flatMap((s) => s.plans.map((p) => ({ project: s, plan: p }))),
    [visible],
  );

  // 마지막 활동 시각 — 빈 상태에서도 침묵을 정보로 (D5).
  const lastActivity = recentEntries[0]?.entry.created_at ?? null;

  const openMain = (nav: { view: string; project_id?: number; entry_path?: string } | null) => {
    void commands.trayOpenMain(
      nav
        ? {
            view: nav.view,
            project_id: nav.project_id ?? null,
            entry_path: nav.entry_path ?? null,
          }
        : null,
    );
  };

  // 스탠드업 대상 = 명시 선택 프로젝트, 아니면 오늘 가장 활동 많은 프로젝트.
  const standupTarget = selected === "all" ? snapshots[0] : snapshots.find((s) => s.id === selected);

  const copyStandup = async () => {
    if (!standupTarget?.workday || standupState === "busy") return;
    setStandupState("busy");
    try {
      const res = await commands.oculpmGenerateSummary(
        standupTarget.id,
        yesterdayOf(standupTarget.workday),
        standupTarget.workday,
        "standup",
        null,
        null,
      );
      if (res.status === "ok") {
        await navigator.clipboard.writeText(res.data.markdown);
        setStandupState("copied");
        setTimeout(() => setStandupState("idle"), 1800);
        return;
      }
    } catch {
      // 클립보드 실패 등 — 아래에서 idle 복귀
    }
    setStandupState("idle");
  };

  if (detail) {
    return (
      <div className="traypop" data-testid="tray-popover">
        <EntryDetail
          projectId={detail.projectId}
          projectName={detail.projectName}
          path={detail.path}
          onBack={() => setDetail(null)}
          onOpenApp={() =>
            openMain({ view: "journal", project_id: detail.projectId, entry_path: detail.path })
          }
        />
      </div>
    );
  }

  if (planDetail) {
    return (
      <div className="traypop" data-testid="tray-popover">
        <PlanDetail
          projectId={planDetail.projectId}
          projectName={planDetail.projectName}
          planId={planDetail.planId}
          onBack={() => setPlanDetail(null)}
          onOpenApp={() => openMain({ view: "planner", project_id: planDetail.projectId })}
        />
      </div>
    );
  }

  if (pane === "settings") {
    return (
      <div className="traypop" data-testid="tray-popover">
        <TraySettings
          onBack={() => setPane("main")}
          onOpenApp={() => openMain({ view: "settings" })}
        />
      </div>
    );
  }

  return (
    <div className="traypop" data-testid="tray-popover">
      <header className="tp-head">
        <ProjectPicker snapshots={snapshots} selected={selected} onSelect={setSelected} />
        <button className="tp-open" onClick={() => openMain(null)}>
          {t("tray.openApp")}
        </button>
      </header>

      <section className="tp-sessions">
        {activeSessions.length === 0 ? (
          <div className="tp-idle-line">{t("tray.noActiveSession")}</div>
        ) : (
          <>
            <div className="tp-sec-label">
              <span className="tp-live-dot" />{" "}
              {t("tray.sessionsActive", { n: activeSessions.length })}
            </div>
            {activeSessions.slice(0, 4).map(({ project, session }) => (
              <div className="tp-session-row" key={`${project.id}:${session.id}`}>
                <span className="tp-agent">
                  {session.agent_label_guess ?? t("tray.agentFallback")}
                </span>
                <span className="tp-dim">{elapsedLabel(session.started_at)}</span>
                <span className="tp-proj">{project.name}</span>
              </div>
            ))}
          </>
        )}
      </section>

      <section className="tp-today">
        <span>
          {t("tray.todayEntries")} <b>{todayEntries.length}</b>
        </span>
        <span>
          {t("tray.filesChanged")} <b>{filesTouched}</b>
        </span>
        {warnCount > 0 && <span className="tp-warn">⚠ {warnCount}</span>}
      </section>

      <section className="tp-entries scrollbar-thin">
        {todayEntries.length === 0 && (
          <div className="tp-empty">
            {t("tray.noEntriesToday")}
            {lastActivity && (
              <span className="tp-dim">
                {t("tray.lastActivity", { time: fmtTime(lastActivity) })}
              </span>
            )}
          </div>
        )}
        {recentEntries.length > 0 &&
          recentEntries.slice(0, ENTRY_LIST_MAX).map(({ project, entry }) => (
            <button
              key={`${project.id}:${entry.relative_path}`}
              className="tp-entry-row"
              title={
                entry.agent_version
                  ? t("tray.entryTooltipWithModel", {
                      agent: entry.agent_id,
                      model: entry.agent_version,
                      files: entry.files_count,
                    })
                  : t("tray.entryTooltip", { agent: entry.agent_id, files: entry.files_count })
              }
              onClick={() =>
                setDetail({
                  projectId: project.id,
                  projectName: project.name,
                  path: entry.relative_path,
                })
              }
            >
              <span className="tp-time">
                {entry.workday === project.workday
                  ? fmtTime(entry.created_at)
                  : `${Number(entry.workday.slice(4, 6))}/${Number(entry.workday.slice(6, 8))}`}
              </span>
              <span className={`tp-type tp-type-${entry.type}`}>
                {TYPE_LABEL[entry.type] ? t(TYPE_LABEL[entry.type]) : entry.type}
              </span>
              <span className="tp-title">{entry.title}</span>
            </button>
          ))}
      </section>

      {activePlans.length > 0 && (
        <section className="tp-plans">
          {activePlans.slice(0, 2).map(({ project, plan }) => (
            <button
              key={`${project.id}:${plan.summary.plan_id}`}
              className="tp-plan-row"
              onClick={() =>
                setPlanDetail({
                  projectId: project.id,
                  projectName: project.name,
                  planId: plan.summary.plan_id,
                })
              }
            >
              <span className="tp-plan-main">
                <span className="tp-title">{plan.summary.title}</span>
                {plan.next && (
                  <span className="tp-plan-next">{t("tray.planNext", { title: plan.next })}</span>
                )}
              </span>
              <span className="tp-progress">
                <span
                  className="tp-progress-fill"
                  style={{ width: `${Math.round((plan.summary.progress ?? 0) * 100)}%` }}
                />
              </span>
              <span className="tp-dim">
                {plan.summary.done_count}/{plan.summary.item_count}
              </span>
            </button>
          ))}
        </section>
      )}

      <footer className="tp-foot">
        <button
          className="tp-action"
          disabled={!standupTarget?.workday || standupState === "busy"}
          onClick={() => void copyStandup()}
        >
          {standupState === "copied" ? t("tray.standupCopied") : t("tray.standupCopy")}
        </button>
        <button className="tp-action" onClick={() => setPane("settings")}>
          {t("tray.settings")}
        </button>
      </footer>

      {loading && <div className="tp-loading" aria-label={t("tray.loadingAria")} />}
    </div>
  );
}
