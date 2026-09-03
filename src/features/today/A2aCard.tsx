import { useCallback, useEffect, useState } from "react";
import { Bot, TriangleAlert } from "@/components/Icons";
import { useT } from "@/i18n";
import { tError } from "@/i18n/errors";
import type { A2aOverview, Liveness } from "@/lib/bindings";
import { oculpmApi } from "@/api/oculpm";
import { toAppError } from "@/api/invoke";
import { agentLabel } from "./agentColor";

// A2A 협업 카드 (docs/a2a/00-master-plan.md §9).
//
// **혼자 일할 때는 보이지 않는다.** 참여자가 하나뿐이고 잡힌 구역도 넘어온
// 작업도 없으면 아무 것도 그리지 않는다 — 대부분의 프로젝트는 끝까지 그
// 상태이고, 거기에 빈 카드를 놓으면 Today 가 쓰지도 않는 기능의 안내판이 된다.
//
// 새 사이드바 항목을 만들지 않은 것도 같은 이유다(D4). 협업 상태는 "오늘 무슨
// 일이 있나"의 일부이지 별도의 목적지가 아니다.
//
// 승인 없이는 아무 것도 시작되지 않는다(D5) — 넘어온 작업은 여기서 사람이
// 수락해야 `working` 으로 간다. 자동 수락은 v1 에 없다.
export function A2aCard({ projectId }: { projectId: number }) {
  const { t } = useT();
  const [data, setData] = useState<A2aOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 묶으려고 고른 세션들. 묶는 것은 **사용자의 행동**이지 앱의 추측이 아니다. */
  const [picked, setPicked] = useState<string[]>([]);
  /** 묶을 때 붙일 이름. 비워 두면 순번이 붙은 기본 이름이 간다. */
  const [name, setName] = useState("");
  /** 이번 세션에 본 침범 경고 (이벤트로만 온다 — 원장에는 남지 않는다). */
  const [trespasses, setTrespasses] = useState<
    { actor: string; path: string; holder: string }[]
  >([]);

  const load = useCallback(() => {
    void oculpmApi
      .a2aOverview(projectId)
      .then(setData)
      .catch((e: unknown) => setError(tError(toAppError(e))));
  }, [projectId]);

  useEffect(() => {
    load();
    // 폴링하지 않는다 — 원장은 앱 밖 프로세스가 쓰고, 워처가 그것을 알린다.
    let offChanged: (() => void) | undefined;
    let offTrespass: (() => void) | undefined;
    void oculpmApi
      .onA2aChanged((payload) => {
        if (payload.project_id === projectId) load();
      })
      .then((off) => {
        offChanged = off;
      });
    void oculpmApi
      .onA2aTrespass(({ project_id, actor, path, holder }) => {
        if (project_id !== projectId) return;
        setTrespasses((prev) =>
          prev.some((p) => p.path === path && p.actor === actor)
            ? prev
            : [...prev, { actor, path, holder }],
        );
      })
      .then((off) => {
        offTrespass = off;
      });
    return () => {
      offChanged?.();
      offTrespass?.();
    };
  }, [projectId, load]);

  if (error) return null;
  if (!data) return null;

  const waiting = data.open_tasks.filter((task) => task.state === "submitted");
  const byId = new Map(data.participants.map((p) => [p.card.agent_id, p]));
  const grouped = new Set(data.groups.flatMap((g) => g.members));
  const unbound = data.participants.filter((p) => !grouped.has(p.card.agent_id));
  // 사슬이 없던 시절의 원장은 **깨진 것이 아니다** — 한 줄로 세어서만 말한다.
  // 끊긴 것만 줄마다 이유를 붙인다.
  const legacy = data.integrity.filter((it) => it.status.kind === "unverifiable");
  const broken = data.integrity.filter((it) => it.status.kind === "broken");
  const quiet =
    data.participants.length <= 1 &&
    data.leases.length === 0 &&
    data.open_tasks.length === 0 &&
    trespasses.length === 0 &&
    broken.length === 0;
  if (quiet) return null;

  const bind = async () => {
    if (picked.length < 2) return;
    try {
      const title = name.trim() || t("a2a.groupDefault", { n: data.groups.length + 1 });
      await oculpmApi.a2aBindGroup(projectId, title, picked);
      setPicked([]);
      setName("");
      load();
    } catch (e) {
      setError(tError(toAppError(e)));
    }
  };

  /** 멤버 하나만 뺀다. **셋 이상일 때만** — 둘에서 하나를 빼면 그건 해체이고,
      그 자리에는 이미 「풀기」가 있다(백엔드도 둘 미만은 거부한다). */
  const drop = async (groupId: string, members: string[], id: string) => {
    try {
      await oculpmApi.a2aSetGroupMembers(
        projectId,
        groupId,
        members.filter((m) => m !== id),
      );
      load();
    } catch (e) {
      setError(tError(toAppError(e)));
    }
  };

  const unbind = async (groupId: string) => {
    try {
      await oculpmApi.a2aDissolveGroup(projectId, groupId);
      load();
    } catch (e) {
      setError(tError(toAppError(e)));
    }
  };

  const decide = async (taskId: string, accept: boolean) => {
    try {
      await oculpmApi.a2aDecideTask(projectId, taskId, accept);
      load();
    } catch (e) {
      setError(tError(toAppError(e)));
    }
  };

  const release = async (leaseId: string) => {
    try {
      await oculpmApi.a2aReleaseLease(projectId, leaseId);
      load();
    } catch {
      load();
    }
  };

  return (
    <div className="card card-pad" role="region" aria-label={t("a2a.title")} style={{ marginBottom: 16 }}>
      <div className="stat-top">
        <Bot size={15} color="var(--accent-text)" />
        <strong>{t("a2a.title")}</strong>
        <span className="a2a-sub right">
          {t("a2a.participants", { n: data.participants.length })}
        </span>
      </div>

      {/* 묶인 팀 — 이 안에서만 말하고 일을 넘긴다. 파일 임대는 그룹과 무관하게
          프로젝트 전체다(같은 파일은 친하든 아니든 부딪힌다). */}
      {data.groups.map((group) => (
        <div className="a2a-group" key={group.id}>
          <div className="a2a-head">
            {group.title}
            <button className="btn ghost sm right" onClick={() => void unbind(group.id)}>
              {t("a2a.unbind")}
            </button>
          </div>
          <ul className="a2a-list" aria-label={group.title}>
            {group.members.map((id) => {
              const seat = byId.get(id);
              return (
                <li key={id}>
                  <strong>{seat ? agentLabel(seat.card.provider) : id}</strong>
                  {seat ? (
                    <>
                      <span className="a2a-sub">{t(`a2a.surface.${seat.card.surface}`)}</span>
                      <UnknownBadge liveness={seat.liveness} />
                    </>
                  ) : null}
                  {group.members.length > 2 ? (
                    <button
                      className="btn ghost sm right"
                      onClick={() => void drop(group.id, group.members, id)}
                    >
                      {t("a2a.removeMember")}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {/* 묶이지 않은 세션 — **보이기만 한다.** 고른 뒤 묶어야 서로 말할 수 있다. */}
      {unbound.length ? (
        <>
          <div className="a2a-head">{t("a2a.unbound")}</div>
          <ul className="a2a-list" aria-label={t("a2a.unbound")}>
            {unbound.map(({ card, liveness }) => (
              <li key={card.agent_id}>
                <label className="a2a-pick">
                  <input
                    type="checkbox"
                    checked={picked.includes(card.agent_id)}
                    onChange={(e) =>
                      setPicked((prev) =>
                        e.target.checked
                          ? [...prev, card.agent_id]
                          : prev.filter((id) => id !== card.agent_id),
                      )
                    }
                  />
                  {/* 어댑터가 준 `name` 은 npm 패키지 이름이라 사람이 읽을 것이
                      못 된다 — 기록에 쓰는 라벨을 앞에 세운다. */}
                  <strong>{agentLabel(card.provider)}</strong>
                  <span className="a2a-sub">{t(`a2a.surface.${card.surface}`)}</span>
                  <span className="a2a-sub a2a-dim">{card.name}</span>
                  <UnknownBadge liveness={liveness} />
                </label>
              </li>
            ))}
          </ul>
          <div className="first-run-actions">
            <input
              className="a2a-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("a2a.groupDefault", { n: data.groups.length + 1 })}
              aria-label={t("a2a.namePlaceholder")}
              maxLength={60}
            />
            <button className="btn sm primary" disabled={picked.length < 2} onClick={() => void bind()}>
              {t("a2a.bind", { n: picked.length })}
            </button>
            <span className="a2a-sub">{t("a2a.bindHint")}</span>
          </div>
        </>
      ) : null}

      {waiting.length ? (
        <>
          <div className="a2a-head">{t("a2a.waiting")}</div>
          <ul className="a2a-list">
            {waiting.map((task) => (
              <li key={task.id}>
                <strong>{task.title}</strong>
                <span className="a2a-sub">{t("a2a.from", { who: task.from })}</span>
                <span className="right">
                  <button className="btn sm primary" onClick={() => void decide(task.id, true)}>
                    {t("a2a.accept")}
                  </button>
                  <button className="btn sm" onClick={() => void decide(task.id, false)}>
                    {t("a2a.decline")}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {data.leases.length ? (
        <>
          <div className="a2a-head">{t("a2a.leases")}</div>
          <ul className="a2a-list">
            {data.leases.map((lease) => (
              <li key={lease.id}>
                <strong>{lease.holder}</strong>
                <span className="a2a-sub">{lease.patterns.join(" · ")}</span>
                <button className="btn ghost sm right" onClick={() => void release(lease.id)}>
                  {t("a2a.release")}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {broken.length || legacy.length ? (
        <>
          <div className="a2a-head">{t("a2a.integrity")}</div>
          <ul className="a2a-list" aria-label={t("a2a.integrity")}>
            {broken.map((it) =>
              it.status.kind === "broken" ? (
                <li key={it.task_id}>
                  <strong>{it.task_id}</strong>
                  <span className="a2a-sub">
                    {t("a2a.integrityBrokenAt", { line: it.status.line })}
                  </span>
                  <span className="a2a-sub">
                    {it.status.reason === "content_changed"
                      ? t("a2a.integrityContentChanged")
                      : it.status.reason === "link_broken"
                        ? t("a2a.integrityLinkBroken")
                        : t("a2a.integrityForked", { from: it.status.forked_from_line ?? 0 })}
                  </span>
                </li>
              ) : null,
            )}
          </ul>
          {legacy.length ? (
            <div className="a2a-sub">{t("a2a.integrityLegacy", { n: legacy.length })}</div>
          ) : null}
          {/* 고치라고 하지 않는다 — 사람이 손으로 고친 것일 수 있다. */}
          <div className="a2a-sub a2a-dim">{t("a2a.integrityLimit")}</div>
        </>
      ) : null}

      {trespasses.length ? (
        <>
          <div className="a2a-head">
            <TriangleAlert size={13} /> {t("a2a.trespass")}
          </div>
          <ul className="a2a-list">
            {trespasses.map((hit) => (
              <li key={`${hit.actor}:${hit.path}`}>
                <strong>{hit.path}</strong>
                <span className="a2a-sub">
                  {t("a2a.trespassBy", { actor: hit.actor, holder: hit.holder })}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

/**
 * 판정 불가 배지 — **오프라인과 같은 색으로 그리지 않는다.**
 *
 * 살아 있다고 확인되지 않은 것과 없어진 것은 다른 사실이고, 화면이 그 둘을 같은
 * 점으로 그리면 사용자가 "없다"고 읽는다 (플랜 `ledger-and-liveness-honesty`).
 * 죽은 참여자는 애초에 목록에 오지 않으므로, 여기서 말할 것은 모름뿐이다.
 */
function UnknownBadge({ liveness }: { liveness: Liveness }) {
  const { t } = useT();
  if (liveness !== "unknown") return null;
  return (
    <span className="a2a-sub a2a-dim" title={t("a2a.unknownLivenessHint")}>
      {t("a2a.unknownLiveness")}
    </span>
  );
}
