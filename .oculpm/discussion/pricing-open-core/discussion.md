---
oculpm_discussion: v1
id: pricing-open-core
title: "가격/라이선스 확정 — 개인 무료·팀 유료의 메커니즘 (open-core vs 라이선스 전환 vs 호스팅)"
status: resolved
created: 2026-07-31
updated: 2026-08-01
owner: claude-code
---

## 문제 정의

Decision 2({#d2-pricing-3depth}, 2026-07-31)로 가격 방향이 "전부 무료"(Decision 1)에서 **개인 무료 / 팀 유료**로 전환됐고, 발사 문구는 "개인 영구 무료(Free forever for individuals), 팀 플랜 준비 중"으로 확정됐다. 그러나 저장소는 현재 **MIT 전면 공개**(LICENSE, 저작권자 Kim Hyunbin 단독)라, "팀 유료"를 실제로 집행할 법적·구조적 메커니즘이 없다. A3 마켓플레이스 발사(커뮤니티 제출·런치 포스트) 전에 다음을 확정해야 한다:

- 팀 유료를 담보하는 **메커니즘** — 코드 분리인가, 라이선스 전환인가, 호스팅 전용인가
- 이미 MIT 로 배포된 v2.5.1 까지의 릴리스와의 **정합** (MIT 는 소급 철회 불가 — 배포분은 영구 MIT)
- 외부 기여를 받기 시작하기 전의 **CLA vs DCO** 결정 (기여가 쌓인 뒤에는 되돌리기 어려움)

**현재 상태의 유리한 점**: `git shortlog` 기준 커밋 저자는 본인 1인(365+1 커밋, 동일 이메일)뿐이다. 즉 **지금은 저작권이 100% 단독**이라 어떤 방안이든 법적 전환 비용이 최소인 시점이고, 외부 기여를 받는 순간부터 선택지가 좁아진다.

**제품 제약**: 로컬-퍼스트 데스크톱(Tauri 2, macOS), SSOT 는 프로젝트 내 `.oculpm/` 마크다운, 서버 없음. 팀 가치(팀 읽기 전용 뷰 등)는 필연적으로 **동기화 서버가 필요** — 즉 팀 기능은 코어와 물리적으로 다른 표면(서버 + 앱 내 팀 클라이언트 모듈)에 생긴다. 1인 개발, 커뮤니티 초기(스타·기여 유입 이제 시작), 텔레메트리 없음 유지.

## 후보 해결 방안

### 방안 A — MIT 유지 + 팀 기능을 별도 비공개 repo/모듈로 분리 (open-core 정석) {#opt-a}

코어(현 저장소 전체)는 MIT 그대로. 팀 기능(동기화 서버 + 앱 내 팀 뷰 모듈)은 별도 비공개 저장소 또는 공개 repo 내 별도 라이선스 디렉터리(`ee/`)로 개발한다.

**선례 (웹 확인)**
- **PostHog** — 코어는 MIT, 저장소 안 [`ee/` 디렉터리](https://github.com/PostHog/posthog/blob/master/ee/LICENSE)만 PostHog Enterprise License(상용 계약 필요, source-available). 순수 MIT 만 원하면 `ee/` 를 지우거나 `posthog-foss` 미러를 쓰면 된다 ([공식 이슈 #2824](https://github.com/PostHog/posthog/issues/2824)).
- **Cal.com** — 코어 AGPLv3 + [`packages/features/ee/`](https://github.com/calcom/cal.com/blob/main/packages/features/ee/LICENSE) 는 상용 라이선스. 철학을 "Singleplayer API = 오픈소스, **Multiplayer API = 상용**"으로 명문화 ([공식 블로그](https://calcom.framer.website/blog/changing-to-agplv3-and-introducing-enterprise-edition)) — "개인 무료/팀 유료" 경계와 정확히 같은 컷이다.

**장점**
- 코어 MIT 가 한 줄도 변하지 않음 — 기존 배포분·README 배지·커뮤니티 신뢰와 **정합 100%**. "오픈소스" 라벨(OSI 인정)을 유지한 채 팀 유료가 성립.
- 팀 뷰=서버 필요라는 제품 구조가 경계를 **저절로** 그어 준다. PostHog 처럼 코어 한복판에서 기능을 갈라내는 고통이 없음 — 팀 기능은 아직 한 줄도 안 짠 신규 표면이다.
- 비공개 모듈에는 외부 기여가 없으므로 그 부분의 CLA 문제가 원천 소멸.

**단점 / 비용**
- repo·빌드 파이프라인 이중화(비공개 repo, 결제 인프라, 라이선스 키 검증). 1인 개발에는 유지 표면 증가.
- 코어에 팀 모듈이 꽂힐 훅 포인트(플러그인/모듈 경계)를 설계해야 함.
- MIT 코어라 제3자가 자체 팀 서버를 만들어 경쟁하는 것 자체는 막을 수 없음(후술 리스크 공통).

**CLA 필요성**: 코어가 영원히 MIT 로 남는다는 약속을 지키는 한 **불필요 — DCO 로 충분**. 단, 코어에 이미 들어간 기능을 나중에 유료 모듈로 "이동"할 가능성을 열어두려면 그 기능의 외부 기여분 재라이선스가 필요해 CLA 가 필요해진다 ([Kate Downing 분석](https://katedowninglaw.com/2019/02/15/should-i-use-a-developers-certificate-of-origin-or-a-contributor-agreement/)).

### 방안 B — 라이선스 전환 (FSL/BSL/Elastic 류) {#opt-b}

저장소 전체(또는 신규 커밋부터)를 FSL 같은 source-available 라이선스로 전환하고, 팀 기능 사용을 라이선스 조항으로 제한한다.

**선례 (웹 확인)**
- **Sentry** — BSL 을 거쳐 2023년 [FSL(Functional Source License)](https://fsl.software/) 창안: 경쟁 SaaS 제공만 금지하고 **2년 후 자동으로 Apache 2.0/MIT 전환** ([TechCrunch](https://techcrunch.com/2023/11/20/with-functional-source-license-sentry-wants-to-grant-developers-freedom-without-harmful-free-riding/), [open.sentry.io/licensing](https://open.sentry.io/licensing)). BSL 대비 전환 기한 단축(4→2년)·변형 남발 방지가 개선점.
- **Plausible** — MIT→**AGPLv3** 전환(2020): 코드를 가져다 프로프라이어터리 경쟁 서비스를 만드는 것을 막기 위해 ([공식 블로그](https://plausible.io/blog/open-source-licenses)). 단 AGPL 은 여전히 OSI 오픈소스라 B 중에서는 가장 온건한 형태.
- 반면교사: **Gitea→Forgejo** — 2022년 Gitea 의 도메인·상표가 커뮤니티 동의 없이 영리회사로 이전되자 커뮤니티가 포크, 이후 Forgejo 는 GPLv3+ 로 재라이선스하고 **CLA 없음·DCO 만**을 "재라이선스 럭풀 구조적 방지"로 명문화했다 ([LWN](https://lwn.net/Articles/986998/), [Forgejo 비교 문서](https://forgejo.org/compare-to-gitea/)). 신뢰를 건드리는 전환이 포크와 커뮤니티 이탈을 부른 사례.

**장점**: 단일 repo 유지(분리 비용 없음), 경쟁 호스팅·리브랜딩 판매를 라이선스로 직접 차단, FSL 은 2년 후 오픈소스 전환이라 "언젠가는 전부 오픈소스" 서사 가능.

**단점 / 비용**
- **기존 MIT 배포분과의 관계**: 이미 배포된 v2.5.1 까지는 영구 MIT — 누구든 그 시점에서 포크해 계속 개발할 수 있다. 전환은 신규 커밋에만 유효.
- "오픈소스" 라벨 상실(FSL/BSL/Elastic 은 OSI 비인정 — OSI 측은 이를 공개적으로 비판해 왔다, [The Register](https://www.theregister.com/2023/11/20/sentry_introduces_the_functional_source/)). README 의 MIT 배지·"서버 없음, 전부 로컬" 신뢰 서사와 충돌하고, **스타·커뮤니티가 성공 프록시인 초기 단계**(Decision 1)에 신뢰 비용이 가장 큰 방안.
- 결정적으로 **과잉 살상**: Ocul-PM 의 팀 가치는 서버에 있는데, 아직 존재하지도 않는 서버를 지키자고 이미 공개된 클라이언트 전체의 라이선스를 바꾸는 셈이다. Sentry·Plausible 은 제품 전체가 서버(SaaS)라 사정이 다르다.

**CLA 필요성**: **사실상 필수**. 전환 이후에도 재전환·듀얼 라이선스 여지를 유지하려면 외부 기여분의 권리를 모아야 한다. DCO 는 재라이선스를 허용하지 않는다 ([opensource.com CLA vs DCO](https://opensource.com/article/18/3/cla-vs-dco-whats-difference)). 지금(단독 저작권)은 전환이 법적으로 자유롭지만, 기여가 쌓인 뒤에는 이 방안 자체가 어려워진다.

### 방안 C — 코어 전부 MIT + 팀 기능은 호스팅 서비스로만 제공 (open-core SaaS) {#opt-c}

클라이언트 코드는 전부 MIT 공개 유지. 팀 기능은 oculpm.com 이 운영하는 호스팅 동기화/팀 뷰 **서비스 구독**으로만 판다. 셀프호스트 팀 서버는 제공하지 않는다.

**선례 (웹 확인)**
- **Plausible** — 코드는 AGPL 전부 공개, 수익은 100% SaaS 구독. 셀프 펀딩·부트스트랩으로 [$1M ARR 도달](https://plausible.io/blog/open-source-saas). "기부는 수익모델이 못 된다(6개월간 $5 기부 6건)"는 실측도 남김 ([lessons](https://plausible.io/blog/building-open-source)).
- **Obsidian** — 코드는 비공개지만 **수익 구조가 가장 가까운 선례**: 로컬-퍼스트 앱은 무료(2025-02 부터 [상용 사용까지 무료화](https://obsidian.md/license)), 수익은 Sync/Publish 라는 **선택적 호스팅 서비스**. 데이터는 기본적으로 기기에만 있고 Sync 를 쓸 때만 서버를 거친다 — "로컬-퍼스트 + 서버는 옵션 부가서비스" 모델의 성립 증명.

**장점**
- 저장소는 오늘과 한 글자도 다르지 않음 — 라이선스 작업·repo 분리 모두 불필요, 발사 문구와 즉시 정합.
- 로컬-퍼스트 서사가 오히려 강화됨: "개인은 서버가 아예 없고, 팀만 옵인으로 서버를 쓴다."
- 1인 개발이 관리할 표면이 서버 하나로 수렴(결제도 SaaS 구독이라 라이선스 키 인프라 불필요).

**단점 / 비용**
- 서버 코드를 공개하면 MIT 라 누구나 셀프호스트 경쟁 가능 → 서버 코드는 비공개로 둬야 하는데, 그 순간 **A(비공개 모듈 분리)와 사실상 수렴**한다. 차이는 "셀프호스트 팀 서버를 파느냐(A) 안 파느냐(C)"뿐.
- 호스팅 운영 부담(가용성·보안·개인정보)이 1인에게 옴. `.oculpm/` 저널이 서버를 지나는 순간 "데이터는 기계를 떠나지 않는다" 약속에 예외가 생김 — Notion OAuth 때처럼 무상태 설계 또는 E2E 암호화가 필요.
- 앱 내 팀 뷰 UI(클라이언트 쪽)를 MIT 코어에 넣을지 말지의 경계 문제는 여전히 남는다.

**CLA 필요성**: 불필요 — **DCO 로 충분**. 코어는 영원히 MIT 고, 유료 가치는 코드가 아니라 서비스 운영에 있으므로 재라이선스 여지가 필요 없다.

---

## 비교 요약

| | A 분리 open-core | B 라이선스 전환 | C 호스팅 전용 |
|---|---|---|---|
| 기존 MIT 배포분 정합 | 완전 | 신규 커밋만 유효, 서사 충돌 | 완전 |
| "오픈소스" 라벨 | 유지 (코어) | 상실 (AGPL 제외) | 유지 |
| 전환 비용 (지금) | 팀 표면 신설 시점에 지불 | 지금은 낮음, 신뢰 비용 큼 | 0 (서버 만들 때 지불) |
| CLA | 불필요 (경계 고정 시) | 사실상 필수 | 불필요 |
| 1인 운영 부담 | repo 2개+키 인프라 | 라이선스 집행 | 서버 운영 |
| 팀 뷰=서버 구조와의 궁합 | 좋음 | 나쁨 (과잉) | 최적 |

## 추천 — 방안 A, 단 C 를 기본 판매 형태로 포함한 형태 {#recommendation}

**코어는 영원히 MIT 로 못 박고(약속 명문화), 팀 기능은 처음부터 별도 비공개 저장소(동기화 서버 + 앱 내 팀 클라이언트 확장)로 시작하며, v1 판매 형태는 호스팅 구독(C)으로 한다.** 셀프호스트 팀 서버 판매(A 의 완전형)는 수요가 증명되면 추가한다.

근거:

1. **팀 뷰=서버 필요라는 제품 구조가 이미 경계를 그어놨다.** PostHog·Cal.com 이 고생한 "코어에서 기능 갈라내기"가 여기엔 없다 — 팀 표면은 아직 0줄이고, 앞으로 짤 코드를 어느 repo 에 두느냐의 문제일 뿐이다. 전환 비용이 구조적으로 가장 싼 방안.
2. **B 는 초기 커뮤니티 단계에서 얻는 것보다 잃는 것이 크다.** 성공 프록시가 스타·다운로드·이슈 유입(Decision 1)인데, source-available 전환은 정확히 그 지표를 해친다(Forgejo 사례가 보여준 신뢰 리스크). 지킬 대상(서버)이 아직 없으니 지불할 이유도 없다.
3. **Obsidian 이 이 정확한 조합의 성립을 증명했다** — 로컬-퍼스트 무료 앱 + 옵인 유료 동기화. Ocul-PM 은 여기에 "코어까지 오픈소스"를 얹는 것이라 포지셔닝이 더 강하다.
4. **CLA 없이 DCO 만으로 갈 수 있다.** "코어는 영원히 MIT, 유료화는 팀 서버·팀 모듈에만" 경계를 공개 문서로 고정하면 재라이선스 여지가 필요 없고, Forgejo 식 "구조적으로 럭풀 불가" 서사를 오히려 신뢰 자산으로 쓸 수 있다. 1인 개발에 CLA 서명 인프라·법률 검토 부담도 없다.

실행 시점: Decision 2 대로 착수 트리거는 팀 수요 신호 유지. 지금 당장 할 일은 (1) 발사 문구와 함께 "코어는 영원히 MIT" 약속을 README/랜딩에 한 줄로 명문화, (2) `CONTRIBUTING.md` 에 DCO(sign-off) 채택, (3) 팀 기능 코드는 이 저장소에 커밋하지 않는다는 원칙 확정 — 이 세 가지뿐이다.

## 사용자가 결정해야 할 질문 {#open-questions}

1. **경계 고정 약속** — "지금 MIT 코어에 있는 기능은 영원히 무료·MIT" 를 공개 문서로 못 박는 데 동의하는가? (동의 = CLA 불필요·DCO 채택. 반대로 코어 기능의 유료 이동 여지를 남기려면 외부 기여를 받기 전에 CLA 를 세팅해야 한다.)
2. **"개인 무료"의 정의** — 회사 안에서 혼자 쓰는 직원도 "개인"인가? (Obsidian 은 2025년 상용 개인 사용까지 무료로 정리했다. 권고: 팀 기능을 안 쓰는 한 회사 내 사용도 무료 — 집행 불가능한 조항을 만들지 않는 쪽.)
3. **팀 서버의 데이터 스탠스** — 호스팅 팀 서버가 저널 원문을 저장하는 모델인가, E2E 암호화 릴레이(서버는 못 읽음)인가? 후자는 "데이터는 기계를 떠나지 않는다" 서사를 지키지만 팀 웹 뷰 구현이 제한된다. (가격·아키텍처 양쪽에 선행하는 결정.)

---

*출처: [PostHog ee/LICENSE](https://github.com/PostHog/posthog/blob/master/ee/LICENSE) · [PostHog #2824](https://github.com/PostHog/posthog/issues/2824) · [Cal.com AGPL+EE 블로그](https://calcom.framer.website/blog/changing-to-agplv3-and-introducing-enterprise-edition) · [Cal.com ee/LICENSE](https://github.com/calcom/cal.com/blob/main/packages/features/ee/LICENSE) · [FSL 공식](https://fsl.software/) · [Sentry licensing](https://open.sentry.io/licensing) · [TechCrunch FSL](https://techcrunch.com/2023/11/20/with-functional-source-license-sentry-wants-to-grant-developers-freedom-without-harmful-free-riding/) · [The Register FSL 비판](https://www.theregister.com/2023/11/20/sentry_introduces_the_functional_source/) · [Plausible 라이선스 전환](https://plausible.io/blog/open-source-licenses) · [Plausible $1M ARR](https://plausible.io/blog/open-source-saas) · [Forgejo GPLv3+ (LWN)](https://lwn.net/Articles/986998/) · [Forgejo vs Gitea](https://forgejo.org/compare-to-gitea/) · [Obsidian license](https://obsidian.md/license) · [CLA vs DCO (opensource.com)](https://opensource.com/article/18/3/cla-vs-dco-whats-difference) · [Kate Downing DCO/CLA](https://katedowninglaw.com/2019/02/15/should-i-use-a-developers-certificate-of-origin-or-a-contributor-agreement/)*

## 결론 (2026-08-01 · 사용자 위임 → 추천안 채택)

사용자가 "최선의 선택으로 진행"을 위임(2026-08-01)해 {#recommendation} 을 그대로 확정한다:

- **메커니즘 = 방안 A+C 조합**: 코어(현 저장소 전체)는 **영원히 MIT** — README 한/영 "라이선스와 약속" 섹션에 명문화 완료. 팀 기능(동기화 서버·팀 뷰)은 처음부터 **별도 비공개 저장소**로 개발하고, v1 판매 형태는 **호스팅 구독**. 셀프호스트 팀 서버 판매는 수요 증명 후 재론.
- **Q1 경계 고정 = 동의**: "지금 MIT 코어에 있는 기능은 영원히 무료·MIT" 공개 약속. 따라서 CLA 불요 — **DCO 채택** (CONTRIBUTING.md 신설).
- **Q2 "개인"의 정의 = 팀 기능을 쓰지 않는 한 회사 내 사용 포함 무료** (Obsidian 2025 정책 선례 — 집행 불가능한 조항을 만들지 않는다).
- **Q3 팀 서버 데이터 스탠스 = E2E 암호화 릴레이 우선 원칙**: 서버는 저널 원문을 읽지 못하는 설계를 기본으로 하고, 팀 웹 뷰 요구가 실수요로 검증되면 옵인 평문 저장을 별도 재론. "데이터는 기계를 떠나지 않는다" 서사가 팀 플랜에서도 기본값.
- **집행 원칙**: 팀 기능 코드는 이 저장소에 커밋하지 않는다. 착수 트리거(팀 수요 신호)는 Decision 2 대로 유지 — 이 결정은 "무엇을/어떻게"의 확정이지 착수 명령이 아니다.

## 토의 / 메모
<!-- oculpm:discussion-log begin v1 -->
| 시각 | 작성자 | 내용 |
|---|---|---|
| 2026-07-31T05:40:00+09:00 | claude-code | 웹 선례 조사(PostHog·Cal.com·Sentry FSL·Plausible·Forgejo·Obsidian) 기반 방안 3종 작성. 추천 = A(경계 분리)+C(호스팅 판매) 조합, DCO 채택. 사용자 결정 대기: {#open-questions} 3건 |
| 2026-08-01T00:00:00+09:00 | claude-code | 사용자 위임("네가 최선의 선택으로 진행")으로 추천안 확정 — A+C·DCO·개인=비팀사용전부·E2E우선. README 한/영 명문화+CONTRIBUTING.md(DCO) 실행, status resolved |
<!-- oculpm:discussion-log end -->
