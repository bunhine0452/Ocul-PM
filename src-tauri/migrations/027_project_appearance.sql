-- 프로젝트별 겉모습 — 카드·탭에서 프로젝트를 **한눈에** 구별하기 위한 것.
--
-- 값은 hex 색이 아니라 **id 문자열**을 저장한다 (`icon` = "terminal", `color`
-- = "amber"). 이유 둘:
--   ① 라이트/다크/프리셋 5종에서 같은 hex 가 성립하지 않는다. id 로 두면
--      각 테마가 자기 팔레트로 해석한다.
--   ② 아이콘은 lucide 컴포넌트라 애초에 색처럼 값으로 저장할 수 없다.
-- NULL = 사용자가 고르지 않음 → 프런트가 이름 해시로 결정적 기본값을 만든다.
ALTER TABLE projects ADD COLUMN icon TEXT;
ALTER TABLE projects ADD COLUMN color TEXT;
