---
version: 1
slug: "landing-index-html"
primary_target: "landing/index.html"
related_targets: ["landing/en/index.html"]
---

# Surface brief — oculpm.com 첫 페이지 (ko · en)

Scope: `landing/index.html` · `landing/en/index.html` · `landing/home.css`. Mode: Persuade.
Audience: 매일 AI 코딩 에이전트로 일하는 개인 개발자(한국어 먼저). Action: macOS 앱 내려받기가 주, Claude Code 플러그인 두 줄이 보조.
Proof: 이 저장소의 실제 기록(일지 932 · 계획 89 · 릴리스 133), 실제 4.1 앱 화면(하네스로 이 저장소의 일지를 채워 찍음, 데모라고 표기), 다운로드 수 · Product Hunt.
Constraints: 앱 색감 그대로(어두운 Deep Forest), 실제 앱 화면이 주인공. 피할 것: 흔한 SaaS 템플릿(가운데 정렬 · 같은 카드 격자 · 대문자 이름표), AI 같은 장식(빛 · 그라디언트 · 유리 · 맥동 · 스크롤 페이드인), 글이 너무 많음. `bump-version.mjs` 가 찾는 버전 자리 여섯.
Process note: 첫 판(밝은 아이보리 스케치 셋)은 사용자가 「퀄리티가 별로, 지금 랜딩을 봐라」로 되돌렸다. 기존 랜딩의 어두운 무대 · 굵은 활자 · 창의 깊이를 기준선으로 삼아 다시 지었다. 이 계약은 지은 뒤에 적었다.

## Direction contract

THESIS: 페이지가 곧 앱이다. 방문자는 설명을 읽기 전에 4.1 의 실제 창을 만지고, 「Claude 가 물어요」에 답해 Claude 가 그 답을 받는 것을 본다. 거부하는 것: 헤드라인 아래 정지된 스크린샷 · 기능 카드 격자.
OWN-WORLD: 앱 어두운 테마 토큰 그대로(ground #121514, window #191d1b, card #232826, ink #f1f4f1, ink-2 #a6aea8, accent #34d095, on-accent #06281c). Pretendard 하나(자체 호스팅 서브셋), 코드는 시스템 모노. 둥근 창 하나에 깊은 그림자, 그 밖은 머리카락 선 · 표 · 정의 목록. 장식 없음.
STORY: 무엇인지(헤드라인 · 한 문장) → 직접 해 보기(창의 탭 다섯, 질문에 답하기) → 하루 한 왕복(어제 18:40 · 18:41 · 오늘 09:02) → 다섯 원칙의 자리(표) → 작은 것들 → 로컬 → 플러그인 → 자기 자신으로 만들어짐(실제 수) → FAQ → 내려받기.
FIRST VIEWPORT: 왼쪽 정렬 80px 헤드라인 두 줄, 그 아래 한 문장, 주 버튼 「v4.1.0 받기 · macOS · 무료」와 플러그인 두 줄 복사, OS 링크와 「새 판」 이 한 줄. 화면 아래쪽으로 실제 앱 창의 윗줄과 「Claude 가 물어요」 행이 보이고, 답 버튼에 초록 테두리와 「눌러서 Claude 에게 답해 보세요」.
FORM: 「페이지가 곧 앱」 — 다시 뽑은 판(round 1)의 THE ROLL, 내 순위 목록 3번. seed:d104fbb58772c15e. Signature interaction: 답 버튼 → 터미널 탭으로 넘어가 answer · 이어진 작업 네 줄이 차례로 선다(사용자 행동에 답하는 한 번의 움직임). Motion grammar: 탭 전환 220ms 교차 페이드, 나머지는 정지.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
