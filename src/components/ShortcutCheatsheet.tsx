import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { AppDialog, DialogBody, DialogHead } from "@/components/ui/AppDialog";
import { Keyboard } from "@/components/Icons";
import type { UiV2View } from "@/contexts/uiV2View";
import { useT } from "@/i18n";
import { NAV_ENTRIES } from "@/lib/navRegistry";
import { noteCheatsheetOpen, onCheatsheetRequest } from "@/lib/projectActions";
import { buildShortcutGroups, type ShortcutGroup } from "@/lib/shortcutRegistry";

// ⌘/ 단축키 치트시트 (완성도 라운드 Phase 2, 2026-08-30).
//
// 창에 하나만 산다 (`AppWindow`) — 어느 화면에서 눌러도 같은 표다. 표는 `shortcutRegistry` 에서
// 그린다: 화면 이동 행은 navRegistry 순서에서 계산되므로 화면을 추가하면 저절로 나타난다.
//
// 11-15 — 대화상자 한 벌(머리 · 스크롤되는 본문)에 서고, 묶음은 CSS 단으로 흐른다. 480×520 창에서
// 표(33줄)가 잘리고 스크롤도 안 되던 자리다. **지금 화면의 묶음이 맨 앞**이고, 프로젝트 창에서는
// 시작 화면 묶음(폴더 열기)을 뺀다 — 그 창에서는 듣지 않는 키다.

/**
 * 이 창이 지금 보여 주는 화면 — 윗줄 탭의 `aria-current="page"` 에서 읽는다. 치트시트는 창 최상위라
 * 화면 상태(WorkspaceContext)의 바깥에 산다. 탭은 navRegistry 순서로 그려지므로 그 순번이 화면이다.
 * 윗줄이 없으면(시작 창) `null`.
 */
export function viewOnScreen(doc: Document = document): UiV2View | null {
  const nav = doc.querySelector(".topbar .topnav");
  if (!nav) return null;
  const tabs = Array.from(nav.querySelectorAll(":scope > button"));
  const at = tabs.findIndex((el) => el.getAttribute("aria-current") === "page");
  if (at >= 0) return NAV_ENTRIES[at]?.id ?? null;
  return doc.querySelector('.topbar [aria-current="page"]') ? "settings" : null;
}

/**
 * 지금 화면의 묶음을 맨 앞으로 — 묶음 id 가 화면 이름과 같으면 그 화면의 키다(다섯 화면 모두 — 계획 묶음이
 * "plan" 이던 때는 계획 화면에서만 칩이 안 섰다, `cheatsheet_here.test.tsx`). 시작 창(`view` 없음)에서는 시작 화면
 * 묶음이 지금 화면이다. 프로젝트 창에서는 시작 화면 묶음을 뺀다.
 */
export function orderShortcutGroups(
  groups: ShortcutGroup[],
  view: UiV2View | null,
  inProject: boolean,
): ShortcutGroup[] {
  const kept = inProject ? groups.filter((g) => g.id !== "start") : groups;
  const here: string = inProject ? (view ?? "") : "start";
  return [...kept.filter((g) => g.id === here), ...kept.filter((g) => g.id !== here)];
}

/**
 * 키 칸의 글자 → 누르는 키들. ` · ` 는 같은 일을 하는 다른 길, ` / ` 는 짝이다(`shortcutRegistry` 머리 주석) —
 * 「j / k · ↑ / ↓」 → [[j, k], [↑, ↓]]. ` / ` 로만 가르던 때는 「k · ↑」 가 한 키캡에 섰다.
 */
export function keyGroups(keys: string): string[][] {
  return keys.split(" · ").map((alt) => alt.split(" / "));
}

/** 끝의 괄호 덧말을 둘째 줄로 — 「창 닫기 (터미널은 …)」 → [「창 닫기」, 「터미널은 …」]. */
export function splitKeyLabel(label: string): [string, string | null] {
  const m = /^(.+?)\s*\(([^()]+)\)\s*$/.exec(label);
  return m ? [m[1], m[2]] : [label, null];
}

export function ShortcutCheatsheet() {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  // 열 때마다 창을 다시 읽는다 — 그 사이 화면을 옮겼을 수 있다.
  const [where, setWhere] = useState<{ view: UiV2View | null; inProject: boolean }>({ view: null, inProject: false });
  useEffect(
    () =>
      onCheatsheetRequest(() => {
        setWhere({ view: viewOnScreen(), inProject: document.querySelector(".topbar") != null });
        setOpen((v) => !v);
      }),
    [],
  );
  // 떠 있는지 적어 둔다 — 열린 표 위의 ⌘/ 가 모달 가드에 먹히지 않고 표를 닫게(`useGlobalShortcuts` · 시작 창).
  useEffect(() => {
    noteCheatsheetOpen(open);
    return () => noteCheatsheetOpen(false);
  }, [open]);
  const groups = useMemo(
    () => orderShortcutGroups(buildShortcutGroups(), where.view, where.inProject),
    [where],
  );
  const here = where.inProject ? where.view : "start";
  // 첫 포커스는 표(본문) — 열자마자 화살표 · PageDown 이 표를 내린다. × 가 먼저 포커스 테를 쥐지 않는다.
  // 본문은 Tab 자리다(× ↔ 표) — 가두기 목록의 끝이라 Tab 이 대화상자 밖으로 새지 않는다.
  const bodyRef = useRef<HTMLDivElement | null>(null);

  return (
    <AppDialog open={open} onClose={() => setOpen(false)} label={t("keys.title")} width={760} initialFocusRef={bodyRef}>
      <DialogHead
        mark={<Keyboard size={15} />}
        title={t("keys.title")}
        sub={t("keys.hint")}
        onClose={() => setOpen(false)}
      />
      <DialogBody ref={bodyRef} focusable>
        <div className="keys-cols">
          {groups.map((g) => (
            <section className="keys-group" key={g.id} aria-labelledby={`keys-${g.id}`}>
              <h3 id={`keys-${g.id}`}>
                {t(g.titleKey)}
                {g.id === here ? <span className="chip sm hairline">{t("dialog.keysHere")}</span> : null}
              </h3>
              <dl>
                {g.rows.map((row) => {
                  const [label, sub] = splitKeyLabel(t(row.labelKey));
                  return (
                    <div className="keys-row" key={`${g.id}:${row.keys}`}>
                      <dt>
                        {label}
                        {sub ? <span className="keys-sub">{sub}</span> : null}
                      </dt>
                      <dd>
                        {keyGroups(row.keys).map((alt, i) => (
                          <Fragment key={i}>
                            {i > 0 ? (
                              <span className="keys-or" aria-hidden="true">
                                ·
                              </span>
                            ) : null}
                            {alt.map((k, j) => (
                              <kbd className="kbd" key={j}>
                                {k}
                              </kbd>
                            ))}
                          </Fragment>
                        ))}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </section>
          ))}
        </div>
      </DialogBody>
    </AppDialog>
  );
}
