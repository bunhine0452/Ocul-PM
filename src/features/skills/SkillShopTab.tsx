// 스킬 샵 탭 — 제3자 스킬 카탈로그(커밋 핀 벤더 사본, MIT)를 사람이 직접
// 브라우징·검색·미리보기·설치하는 표면. 갤러리 모달 안에 숨어 있던 카탈로그를
// 허브의 정식 탭으로 승격했다 (모달에는 이 탭으로 오는 포인터만 남긴다).
//
// 게이트 없음(의도): 설치되는 스킬은 `.claude/skills/` 에 들어가는 Claude Code
// **네이티브** 기능이라 ocul-pm 플러그인 없이도 동작한다 — 플러그인 설치자
// 한정으로 잠글 이유가 없고, 대신 하단 안내로 사실을 알린다.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { Toolbar } from "@/components/Toolbar";
import { Markdown } from "@/components/Markdown";
import { AppDialog } from "@/components/ui/AppDialog";
import { commands } from "@/lib/bindings";
import { toast } from "@/lib/toast";
import { CATALOG_SKILLS, type CatalogSkill, type CatalogTag } from "./skillsCatalog";
import { tAll, useT } from "@/i18n";
import { tError } from "@/i18n/errors";

interface SkillShopTabProps {
  projectId: number;
  tabs: ReactNode;
}

export function SkillShopTab({ projectId, tabs }: SkillShopTabProps) {
  const { t } = useT();
  // 설치 여부 판정은 프로젝트 스코프 폴더명 기준 — 동명의 자작 스킬도 "있음"
  // 으로 표시된다 (백엔드 skills_save 의 동명 거부가 이중 가드, title 로 고지).
  const [installedDirs, setInstalledDirs] = useState<Set<string> | null>(null);
  const [stackTags, setStackTags] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState<CatalogTag | null>(null);
  const [preview, setPreview] = useState<CatalogSkill | null>(null);

  // 프로젝트 전환 시 캐시 리셋 (stale 추천/설치 표시 방지).
  useEffect(() => {
    setInstalledDirs(null);
    setStackTags(null);
    setTagFilter(null);
    setQuery("");
  }, [projectId]);

  useEffect(() => {
    if (installedDirs != null) return;
    let alive = true;
    void commands.skillsList(projectId).then((res) => {
      if (!alive) return;
      setInstalledDirs(
        res.status === "ok" ? new Set(res.data.project.map((e) => e.dir_name)) : new Set(),
      );
    });
    return () => {
      alive = false;
    };
  }, [installedDirs, projectId]);

  useEffect(() => {
    if (stackTags != null) return;
    let alive = true;
    void commands.detectStack(projectId).then((res) => {
      if (!alive) return;
      setStackTags(res.status === "ok" ? res.data : []);
    });
    return () => {
      alive = false;
    };
  }, [stackTags, projectId]);

  const matched = useMemo(() => {
    if (!stackTags?.length) return [];
    const tagSet = new Set(stackTags);
    return CATALOG_SKILLS.filter((c) => c.tags.some((t) => tagSet.has(t)));
  }, [stackTags]);

  // 카탈로그에 실제로 등장하는 태그만 필터 칩으로 (빈 칩 방지).
  const presentTags = useMemo(() => {
    const counts = new Map<CatalogTag, number>();
    for (const c of CATALOG_SKILLS) {
      for (const t of c.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CATALOG_SKILLS.filter((c) => {
      if (tagFilter && !c.tags.includes(tagFilter)) return false;
      if (!q) return true;
      // 검색은 **양 언어**를 색인한다 — 영어 모드에서도 한국어 요약으로 찾히도록
      // (내비·팔레트와 같은 정책, i18n `tAll`).
      const hay = `${c.id} ${tAll(c.labelKey).join(" ")} ${tAll(c.summaryKey).join(" ")} ${c.tags.join(" ")}`.toLowerCase();
      return hay.includes(q);
    });
  }, [query, tagFilter]);

  const install = async (id: string) => {
    const c = CATALOG_SKILLS.find((x) => x.id === id);
    if (!c || busy) return;
    setBusy(true);
    const res = await commands.skillsSave(projectId, "project", c.id, c.content, true);
    setBusy(false);
    if (res.status === "ok") {
      toast.info(t("shop.installed", { id: c.id, source: c.source }));
      setInstalledDirs(null); // 재조회
    } else {
      toast.destructive(tError(res.error));
    }
  };

  const row = (c: CatalogSkill) => {
    const installed = installedDirs?.has(c.id) ?? false;
    return (
      <li key={c.id} className="sk-gallery-item">
        <button
          type="button"
          className="sk-gallery-meta sk-shop-meta"
          onClick={() => setPreview(c)}
          title={t("shop.previewTitle")}
        >
          <div className="sk-gallery-name">
            {t(c.labelKey)}{" "}
            <span className="font-mono text-[10px] text-muted-foreground">
              {c.source} · {c.tags.join("·")} · {t("shop.bodyTok", { n: c.tokenEstimate.toLocaleString() })}
            </span>
          </div>
          <div className="sk-gallery-desc">{t(c.summaryKey)}</div>
        </button>
        {installed ? (
          <span
            className="sk-chip"
            title={t("shop.dupTitle")}
          >
            {t("shop.isInstalled")}
          </span>
        ) : (
          <button
            type="button"
            className="btn primary sm"
            disabled={busy}
            onClick={() => void install(c.id)}
          >
            {t("shop.install")}
          </button>
        )}
      </li>
    );
  };

  return (
    <>
      <Toolbar title={t("nav.skills")} sub={t("shop.toolbarSub")}>
        {tabs}
      </Toolbar>
      <div className="scroll">
        <div className="page sk-shop">
          <section>
            <h2 className="sk-shop-h">
              {t("shop.recommended")}
              <span className="sk-shop-tags">
                {stackTags?.map((t) => (
                  <span key={t} className="sk-chip">
                    {t}
                  </span>
                ))}
              </span>
            </h2>
            {stackTags == null ? (
              <p className="text-sm text-muted-foreground">{t("shop.detecting")}</p>
            ) : matched.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {stackTags.length === 0
                  ? t("shop.noStack")
                  : t("shop.noMatchStack")}
              </p>
            ) : (
              <ul className="sk-gallery-list">{matched.map(row)}</ul>
            )}
          </section>

          <section>
            <h2 className="sk-shop-h">{t("shop.fullCatalog", { n: CATALOG_SKILLS.length })}</h2>
            <div className="sk-shop-filter">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("shop.searchPlaceholder")}
                aria-label={t("shop.searchAria")}
              />
              <div className="sk-shop-tagrow" role="group" aria-label={t("shop.tagFilterAria")}>
                <button
                  type="button"
                  aria-pressed={tagFilter == null}
                  className={`sk-chip sk-chip-btn${tagFilter == null ? " on" : ""}`}
                  onClick={() => setTagFilter(null)}
                >
                  {t("shop.allTags")}
                </button>
                {presentTags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={tagFilter === t}
                    className={`sk-chip sk-chip-btn${tagFilter === t ? " on" : ""}`}
                    onClick={() => setTagFilter((cur) => (cur === t ? null : t))}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("shop.noSearchMatch")}</p>
            ) : (
              <ul className="sk-gallery-list">{filtered.map(row)}</ul>
            )}
          </section>

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t("shop.note1")} <strong>{t("shop.note2")}</strong>{t("shop.note3")}{" "}
            <code>.claude/skills/</code> {t("shop.note4")}{" "}
            <strong>{t("shop.note5")}</strong>{t("shop.note6")}
          </p>
        </div>
      </div>

      <AppDialog
        open={preview != null}
        onClose={() => setPreview(null)}
        label={preview ? t("shop.previewLabel", { id: preview.id }) : t("shop.preview")}
        width={720}
      >
        {preview && (
          <>
            <div className="sk-modal-head">
              <h2>{t(preview.labelKey)}</h2>
              <p className="text-xs text-muted-foreground">
                {preview.source} · MIT ·{" "}
                <a href={preview.sourceUrl} target="_blank" rel="noreferrer">
                  {t("shop.source")}
                </a>
              </p>
            </div>
            <div className="sk-modal-body sk-shop-preview">
              <Markdown>{preview.content}</Markdown>
            </div>
            <div className="sk-modal-foot">
              {installedDirs?.has(preview.id) ? (
                <span className="sk-chip">{t("shop.isInstalled")}</span>
              ) : (
                <button
                  type="button"
                  className="btn primary sm"
                  disabled={busy}
                  onClick={() => void install(preview.id)}
                >
                  {t("shop.installHere")}
                </button>
              )}
              <button type="button" className="btn ghost sm" onClick={() => setPreview(null)}>
                {t("common.close")}
              </button>
            </div>
          </>
        )}
      </AppDialog>
    </>
  );
}
