import { useEffect, useState } from "react";
import { oculpmApi } from "@/api/oculpm";
import { useT, type I18nKey } from "@/i18n";
import type { RelatedRef, RelatedSuggestion } from "@/lib/bindings";
import { plainTitle } from "./JournalRow";

// 관련 일지 — 상세 바닥의 한 줄 (4.0). 적어 둔 링크(frontmatter `related`)를 먼저, 모자라면
// 같은 파일·같은 계획 항목을 만진 과거 일지를 근거와 함께 읽기 전용으로 보인다.
// 근거를 못 적을 추천은 추천이 아니라 소음이다 — 백엔드가 문턱 아래를 이미 버린다.
//
// 링크는 계획 링크와 한 모양이다(본문색 · 옅은 밑줄, 11-15). 다크에서 가장 채도 높은 글자(민트)가
// 화면 바닥의 관련 링크였다 — 예외가 아닌데 가장 크게 외쳤다. 이유는 숫자만 두고 경로는 title 에 둔다.

/** 한 줄에 놓는 링크 수. */
const MAX_LINKS = 4;

interface Link {
  path: string;
  /** 못 읽은 참조면 `null` — 회색 「찾지 못한 일지」. */
  title: string | null;
  why: string;
  /** 이유의 자세한 말(경로 · 항목 id) — 툴팁. */
  whyTitle?: string;
}

type T = ReturnType<typeof useT>["t"];

/** 근거 코드 → 사람이 읽는 줄(숫자만)과 툴팁(경로 · 항목). 백엔드는 코드와 파라미터만 준다 (영어 모드에 한국어가 새지 않게). */
function reasonOf(s: RelatedSuggestion, t: T): { why: string; title: string } {
  const why: string[] = [];
  const title: string[] = [];
  for (const r of s.reasons) {
    if (r.code === "shared_files") {
      why.push(t("entry.related.why.files", { n: r.params[0] ?? "" }));
      if (r.params[1]) title.push(r.params[1]);
    } else if (r.code === "plan_item") {
      const items = (r.params[0] ?? "").split(",").map((x) => x.trim()).filter(Boolean);
      why.push(t("entry.related.why.plan", { n: items.length || 1 }));
      if (items.length) title.push(items.map((x) => (x.startsWith("#") ? x : `#${x}`)).join(" "));
    } else if (r.code === "title") {
      why.push(t("entry.related.why.title", { pct: r.params[0] ?? "" }));
    } else {
      why.push(r.code);
    }
  }
  return { why: why.join(" · "), title: title.join("\n") };
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
        refs.map(async (ref): Promise<Link> => {
          const e = await oculpmApi.getJournalEntry(projectId, ref).catch(() => null);
          return {
            path: ref,
            title: e?.title ? plainTitle(e.title) : null,
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
        ...suggested.map((s) => {
          const r = reasonOf(s, t);
          return { path: s.relative_path, title: plainTitle(s.title || s.relative_path), why: r.why, whyTitle: r.title || undefined };
        }),
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
          {l.title == null ? (
            <span className="jd-related-missing" title={l.path}>
              {t("journal.related.missing")}
            </span>
          ) : (
            <button type="button" className="jd-link" onClick={() => onOpen(l.path)} title={l.path}>
              {l.title}
            </button>
          )}
          {l.why ? (
            <span className="jd-related-why" title={l.whyTitle}>
              {" · "}
              {l.why}
            </span>
          ) : null}
        </span>
      ))}
    </div>
  );
}
