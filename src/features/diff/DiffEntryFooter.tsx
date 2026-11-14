import { useEffect, useState } from "react";

import { oculpmApi } from "@/api/oculpm";
import { CheckMark, ShieldCheck } from "@/components/Icons";
import { verificationLines } from "@/features/oculpm/verification";
import { useT } from "@/i18n";
import type { ChangeGroup } from "@/lib/bindings";
import { toast } from "@/lib/toast";

/**
 * 변경 화면의 바닥줄 — 「이 일지의 검증: 명령 · 결과 끝 줄」 + 검증 줄 복사 + 읽음 (시안 Diff).
 *
 * 지금 보는 파일을 적은 일지의 검증 칸 첫 줄을 그대로 보인다. 일지가 말한 것과 실제로 바뀐
 * 것을 한 화면에서 붙여 보는 자리라, 「믿을 수 있나」의 근거가 diff 옆에 서야 한다.
 * 일지에 없는 파일(미추적 묶음)에는 그리지 않는다 — 없는 근거를 꾸미지 않는다.
 *
 * 11-15 (#diff-receipt): 검증 줄은 **끝(결과)을 남기고 가운데를 줄인다** — 끝에서 자르던 때 결과가 안
 * 보였다. 전문은 title. ✓ 는 누른 뒤에만 선다(누르기 전부터 ✓ 가 서 있었다).
 */
export function DiffEntryFooter({
  projectId,
  group,
  onToggleVerified,
  onOpenEntry,
}: {
  projectId: number;
  group: ChangeGroup;
  onToggleVerified: (relativePath: string, next: boolean) => void;
  /** 일지 화면으로 — 이 묶음의 일지를 연다. */
  onOpenEntry?: (relativePath: string) => void;
}) {
  const { t } = useT();
  const path = group.entry_path;
  const [lines, setLines] = useState<string[] | null>(null);
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setLines(null);
    void Promise.resolve()
      .then(() => oculpmApi.getJournalEntry(projectId, path))
      .then((d) => {
        if (!cancelled) setLines(verificationLines(d?.body_markdown ?? ""));
      })
      .catch(() => {
        if (!cancelled) setLines([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, path]);
  if (!path) return null;
  const verified = (group.verified_by_user ?? false) && !group.verified_stale;
  const first = lines?.[0] ?? null;
  const copy = () => {
    if (!first) return;
    void navigator.clipboard?.writeText(first).then(() => toast.info(t("diff.copiedVerify")));
  };
  const [head, tail] = first ? splitTail(first) : ["", ""];
  return (
    <div className="diff-entry-foot" data-evidence={first ? "on" : lines ? "off" : "pending"}>
      <ShieldCheck size={13} aria-hidden="true" />
      <span className="def-label">{t("diff.entryVerify")}</span>
      <span className="def-line mono" title={first ?? undefined}>
        {first ? (
          <>
            <span className="def-head">{head}</span>
            <span className="def-tail">{tail}</span>
          </>
        ) : lines ? (
          t("diff.entryVerifyNone")
        ) : (
          "…"
        )}
      </span>
      <span className="def-fill" />
      {onOpenEntry ? (
        <button type="button" className="btn ghost sm" onClick={() => onOpenEntry(path)}>
          {t("diff.openEntry")}
        </button>
      ) : null}
      {first ? (
        <button type="button" className="btn sm" onClick={copy}>
          {t("diff.copyVerify")}
        </button>
      ) : null}
      <button
        type="button"
        className="btn sm"
        aria-pressed={verified}
        onClick={() => onToggleVerified(path, !verified)}
        title={verified ? t("entry.unverifyTitle") : t("entry.verifyTitle")}
      >
        {verified ? <CheckMark size={13} aria-hidden="true" /> : null}
        {verified ? t("entry.verified") : t("diff.markRead")}
      </button>
    </div>
  );
}

/**
 * 검증 줄을 앞 · 끝 두 조각으로 — 줄일 때 앞 조각만 줄어 끝(결과)이 남는다. 끝은 마지막 「 · 」 · 「 → 」
 * 뒤(결과 끝 줄의 관례), 없으면 마지막 28자.
 */
export function splitTail(line: string): [string, string] {
  const cut = Math.max(line.lastIndexOf(" · "), line.lastIndexOf(" → "));
  const at = cut > 0 && line.length - cut <= 60 ? cut : Math.max(0, line.length - 28);
  return [line.slice(0, at), line.slice(at)];
}
