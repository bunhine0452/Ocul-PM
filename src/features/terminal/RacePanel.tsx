/**
 * 나란히 돌리기 (같은 일을 worktree 여럿에서) — 시작 대화상자 · 터미널 위 띠 · 시도의 변경 보기 (Orca 벤치마킹).
 *
 * 띠는 시도가 있을 때만 서고, 평소엔 **한 줄로 접힌다** — 「나란히 3 · 기다림 1 · 추천 시도 2 ›」. 늘 펼쳐져 있던
 * 때는 시도 셋이면 약 100px 을 먹었다. 펼치면 시도마다 한 줄: 탭과 같은 점 · 예외 낱말 · 변경 크기 · 검증.
 * 시도 이름을 누르면 그 변경을 보고(「보기」 단추는 걷었다), 「이 변경 가져오기」 는 추천 줄과 변경 보기의 발에만
 * 선다 — 원래 폴더에 커밋 전 변경으로 들어오고 변경 화면에서 검토한다. 「모두 정리」 는 세션을 닫고 worktree
 * 와 가지째 지운다. 내부 이름(race · lane)은 그대로 두고, 사람에게는 「나란히 돌린 시도」 로 말한다.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";

import { toAppError } from "@/api/invoke";
import { raceApi, type RaceLane } from "@/api/race";
import { ChevronLeft, ChevronRight, SquareTerminal } from "@/components/Icons";
import { RadioSeg } from "@/components/RadioSeg";
import { AppDialog, DialogKey } from "@/components/ui/AppDialog";
import { PatchView } from "@/features/diff/PatchView";
import { langFromPath } from "@/features/diff/diffParse";
import { useConfirm } from "@/hooks/useConfirm";
import { useT } from "@/i18n";
import { tError } from "@/i18n/errors";
import { blocked } from "@/lib/blocked";
import { kbd } from "@/lib/kbd";
import { NAV_BUS } from "@/lib/navRegistry";
import { toast } from "@/lib/toast";
import { requestTermFocus } from "./focusRequest";
import { clearRace, refreshRace, setRaceExpanded, startRace, useRace } from "./race";
import { SessionDot, SessionWord } from "./SessionTabs";
import { sessionView, type SessionView } from "./status";
import { hasWorked, subscribeTerms, termsSnapshot } from "./termStore";
import "./race.css";

const COUNTS = [2, 3, 4] as const;
/** `evidence::COMMAND` — 검증 칸에 명령 · 결과가 있다. */
const PROVED = 2;

/**
 * 추천 레인 — 그 안의 Claude 가 검증 칸에 명령 증거를 남긴 레인 가운데 바뀐 줄이 가장 적은 것.
 * Orca 는 diff 를 눈으로 비교한다. 여기서는 증명한 것부터, 같은 일을 더 작게 한 것부터.
 */
export function recommendLane(lanes: readonly RaceLane[]): string | null {
  const proved = lanes.filter((l) => (l.evidence ?? 0) >= PROVED && l.files > 0);
  if (proved.length === 0) return null;
  return proved.reduce((best, l) => (l.added + l.removed < best.added + best.removed ? l : best)).path;
}

export function RaceStartDialog({ projectId, onClose }: { projectId: number; onClose: () => void }) {
  const { t } = useT();
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState<number>(3);
  const [busy, setBusy] = useState(false);
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  const start = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    try {
      const first = await startRace(projectId, prompt.trim(), count);
      if (first != null) requestTermFocus(first);
      onClose();
    } catch (e) {
      toast.destructive(t("race.startFailed", { error: tError(toAppError(e)) }));
    } finally {
      setBusy(false);
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void start();
    }
  };

  return (
    <AppDialog open onClose={onClose} label={t("race.startTitle")} width={520} initialFocusRef={textRef}>
      <div className="send">
        <div className="send-head">
          <b>{t("race.startTitle")}</b>
        </div>
        <p className="send-ctx">{t("race.startBody")}</p>
        <textarea
          ref={textRef}
          className="send-text"
          rows={5}
          value={prompt}
          placeholder={t("race.placeholder")}
          aria-label={t("race.placeholder")}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="send-foot">
          <span className="send-target">
            <span>{t("race.count")}</span>
            {/* 여럿 중 하나 — 앱의 라디오 묶음 한 벌(11-15 RC-19). 딸린 패널 없는 탭(role=tab)이라 화면 읽기에 거짓말을 했다. */}
            <RadioSeg
              label={t("race.count")}
              value={String(count)}
              options={COUNTS.map((n) => ({ id: String(n), label: n }))}
              onChange={(v) => setCount(Number(v))}
            />
          </span>
          <span className="send-sp" />
          {/* 발은 대화상자 한 벌의 약속(11-15 RC-10) — 취소 = 테 없는 단추 + Esc, 시작 = 채운 단추 + ⌘↩. */}
          <button type="button" className="btn ghost sm" onClick={onClose}>
            {t("common.cancel")}
            <DialogKey>Esc</DialogKey>
          </button>
          <button
            type="button"
            className="btn primary sm"
            aria-keyshortcuts="Meta+Enter Control+Enter"
            {...blocked(prompt.trim() ? null : t("race.needsPrompt"))}
            disabled={busy}
            onClick={() => void start()}
          >
            {t("race.start", { n: count })}
            <DialogKey>{kbd("⌘↩")}</DialogKey>
          </button>
        </div>
      </div>
    </AppDialog>
  );
}

export function RaceStrip({ projectId }: { projectId: number }) {
  const { t } = useT();
  const race = useRace();
  const sessions = useSyncExternalStore(subscribeTerms, termsSnapshot);
  const { confirm, confirmDialog } = useConfirm();
  const [viewing, setViewing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const hasLanes = race.lanes.length > 0;

  // 시도가 있으면 세션 상태가 바뀔 때마다(끝냄 · 기다림) 변경 크기를 다시 잰다 — 잠깐 모아서. 없으면 화면에
  // 들어올 때 한 번뿐 — 시도를 안 쓰는 사람에게 상태가 바뀔 때마다 `git worktree list` 를 띄우던 것.
  const statusKey = hasLanes ? sessions.map((s) => `${s.id}:${s.status?.state ?? ""}:${s.alive}`).join(",") : "";
  useEffect(() => {
    const h = setTimeout(() => void refreshRace(projectId).catch(() => {}), 600);
    return () => clearTimeout(h);
  }, [projectId, statusKey, hasLanes]);

  if (!hasLanes) return confirmDialog;
  const recommended = recommendLane(race.lanes);
  const infoOf = (lane: RaceLane) => {
    const sid = race.sessions.get(lane.path);
    return sessions.find((s) => s.id === sid) ?? null;
  };
  const viewOf = (lane: RaceLane): SessionView | null => {
    const info = infoOf(lane);
    return info ? sessionView(t, info, hasWorked(info.id), lane.journals ?? 0) : null;
  };
  const waiting = race.lanes.filter((l) => viewOf(l)?.mark === "wait").length;
  const pickAt = race.lanes.findIndex((l) => l.path === recommended);

  const take = async (lane: RaceLane, n: number): Promise<boolean> => {
    const ok = await confirm({ title: t("race.takeTitle", { n }), message: t("race.takeBody"), confirmLabel: t("race.take") });
    if (!ok) return false;
    setBusy(true);
    try {
      await raceApi.take(projectId, lane.path);
      toast.info(t("race.taken", { n }), {
        actions: [
          {
            label: t("race.openDiff"),
            onClick: () => window.dispatchEvent(new CustomEvent(NAV_BUS.setView, { detail: "diff" })),
          },
        ],
      });
      return true;
    } catch (e) {
      toast.destructive(t("race.takeFailed", { error: tError(toAppError(e)) }));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    const ok = await confirm({
      title: t("race.clearTitle", { n: race.lanes.length }),
      message: t("race.clearBody"),
      confirmLabel: t("race.clear"),
      danger: true,
    });
    if (!ok) return;
    try {
      await clearRace(projectId);
    } catch (e) {
      toast.destructive(t("race.clearFailed", { error: tError(toAppError(e)) }));
    }
  };

  return (
    <>
      <div className={"tm-race" + (race.expanded ? " is-open" : "")} role="region" aria-label={t("race.title")}>
        <div className="tm-race-bar">
          <button
            type="button"
            className="tm-race-sum"
            aria-expanded={race.expanded}
            title={t("race.buttonTitle")}
            onClick={() => setRaceExpanded(!race.expanded)}
          >
            <span className="tm-race-head">{t("race.summary", { n: race.lanes.length })}</span>
            {waiting > 0 ? <span className="tm-race-wait">{t("race.summaryWaiting", { n: waiting })}</span> : null}
            {pickAt >= 0 ? <span>{t("race.summaryPick", { n: pickAt + 1 })}</span> : null}
            <ChevronRight className="tm-race-chev" size={13} aria-hidden="true" />
          </button>
          <span className="tm-race-sp" />
          {race.expanded ? (
            <button type="button" className="btn ghost sm" onClick={() => void clear()}>
              {t("race.clear")}
            </button>
          ) : null}
        </div>
        {race.expanded ? (
          <ul className="tm-race-lanes">
            {race.lanes.map((lane, i) => {
              const n = i + 1;
              const info = infoOf(lane);
              const view = viewOf(lane);
              const empty = lane.files === 0;
              return (
                <li key={lane.path} className="tm-race-lane">
                  <span className="tm-race-who">
                    {view ? <SessionDot view={view} /> : <span className="tm-dot is-none" aria-hidden="true" />}
                    <button
                      type="button"
                      className="tm-race-name"
                      {...blocked(empty ? t("race.noChanges") : null, t("race.viewTitle", { path: lane.path }))}
                      onClick={() => setViewing(i)}
                    >
                      {t("race.lane", { n })}
                    </button>
                    {lane.path === recommended ? (
                      <span className="chip sm hairline" title={t("race.recommendedTitle")}>
                        {t("race.recommended")}
                      </span>
                    ) : null}
                  </span>
                  <span className="tm-race-word">
                    {view ? <SessionWord view={view} /> : <span className="tm-race-muted">{t("race.noSession")}</span>}
                  </span>
                  <span className="tm-race-size">
                    {empty ? (
                      t("race.noChanges")
                    ) : (
                      <>
                        {t("race.files", { n: lane.files })} <span className="add">+{lane.added}</span>{" "}
                        <span className="del">−{lane.removed}</span>
                      </>
                    )}
                  </span>
                  <LaneEvidence lane={lane} />
                  <button
                    type="button"
                    className="iconbtn sm"
                    aria-label={t("race.focusSession", { n })}
                    {...blocked(info ? null : t("race.noSession"), t("race.focusSession", { n }))}
                    onClick={() => info && requestTermFocus(info.id)}
                  >
                    <SquareTerminal size={13} aria-hidden="true" />
                  </button>
                  {lane.path === recommended ? (
                    <button type="button" className="btn sm" disabled={busy} onClick={() => void take(lane, n)}>
                      {t("race.take")}
                    </button>
                  ) : (
                    <span aria-hidden="true" />
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
      {viewing != null && race.lanes[viewing] ? (
        <LaneDiffDialog
          projectId={projectId}
          lanes={race.lanes}
          at={viewing}
          busy={busy}
          onMove={setViewing}
          onTake={(lane, n) => void take(lane, n).then((ok) => ok && setViewing(null))}
          onClose={() => setViewing(null)}
        />
      ) : null}
      {confirmDialog}
    </>
  );
}

/** git 의 확장 머리줄 — diff 파서가 코드 줄로 그리지 않게 뺀다(`index`·`---`·`+++` 는 파서가 안다). */
const EXT_HEADER = /^(new file mode|deleted file mode|old mode|new mode|similarity index|dissimilarity index|rename from|rename to|copy from|copy to) /;

/** 레인 안의 Claude 가 남긴 것 — 증거 등급 칩 · 검증 칸의 끝 줄(제목은 가리키면). 일지가 없으면 그 말. */
function LaneEvidence({ lane }: { lane: RaceLane }) {
  const { t } = useT();
  if (!lane.journals) return <span className="tm-race-ev tm-race-muted">{t("race.noJournal")}</span>;
  const level = lane.evidence ?? 0;
  return (
    <span className="tm-race-ev" title={lane.journal_title ?? undefined}>
      <span className={"chip sm " + (level >= PROVED ? "ok" : "warn")}>
        {level >= PROVED
          ? t("journal.verify.hasCommand")
          : level === 1
            ? t("journal.verify.noCommand")
            : t("journal.evidence.missing")}
      </span>
      <span className="tm-race-proof mono">{lane.proof ?? lane.journal_title ?? ""}</span>
    </span>
  );
}

/** 여러 파일 diff → 파일마다 한 장. 끝의 빈 줄도 뺀다(빈 문맥 줄로 그려진다). */
export function splitByFile(patch: string): { file: string; patch: string }[] {
  return patch
    .split(/^(?=diff --git )/m)
    .filter((part) => part.startsWith("diff --git "))
    .map((part) => ({
      file: /^diff --git a\/.+? b\/(.+)$/m.exec(part)?.[1] ?? "?",
      patch: part
        .split("\n")
        .filter((line) => !EXT_HEADER.test(line))
        .join("\n")
        .replace(/\n+$/, ""),
    }));
}

/**
 * 시도 하나의 변경 — 머리에 ‹ 앞 시도 · 다음 시도 › 와 닫기, 발에 닫기 · 「이 변경 가져오기」. 예전 대화상자에는
 * 닫기도 가져오기도 없어 Esc 로 나가 띠에서 다시 골라야 했다.
 */
function LaneDiffDialog({
  projectId,
  lanes,
  at,
  busy,
  onMove,
  onTake,
  onClose,
}: {
  projectId: number;
  lanes: readonly RaceLane[];
  at: number;
  busy: boolean;
  onMove: (at: number) => void;
  onTake: (lane: RaceLane, n: number) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const lane = lanes[at];
  const n = at + 1;
  const [files, setFiles] = useState<{ file: string; patch: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setFiles(null);
    setError(null);
    raceApi.patch(projectId, lane.path).then(
      (p) => alive && setFiles(splitByFile(p)),
      (e: unknown) => alive && setError(tError(toAppError(e))),
    );
    return () => {
      alive = false;
    };
  }, [projectId, lane.path]);
  const empty = lane.files === 0;
  return (
    <AppDialog open onClose={onClose} label={t("race.lane", { n })} width={960}>
      <div className="tm-race-diff">
        <div className="tm-race-diff-head">
          <button
            type="button"
            className="btn ghost sm"
            {...blocked(at > 0 ? null : t("race.noPrev"))}
            onClick={() => onMove(at - 1)}
          >
            <ChevronLeft size={13} aria-hidden="true" />
            {at > 0 ? t("race.lane", { n: at }) : null}
          </button>
          <b className="tm-race-diff-title">
            {t("race.lane", { n })} · {t("race.files", { n: lane.files })} <span className="add">+{lane.added}</span>{" "}
            <span className="del">−{lane.removed}</span>
          </b>
          <button
            type="button"
            className="btn ghost sm"
            {...blocked(at < lanes.length - 1 ? null : t("race.noNext"))}
            onClick={() => onMove(at + 1)}
          >
            {at < lanes.length - 1 ? t("race.lane", { n: n + 1 }) : null}
            <ChevronRight size={13} aria-hidden="true" />
          </button>
        </div>
        {lane.journals ? (
          <p className="send-ctx">
            {lane.journal_title} <LaneEvidence lane={lane} />
          </p>
        ) : null}
        <div className="tm-race-diff-body diff-code">
          {error ? <p className="send-ctx">{error}</p> : null}
          {empty ? <p className="send-ctx">{t("race.noChanges")}</p> : null}
          {files === null && !error && !empty ? <p className="send-ctx">{t("race.loading")}</p> : null}
          {files?.map((f) => (
            <section key={f.file}>
              <h3 className="tm-race-file">{f.file}</h3>
              <PatchView patch={f.patch} mode="unified" lang={langFromPath(f.file)} />
            </section>
          ))}
        </div>
        {/* 닫는 길은 발의 「닫기 Esc」 하나 — 머리의 × 와 둘이면 어느 쪽이 기본인지 흐려진다(RC-10). */}
        <div className="send-foot">
          <span className="send-sp" />
          <button type="button" className="btn ghost sm" onClick={onClose}>
            {t("common.close")}
            <DialogKey>Esc</DialogKey>
          </button>
          <button
            type="button"
            className="btn primary sm"
            {...blocked(empty ? t("race.noChanges") : null)}
            disabled={busy}
            onClick={() => onTake(lane, n)}
          >
            {t("race.take")}
          </button>
        </div>
      </div>
    </AppDialog>
  );
}
