import { useEffect, useMemo, useState } from "react";
import { AppDialog } from "@/components/ui/AppDialog";
import { Keyboard } from "@/components/Icons";
import { useT } from "@/i18n";
import { onCheatsheetRequest } from "@/lib/projectActions";
import { buildShortcutGroups } from "@/lib/shortcutRegistry";

// ⌘/ 단축키 치트시트 (완성도 라운드 Phase 2, 2026-08-30).
//
// 창에 하나만 산다 (`TabbedWindow`) — 어느 탭·어느 화면에서 눌러도 같은 표다.
// 표는 `shortcutRegistry` 에서 그린다: 화면 이동 행은 navRegistry 순서에서
// 계산되므로 화면을 추가하면 저절로 나타난다.

export function ShortcutCheatsheet() {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  useEffect(() => onCheatsheetRequest(() => setOpen((v) => !v)), []);
  const groups = useMemo(() => buildShortcutGroups(), []);

  return (
    <AppDialog open={open} onClose={() => setOpen(false)} label={t("keys.title")} width={760}>
      <div className="sk-modal-head">
        <Keyboard size={16} />
        <h3>{t("keys.title")}</h3>
        <span className="sk-modal-sub">{t("keys.hint")}</span>
      </div>
      <div className="keys-grid">
        {groups.map((g) => (
          <section className="keys-group" key={g.id} aria-labelledby={`keys-${g.id}`}>
            <h4 id={`keys-${g.id}`}>{t(g.titleKey)}</h4>
            <dl>
              {g.rows.map((row) => (
                <div className="keys-row" key={`${g.id}:${row.keys}`}>
                  <dt>{t(row.labelKey)}</dt>
                  <dd>
                    {row.keys.split(" / ").map((k, i) => (
                      <kbd className="kbd" key={i}>
                        {k}
                      </kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </AppDialog>
  );
}
