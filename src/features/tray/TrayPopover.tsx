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
import { listen } from "@tauri-apps/api/event";
import { ArrowLeft, Check, ChevronDown, ExternalLink } from "lucide-react";
import {
  commands,
  type JournalEntrySummary,
  type PlanSummary,
  type Session,
} from "@/lib/bindings";
import "./tray.css";

interface ProjectSnapshot {
  id: number;
  name: string;
  rootPath: string;
  workday: string | null;
  sessions: Session[];
  entries: JournalEntrySummary[];
  plans: PlanSummary[];
}

const TYPE_LABEL: Record<string, string> = {
  feature: "기능",
  bug: "버그",
  error: "에러",
  refactor: "리팩토링",
  chore: "잡일",
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
  if (min < 1) return "방금 시작";
  if (min < 60) return `${min}분째`;
  return `${Math.floor(min / 60)}시간 ${min % 60}분째`;
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
  return {
    id: p.id,
    name: p.name,
    rootPath: p.root_path,
    workday: status.status === "ok" ? status.data.current_workday : null,
    sessions: sessions.status === "ok" ? sessions.data : [],
    entries: entries.status === "ok" ? entries.data : [],
    plans: plans.status === "ok" ? plans.data.filter((x) => x.status === "active") : [],
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
      ? "전체 프로젝트"
      : (snapshots.find((s) => s.id === selected)?.name ?? "프로젝트");

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
        aria-label="프로젝트"
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
            "전체 프로젝트",
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
  const [entry, setEntry] = useState<{
    title: string;
    body: string;
    type: string;
    agent: string;
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
        <button className="tp-back" onClick={onBack} aria-label="뒤로">
          <ArrowLeft size={14} />
        </button>
        {entry && (
          <span className={`tp-type tp-type-${entry.type}`}>
            {TYPE_LABEL[entry.type] ?? entry.type}
          </span>
        )}
        <span className="tp-detail-proj">{projectName}</span>
      </div>
      {failed ? (
        <div className="tp-empty">일지를 읽지 못했습니다</div>
      ) : !entry ? (
        <div className="tp-empty">불러오는 중…</div>
      ) : (
        <div className="tp-detail-body">
          <div className="tp-detail-title">{entry.title}</div>
          <div className="tp-detail-meta">
            {entry.agent} · {fmtTime(entry.createdAt)}
          </div>
          <MdLite text={entry.body} />
        </div>
      )}
      <button className="tp-open-settings" onClick={onOpenApp}>
        앱에서 열기 <ExternalLink size={12} />
      </button>
    </div>
  );
}

// ─── 트레이 설정 (상단바에서 끝낼 수 있는 것) ────────────────────────────────

const TRAY_TOGGLES: Array<{ key: string; label: string; hint: string; defaultOn: boolean }> = [
  {
    key: "tray.show_icon",
    label: "메뉴바 아이콘 표시",
    hint: "세션이 활성일 때 아이콘이 움직입니다",
    defaultOn: true,
  },
  {
    key: "tray.keep_running",
    label: "창 닫기(⌘W) = 메뉴바로 최소화",
    hint: "끄면 창 닫기가 곧 종료입니다 (⌘Q 는 항상 완전 종료)",
    defaultOn: false,
  },
  {
    key: "tray.hide_dock",
    label: "상주 중 Dock 아이콘 숨김",
    hint: "메뉴바로 최소화된 동안 Dock 에서도 사라집니다",
    defaultOn: false,
  },
];

function TraySettings({ onBack, onOpenApp }: { onBack: () => void; onOpenApp: () => void }) {
  const [vals, setVals] = useState<Record<string, boolean> | null>(null);

  useEffect(() => {
    void commands.settingsGetAll().then((res) => {
      if (res.status !== "ok") return;
      const m = new Map(res.data);
      setVals(
        Object.fromEntries(
          TRAY_TOGGLES.map((t) => [
            t.key,
            m.has(t.key) ? m.get(t.key) === "1" : t.defaultOn,
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
        <button className="tp-back" onClick={onBack} aria-label="뒤로">
          <ArrowLeft size={14} />
        </button>
        <span className="tp-settings-title">상단바 설정</span>
      </div>
      <div className="tp-settings-body">
        {TRAY_TOGGLES.map((t) => {
          const disabled = !vals || (t.key === "tray.hide_dock" && dockDisabled);
          const on = !!vals?.[t.key] && !(t.key === "tray.hide_dock" && dockDisabled);
          return (
            <button
              key={t.key}
              className={`tp-toggle-row ${disabled ? "is-disabled" : ""}`}
              disabled={disabled}
              onClick={() => toggle(t.key)}
            >
              <span className={`tp-switch ${on ? "is-on" : ""}`}>
                <span className="tp-switch-knob" />
              </span>
              <span className="tp-toggle-text">
                <span className="tp-toggle-label">{t.label}</span>
                <span className="tp-toggle-hint">{t.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
      <button className="tp-open-settings" onClick={onOpenApp}>
        앱에서 전체 설정 열기 <ExternalLink size={12} />
      </button>
    </div>
  );
}

// ─── 팝오버 본체 ─────────────────────────────────────────────────────────────

export function TrayPopover() {
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
      void reload();
    });
    return () => {
      void un.then((f) => f());
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
          앱 열기 ↗
        </button>
      </header>

      <section className="tp-sessions">
        {activeSessions.length === 0 ? (
          <div className="tp-idle-line">지금 활성 세션 없음</div>
        ) : (
          <>
            <div className="tp-sec-label">
              <span className="tp-live-dot" /> 세션 {activeSessions.length} 활성
            </div>
            {activeSessions.slice(0, 4).map(({ project, session }) => (
              <div className="tp-session-row" key={`${project.id}:${session.id}`}>
                <span className="tp-agent">{session.agent_label_guess ?? "에이전트"}</span>
                <span className="tp-dim">{elapsedLabel(session.started_at)}</span>
                <span className="tp-proj">{project.name}</span>
              </div>
            ))}
          </>
        )}
      </section>

      <section className="tp-today">
        <span>
          오늘 일지 <b>{todayEntries.length}</b>
        </span>
        <span>
          변경 파일 <b>{filesTouched}</b>
        </span>
        {warnCount > 0 && <span className="tp-warn">⚠ {warnCount}</span>}
      </section>

      <section className="tp-entries">
        {todayEntries.length === 0 && (
          <div className="tp-empty">
            오늘 아직 기록 없음
            {lastActivity && <span className="tp-dim"> · 마지막 활동 {fmtTime(lastActivity)}</span>}
          </div>
        )}
        {recentEntries.length > 0 &&
          recentEntries.slice(0, 4).map(({ project, entry }) => (
            <button
              key={`${project.id}:${entry.relative_path}`}
              className="tp-entry-row"
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
                {TYPE_LABEL[entry.type] ?? entry.type}
              </span>
              <span className="tp-title">{entry.title}</span>
            </button>
          ))}
      </section>

      {activePlans.length > 0 && (
        <section className="tp-plans">
          {activePlans.slice(0, 2).map(({ project, plan }) => (
            <button
              key={`${project.id}:${plan.plan_id}`}
              className="tp-plan-row"
              onClick={() => openMain({ view: "planner", project_id: project.id })}
            >
              <span className="tp-title">{plan.title}</span>
              <span className="tp-progress">
                <span
                  className="tp-progress-fill"
                  style={{ width: `${Math.round((plan.progress ?? 0) * 100)}%` }}
                />
              </span>
              <span className="tp-dim">
                {plan.done_count}/{plan.item_count}
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
          {standupState === "copied" ? "복사됨 ✓" : "스탠드업 복사"}
        </button>
        <button className="tp-action" onClick={() => setPane("settings")}>
          설정
        </button>
      </footer>

      {loading && <div className="tp-loading" aria-label="불러오는 중" />}
    </div>
  );
}
