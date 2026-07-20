// v2.3.0 메뉴바 팝오버 (docs/menubar/00-master-plan.md D2·D3·D5).
//
// "앱을 열지 않고 답이 되는 5초" — 위에서 아래로: 프로젝트 스위처 → 활성
// 세션 → 오늘 한 줄 → 최근 일지 → 활성 플랜 → 빠른 액션. 읽기 전용 +
// 딥링크가 원칙이고, 유일한 쓰기는 스탠드업 복사(결정적 폴백 경로)다.
//
// 데이터는 팝오버가 열릴 때만 기존 커맨드로 당긴다 (폴링 없음 — 백엔드가
// show 시점에 "tray-popover-shown" 을 쏜다). 신규 백엔드 집계 커맨드 없음.

import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
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

export function TrayPopover() {
  const [snapshots, setSnapshots] = useState<ProjectSnapshot[]>([]);
  const [selected, setSelected] = useState<number | "all">("all");
  const [loading, setLoading] = useState(true);
  const [standupState, setStandupState] = useState<"idle" | "busy" | "copied">("idle");

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
    // 팝오버가 다시 열릴 때마다 재조회 (백엔드 show 시점 신호).
    const un = listen("tray-popover-shown", () => void reload());
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

  const todayEntries = useMemo(
    () =>
      visible
        .flatMap((s) => s.entries.map((e) => ({ project: s, entry: e })))
        .sort((a, b) => (a.entry.created_at < b.entry.created_at ? 1 : -1)),
    [visible],
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
  const lastActivity = todayEntries[0]?.entry.created_at ?? null;

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

  return (
    <div className="traypop" data-testid="tray-popover">
      <header className="tp-head">
        <select
          className="tp-project"
          aria-label="프로젝트"
          value={selected === "all" ? "all" : String(selected)}
          onChange={(e) =>
            setSelected(e.target.value === "all" ? "all" : Number(e.target.value))
          }
        >
          <option value="all">전체 프로젝트</option>
          {snapshots.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
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
        {todayEntries.length === 0 ? (
          <div className="tp-empty">
            오늘 아직 기록 없음
            {lastActivity && <span className="tp-dim"> · 마지막 활동 {fmtTime(lastActivity)}</span>}
          </div>
        ) : (
          todayEntries.slice(0, 4).map(({ project, entry }) => (
            <button
              key={`${project.id}:${entry.relative_path}`}
              className="tp-entry-row"
              onClick={() =>
                openMain({
                  view: "journal",
                  project_id: project.id,
                  entry_path: entry.relative_path,
                })
              }
            >
              <span className="tp-time">{fmtTime(entry.created_at)}</span>
              <span className={`tp-type tp-type-${entry.type}`}>
                {TYPE_LABEL[entry.type] ?? entry.type}
              </span>
              <span className="tp-title">{entry.title}</span>
            </button>
          ))
        )}
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
        <button className="tp-action" onClick={() => openMain({ view: "today" })}>
          Today
        </button>
        <button className="tp-action" onClick={() => openMain({ view: "settings" })}>
          설정
        </button>
      </footer>

      {loading && <div className="tp-loading" aria-label="불러오는 중" />}
    </div>
  );
}
