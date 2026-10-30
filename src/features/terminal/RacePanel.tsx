/**
 * 같은 일을 worktree 여럿에서 — 시작 대화상자 · 터미널 위 레인 띠 · 레인 변경 보기 (Orca 벤치마킹).
 *
 * 띠는 레인이 있을 때만 선다(예외만 보인다). 레인마다 순번 · 안의 Claude 상태 · 변경 크기,
 * 「보기」(그 레인의 diff)와 「이것으로」(원래 폴더에 커밋 전 변경으로 — 변경 화면에서 검토).
 * 「모두 정리」는 세션을 닫고 worktree 와 가지째 지운다.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";

import { toAppError } from "@/api/invoke";
import { raceApi, type RaceLane } from "@/api/race";
import { AppDialog } from "@/components/ui/AppDialog";
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
import { clearRace, refreshRace, startRace, useRace } from "./race";
import { sessionWord } from "./status";
import { subscribeTerms, termsSnapshot } from "./termStore";
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
          <kbd className="kbd">{kbd("⌘↩")}</kbd>
        </div>
        <p className="send-ctx">{t("race.startBody")}</p>
        <textarea
          ref={textRef}
          className="send-text"
          rows={5}
          value={prompt}
          placeholder={t("race.placeholder")}
          aria-label={t("race.placeholder")}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="send-foot">
          <span className="send-target">
            <span>{t("race.count")}</span>
            <span className="seg" role="tablist" aria-label={t("race.count")}>
              {COUNTS.map((n) => (
                <button
                  key={n}
                  type="button"
                  role="tab"
                  aria-selected={count === n}
                  className="seg-item"
                  onClick={() => setCount(n)}
                >
                  {n}
                </button>
              ))}
            </span>
          </span>
          <span className="send-sp" />
          <button type="button" className="btn sm" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn primary sm"
            {...blocked(prompt.trim() ? null : t("race.needsPrompt"))}
            disabled={busy}
            onClick={() => void start()}
          >
            {t("race.start", { n: count })}
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
  const [viewing, setViewing] = useState<{ lane: RaceLane; n: number } | null>(null);
  const [busy, setBusy] = useState(false);

  // 처음, 그리고 세션 상태가 바뀔 때(끝냄 · 기다림) 변경 크기를 다시 잰다 — 잠깐 모아서.
  const statusKey = sessions.map((s) => `${s.id}:${s.status?.state ?? ""}:${s.alive}`).join(",");
  useEffect(() => {
    const h = setTimeout(() => void refreshRace(projectId).catch(() => {}), 600);
    return () => clearTimeout(h);
  }, [projectId, statusKey]);

  if (race.lanes.length === 0) return confirmDialog;
  const recommended = recommendLane(race.lanes);

  const take = async (lane: RaceLane, n: number) => {
    const ok = await confirm({ title: t("race.takeTitle", { n }), message: t("race.takeBody"), confirmLabel: t("race.take") });
    if (!ok) return;
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
    } catch (e) {
      toast.destructive(t("race.takeFailed", { error: tError(toAppError(e)) }));
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
      <div className="tm-race" role="region" aria-label={t("race.title")}>
        <span className="tm-race-head">{t("race.title")}</span>
        <ul className="tm-race-lanes">
          {race.lanes.map((lane, i) => {
            const n = i + 1;
            const sid = race.sessions.get(lane.path);
            const info = sessions.find((s) => s.id === sid) ?? null;
            const empty = lane.files === 0;
            return (
              <li key={lane.path} className="tm-race-lane">
                <span className="tm-race-who">
                <button
                  type="button"
                  className="tm-race-name"
                  title={lane.path}
                  {...blocked(info ? null : t("race.noSession"))}
                  onClick={() => info && requestTermFocus(info.id)}
                >
                  {t("race.lane", { n })}
                </button>
                {lane.path === recommended ? (
                  <span className="chip sm outline" title={t("race.recommendedTitle")}>
                    {t("race.recommended")}
                  </span>
                ) : null}
                </span>
                <span className="tm-race-word">{info ? sessionWord(t, info) : t("race.noSession")}</span>
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
                  className="btn ghost sm"
                  {...blocked(empty ? t("race.noChanges") : null)}
                  onClick={() => setViewing({ lane, n })}
                >
                  {t("race.view")}
                </button>
                <button
                  type="button"
                  className="btn sm"
                  {...blocked(empty ? t("race.noChanges") : null)}
                  disabled={busy}
                  onClick={() => void take(lane, n)}
                >
                  {t("race.take")}
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" className="btn ghost sm" onClick={() => void clear()}>
          {t("race.clear")}
        </button>
      </div>
      {viewing ? <LaneDiffDialog projectId={projectId} {...viewing} onClose={() => setViewing(null)} /> : null}
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

function LaneDiffDialog({ projectId, lane, n, onClose }: { projectId: number; lane: RaceLane; n: number; onClose: () => void }) {
  const { t } = useT();
  const [files, setFiles] = useState<{ file: string; patch: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    raceApi.patch(projectId, lane.path).then(
      (p) => alive && setFiles(splitByFile(p)),
      (e: unknown) => alive && setError(tError(toAppError(e))),
    );
    return () => {
      alive = false;
    };
  }, [projectId, lane.path]);
  return (
    <AppDialog open onClose={onClose} label={t("race.lane", { n })} width={960}>
      <div className="tm-race-diff">
        <div className="send-head">
          <b>
            {t("race.lane", { n })} · {t("race.files", { n: lane.files })} <span className="add">+{lane.added}</span>{" "}
            <span className="del">−{lane.removed}</span>
          </b>
        </div>
        {lane.journals ? (
          <p className="send-ctx">
            {lane.journal_title} <LaneEvidence lane={lane} />
          </p>
        ) : null}
        <div className="tm-race-diff-body diff-code">
          {error ? <p className="send-ctx">{error}</p> : null}
          {files === null && !error ? <p className="send-ctx">{t("race.loading")}</p> : null}
          {files?.map((f) => (
            <section key={f.file}>
              <h3 className="tm-race-file">{f.file}</h3>
              <PatchView patch={f.patch} mode="unified" lang={langFromPath(f.file)} />
            </section>
          ))}
        </div>
      </div>
    </AppDialog>
  );
}
