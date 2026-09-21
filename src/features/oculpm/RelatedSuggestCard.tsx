import { useCallback, useEffect, useState } from "react";
import { Link2 } from "@/components/Icons";
import { LoadingState } from "@/components/LoadingState";
import { oculpmApi, OculpmApiError } from "@/api/oculpm";
import { toast } from "@/lib/toast";
import { useT } from "@/i18n";
import { TRIGGER_META } from "./triggerMeta";
import type { EntryType, RelatedSuggestion } from "@/lib/bindings";

// 「관련 후보」 — 일지 상세의 부록 하나 ({#related-suggest} · {#related-ui}).
//
// 왜 있는가: 이 저장소의 일지 727건 중 frontmatter `related` 가 채워진 것은
// 243건이고, 같은 파일에 bug 일지가 5건 넘게 붙은 파일이 31개다. 재발은 이미
// 기록돼 있는데 **700건짜리 목록 안에서 안 보인다.**
//
// 화면의 약속 둘:
//  1. **근거 없는 후보는 안 띄운다.** 백엔드가 문턱 아래를 이미 버리고,
//     남은 것도 "왜 후보인지"를 줄마다 같이 적는다. 근거를 못 적을 추천은
//     추천이 아니라 소음이다.
//  2. **「잇기」는 원본 .md 를 고친다.** 캐시가 아니라 디스크 frontmatter 에
//     한 줄이 들어간다 — 그래서 버튼 옆에 그 사실을 적어 둔다.
//
// 별도 파일인 이유: `EntryDetailView.tsx` 는 650줄이고 크기 래칫이 지켜보는
// 파일이다. 부록은 부록 파일이 갖는다.

interface RelatedSuggestCardProps {
  projectId: number;
  /** `.oculpm/journal/` 기준 상대경로 — 대상 일지. */
  relativePath: string;
  /** 이미 이어 둔 참조 수. 「잇기」 직후 목록을 다시 받기 위한 신호다. */
  relatedCount: number;
  /** 한 건 이었다 — 상세를 다시 읽어 마스트헤드의 칩을 갱신한다. */
  onLinked: () => void;
  onOpenRelated?: (relativePath: string) => void;
}

/**
 * 잇는 종류는 `followup` 하나다. 규격은 넷(blocks·blocked_by·followup·
 * duplicate)이지만, 나머지 셋은 **사람이 아는 사실**을 담는 말이라 후보 목록이
 * 대신 고를 수 없다. 화면이 확실히 말할 수 있는 것은 "이 일지가 저것의 뒤를
 * 잇는다" 뿐이다. 다른 종류가 필요하면 원본을 열어 적는 길이 그대로 있다.
 */
const LINK_KIND = "followup";

export function RelatedSuggestCard({
  projectId,
  relativePath,
  relatedCount,
  onLinked,
  onOpenRelated,
}: RelatedSuggestCardProps) {
  const { t } = useT();
  const [items, setItems] = useState<RelatedSuggestion[] | null>(null);
  /** 지금 잇는 중인 후보의 경로 — 진행 중 표시이자 중복 클릭 차단. */
  const [linkBusy, setLinkBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    oculpmApi
      .suggestRelated(projectId, relativePath)
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch(() => {
        // 후보는 곁다리다 — 못 받아도 일지 열람을 방해하지 않는다.
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, relativePath, relatedCount]);

  const link = useCallback(
    async (ref: string) => {
      setLinkBusy(ref);
      try {
        await oculpmApi.addRelated(projectId, relativePath, ref, LINK_KIND);
        toast.info(t("entry.related.linked"));
        onLinked();
      } catch (e) {
        toast.destructive(
          t("entry.related.linkFailed", {
            error: e instanceof OculpmApiError ? e.message : String(e),
          }),
        );
      } finally {
        setLinkBusy(null);
      }
    },
    [projectId, relativePath, onLinked, t],
  );

  // 로딩은 자리를 차지하지 않는다 — 부록이라 늦게 와도 본문이 안 밀려야 한다.
  if (items == null) {
    return (
      <section className="entry-relsug" aria-busy="true">
        <LoadingState density="compact" align="start">
          {t("entry.related.loading")}
        </LoadingState>
      </section>
    );
  }
  // 근거 있는 후보가 없으면 상자 자체를 안 그린다 (빈 상자는 정보가 아니다).
  if (items.length === 0) return null;

  return (
    <section className="entry-relsug">
      <div className="entry-relsug-head">
        <h2>{t("entry.related.title")}</h2>
        <span className="entry-relsug-hint">{t("entry.related.hint")}</span>
      </div>
      <ul className="entry-relsug-list">
        {items.map((s) => {
          const meta = TRIGGER_META[s.entry_type as EntryType] ?? TRIGGER_META.chore;
          const Icon = meta.icon;
          return (
            <li key={s.relative_path} className="entry-relsug-row">
              <button
                type="button"
                className="entry-relsug-open"
                onClick={() => onOpenRelated?.(s.relative_path)}
                disabled={!onOpenRelated}
                title={s.relative_path}
              >
                <Icon size={13} />
                <span className="entry-relsug-title">{s.title || s.relative_path}</span>
                <span className="entry-relsug-day">{s.workday}</span>
              </button>
              <p className="entry-relsug-why">{reasonText(s, t)}</p>
              <button
                type="button"
                className="btn sm"
                onClick={() => void link(s.relative_path)}
                disabled={linkBusy != null}
                title={t("entry.related.linkTitle")}
              >
                <Link2 size={11} />{" "}
                {linkBusy === s.relative_path ? t("entry.related.linking") : t("entry.related.link")}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * 근거 코드 → 사람이 읽는 줄. 백엔드는 코드와 파라미터만 주고 문장은 여기서
 * 만든다 — 그래야 영어 모드에서 한국어가 안 샌다.
 */
function reasonText(s: RelatedSuggestion, t: ReturnType<typeof useT>["t"]) {
  return s.reasons
    .map((r) => {
      if (r.code === "shared_files") {
        return t("entry.related.why.files", {
          n: r.params[0] ?? "",
          file: shortPath(r.params[1] ?? ""),
        });
      }
      if (r.code === "plan_item") {
        return t("entry.related.why.plan", { items: r.params[0] ?? "" });
      }
      if (r.code === "title") {
        return t("entry.related.why.title", { pct: r.params[0] ?? "" });
      }
      return r.code;
    })
    .join(" · ");
}

/** 근거 줄은 한 줄이어야 한다 — 긴 경로는 끝 두 조각만. */
function shortPath(path: string): string {
  const parts = path.split("/");
  return parts.length <= 2 ? path : `…/${parts.slice(-2).join("/")}`;
}

export default RelatedSuggestCard;
