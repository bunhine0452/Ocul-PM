import { useEffect, useState } from "react";

import { oculpmApi } from "@/api/oculpm";
import { CheckMark, ShieldCheck } from "@/components/Icons";
import { MachineText, machineParts, machinePlain, splitParts } from "@/components/MachineText";
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
 * 읽음 단추의 이름은 일지 상세와 같은 낱말(`entry.verify`)이고, 설명은 키 표기 없이 따로 둔다 — 일지
 * 상세의 설명은 「(v)」 를 알리는데, 이 화면의 v 는 파일의 「봤음」 이다(알린 키 = 듣는 키).
 * 검증 줄은 본문 서체에 명령 · 결과 토큰만 기계 글씨다(`MachineText`, 11-15 V-08) — 줄 전체가 mono 이던 때
 * 에이전트가 쓴 한국어가 고정폭 대체 글꼴로 띄엄띄엄 놓였다.
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
        // 백틱을 남긴 줄 — 그릴 때 코드 조각을 기계 글씨로 읽는다.
        if (!cancelled) setLines(verificationLines(d?.body_markdown ?? "", 8, true));
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
  const raw = lines?.[0] ?? null;
  // 툴팁 · 복사는 글자만(백틱 · `**` 를 벗긴 것). 줄이는 자리는 그 글자 기준이다.
  const first = raw != null ? machinePlain(raw) : null;
  const copy = () => {
    if (!first) return;
    void navigator.clipboard?.writeText(first).then(() => toast.info(t("diff.copiedVerify")));
  };
  const [head, tail] = raw != null && first ? splitParts(machineParts(raw), splitTail(first)[0].length) : [[], []];
  return (
    <div className="diff-entry-foot" data-evidence={first ? "on" : lines ? "off" : "pending"}>
      <ShieldCheck size={13} aria-hidden="true" />
      <span className="def-label">{t("diff.entryVerify")}</span>
      <span className="def-line" title={first ?? undefined}>
        {first ? (
          <>
            <span className="def-head">
              <MachineText parts={head} />
            </span>
            <span className="def-tail">
              <MachineText parts={tail} />
            </span>
          </>
        ) : lines ? (
          t("diff.entryVerifyNone")
        ) : (
          "…"
        )}
      </span>
      {/* 동작 묶음 — 좁으면 통째로 다음 줄 오른쪽으로 꺾인다(검증 줄이 0 폭으로 눌리고 단추가 칸 밖으로 잘렸다). */}
      <span className="def-act">
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
          title={verified ? t("diff.unmarkReadTitle") : t("diff.markReadTitle")}
        >
          {verified ? <CheckMark size={13} aria-hidden="true" /> : null}
          {verified ? t("entry.verified") : t("entry.verify")}
        </button>
      </span>
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
