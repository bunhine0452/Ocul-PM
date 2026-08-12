/**
 * 프로젝트 겉모습 — 아이콘 10종 · 색 8종.
 *
 * 저장되는 것은 hex 나 컴포넌트가 아니라 **id 문자열**이다 (`"terminal"`,
 * `"amber"`). 색을 hex 로 저장하면 라이트/다크/프리셋 5종에서 같은 값이
 * 성립하지 않는다 — id 로 두면 각 테마가 자기 팔레트로 해석한다
 * (`home.css` 의 `[data-pc]` 블록).
 *
 * 고르지 않은 프로젝트는 **이름 해시**로 결정적 기본값을 받는다. 무작위가
 * 아니라 해시인 이유: 같은 프로젝트가 창을 옮기거나 재실행해도 같은 색으로
 * 남아야 "색으로 구별한다" 는 목적이 성립한다.
 */
import {
  Cat,
  Coffee,
  Donut,
  Fish,
  Gem,
  Ghost,
  IceCreamCone,
  Rabbit,
  Rocket,
  Sprout,
  type IconProps,
} from "@/components/Icons";

/**
 * `@/components/Icons` 는 손으로 쓴 SVG 컴포넌트와 lucide 재수출이 섞여 있어
 * 시그니처가 하나로 떨어지지 않는다 — 둘 다 받을 수 있는 최소 계약만 둔다.
 */
export type ProjectIconComponent = React.ComponentType<IconProps>;

export interface ProjectIconSpec {
  id: string;
  Icon: ProjectIconComponent;
}

/**
 * 기본 제공 아이콘. 순서가 곧 선택기의 배열 순서다.
 *
 * 도구 아이콘(폴더·터미널·브랜치)이 아니라 **성격 있는 모양**을 쓴다 — 카드가
 * 아홉 장 놓였을 때 눈이 먼저 찾는 건 기능이 아니라 얼굴이다.
 *
 * 실루엣이 서로 겹치지 않게 골랐다(뾰족·긴귀·물결·삼각·기둥·고리): 15px 에서
 * 구별되지 않으면 열 개나 두는 의미가 없다. 직접 그리는 대신 lucide 를 쓰는
 * 이유도 같은 크기 문제다 — 곡률이 조금만 어긋나면 고양이가 눈처럼 보인다.
 */
export const PROJECT_ICONS: readonly ProjectIconSpec[] = [
  { id: "cat", Icon: Cat },
  { id: "rabbit", Icon: Rabbit },
  { id: "ghost", Icon: Ghost },
  { id: "rocket", Icon: Rocket },
  { id: "sprout", Icon: Sprout },
  { id: "icecream", Icon: IceCreamCone },
  { id: "coffee", Icon: Coffee },
  { id: "donut", Icon: Donut },
  { id: "fish", Icon: Fish },
  { id: "gem", Icon: Gem },
] as const;

/**
 * 색 id. 실제 값은 CSS 가 테마별로 정의한다 — 여기서는 **이름만** 안다.
 * `slate` 는 "색 없음"에 해당하는 중성값이라 팔레트의 첫 자리를 지킨다.
 */
export const PROJECT_COLORS = [
  "slate",
  "green",
  "blue",
  "violet",
  "amber",
  "rose",
  "teal",
  "orange",
] as const;

export type ProjectColorId = (typeof PROJECT_COLORS)[number];

/**
 * 이름 → 안정적인 정수. 문자열 해시(djb2 변형)라 같은 이름이면 언제나 같은
 * 값이 나온다 — 재실행·창 이동에도 색이 흔들리지 않는 근거다.
 */
function hash(name: string): number {
  let h = 5381;
  for (let i = 0; i < name.length; i += 1) h = ((h << 5) + h + name.charCodeAt(i)) >>> 0;
  return h;
}

/** 사용자가 고른 값이 우선, 없으면 이름에서 결정적으로 유도한다. */
export function resolveProjectColor(
  name: string,
  stored: string | null | undefined,
): ProjectColorId {
  if (stored && (PROJECT_COLORS as readonly string[]).includes(stored)) {
    return stored as ProjectColorId;
  }
  // 중성색(slate)은 기본 유도에서 제외한다 — 아무 것도 안 고른 프로젝트가
  // 전부 회색이면 "색으로 구별" 이라는 목적 자체가 사라진다.
  const hues = PROJECT_COLORS.slice(1);
  return hues[hash(name) % hues.length];
}

export function resolveProjectIcon(
  name: string,
  stored: string | null | undefined,
): ProjectIconSpec {
  const found = stored ? PROJECT_ICONS.find((i) => i.id === stored) : undefined;
  // 유도 기본값은 폴더가 아니라 해시로 — 전부 같은 아이콘이면 없는 것과 같다.
  return found ?? PROJECT_ICONS[hash(name) % PROJECT_ICONS.length];
}
