import { Clipboard, GitCompareArrows, Link2 } from "@/components/Icons";
import { useT } from "@/i18n";
import { toast } from "@/lib/toast";

/**
 * 일지 상세의 「다음은」 — 제목 → 증거 → 다음, 세 질문 한 순서 (시안 Journal-Detail).
 *
 * 읽고 나서 손이 갈 곳을 한 줄에: 변경 N파일 보기 · 관련 일지 N · /oculpm:redteam 복사.
 * 새 자료는 없다 — 전부 이 화면이 이미 아는 것이고, 자리만 머리글 아래로 올린다.
 */
export function EntryNextRow({
  filesCount,
  relatedCount,
  relativePath,
  onOpenDiff,
  onOpenRelated,
}: {
  filesCount: number;
  relatedCount: number;
  relativePath: string;
  onOpenDiff: () => void;
  onOpenRelated?: () => void;
}) {
  const { t } = useT();
  const copyRedteam = () => {
    void navigator.clipboard?.writeText(`/oculpm:redteam ${relativePath}`).then(() => toast.info(t("branch.receipt.redteamCopied")));
  };
  return (
    <div className="entry-next" aria-label={t("entry.next.aria")}>
      <span className="entry-next-label">{t("entry.next.label")}</span>
      <button type="button" className="btn sm" onClick={onOpenDiff}>
        <GitCompareArrows size={13} /> {t("entry.next.diff", { n: filesCount })}
      </button>
      {relatedCount > 0 && onOpenRelated ? (
        <button type="button" className="btn sm" onClick={onOpenRelated}>
          <Link2 size={13} /> {t("entry.next.related", { n: relatedCount })}
        </button>
      ) : null}
      <button type="button" className="btn sm" onClick={copyRedteam} title={t("entry.next.redteamHint")}>
        <Clipboard size={13} /> {t("branch.receipt.redteam")}
      </button>
    </div>
  );
}
