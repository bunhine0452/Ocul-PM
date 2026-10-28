import { useEffect, useState } from "react";

import { oculpmApi } from "@/api/oculpm";
import { CheckMark, ShieldCheck } from "@/components/Icons";
import { verificationLines } from "@/features/oculpm/EvidenceCard";
import { useT } from "@/i18n";
import type { ChangeGroup } from "@/lib/bindings";
import { toast } from "@/lib/toast";

/**
 * 변경 화면의 바닥줄 — 「이 일지의 검증: 명령 · 결과 끝 줄」 + 확인 명령 복사 + 사람 확인 (시안 Diff).
 *
 * 지금 보는 파일을 적은 일지의 검증 칸 첫 줄을 그대로 보인다. 일지가 말한 것과 실제로 바뀐
 * 것을 한 화면에서 붙여 보는 자리라, 「믿을 수 있나」의 근거가 diff 옆에 서야 한다.
 * 일지에 없는 파일(미추적 묶음)에는 그리지 않는다 — 없는 근거를 꾸미지 않는다.
 */
export function DiffEntryFooter({
  projectId,
  group,
  onToggleVerified,
}: {
  projectId: number;
  group: ChangeGroup;
  onToggleVerified: (relativePath: string, next: boolean) => void;
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
    void navigator.clipboard?.writeText(first).then(() => toast.info(t("plan.copiedCheck")));
  };
  return (
    <div className="diff-entry-foot" data-evidence={first ? "on" : lines ? "off" : "pending"}>
      <ShieldCheck size={13} aria-hidden="true" />
      <span className="def-label">{t("diff.entryVerify")}</span>
      <span className="def-line mono">{first ?? (lines ? t("diff.entryVerifyNone") : "…")}</span>
      <span className="def-fill" />
      {first ? (
        <button type="button" className="btn sm" onClick={copy}>
          {t("plan.copyCheck")}
        </button>
      ) : null}
      <button
        type="button"
        className={"btn sm" + (verified ? " ok" : "")}
        aria-pressed={verified}
        onClick={() => onToggleVerified(path, !verified)}
        title={verified ? t("entry.unverifyTitle") : t("entry.verifyTitle")}
      >
        <CheckMark size={13} /> {verified ? t("entry.verified") : t("entry.verify")}
      </button>
    </div>
  );
}
