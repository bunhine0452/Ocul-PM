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

interface SkillShopTabProps {
  projectId: number;
  tabs: ReactNode;
}

export function SkillShopTab({ projectId, tabs }: SkillShopTabProps) {
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
      const hay = `${c.id} ${c.label} ${c.summary} ${c.tags.join(" ")}`.toLowerCase();
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
      toast.info(`카탈로그 스킬 설치됨: ${c.id} (${c.source}, MIT)`);
      setInstalledDirs(null); // 재조회
    } else {
      toast.destructive(res.error);
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
          title="클릭해서 본문 미리보기"
        >
          <div className="sk-gallery-name">
            {c.label}{" "}
            <span className="font-mono text-[10px] text-muted-foreground">
              {c.source} · {c.tags.join("·")} · 본문 ≈{c.tokenEstimate.toLocaleString()} tok
            </span>
          </div>
          <div className="sk-gallery-desc">{c.summary}</div>
        </button>
        {installed ? (
          <span
            className="sk-chip"
            title="같은 이름의 스킬이 이 프로젝트에 이미 있습니다 (내용은 다를 수 있어요)"
          >
            설치됨
          </span>
        ) : (
          <button
            type="button"
            className="btn primary sm"
            disabled={busy}
            onClick={() => void install(c.id)}
          >
            설치
          </button>
        )}
      </li>
    );
  };

  return (
    <>
      <Toolbar title="스킬·규칙" sub="스킬 샵 — 검증된 제3자 스킬 (MIT · 버전 고정)">
        {tabs}
      </Toolbar>
      <div className="scroll">
        <div className="page sk-shop">
          <section>
            <h2 className="sk-shop-h">
              이 프로젝트 스택 추천
              <span className="sk-shop-tags">
                {stackTags?.map((t) => (
                  <span key={t} className="sk-chip">
                    {t}
                  </span>
                ))}
              </span>
            </h2>
            {stackTags == null ? (
              <p className="text-sm text-muted-foreground">스택 감지 중…</p>
            ) : matched.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {stackTags.length === 0
                  ? "스택을 감지하지 못했습니다 — 아래 전체 카탈로그에서 직접 고를 수 있어요."
                  : "감지된 스택과 일치하는 카탈로그 스킬이 없습니다."}
              </p>
            ) : (
              <ul className="sk-gallery-list">{matched.map(row)}</ul>
            )}
          </section>

          <section>
            <h2 className="sk-shop-h">전체 카탈로그 ({CATALOG_SKILLS.length})</h2>
            <div className="sk-shop-filter">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="이름·요약·태그 검색"
                aria-label="카탈로그 검색"
              />
              <div className="sk-shop-tagrow" role="group" aria-label="태그 필터">
                <button
                  type="button"
                  aria-pressed={tagFilter == null}
                  className={`sk-chip sk-chip-btn${tagFilter == null ? " on" : ""}`}
                  onClick={() => setTagFilter(null)}
                >
                  전체
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
              <p className="text-sm text-muted-foreground">검색과 일치하는 스킬이 없습니다.</p>
            ) : (
              <ul className="sk-gallery-list">{filtered.map(row)}</ul>
            )}
          </section>

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            전부 제3자 스킬(MIT)의 <strong>출처·버전 고정 사본</strong>입니다 — ECC(Affaan
            Mustafa)·ponytail(DietrichGebert), 원문 무수정, 런타임 네트워크 0. 설치하면{" "}
            <code>.claude/skills/</code> 에 들어가며 이는 Claude Code 의 <strong>네이티브
            기능이라 ocul-pm 플러그인 없이도 동작</strong>합니다. 설치된 스킬의 설명 한 줄은 매
            세션 컨텍스트에 상시 탑승하므로 프로젝트당 2~3개를 권장하고, 표기된 "본문 ≈N tok"
            은 스킬이 발동될 때만 로드되는 본문 크기입니다.
          </p>
        </div>
      </div>

      <AppDialog
        open={preview != null}
        onClose={() => setPreview(null)}
        label={preview ? `${preview.id} 미리보기` : "미리보기"}
        width={720}
      >
        {preview && (
          <>
            <div className="sk-modal-head">
              <h2>{preview.label}</h2>
              <p className="text-xs text-muted-foreground">
                {preview.source} · MIT ·{" "}
                <a href={preview.sourceUrl} target="_blank" rel="noreferrer">
                  원본 (핀 커밋)
                </a>
              </p>
            </div>
            <div className="sk-modal-body sk-shop-preview">
              <Markdown>{preview.content}</Markdown>
            </div>
            <div className="sk-modal-foot">
              {installedDirs?.has(preview.id) ? (
                <span className="sk-chip">설치됨</span>
              ) : (
                <button
                  type="button"
                  className="btn primary sm"
                  disabled={busy}
                  onClick={() => void install(preview.id)}
                >
                  이 프로젝트에 설치
                </button>
              )}
              <button type="button" className="btn ghost sm" onClick={() => setPreview(null)}>
                닫기
              </button>
            </div>
          </>
        )}
      </AppDialog>
    </>
  );
}
