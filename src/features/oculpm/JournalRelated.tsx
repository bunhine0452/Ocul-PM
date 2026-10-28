import { useEffect, useState } from "react";
import { oculpmApi } from "@/api/oculpm";
import { useT, type I18nKey } from "@/i18n";
import type { RelatedRef, RelatedSuggestion } from "@/lib/bindings";

// 관련 일지 — 상세 바닥의 한 줄 (4.0). 적어 둔 링크(frontmatter `related`)를 먼저, 모자라면
// 같은 파일·같은 계획 항목을 만진 과거 일지를 근거와 함께 읽기 전용으로 보인다.
// 근거를 못 적을 추천은 추천이 아니라 소음이다 — 백엔드가 문턱 아래를 이미 버린다.

/** 한 줄에 놓는 링크 수. */
const MAX_LINKS = 4;

interface Link {
  path: string;
  title: string;
  why: string;
}

type T = ReturnType<typeof useT>["t"];

/** 근거 코드 → 사람이 읽는 줄. 백엔드는 코드와 파라미터만 주고 문장은 여기서 만든다 (영어 모드에 한국어가 새지 않게). */
function reasonText(s: RelatedSuggestion, t: T): string {
  return s.reasons
    .map((r) => {
      if (r.code === "shared_files") {
        return t("entry.related.why.files", { n: r.params[0] ?? "", file: shortPath(r.params[1] ?? "") });
      }
      if (r.code === "plan_item") return t("entry.related.why.plan", { items: r.params[0] ?? "" });
      if (r.code === "title") return t("entry.related.why.title", { pct: r.params[0] ?? "" });
      return r.code;
    })
    .join(" · ");
}

/** 근거 줄은 한 줄이어야 한다 — 긴 경로는 끝 두 조각만. */
function shortPath(path: string): string {
  const parts = path.split("/");
  return parts.length <= 2 ? path : `…/${parts.slice(-2).join("/")}`;
}

export function JournalRelated({
  projectId,
  relativePath,
  explicit,
  onOpen,
}: {
  projectId: number;
  relativePath: string;
  /** 일지에 적힌 `related` 링크. */
  explicit: RelatedRef[];
  onOpen: (relativePath: string) => void;
}) {
  const { t } = useT();
  const [links, setLinks] = useState<Link[]>([]);
  const refKey = explicit.map((r) => r.ref).join("\n");

  useEffect(() => {
    let cancelled = false;
    setLinks([]);
    void (async () => {
      const refs = refKey ? refKey.split("\n").slice(0, MAX_LINKS) : [];
      const named = await Promise.all(
        refs.map(async (ref) => {
          const e = await oculpmApi.getJournalEntry(projectId, ref).catch(() => null);
          return {
            path: ref,
            title: e?.title || ref,
            why: t(`entry.relatedKind.${explicit.find((r) => r.ref === ref)?.kind ?? "followup"}` as I18nKey),
          };
        }),
      );
      const room = MAX_LINKS - named.length;
      const suggested =
        room > 0
          ? await oculpmApi
              .suggestRelated(projectId, relativePath, room)
              .then((rows) => rows.filter((s) => !refs.includes(s.relative_path)).slice(0, room))
              .catch(() => [] as RelatedSuggestion[])
          : [];
      if (cancelled) return;
      setLinks([
        ...named,
        ...suggested.map((s) => ({ path: s.relative_path, title: s.title || s.relative_path, why: reasonText(s, t) })),
      ]);
    })();
    return () => {
      cancelled = true;
    };
    // `explicit` 는 refKey 로 대신 본다 — 렌더마다 새 배열이다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, relativePath, refKey, t]);

  if (links.length === 0) return null;
  return (
    <div className="jd-related" aria-label={t("journal.related.aria")}>
      <span>{t("journal.related.label")}</span>
      {links.map((l) => (
        <span key={l.path}>
          <button type="button" className="jd-related-link" onClick={() => onOpen(l.path)} title={l.path}>
            {l.title}
          </button>
          {l.why ? <span className="jd-related-why"> · {l.why}</span> : null}
        </span>
      ))}
    </div>
  );
}
