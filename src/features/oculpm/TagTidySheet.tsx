import { useCallback, useEffect, useMemo, useState } from "react";
import { AppDialog } from "@/components/ui/AppDialog";
import { LoadingState } from "@/components/LoadingState";
import { Tag, TriangleAlert } from "@/components/Icons";
import { oculpmApi } from "@/api/oculpm";
import { toast } from "@/lib/toast";
import { blocked } from "@/lib/blocked";
import { useT, type I18nKey } from "@/i18n";
import type { TagMergeSkip, TagStat } from "@/lib/bindings";

// 「태그 정리」 — 일지 화면의 부록 하나 ({#tag-merge}).
//
// 왜 있는가: 이 저장소(2026-09-21)는 일지 727건에 태그 806종, 그중 437종이
// 1회용이다. 태그 필터는 "누르면 1건 나오는 버튼 437개"가 됐다. 어휘가 갈라진
// 것은 기록이 아니라 **말버릇**의 문제라, 새 일지는 `journal_write` 가
// 정규화·힌트로 막고(그건 앞으로의 문제다) 이미 쌓인 것은 사람이 여기서 모은다.
//
// 화면의 약속 셋:
//  1. **근거 없는 제안은 안 띄운다.** `suggest_into` 는 백엔드의 결정적 판정
//     (단복수·편집거리 1·접두 분리)이고, 못 대면 `null` 로 온다.
//  2. **누르기 전에는 아무것도 안 바뀐다.** 제안은 목록일 뿐이고, 병합은
//     인라인 확인을 한 번 더 받는다 — 되돌리기가 없다.
//  3. **건너뛴 파일은 이름을 댄다.** 잠긴 일지 한 건 때문에 나머지를 되돌리지
//     않고, 무엇이 안 됐는지는 끝나고 목록으로 보여 준다.
//
// 별도 파일인 이유: `JournalScreenV2.tsx` 는 753줄이고 크기 래칫이 지켜보는
// 파일이다. 부록은 부록 파일이 갖는다.

interface TagTidySheetProps {
  projectId: number;
  open: boolean;
  onClose: () => void;
  /** 한 번이라도 병합이 일어났다 — 타임라인의 태그 칩을 다시 읽는다. */
  onMerged: () => void;
}

/**
 * 백엔드가 준 사유 **토큰** → 사전 키. 백엔드가 문장을 만들면 영어 모드에서
 * 그대로 새어 나오므로, 문장은 언제나 여기서 붙는다. 모르는 토큰은 토큰
 * 그대로 보여 준다 — 「알 수 없는 이유」보다 낫다.
 */
const SKIP_REASON_KEY: Record<string, I18nKey> = {
  unchanged: "journal.tags.skip.unchanged",
  locked: "journal.tags.skip.locked",
  unreadable: "journal.tags.skip.unreadable",
  "broken-frontmatter": "journal.tags.skip.brokenFrontmatter",
  "write-failed": "journal.tags.skip.writeFailed",
  "invalid-path": "journal.tags.skip.invalidPath",
};

/** 제안 하나를 접은 것 — 「이 말로 모을 후보들」. */
interface SuggestGroup {
  into: string;
  from: TagStat[];
  /** 옮겨질 일지 건수의 합 (중복 일지는 겹쳐 셀 수 있다 — 상한 표시다). */
  entries: number;
}

export function TagTidySheet({ projectId, open, onClose, onMerged }: TagTidySheetProps) {
  const { t } = useT();
  const [stats, setStats] = useState<TagStat[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [target, setTarget] = useState<string | null>(null);
  /** 인라인 확인 중인 대상 — `null` 이면 확인 단계가 아니다. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [skipped, setSkipped] = useState<TagMergeSkip[]>([]);

  const load = useCallback(() => {
    setStats(null);
    setError(null);
    oculpmApi
      .tagStats(projectId)
      .then(setStats)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [projectId]);

  useEffect(() => {
    if (!open) return;
    setSelected([]);
    setTarget(null);
    setConfirming(null);
    setSkipped([]);
    load();
  }, [open, load]);

  const groups = useMemo<SuggestGroup[]>(() => {
    if (!stats) return [];
    const byTarget = new Map<string, TagStat[]>();
    for (const s of stats) {
      if (!s.suggest_into) continue;
      const list = byTarget.get(s.suggest_into) ?? [];
      list.push(s);
      byTarget.set(s.suggest_into, list);
    }
    return [...byTarget.entries()]
      .map(([into, from]) => ({
        into,
        from,
        entries: from.reduce((n, s) => n + s.count, 0),
      }))
      .sort((a, b) => b.entries - a.entries || a.into.localeCompare(b.into));
  }, [stats]);

  const onceCount = useMemo(() => (stats ?? []).filter((s) => s.count === 1).length, [stats]);

  const run = useCallback(
    async (from: string[], into: string) => {
      setBusy(true);
      setConfirming(null);
      try {
        const report = await oculpmApi.tagMerge(projectId, from, into);
        setSkipped(report.skipped);
        toast.info(
          report.skipped.length > 0
            ? t("journal.tags.mergedWithSkips", {
                n: report.rewritten,
                s: report.skipped.length,
              })
            : t("journal.tags.merged", { n: report.rewritten }),
        );
        setSelected([]);
        setTarget(null);
        if (report.rewritten > 0) onMerged();
        load();
      } catch (e: unknown) {
        toast.destructive(e instanceof Error ? e.message : t("journal.tags.mergeFailed"));
      } finally {
        setBusy(false);
      }
    },
    [projectId, onMerged, load, t],
  );

  const toggle = (tag: string) =>
    setSelected((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]));

  const manualFrom = selected.filter((s) => s !== target);
  const manualKey = "__manual__";

  return (
    <AppDialog open={open} onClose={onClose} label={t("journal.tags.tidyLabel")} width={620}>
      <div className="sk-modal-head">
        <Tag size={15} /> {t("journal.tags.tidyTitle")}
        <span className="sk-modal-sub">
          {stats
            ? t("journal.tags.summary", { n: stats.length, m: onceCount })
            : t("common.loading")}
        </span>
      </div>

      <div className="tt-body">
        {error ? (
          <p className="tt-empty">{t("journal.tags.loadFailed")}</p>
        ) : !stats ? (
          <LoadingState density="compact" />
        ) : stats.length === 0 ? (
          <p className="tt-empty">{t("journal.tags.empty")}</p>
        ) : (
          <>
            <h4 className="tt-h">{t("journal.tags.suggestHeading")}</h4>
            {groups.length === 0 ? (
              <p className="tt-empty">{t("journal.tags.suggestEmpty")}</p>
            ) : (
              <ul className="tt-groups">
                {groups.map((g) => (
                  <li key={g.into} className="tt-group">
                    <div className="tt-group-main">
                      <span className="tt-from">{g.from.map((s) => s.tag).join(", ")}</span>
                      <span className="tt-arrow" aria-hidden="true">
                        →
                      </span>
                      <code className="tt-into">{g.into}</code>
                      <span className="tt-sub">{t("journal.tags.count", { n: g.entries })}</span>
                    </div>
                    {confirming === g.into ? (
                      <div className="tt-confirm">
                        <TriangleAlert size={13} />
                        <span>{t("journal.tags.confirm", { n: g.entries })}</span>
                        <button
                          type="button"
                          className="btn danger sm"
                          disabled={busy}
                          onClick={() => void run(g.from.map((s) => s.tag), g.into)}
                        >
                          {t("journal.tags.confirmYes")}
                        </button>
                        <button
                          type="button"
                          className="btn ghost sm"
                          onClick={() => setConfirming(null)}
                        >
                          {t("common.cancel")}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="btn sm"
                        disabled={busy}
                        onClick={() => setConfirming(g.into)}
                      >
                        {t("journal.tags.merge")}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <h4 className="tt-h">{t("journal.tags.allHeading")}</h4>
            <ul className="tt-list">
              {stats.map((s) => (
                <li key={s.tag} className="tt-row">
                  <label className="tt-pick">
                    <input
                      type="checkbox"
                      checked={selected.includes(s.tag)}
                      onChange={() => toggle(s.tag)}
                      aria-label={s.tag}
                    />
                    <code className={"tt-tag" + (target === s.tag ? " on" : "")}>{s.tag}</code>
                  </label>
                  <span className="tt-sub">{t("journal.tags.count", { n: s.count })}</span>
                  {s.count === 1 ? <span className="tt-once">{t("journal.tags.once")}</span> : null}
                  <span className="tt-spacer" />
                  <button
                    type="button"
                    className={"scope-chip" + (target === s.tag ? " on" : "")}
                    onClick={() => setTarget(target === s.tag ? null : s.tag)}
                  >
                    {t("journal.tags.setTarget")}
                  </button>
                </li>
              ))}
            </ul>

            {skipped.length > 0 ? (
              <>
                <h4 className="tt-h">{t("journal.tags.skippedHeading")}</h4>
                <ul className="tt-list">
                  {skipped.map((s) => (
                    <li key={s.path} className="tt-row">
                      <code className="tt-tag">{s.path}</code>
                      <span className="tt-sub">
                        {SKIP_REASON_KEY[s.reason] ? t(SKIP_REASON_KEY[s.reason]) : s.reason}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </>
        )}
      </div>

      <div className="sk-modal-foot tt-foot">
        <span className="tt-foot-note">
          {target
            ? t("journal.tags.targetIs", { tag: target, n: manualFrom.length })
            : t("journal.tags.pickTarget")}
        </span>
        {confirming === manualKey && target ? (
          <>
            <button
              type="button"
              className="btn danger sm"
              disabled={busy}
              onClick={() => void run(manualFrom, target)}
            >
              {t("journal.tags.confirmYes")}
            </button>
            <button type="button" className="btn ghost sm" onClick={() => setConfirming(null)}>
              {t("common.cancel")}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn ghost sm" onClick={onClose}>
              {t("common.close")}
            </button>
            <button
              type="button"
              className="btn primary sm"
              disabled={busy}
              {...blocked(
                !target
                  ? t("journal.tags.pickTarget")
                  : manualFrom.length === 0
                    ? t("journal.tags.pickSources")
                    : null,
                t("journal.tags.merge"),
              )}
              onClick={() => setConfirming(manualKey)}
            >
              {t("journal.tags.merge")}
            </button>
          </>
        )}
      </div>
    </AppDialog>
  );
}
