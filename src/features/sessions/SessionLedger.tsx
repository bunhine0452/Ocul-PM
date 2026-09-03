import { TriangleAlert } from "@/components/Icons";
import { useT } from "@/i18n";
import { toast } from "@/lib/toast";
import type { Lease, LedgerIntegrity, Task } from "@/lib/bindings";
import type { SessionBoard } from "./useSessionBoard";

/**
 * 세션이 목록에 오르는 유일한 길 — **스스로 등록하는 것**.
 *
 * 앱은 자기가 띄운 ACP 패널만 대신 등록한다. 사용자가 따로 연 터미널의
 * `claude`·`codex` 는 우리 자식이 아니라서 우리가 알 방법이 없다. 그래서 빈
 * 보드에 "없습니다" 만 적으면 사용자는 기능이 고장 났다고 읽는다 — 왜 안 보이고
 * 무엇을 하면 보이는지를 같은 자리에서 말한다.
 */
const REGISTER_CMD = `oculpm agent_register '{"name":"refactor"}'`;

interface LedgerProps {
  board: SessionBoard;
  waiting: Task[];
  leases: Lease[];
  integrity: LedgerIntegrity[];
  /** 위(급한 것)와 아래(참고) — 한 컴포넌트가 두 자리를 나눠 그린다. */
  place: "top" | "bottom";
}

export function SessionLedger({ board, waiting, leases, integrity, place }: LedgerProps) {
  const { t } = useT();

  if (place === "top") {
    if (!waiting.length && !board.trespasses.length) return null;
    return (
      <div className="card card-pad sess-block">
        {waiting.length ? (
          <>
            <div className="a2a-head">{t("a2a.waiting")}</div>
            <ul className="a2a-list">
              {waiting.map((task) => (
                <li key={task.id}>
                  <strong>{task.title}</strong>
                  <span className="a2a-sub">{t("a2a.from", { who: task.from })}</span>
                  <span className="right">
                    <button
                      type="button"
                      className="btn sm primary"
                      onClick={() => void board.decide(task.id, true)}
                    >
                      {t("a2a.accept")}
                    </button>
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => void board.decide(task.id, false)}
                    >
                      {t("a2a.decline")}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {board.trespasses.length ? (
          <>
            <div className="a2a-head">
              <TriangleAlert size={13} /> {t("a2a.trespass")}
            </div>
            <ul className="a2a-list">
              {board.trespasses.map((hit) => (
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

  // 사슬이 없던 시절의 원장은 **깨진 것이 아니다** — 한 줄로 세어서만 말한다.
  const legacy = integrity.filter((it) => it.status.kind === "unverifiable");
  const broken = integrity.filter((it) => it.status.kind === "broken");

  return (
    <>
      {/* 구역 임대는 **그룹에 매이지 않는다** — 같은 파일은 친하든 아니든
          부딪히므로 팀별로 쪼개지 않고 프로젝트 하나의 목록으로 둔다. */}
      {leases.length ? (
        <div className="card card-pad sess-block">
          <div className="a2a-head">{t("a2a.leases")}</div>
          <ul className="a2a-list">
            {leases.map((lease) => (
              <li key={lease.id}>
                <strong>{lease.holder}</strong>
                <span className="a2a-sub">{lease.patterns.join(" · ")}</span>
                <button
                  type="button"
                  className="btn ghost sm right"
                  onClick={() => void board.release(lease.id)}
                >
                  {t("a2a.release")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {broken.length || legacy.length ? (
        <div className="card card-pad sess-block">
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
        </div>
      ) : null}

      <div className="card card-pad sess-block">
        <div className="a2a-head">{t("sessions.missingTitle")}</div>
        <p className="a2a-desc">{t("sessions.missingDesc")}</p>
        <div className="sess-cmd">
          <code>{REGISTER_CMD}</code>
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              void navigator.clipboard
                ?.writeText(REGISTER_CMD)
                .then(() => toast.info(t("common.copied")));
            }}
          >
            {t("common.copy")}
          </button>
        </div>
      </div>
    </>
  );
}
