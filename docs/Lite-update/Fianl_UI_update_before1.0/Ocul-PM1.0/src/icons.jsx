/* Icon component built from Lucide UMD (window.lucide.icons) */
function Icon({ name, size = 18, sw = 1.75, className, style, color }) {
  const lib = (typeof window !== "undefined" && window.lucide && window.lucide.icons) || {};
  const def = lib[name] || lib.Circle;
  const children = (def && def[2]) || [];
  return React.createElement(
    "svg",
    {
      width: size, height: size, viewBox: "0 0 24 24", fill: "none",
      stroke: color || "currentColor", strokeWidth: sw,
      strokeLinecap: "round", strokeLinejoin: "round",
      className, style, "aria-hidden": true,
    },
    children.map((c, i) => React.createElement(c[0], { key: i, ...c[1] }))
  );
}

/* trigger -> icon + label + class */
const TRIGGER_META = {
  bugfix:   { icon: "Bug",            label: "버그 수정",  cls: "t-bugfix",   key: "버그" },
  feature:  { icon: "Sparkles",       label: "기능 추가",  cls: "t-feature",  key: "기능" },
  refactor: { icon: "GitBranch",      label: "리팩토링",   cls: "t-refactor", key: "리팩토링" },
  error:    { icon: "TriangleAlert",  label: "에러 사이클", cls: "t-error",    key: "에러" },
  chore:    { icon: "Wrench",         label: "잡일",       cls: "t-chore",    key: "잡일" },
};

function TriggerBadge({ type, withLabel = true }) {
  const m = TRIGGER_META[type] || TRIGGER_META.chore;
  return (
    <span className={"tbadge " + m.cls}>
      <Icon name={m.icon} size={12} sw={2.1} />
      {withLabel ? m.label : null}
    </span>
  );
}

Object.assign(window, { Icon, TRIGGER_META, TriggerBadge });
