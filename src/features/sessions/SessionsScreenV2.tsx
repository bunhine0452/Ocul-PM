import { useCallback, useMemo, useState } from "react";

import { Toolbar } from "@/components/Toolbar";
import { ErrorCard } from "@/components/ErrorCard";
import { RefreshCw } from "@/components/Icons";
import { useT } from "@/i18n";
import { SESSION_DND_MIME, SessionCard } from "./SessionCard";
import { SessionLedger } from "./SessionLedger";
import { useSessionBoard } from "./useSessionBoard";

// 세션 화면 (docs/a2a/00-master-plan.md D8) — 2026-09-04.
//
// **왜 화면이 되었나.** 묶기는 Today 카드 안에 있었다(D4: 화면을 늘리지 않는다).
// 실사용에서 뒤집혔다: 한 프로젝트에 세션 넷이 붙어 서로 다른 일을 하면, 그중
// 둘을 고르는 것은 "오늘 무슨 일이 있었나" 를 훑다 곁눈으로 하는 일이 아니라
// **작정하고 앉아서 하는 일**이다. 카드 한 장 폭에 체크박스 넷을 세운 화면은
// 넷이 서로 어떻게 다른지 말할 자리가 없었고, 그래서 고를 수가 없었다.
//
// **두 단 보드인 이유.** 묶기의 실제 모양은 "왼쪽에서 오른쪽으로 옮기기" 다.
// 목록 하나에 체크박스를 세우면 지금 무엇이 어느 팀인지가 들여쓰기로만 남는다.
//
// **드래그만으로 만들지 않았다.** 끌기는 빠른 길이지 유일한 길이 아니다 —
// 카드마다 체크박스가 있고, 아래 행동 줄에서 대상(새 팀·기존 팀)을 골라 키보드
// 만으로 같은 일을 끝낼 수 있다.
export function SessionsScreenV2({ projectId }: { projectId: number }) {
  const { t } = useT();
  const board = useSessionBoard(projectId);
  const { data, board: model, error, now } = board;

  /** 묶으려고 고른 세션들. 묶는 것은 **사용자의 행동**이지 앱의 추측이 아니다. */
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState("");
  /** 넣을 곳 — `""` 는 새 팀. 드래그로는 레인에 직접 떨구면 된다. */
  const [target, setTarget] = useState("");
  /** 지금 드래그가 올라와 있는 구역 (하이라이트용). */
  const [over, setOver] = useState<string | null>(null);

  const togglePick = useCallback((id: string, on: boolean) => {
    setPicked((prev) => (on ? (prev.includes(id) ? prev : [...prev, id]) : prev.filter((p) => p !== id)));
  }, []);

  const teams = model?.teams ?? [];
  const unbound = model?.unbound ?? [];
  // 고른 대상이 그 사이 풀렸을 수 있다 — 없는 팀을 가리키는 채로 두면 버튼이
  // 눌리는데 아무 일도 안 일어난다. 그런 대상은 「새 팀」으로 접는다.
  const targetTeam = teams.find((lane) => lane.group.id === target);
  const dest = targetTeam ? target : "";
  const canSubmit = dest ? picked.length >= 1 : picked.length >= 2;

  const dropped = (e: React.DragEvent) => {
    const id = e.dataTransfer.getData(SESSION_DND_MIME);
    setOver(null);
    return id || null;
  };
  const allowDrop = (zone: string) => (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(SESSION_DND_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setOver(zone);
  };

  /** 팀에서 빼기 — 어느 팀에 있었는지는 원장이 안다. */
  const detach = useCallback(
    (agentId: string) => {
      const lane = teams.find((l) => l.group.members.includes(agentId));
      if (!lane) return;
      void board.removeMember(lane.group.id, agentId);
    },
    [board, teams],
  );

  const submit = async () => {
    if (!canSubmit) return;
    const ok = dest
      ? await board.addToTeam(dest, picked)
      : await board.bind(name.trim() || t("a2a.groupDefault", { n: teams.length + 1 }), picked);
    // 거절당했으면 고른 것을 그대로 둔다 — 넷 중 둘을 다시 고르게 하지 않는다.
    if (!ok) return;
    if (!dest) setName("");
    setPicked([]);
  };

  const attached = data?.participants.length ?? 0;
  const targetOptions = useMemo(
    () => teams.map((lane) => ({ id: lane.group.id, title: lane.group.title })),
    [teams],
  );

  return (
    <>
      <Toolbar title={t("sessions.title")} sub={t("sessions.attached", { n: attached })}>
        <button type="button" className="btn sm" onClick={board.reload}>
          <RefreshCw size={14} /> {t("sessions.refresh")}
        </button>
      </Toolbar>

      <div className="scroll">
        <div className="page fade-in">
          {error ? <ErrorCard title={t("sessions.title")} error={error} onRetry={board.reload} /> : null}

          <SessionLedger
            board={board}
            waiting={model?.waiting ?? []}
            leases={data?.leases ?? []}
            integrity={data?.integrity ?? []}
            place="top"
          />

          <div className="sess-board">
            {/* 왼쪽 — 묶이지 않은 세션. 여기로 떨어뜨리면 팀에서 빠진다. */}
            <section
              className={"sess-col" + (over === "unbound" ? " over" : "")}
              aria-label={t("sessions.unbound")}
              onDragOver={allowDrop("unbound")}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => {
                const id = dropped(e);
                if (id) detach(id);
              }}
            >
              <div className="sess-col-head">
                <strong>{t("sessions.unbound")}</strong>
                <span className="a2a-sub">{unbound.length}</span>
              </div>
              <p className="a2a-sub sess-col-hint">
                {over === "unbound" ? t("sessions.dropToUnbind") : t("sessions.unboundHint")}
              </p>
              {unbound.map((seat) => (
                <SessionCard
                  key={seat.id}
                  seat={seat}
                  now={now}
                  picked={picked.includes(seat.id)}
                  onPick={(on) => togglePick(seat.id, on)}
                  onAlias={(alias) => board.setAlias(seat.id, alias)}
                />
              ))}
              {/* 비어 있는 이유가 셋이라 문장도 셋이다: 아무도 없다 · 나 혼자다 ·
                  다 묶여 있다. 셋째는 할 말이 없으므로 아무 것도 안 쓴다 —
                  오른쪽 팀 칸이 이미 그 이야기를 하고 있다. */}
              {model && unbound.length === 0 && attached < 2 ? (
                <p className="sess-empty">{attached === 0 ? t("sessions.empty") : t("sessions.alone")}</p>
              ) : null}
            </section>

            {/* 오른쪽 — 사용자가 묶은 팀. 레인에 떨어뜨리면 그 팀에 들어간다. */}
            <section className="sess-col" aria-label={t("sessions.teams")}>
              <div className="sess-col-head">
                <strong>{t("sessions.teams")}</strong>
                <span className="a2a-sub">{teams.length}</span>
              </div>

              {teams.map((lane) => (
                <div
                  key={lane.group.id}
                  className={"sess-lane" + (over === lane.group.id ? " over" : "")}
                  role="group"
                  aria-label={lane.group.title}
                  onDragOver={allowDrop(lane.group.id)}
                  onDragLeave={() => setOver(null)}
                  onDrop={(e) => {
                    const id = dropped(e);
                    if (id) void board.addToTeam(lane.group.id, [id]);
                  }}
                >
                  <div className="sess-lane-head">
                    <strong>{lane.group.title}</strong>
                    {lane.goneCount > 0 ? (
                      <span className="a2a-sub">{t("sessions.attached", { n: lane.members.length })}</span>
                    ) : null}
                    <button
                      type="button"
                      className="btn ghost sm right"
                      onClick={() => void board.dissolve(lane.group.id)}
                    >
                      {t("a2a.unbind")}
                    </button>
                  </div>
                  {lane.members.map((seat) => (
                    <SessionCard
                      key={seat.id}
                      seat={seat}
                      now={now}
                      onRemove={() => detach(seat.id)}
                      removeLabel={
                        lane.members.length > 2 ? t("a2a.removeMember") : t("a2a.unbind")
                      }
                      onAlias={(alias) => board.setAlias(seat.id, alias)}
                    />
                  ))}
                </div>
              ))}

              {/* 새 팀 자리 — 떨어뜨리면 **골라질 뿐** 아직 묶이지 않는다.
                  팀은 둘부터라, 하나를 놓은 순간 묶어 버리면 백엔드가 거절한다. */}
              <div
                className={"sess-lane new" + (over === "new" ? " over" : "")}
                onDragOver={allowDrop("new")}
                onDragLeave={() => setOver(null)}
                onDrop={(e) => {
                  const id = dropped(e);
                  if (!id) return;
                  setTarget("");
                  togglePick(id, true);
                }}
              >
                <strong>{t("sessions.newTeam")}</strong>
                <p className="a2a-sub">{t("sessions.newTeamHint")}</p>
                {picked.length ? (
                  <div className="sess-chips">
                    {picked.map((id) => {
                      const seat = unbound.find((s) => s.id === id);
                      return (
                        <button
                          key={id}
                          type="button"
                          className="sess-chip"
                          onClick={() => togglePick(id, false)}
                        >
                          {seat?.label ?? id} ×
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </section>
          </div>

          {/* 행동 줄 — 드래그 없이도 같은 일을 끝낼 수 있는 길. */}
          <div className="sess-actions" role="group" aria-label={t("sessions.actionsAria")}>
            <span className="sess-count">
              {picked.length ? t("sessions.picked", { n: picked.length }) : t("sessions.pickNone")}
            </span>
            {targetOptions.length ? (
              <select
                className="a2a-name"
                aria-label={t("sessions.target")}
                value={dest}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">{t("sessions.newTeam")}</option>
                {targetOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.title}
                  </option>
                ))}
              </select>
            ) : null}
            {dest ? null : (
              <input
                className="a2a-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("a2a.groupDefault", { n: teams.length + 1 })}
                aria-label={t("a2a.namePlaceholder")}
                maxLength={60}
              />
            )}
            <button type="button" className="btn sm primary" disabled={!canSubmit} onClick={() => void submit()}>
              {targetTeam ? t("sessions.bindTo") : t("a2a.bind", { n: picked.length })}
            </button>
            <span className="a2a-sub">
              {!dest && picked.length === 1 ? t("sessions.needTwo") : t("a2a.bindHint")}
            </span>
          </div>

          <SessionLedger
            board={board}
            waiting={model?.waiting ?? []}
            leases={data?.leases ?? []}
            integrity={data?.integrity ?? []}
            place="bottom"
          />
        </div>
      </div>
    </>
  );
}

export default SessionsScreenV2;
