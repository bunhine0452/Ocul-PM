"""에이전트 성적표 — 지표 계산 (2026-10-04 초안, 정의는 agent-report-card.md).

    python3 docs/launch/agent-report-card.py [--samples]

저장소 루트에서 실행한다. 입력 셋:
  - .oculpm/journal/**/*.md frontmatter + 본문 (전 기간)
  - git log (전 기간)
  - ~/.claude/projects/<루트 경로의 - 치환>/*.jsonl Claude Code 대화 기록
    (+ <세션>/subagents/*.jsonl, 보존 창 기본 30일)
지금 도는 대화를 빼려면 REPORT_CARD_EXCLUDE_SESSION=<id>.
"""
import collections
import datetime as dt
import glob
import json
import os
import re
import subprocess
import sys

ROOT = subprocess.run(
    ["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True
).stdout.strip()
TRANSCRIPTS = os.path.expanduser("~/.claude/projects/" + re.sub(r"[^A-Za-z0-9]", "-", ROOT))
EXCLUDE_SESSION = os.environ.get("REPORT_CARD_EXCLUDE_SESSION")
EDIT_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
BUG_TYPES = {"bug", "error", "fix"}
BUILD_TYPES = {"feature", "refactor"}
SAMPLES = "--samples" in sys.argv

# 루트 자신 · 형제 워크트리(ai-pm-release) · .claude/worktrees/<이름> 을 같은 저장소로 본다.
PATH_RE = re.compile(re.escape(ROOT) + r"(?:-[^/]+)?/(?:\.claude/worktrees/[^/]+/)?(.+)$")


def norm(p):
    if not p:
        return None
    m = PATH_RE.search(p)
    return m.group(1) if m else None


def recorded_scope(rel):
    """기록 대상인 파일인가 — .oculpm/ 자체(일지·플랜)는 기록의 산출물이라 뺀다."""
    return rel is not None and not rel.startswith(".oculpm/")


def kind(rel):
    if re.search(r"(^|/)(__tests__|tests?)/|_tests?\.rs$|\.test\.tsx?$|\.spec\.", rel):
        return "test"
    if rel.startswith((".github/", "e2e/")):
        return "ci"
    if rel.startswith("docs/") or rel.endswith(".md"):
        return "docs"
    if re.search(r"\.(rs|ts|tsx|css)$", rel):
        return "source"
    return "other"


# ---------------------------------------------------------------- journals
def parse_journals():
    out = []
    for p in sorted(glob.glob(f"{ROOT}/.oculpm/journal/*/*/*.md")):
        s = open(p, encoding="utf-8", errors="ignore").read()
        m = re.match(r"^---\n(.*?)\n---\n?(.*)$", s, re.S)
        if not m:
            continue
        fm, body = m.group(1), m.group(2)

        def f(key):
            r = re.search(rf"^{key}:\s*\"?([^\"\n]*)\"?", fm, re.M)
            return r.group(1).strip() if r else None

        agent = re.search(r"^agent:\s*\n((?:\s+.*\n?)+?)(?=^\S)", fm + "\nZ", re.M)
        ablock = agent.group(1) if agent else ""
        aid = re.search(r"id:\s*\"?([^\"\n]+)", ablock)
        aver = re.search(r"version:\s*\"?([^\"\n]+)", ablock)
        asess = re.search(r"session:\s*\"?([^\"\n]+)", ablock)
        try:
            ts = dt.datetime.fromisoformat(f("created_at")) if f("created_at") else None
        except ValueError:
            ts = None
        out.append(dict(
            path=os.path.relpath(p, ROOT), type=f("type"), status=f("status"), ts=ts,
            agent=(aid.group(1).strip() if aid else "?"),
            model=(aver.group(1).strip() if aver else None),
            session=(asess.group(1).strip() if asess else None),
            verified=f("verified_by_user"),
            files={x.strip('"') for x in re.findall(r"-\s+path:\s*(\S+)", fm)},
            body=body,
        ))
    return out


VERIFY_HEADER = re.compile(r"^#{2,4}\s*(검증|Verification)", re.M)
CMD_EVIDENCE = re.compile(
    r"cargo (test|clippy|build|check|fmt)|pnpm (test|typecheck|lint|build|vitest|tauri build)"
    r"|vitest|tsc --noEmit|\btsc\b|pytest|npm (run )?test|exit 0|통과|green|초록"
)
SELF_UNVERIFIED = re.compile(
    r"실기기[^\n]{0,20}(미확인|확인 (대기|안|못|전)|미검증)|육안[^\n]{0,15}(대기|미확인|못|안 했|이월)"
    r"|미검증|검증하지 (못|않)|확인하지 (못|않)|확인 못|not (yet )?verified|unverified"
    r"|사용자 (육안 )?확인 대기|수동 확인 (필요|대기)"
)


def verify_section(body):
    """검증 칸 본문만 — 원인 설명의 "확인하지 않아서" 를 미검증으로 오인하지 않게."""
    m = VERIFY_HEADER.search(body)
    if not m:
        return ""
    rest = body[m.end():]
    nxt = re.search(r"^#{1,4}\s", rest, re.M)
    return rest[: nxt.start()] if nxt else rest


# ---------------------------------------------------------------- transcripts
def parse_transcripts():
    """대화 id → 성공한 편집 파일 · 일지 도구 호출 · 도구가 버린 경로."""
    sessions = collections.defaultdict(lambda: dict(
        edits=set(), journal_calls=0, journal_files=set(), dropped=set(), start=None, end=None))
    files = glob.glob(f"{TRANSCRIPTS}/*.jsonl") + glob.glob(f"{TRANSCRIPTS}/*/subagents/*.jsonl")
    for fp in files:
        sid = fp.split("/")[-3] if "/subagents/" in fp else os.path.basename(fp)[:-6]
        if sid == EXCLUDE_SESSION:
            continue
        S = sessions[sid]
        pending, failed, jw_ids = {}, set(), set()
        for line in open(fp, encoding="utf-8", errors="ignore"):
            try:
                o = json.loads(line)
            except json.JSONDecodeError:
                continue
            t = o.get("timestamp")
            if t:
                S["start"] = min(S["start"] or t, t)
                S["end"] = max(S["end"] or t, t)
            msg = o.get("message") or {}
            content = msg.get("content") if isinstance(msg, dict) else None
            if not isinstance(content, list):
                continue
            for b in content:
                if not isinstance(b, dict):
                    continue
                if b.get("type") == "tool_use":
                    name, inp = b.get("name", ""), b.get("input") or {}
                    if name in EDIT_TOOLS:
                        rel = norm(inp.get("file_path") or inp.get("notebook_path"))
                        if rel:
                            pending[b.get("id")] = rel
                    elif name.endswith("journal_write"):
                        S["journal_calls"] += 1
                        jw_ids.add(b.get("id"))
                        ft = inp.get("files_touched")
                        if isinstance(ft, list):
                            # 문자열 원소는 서버가 경고 없이 버린다 (mcp/tools/mod.rs 의 filter_map)
                            S["dropped"] |= {x for x in ft if isinstance(x, str)}
                elif b.get("type") == "tool_result":
                    if b.get("is_error"):
                        failed.add(b.get("tool_use_id"))
                    elif b.get("tool_use_id") in jw_ids:
                        # 일지에 대화 id 가 안 붙은 경우가 있어, 도구가 돌려준 저장 경로로도 잇는다.
                        txt = json.dumps(b.get("content"), ensure_ascii=False)
                        S["journal_files"] |= set(re.findall(r'(\.oculpm/journal/[^"\\]+?\.md)', txt))
        for tid, rel in pending.items():
            if tid not in failed:
                S["edits"].add(rel)
    return sessions


def main():
    J = parse_journals()
    T = parse_transcripts()
    done = [j for j in J if j["status"] == "done"]
    res = {}

    # ---- 볼륨·리듬
    ts = sorted(j["ts"] for j in J if j["ts"])
    days = sorted({t.date() for t in ts})
    streak = best = 1
    for a, b in zip(days, days[1:]):
        streak = streak + 1 if (b - a).days == 1 else 1
        best = max(best, streak)
    hours = collections.Counter(t.hour for t in ts)
    per_day = collections.Counter(t.date() for t in ts)
    month = collections.Counter(t.strftime("%Y-%m") for t in ts)
    res["volume"] = dict(
        entries=len(J), files_touched=sum(len(j["files"]) for j in J),
        first=str(days[0]), last=str(days[-1]), active_days=len(days),
        span_days=(days[-1] - days[0]).days + 1, longest_streak=best,
        busiest_day=[str(per_day.most_common(1)[0][0]), per_day.most_common(1)[0][1]],
        per_month=dict(sorted(month.items())),
        hours={h: hours.get(h, 0) for h in range(24)},
        night_share_0_5=round(sum(hours.get(h, 0) for h in range(0, 6)) / len(ts), 3),
        types=dict(collections.Counter(j["type"] for j in J)),
        agents=dict(collections.Counter(j["agent"].split(":")[0] for j in J)),
    )

    def mnorm(m):
        if not m:
            return "unknown"
        m = m.lower().replace("-", " ").replace("claude ", "")
        m = re.sub(r"\(1m[^)]*\)|\[1m\]|·.*$", "", m)
        return re.sub(r"\s+", " ", m).strip()
    res["models"] = collections.Counter(mnorm(j["model"]) for j in J).most_common(12)

    # ---- 검증 칸 (전 기간, done 일지)
    unv = [j for j in done if SELF_UNVERIFIED.search(verify_section(j["body"]))]
    res["verification"] = dict(
        done=len(done),
        with_section=sum(1 for j in done if VERIFY_HEADER.search(j["body"])),
        with_command_evidence=sum(1 for j in done if CMD_EVIDENCE.search(verify_section(j["body"]))),
        self_reported_unverified=len(unv),
        button_verified=sum(1 for j in done if j["verified"] == "true"),
    )
    if SAMPLES:
        res["_samples_unverified"] = [
            (j["path"], SELF_UNVERIFIED.search(verify_section(j["body"])).group(0))
            for j in unv[:: max(1, len(unv) // 12)]
        ]

    # ---- 다시 고친 버그 (전 기간) — 공용 파일(일지 3% 이상 등장)은 겹침에서 뺀다
    df = collections.Counter(f for j in J for f in j["files"] if recorded_scope(f))
    hub_cut = max(3, int(len(J) * 0.03))
    hubs = {f for f, c in df.items() if c >= hub_cut}
    bugs = [j for j in J if j["type"] in BUG_TYPES and j["ts"]]
    builds = [j for j in J if j["type"] in BUILD_TYPES and j["ts"]]
    rework14 = rework7 = 0
    samples = []
    for b in bugs:
        own = {f for f in b["files"] if recorded_scope(f)} - hubs
        hits = [e for e in builds if b["ts"] - dt.timedelta(days=14) <= e["ts"] < b["ts"] and (e["files"] & own)]
        if hits:
            rework14 += 1
            rework7 += any(e["ts"] >= b["ts"] - dt.timedelta(days=7) for e in hits)
            if len(samples) < 8:
                samples.append((b["path"], hits[-1]["path"], sorted(hits[-1]["files"] & own)[:2]))
    bug_files = collections.Counter(
        f for b in bugs for f in b["files"] if recorded_scope(f) and f not in hubs and kind(f) != "test")
    bug_month = collections.Counter(b["ts"].strftime("%Y-%m") for b in bugs)
    res["bugs"] = dict(
        bug_entries=len(bugs), rework_within_7d=rework7, rework_within_14d=rework14,
        hub_cut=hub_cut, hubs=sorted(hubs, key=lambda f: -df[f]),
        top_bug_files_excl_tests=bug_files.most_common(8),
        bug_share_by_month={m: round(bug_month.get(m, 0) / c, 2) for m, c in sorted(month.items())},
    )
    if SAMPLES:
        res["_samples_rework"] = samples

    # ---- 대화 단위: 기록률 + 일지에 없는 편집 (대화 기록 보존 창)
    by_session = collections.defaultdict(list)
    for j in J:
        if j["session"]:
            by_session[j["session"]].append(j)
    jpath = {j["path"]: j for j in J}
    worked = recorded = edited = omitted = dropped = 0
    omitted_kind, edited_kind = collections.Counter(), collections.Counter()
    for sid, S in T.items():
        work = {f for f in S["edits"] if recorded_scope(f)}
        if not work:
            continue
        worked += 1
        js = list(by_session.get(sid, []))
        js += [jpath[p] for p in S["journal_files"] if p in jpath and jpath[p] not in js]
        if not (js or S["journal_calls"]):
            continue
        recorded += 1
        listed = set().union(*[j["files"] for j in js]) if js else set()
        for f in work:
            edited += 1
            edited_kind[kind(f)] += 1
            if f in listed:
                continue
            if f in S["dropped"]:
                dropped += 1
            else:
                omitted += 1
                omitted_kind[kind(f)] += 1
    window = sorted(x for S in T.values() for x in (S["start"], S["end"]) if x)
    res["conversations"] = dict(
        window=[window[0][:10], window[-1][:10]] if window else None,
        conversations_total=len(T), with_file_edits=worked, with_journal=recorded,
        files_edited_in_journaled_convs=edited, omitted_by_agent=omitted, dropped_by_tool=dropped,
        omitted_by_kind={k: f"{omitted_kind[k]}/{edited_kind[k]}" for k in edited_kind},
    )

    # ---- 일지 도구 입력 모양
    calls = str_calls = str_paths = 0
    for fp in glob.glob(f"{TRANSCRIPTS}/*.jsonl") + glob.glob(f"{TRANSCRIPTS}/*/subagents/*.jsonl"):
        if EXCLUDE_SESSION and EXCLUDE_SESSION in fp:
            continue
        for line in open(fp, encoding="utf-8", errors="ignore"):
            if "journal_write" not in line:
                continue
            try:
                content = (json.loads(line).get("message") or {}).get("content")
            except json.JSONDecodeError:
                continue
            for b in content if isinstance(content, list) else []:
                if not (isinstance(b, dict) and b.get("type") == "tool_use"
                        and b.get("name", "").endswith("journal_write")
                        and (b.get("input") or {}).get("body_markdown")):
                    continue
                calls += 1
                ft = b["input"].get("files_touched") or []
                n = sum(isinstance(x, str) for x in ft) if isinstance(ft, list) else 0
                str_calls += n > 0
                str_paths += n
    res["journal_tool"] = dict(calls=calls, string_form_calls=str_calls, string_paths_dropped=str_paths)

    # ---- git
    log = subprocess.run(["git", "-C", ROOT, "log", "--no-merges", "--format=%B%x1e"],
                         capture_output=True, text=True).stdout
    commits = [c for c in log.split("\x1e") if c.strip()]
    res["git"] = dict(
        commits=len(commits),
        claude_coauthored=sum(1 for c in commits if re.search(r"Co-Authored-By:\s*Claude", c, re.I)),
    )

    print(json.dumps(res, ensure_ascii=False, indent=1, default=str))


if __name__ == "__main__":
    main()
