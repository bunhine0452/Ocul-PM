"""기다리지 않는 dots — 2단계(무인 실행 → 재개) 스파이크.

각 CLI 마다:
  1단계: worktree 안에서 무인 실행. 편집은 허용, `git commit` 은 막힌 상태.
         막히면 기다리지 말고 "NEEDS: …" 로 끝내라고 지시.
  2단계: **별도 프로세스**로 같은 세션을 재개하며 커밋 권한만 추가.
  검증: 1단계 편집이 남아 있고, 2단계에서 커밋이 생겼는가.
"""
import json, os, subprocess, sys, tempfile, time

BASE = os.environ.get("SPIKE_WORK") or tempfile.mkdtemp(prefix="twophase-")
LOG = open(os.path.join(BASE, "events.log"), "a")
T0 = time.time()
TASK = ("Append the line 'hello from background agent' to notes.txt, then commit it with the shell "
        "command `git commit -am \"bg: hello\"` (exactly that, nothing appended). If any action is denied or blocked, do NOT retry or "
        "work around it — stop immediately and reply with one line: NEEDS: <the exact command or permission>.")


def log(tag, obj):
    line = f"[{time.time()-T0:7.2f}] {tag} {json.dumps(obj, ensure_ascii=False)[:900]}"
    LOG.write(line + "\n"); LOG.flush(); print(line, flush=True)


def sh(*args, cwd):
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True)


def make_worktree(name):
    repo = os.path.join(BASE, f"{name}-repo")
    os.makedirs(repo)
    sh("git", "init", "-q", "-b", "main", cwd=repo)
    open(os.path.join(repo, "notes.txt"), "w").write("first line\n")
    sh("git", "add", ".", cwd=repo)
    sh("git", "-c", "user.name=spike", "-c", "user.email=spike@example.invalid", "commit", "-qm", "init", cwd=repo)
    wt = os.path.join(BASE, f"{name}-wt")
    sh("git", "worktree", "add", "-q", "-b", f"bg/{name}", wt, cwd=repo)
    # 에이전트의 커밋이 신원 없이 실패하지 않게 worktree 로컬 신원
    sh("git", "config", "user.name", "bg-agent", cwd=wt)
    sh("git", "config", "user.email", "bg-agent@example.invalid", cwd=wt)
    return repo, wt


def run_stream(cmd, cwd, env=None):
    p = subprocess.Popen(cmd, cwd=cwd, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    events = []
    for raw in p.stdout:
        raw = raw.strip()
        if not raw:
            continue
        try:
            events.append(json.loads(raw))
        except Exception:
            log("RAW", raw[:300])
    err = p.stderr.read()
    p.wait()
    return p.returncode, events, err


def state(wt):
    notes = open(os.path.join(wt, "notes.txt")).read()
    head = sh("git", "log", "--oneline", "-3", cwd=wt).stdout.strip().splitlines()
    dirty = sh("git", "status", "--short", cwd=wt).stdout.strip()
    return {"notes_has_hello": "hello from background agent" in notes, "log": head, "dirty": dirty}


# ── Claude ──────────────────────────────────────────────────────────────────
def claude():
    env = {k: v for k, v in os.environ.items() if not (k == "CLAUDECODE" or k.startswith("CLAUDE_CODE_"))}
    _, wt = make_worktree("claude")
    base = ["claude", "-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "dontAsk"]

    code, ev, err = run_stream(base + ["--allowedTools=Read,Edit,Write", TASK], wt, env)
    sid = None
    for e in ev:
        if e.get("type") == "system" and e.get("subtype") == "init":
            sid = e.get("session_id")
            tools = e.get("tools", [])
            log("C1 init", {"session_id": sid, "oculpm_tools": [t for t in tools if "oculpm" in t][:6]})
        if e.get("type") == "result":
            log("C1 result", {k: e.get(k) for k in ("subtype", "is_error", "result", "permission_denials", "total_cost_usd", "num_turns")})
    log("C1 exit", {"code": code, "stderr": err[-300:], "state": state(wt)})
    if not sid:
        return

    code, ev, err = run_stream(base + ["--resume", sid, "--allowedTools=Read,Edit,Write,Bash(git commit:*)",
                                       "Approved: you may now run the git commit. Continue the task and finish it."], wt, env)
    for e in ev:
        if e.get("type") == "result":
            log("C2 result", {k: e.get(k) for k in ("subtype", "is_error", "result", "permission_denials", "session_id", "total_cost_usd", "num_turns")})
    log("C2 exit", {"code": code, "stderr": err[-300:], "state": state(wt)})


# ── Codex ───────────────────────────────────────────────────────────────────
def codex():
    repo, wt = make_worktree("codex")
    # 실제 프로젝트처럼: /tmp 쓰기 허용을 꺼서 worktree 밖(본 저장소 .git)은 못 쓰게
    no_tmp = ["-c", "sandbox_workspace_write.exclude_slash_tmp=true",
              "-c", "sandbox_workspace_write.exclude_tmpdir_env_var=true"]
    code, ev, err = run_stream(["codex", "exec", "--json", "-s", "workspace-write", *no_tmp, "-C", wt, TASK], wt)
    tid = None
    for e in ev:
        t = e.get("type")
        if t == "thread.started":
            tid = e.get("thread_id")
        if t in ("thread.started", "turn.completed", "turn.failed", "error") or (
                t == "item.completed" and e.get("item", {}).get("type") in ("command_execution", "agent_message", "file_change")):
            log("X1 " + t, e)
    log("X1 exit", {"code": code, "stderr": err[-300:], "thread_id": tid, "state": state(wt)})

    code, ev, err = run_stream(["codex", "exec", "--json", "-c", 'sandbox_mode="workspace-write"', *no_tmp,
                                "-c", f'sandbox_workspace_write.writable_roots=["{os.path.realpath(os.path.join(repo, ".git"))}"]', "resume", tid,
                                "Approved: you may now run the git commit. Continue the task and finish it."], wt)
    for e in ev:
        t = e.get("type")
        if t in ("thread.started", "turn.completed", "turn.failed", "error") or (
                t == "item.completed" and e.get("item", {}).get("type") in ("command_execution", "agent_message", "file_change")):
            log("X2 " + t, e)
    log("X2 exit", {"code": code, "stderr": err[-300:], "state": state(wt)})


if __name__ == "__main__":
    log("BASE", BASE)
    which = sys.argv[1:] or ["claude", "codex"]
    if "claude" in which: claude()
    if "codex" in which: codex()
