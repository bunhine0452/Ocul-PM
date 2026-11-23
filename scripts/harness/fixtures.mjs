#!/usr/bin/env node
/**
 * 하네스 픽스처 — 이 저장소의 실제 `.oculpm` 일지 · 계획 · 최근 커밋에서 `generated/fixtures.json` 을 뽑는다.
 * 커밋되는 픽스처는 없다(출력은 .gitignore). 돌릴 때마다 지금의 저장소로 새로 만든다.
 *
 * 사용: node scripts/harness/fixtures.mjs [--days 8] [--repo <경로>] [--out <파일>]
 *
 * 모양의 근거(어기면 화면에 가짜 결함이 난다 — README 「함정」):
 * - 일지 제목은 frontmatter 가 아니라 본문 첫 줄 `[x] 제목` (checkbox).
 * - 계획 항목의 phase 는 단계 **이름** (parse.rs) — id 를 넣으면 안 된다.
 * - evidence 는 src-tauri/src/oculpm/evidence.rs 의 등급(0 · 1 · 2)을 그대로 흉내 낸다.
 * - git op 는 한 글자(M/A/D). `related` · `tags` 는 배열(문자열로 읽으면 JournalRelated 가 깨진다).
 *
 * 개인 정보 · 시크릿: 일지는 앱이 쓸 때 이미 가렸지만(redact.rs) 한 번 더 가린다 — 키 모양 · 이메일 ·
 * 집 폴더 이름을 바꿔 써서, 이 파일이 어디로 새도 이 기기의 사용자 이름이 박혀 있지 않게 한다.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = import.meta.dirname;
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const repo = path.resolve(arg("repo", path.join(here, "..", "..")));
const out = path.resolve(arg("out", path.join(here, "generated", "fixtures.json")));
const days = Number(arg("days", "8"));

const J = path.join(repo, ".oculpm", "journal");
const P = path.join(repo, ".oculpm", "planner");

// ---- 가리기 -------------------------------------------------------------

let scrubbed = 0;
const hit = (re, to) => (s) =>
  s.replace(re, (...m) => {
    scrubbed += 1;
    return typeof to === "function" ? to(...m) : to;
  });
const home = os.homedir();
const user = path.basename(home);
const SCRUBBERS = [
  hit(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[비밀 키]"),
  hit(/\bsk-[A-Za-z0-9_-]{16,}/g, "sk-[가림]"),
  hit(/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "gh_[가림]"),
  hit(/\bAKIA[0-9A-Z]{16}\b/g, "AKIA[가림]"),
  hit(/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, "xox-[가림]"),
  hit(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, "[토큰]"),
  hit(/\b(api[_-]?key|secret|passwd|password|token)(\s*[:=]\s*)["']?[A-Za-z0-9+/_-]{12,}["']?/gi, (_m, k, sep) => `${k}${sep}[가림]`),
  hit(/\b[\w.+-]+@(?!example\.)[\w-]+(?:\.[\w-]+)+\b/g, "dev@example.com"),
  // 집 폴더 — 이 기기의 실제 경로와 일반 `/Users/<이름>` 모두.
  hit(new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "/Users/dev"),
  hit(/\/Users\/(?!dev\b)[^/\s"'`)]+/g, "/Users/dev"),
  hit(/C:\\Users\\(?!dev\b)[^\\\s"'`)]+/g, "C:\\Users\\dev"),
  user && user !== "dev" ? hit(new RegExp(`\\b${user.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), "dev") : (s) => s,
];
const scrub = (s) => (typeof s === "string" ? SCRUBBERS.reduce((acc, f) => f(acc), s) : s);

// ---- 일지 ---------------------------------------------------------------

// `\b` 는 JS 에서 ASCII 만 낱말로 쳐서 「검증」 뒤에서 안 선다 — 유니코드 글자 · 숫자가 이어지지 않는 자리로 쓴다.
const HEADER = /^#{2,4}\s*(검증|Verification)(?![\p{L}\p{N}_])/mu;
const NEXT_HEADER = /^#{1,4}\s/m;
const CMD =
  /cargo (test|clippy|build|check|fmt)|pnpm (test|typecheck|lint|build|vitest|tauri build)|vitest|tsc --noEmit|\btsc\b|pytest|npm (run )?test|exit 0|통과|green|초록/;
const SELF_UNVERIFIED =
  /실기기[^\n]{0,20}(미확인|확인 (대기|안|못|전)|미검증)|육안[^\n]{0,15}(대기|미확인|못|안 했|이월)|미검증|검증하지 (못|않)|확인하지 (못|않)|확인 못|not (yet )?verified|unverified|사용자 (육안 )?확인 대기|수동 확인 (필요|대기)/;

function evidenceOf(body) {
  const m = HEADER.exec(body);
  if (!m) return 0;
  const rest = body.slice(m.index + m[0].length);
  const n = NEXT_HEADER.exec(rest);
  const sec = n ? rest.slice(0, n.index) : rest;
  return CMD.test(sec) && !SELF_UNVERIFIED.test(sec) ? 2 : 1;
}

const unquote = (v) => v.trim().replace(/^"(.*)"$/, "$1");

function parseFm(text) {
  if (!text.startsWith("---")) return [{}, text];
  const end = text.indexOf("\n---", 3);
  const fmRaw = text.slice(3, end);
  const body = text.slice(end + 4).replace(/^\n+/, "");
  const fm = { files: [], tags: [], related: [], agent: {} };
  let section = null;
  let cur = null;
  for (const line of fmRaw.split("\n")) {
    if (!line.trim()) continue;
    if (!line.startsWith(" ") && line.includes(":")) {
      const i = line.indexOf(":");
      const k = line.slice(0, i);
      const v = unquote(line.slice(i + 1));
      section = k;
      if (v && v !== "[]") fm[k] = v;
      continue;
    }
    const s = line.trim();
    if (section === "agent") {
      const i = s.indexOf(":");
      fm.agent[s.slice(0, i).trim()] = unquote(s.slice(i + 1));
    } else if (section === "files_touched") {
      if (s.startsWith("- path:")) {
        cur = { path: unquote(s.slice(s.indexOf(":") + 1)), op: "update" };
        fm.files.push(cur);
      } else if (s.startsWith("op:") && cur) cur.op = s.slice(3).trim();
    } else if (section === "tags" && s.startsWith("- ")) fm.tags.push(unquote(s.slice(2)));
    else if (section === "related") {
      if (s.startsWith("- ref:")) {
        cur = { ref: unquote(s.slice(s.indexOf(":") + 1)), kind: "followup" };
        fm.related.push(cur);
      } else if (s.startsWith("kind:") && cur) cur.kind = unquote(s.slice(5));
    }
  }
  return [fm, body];
}

function titleOf(body, slug) {
  const lines = body.trim().split("\n");
  const first = lines[0] ?? "";
  const m = /^\[( |x|X)\]\s*(.+)/.exec(first);
  if (m) return [m[2].trim(), m[1].toLowerCase() === "x", lines.slice(1).join("\n").replace(/^\n+/, "")];
  if (first.startsWith("# ")) return [first.slice(2).trim(), null, body];
  return [slug, null, body];
}

function walk(dir) {
  const acc = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) acc.push(...walk(full));
    else if (e.name.endsWith(".md")) acc.push(full);
  }
  return acc.sort();
}

if (!fs.existsSync(J)) {
  console.error(`일지 폴더가 없어요: ${J} — --repo 로 .oculpm 이 있는 저장소를 가리켜요.`);
  process.exit(1);
}
const workdays = fs
  .readdirSync(J)
  .filter((d) => /^\d{8}$/.test(d))
  .sort()
  .slice(-days);

const journals = [];
for (const wd of workdays) {
  for (const full of walk(path.join(J, wd))) {
    const rel = path.relative(J, full).split(path.sep).join("/");
    const text = fs.readFileSync(full, "utf8");
    const [fm, body] = parseFm(text);
    const slug = fm.slug ?? path.basename(full, ".md");
    const [title, checkbox, rest] = titleOf(body, slug);
    journals.push({
      relative_path: rel,
      workday: wd,
      type: fm.type ?? "chore",
      slug,
      status: fm.status ?? "done",
      difficulty: fm.difficulty ?? null,
      title: scrub(title),
      checkbox,
      session_id: fm.session_id ?? `${wd}-001`,
      agent_id: fm.agent.id ?? "claude-code",
      agent_version: fm.agent.version ?? null,
      agent_session: null,
      verified_by_user: fm.verified_by_user === "true",
      verified_stale: false,
      evidence: evidenceOf(body),
      created_at: fm.created_at ?? `${wd.slice(0, 4)}-${wd.slice(4, 6)}-${wd.slice(6)}T09:00:00+09:00`,
      updated_at: fm.updated_at ?? null,
      tags: fm.tags,
      files: fm.files.map((f) => ({ path: scrub(f.path), op: f.op })),
      related: fm.related,
      language: fm.language ?? "ko",
      files_count: fm.files.length,
      body_markdown: scrub(rest),
      byte_size: Buffer.byteLength(text),
    });
  }
}
journals.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));

// ---- 계획 ---------------------------------------------------------------

const ITEM = /^(\s*)- \[(.)\]\s+(.*?)\s*\{#([A-Za-z0-9_-]+)\}\s*$/;
const PHASE = /^##\s+(.*?)\s*(\{#([A-Za-z0-9_-]+)\})?\s*$/;
const STATUS = { " ": "todo", x: "done", X: "done", "~": "in_progress", "!": "blocked", ">": "deferred", "-": "dropped" };
const LOG_STATUS = { "☐": "todo", x: "done", "~": "in_progress", "!": "blocked", ">": "deferred", "-": "dropped" };
const VERDICT = /^(판정|verdict) (✓|✗)\s*(.*)/;
const weight = (s) => ({ todo: 0, blocked: 0, in_progress: 0.5, done: 1 })[s];

const plans = [];
for (const f of fs.existsSync(P) ? fs.readdirSync(P).sort() : []) {
  if (!f.endsWith(".md") || f.endsWith(".log.md")) continue;
  const text = fs.readFileSync(path.join(P, f), "utf8");
  const [fm, body] = parseFm(text);
  if (fm.status !== "active") continue;
  const pid = fm.id ?? f.slice(0, -3);
  const phases = [];
  const items = [];
  const logs = [];
  let doneWhen = null;
  let check = null;
  let phase = null;
  let inLog = false;
  let order = 0;
  const parents = {};
  for (const line of body.split("\n")) {
    if (line.includes("plan-log begin")) { inLog = true; continue; }
    if (line.includes("plan-log end")) { inLog = false; continue; }
    if (inLog) {
      const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      if (cells.length >= 6 && /^\d{4}/.test(cells[0])) {
        const [fr, to] = cells[3].split("→").map((x) => x.trim());
        logs.push({
          ts: cells[0],
          item_id: cells[1].replace(/^#/, ""),
          agent_id: cells[2],
          from_status: to === undefined ? null : (LOG_STATUS[fr] ?? null),
          to_status: LOG_STATUS[to === undefined ? fr : to] ?? null,
          journal_ref: cells[4] || null,
          note: scrub(cells[5]) || null,
        });
      }
      continue;
    }
    if (line.startsWith("**완료 조건:**")) { doneWhen = scrub(line.split("**완료 조건:**")[1].trim()); continue; }
    if (line.startsWith("**확인 명령:**")) { check = scrub(line.split("**확인 명령:**")[1].trim()); continue; }
    let m = PHASE.exec(line);
    if (m) {
      phase = m[1].trim();
      phases.push({ phase_id: m[3] ?? null, name: phase });
      continue;
    }
    m = ITEM.exec(line);
    if (m) {
      const indent = m[1].length;
      let parent = null;
      if (indent > 0) {
        for (const lvl of Object.keys(parents).map(Number).sort((a, b) => b - a)) {
          if (lvl < indent) { parent = parents[lvl]; break; }
        }
      }
      parents[indent] = m[4];
      items.push({
        item_id: m[4], phase, title: scrub(m[3]), status: STATUS[m[2]] ?? "todo", order_idx: order,
        parent_item: parent, note: null, last_agent: null, last_update: null, journal_refs: [],
      });
      order += 1;
    }
  }
  for (const lg of logs) {
    const it = items.find((i) => i.item_id === lg.item_id);
    if (!it) continue;
    it.last_agent = lg.agent_id;
    it.last_update = lg.ts;
    if (lg.journal_ref) it.journal_refs.push(lg.journal_ref.replace(".oculpm/journal/", ""));
  }
  let verdict = null;
  for (const lg of [...logs].reverse()) {
    const m = VERDICT.exec(lg.note ?? "");
    if (m) {
      verdict = {
        passed: m[2] === "✓", summary: m[3], ts: lg.ts, agent_id: lg.agent_id, item_id: lg.item_id,
        passed_here_at: m[2] === "✓" ? lg.ts : null,
      };
      break;
    }
  }
  const counted = items.map((i) => weight(i.status)).filter((w) => w !== undefined);
  const progress = counted.length ? counted.reduce((a, b) => a + b, 0) / counted.length : null;
  const phaseDtos = [];
  for (const ph of phases) {
    const its = items.filter((i) => i.phase === ph.name);
    if (!its.length) continue;
    const w = its.map((i) => weight(i.status)).filter((x) => x !== undefined);
    const dc = its.filter((i) => i.status === "done").length;
    phaseDtos.push({
      phase_id: ph.phase_id, name: ph.name,
      status: w.length && w.every((x) => x === 1) ? "done" : dc ? "in_progress" : "todo",
      progress: w.length ? w.reduce((a, b) => a + b, 0) / w.length : null,
      item_count: its.length, done_count: dc, last_agent: null, last_update: null,
    });
  }
  const updated = logs.length ? logs[logs.length - 1].ts : `${fm.updated ?? "2026-01-01"}T09:00:00+09:00`;
  plans.push({
    summary: {
      plan_id: pid, title: scrub(fm.title ?? pid), status: "active", owner_agent: fm.owner ?? "claude-code", progress,
      file_path: `.oculpm/planner/${f}`, updated_at: updated, item_count: items.length,
      done_count: items.filter((i) => i.status === "done").length, last_verdict: verdict, stale_files: [], verdict_from: null,
    },
    items, phases: phaseDtos, decisions: [], warnings: [], done_when: doneWhen, check, log: logs,
  });
}
plans.sort((a, b) => (a.summary.updated_at < b.summary.updated_at ? 1 : -1));

// ---- git 변경: 최근 커밋의 파일과 패치를 「커밋 전 변경」 으로 ------------------

const git = (...args) => {
  try {
    return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
};
const SKIP = /(^|\/)(pnpm-lock\.yaml|Cargo\.lock|bindings\.ts)$|^\.oculpm\/|^landing\/|\.(png|jpe?g|gif|webp|ico|icns|woff2?|svg)$/;
const candidates = [];
const seen = new Set();
for (const sha of git("log", "-n", "14", "--no-merges", "--format=%h").split("\n").filter(Boolean)) {
  for (const line of git("show", "--name-status", "--format=", sha).split("\n")) {
    if (!line.trim()) continue;
    const cols = line.split("\t");
    const p = cols[cols.length - 1];
    if (SKIP.test(p) || seen.has(p)) continue;
    const patch = git("show", "--format=", sha, "--", p);
    if (!patch || patch.split("\n").length > 400) continue;
    seen.add(p);
    candidates.push({ path: p, op: cols[0][0], patch: scrub(patch) });
  }
}
// 일지 어디에도 안 적힌 파일 둘 + 적힌 파일 일곱 — 「일지 없는 변경」 묶음과 채운 단추가 보이게.
const recordedPaths = new Set(journals.flatMap((j) => j.files.map((f) => f.path)));
const unrecordedC = candidates.filter((c) => !recordedPaths.has(c.path)).slice(0, 2);
const recordedC = candidates.filter((c) => recordedPaths.has(c.path)).slice(0, 7);
const picked = [...unrecordedC, ...recordedC];
const changes = picked.map((c) => ({ path: scrub(c.path), op: c.op }));
const patches = Object.fromEntries(picked.map((c) => [scrub(c.path), c.patch]));
const lastDay = workdays[workdays.length - 1] ?? "20260101";

const fx = {
  nowIso: `${lastDay.slice(0, 4)}-${lastDay.slice(4, 6)}-${lastDay.slice(6)}T18:20:00+09:00`,
  workdays,
  journals,
  plans,
  changes,
  patches,
  unrecorded: unrecordedC.map((c) => scrub(c.path)),
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(fx));
console.log(
  `fixtures: journals=${journals.length} plans=${plans.length} changes=${changes.length} (일지 없는 ${fx.unrecorded.length}) workdays=${workdays.length} scrubbed=${scrubbed} → ${path.relative(process.cwd(), out) || out}`,
);
