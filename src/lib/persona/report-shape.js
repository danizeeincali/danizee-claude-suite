/**
 * The report's shape: one pure module (no node: imports, so it runs in Node and in a Worker) shared by the reader
 * (`read.js`) and the tester connector (`tools.js`), so a report is read by the same rules wherever it lands.
 * A report is one fenced json block, then optional prose. `parseReport` finds the first json block, checks every field
 * strictly and never throws: a value it cannot trust becomes null with a precise line in `problems[]`, and it never
 * guesses. Harmless slips it can read without doubt ("yes"/"no"/"true"/"false" or 1/0 for a boolean or a score, a
 * capitalised severity, a trailing comma, a // comment) are read and still noted: the reader counts such a report, while
 * `submissionProblems` (the connector's `submit_report`) refuses any problem line.
 */
export const SEVERITY = ["blocker", "confusing", "rough", "idea"];
export const STEPS = ["saw", "used", "reacted", "invented"];

const STOP_CHARS = `\\s)>\\]"'\`<`;
const REST = `[^${STOP_CHARS}]*`;
const K = "[A-Za-z0-9_-]";
// A run of base64url characters, which a hard line break may have split.
const WRAPPED = `${K}+(?:\\r?\\n${K}+)*`;
const joined = (s) => s.replace(/\r?\n/g, "");
/** A run that could be a key: 40 or more long, and neither a lower-case slug or id (walk ids are) nor one capitalised word. */
const keyLike = (s) => s.length >= 40 && !/^[a-z0-9-]+$/.test(s) && !/^[A-Z]?[a-z]+$/.test(s);
const PAIR = new RegExp(`(?:(?<=%23)|(?<!${K}))(?:\\d{4}-\\d{2}-\\d{2}|${K}{6,12})\\.(?:\\r?\\n)?(${WRAPPED})`, "gi");
const RUN = new RegExp(WRAPPED, "g");
/** One pattern per secret path: the path (its slashes also written %2F) kept, everything after it up to whitespace dropped. */
const pathRule = (p) => new RegExp(`(${String(p).split("/").map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("(?:\\/|%2F)")})\\S+`, "gi");
const TOKEN = /(?:#|%23)[A-Za-z0-9_.~%+=-]{20,}[^\s)>\]"'`<]*/gi;
/**
 * Takes secrets out of tester text. Sign-in links usually keep their secret after a `#`, often as `#<left>.<right>` (a
 * short code or a date, a dot, then a long key). In order, it drops: a `<date or 6-12 char code>.<key>`
 * pair; any run of 40+ base64url characters that could be a key (also when a line break splits it), with or without a
 * `#`; everything after each of `secretPaths` (a project's own sign-in paths, like `/sign-in/tester`) up to whitespace; a fragment (`#…` or `%23…`) off every address (full, host-only
 * or bare path, with or without a query); and any `#` or `%23` followed by 20+ of [A-Za-z0-9_.~%+=-], wherever it stands.
 * Over-stripping is the safe side. Nothing marks where text was dropped.
 */
export function stripFragments(text, { secretPaths = [] } = {}) {
  let t = String(text ?? "")
    .replace(PAIR, (m, right) => (joined(right).length >= 40 && keyLike(joined(right)) ? "" : m))
    .replace(RUN, (m) => (keyLike(joined(m)) ? "" : m))
  for (const p of secretPaths) if (typeof p === "string" && p.length >= 2) t = t.replace(pathRule(p), "$1");
  return t.replace(WORD, offAddress).replace(TOKEN, "");
}

// The address rule. A fragment can only follow an address in the same run of non-stop characters, so it works run by run
// (`WORD`), and only on a run's text up to its last `#` or `%23`: an address that matches there ends at a marker and
// swallows the rest of the run, so the part after the last marker is dropped with it. Cut that way, every attempt to
// start a match either succeeds at once or fails on a bounded prefix: a scheme is at most 32 characters, a host label
// 63 and a host at most 10 labels. A longer scheme or host still loses its fragment (the match starts inside it: a host
// match has no word boundary at its start, so it can begin in the middle of an over-long label).
const WORD = new RegExp(`[^${STOP_CHARS}]+`, "g");
const ADDR_BODY = `(?:(?!%23)[^\\s#${STOP_CHARS.slice(2)}])`;
const ADDR = new RegExp(
  `(${[
    `[a-z][a-z0-9+.-]{0,31}:\\/\\/${ADDR_BODY}+`,
    `(?:[a-z0-9-]{1,63}\\.){1,10}[a-z]{2,24}\\b(?:[/?]${ADDR_BODY}*)?`,
    `(?<=^|[\\s(\`"'])\\/[A-Za-z0-9_\\-/.]{1,512}(?:\\?${ADDR_BODY}*)?`,
  ].join("|")})(?:#|%23)${REST}`,
  "gim",
);
function offAddress(word) {
  const last = Math.max(word.lastIndexOf("#") < 0 ? -1 : word.lastIndexOf("#") + 1, word.lastIndexOf("%23") < 0 ? -1 : word.lastIndexOf("%23") + 3);
  if (last < 0) return word;
  let hit = false;
  const cut = word.slice(0, last).replace(ADDR, (m, addr) => {
    hit = true;
    return addr;
  });
  return hit ? cut : word;
}

/** Takes fragments off every string inside a value (keys untouched); serialise afterwards, never the other way round. */
export const stripDeep = (v, opts) => (typeof v === "string" ? stripFragments(v, opts) : Array.isArray(v) ? v.map((x) => stripDeep(x, opts)) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, stripDeep(x, opts)])) : v);
/** A value quoted in a problems line: strings are stripped before they are clipped, so a clip never keeps part of a key. */
export const show = (v) => {
  if (typeof v !== "string") return JSON.stringify(stripDeep(v)) ?? String(v);
  const s = stripFragments(v);
  return JSON.stringify(s.length > 40 ? `${s.slice(0, 40)}…` : s);
};

/** A file name or id as it may be stored or printed: [A-Za-z0-9._-] kept, anything else `?`, at most 80 characters. */
export const safeName = (s) => [...String(s)].map((c) => (/^[A-Za-z0-9._-]$/.test(c) ? c : "?")).slice(0, 80).join("");
/** The name a report must have: `r<round>-` then lower-case letters, digits and hyphens. */
export const REPORT_NAME = /^r\d+-[a-z0-9-]{1,80}$/;

/**
 * The first fenced json block: `{ body, prose, tagged }` or null. A ```json block wins; a bare ``` block holding `{` comes next.
 * Read line by line: a fence line opens a block and the first later line that is exactly that fence (at least two lines on)
 * closes it, found by looking up the lines that hold each fence, so a text of unclosed fences is read once, not once per fence.
 */
function findBlock(text) {
  const lines = text.split("\n");
  const at = [];
  for (let i = 0, p = 0; i < lines.length; p += lines[i].length + 1, i++) at.push(p);
  const closers = new Map();
  for (let i = 0; i < lines.length; i++) {
    const m = /^[ \t]*(`{3,})[ \t]*\r?$/.exec(lines[i]);
    if (m) (closers.get(m[1]) ?? closers.set(m[1], []).get(m[1])).push(i);
  }
  const blocks = [];
  for (let i = 0; i < lines.length; ) {
    const m = /^[ \t]*(`{3,})[ \t]*([A-Za-z]*)[ \t]*\r?$/.exec(lines[i]);
    const list = m ? closers.get(m[1]) : null;
    let lo = 0;
    let hi = list ? list.length : 0;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid] >= i + 2) hi = mid;
      else lo = mid + 1;
    }
    if (!m || !list || lo >= list.length) {
      i++;
      continue;
    }
    const j = list[lo];
    const bodyEnd = at[j] - 1 - (lines[j - 1].endsWith("\r") ? 1 : 0);
    blocks.push({ tag: m[2].toLowerCase(), body: text.slice(at[i + 1], bodyEnd), end: at[j] + lines[j].length });
    // A README-style outer fence holds the real block: look inside it too.
    i = m[2] === "" ? i + 1 : j + 1;
  }
  const b = blocks.find((x) => x.tag === "json") ?? blocks.find((x) => x.tag === "" && x.body.trim().startsWith("{"));
  return b ? { body: b.body.replace(/\r\n/g, "\n"), prose: text.slice(b.end).trim(), tagged: b.tag === "json" } : null;
}

/** Blanks // comments and trailing commas outside strings, keeping every position, and says what it did. */
function repair(src, problems) {
  const out = src.split("");
  let inStr = false;
  let comments = 0;
  let commas = 0;
  for (let i = 0; i < out.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "/" && src[i + 1] === "/") {
      comments++;
      for (; i < out.length && src[i] !== "\n"; i++) out[i] = " ";
    } else if (c === ",") {
      let j = i + 1;
      for (; j < src.length; j++) {
        if (/\s/.test(src[j])) continue;
        if (src[j] === "/" && src[j + 1] === "/") while (j < src.length && src[j] !== "\n") j++;
        else break;
      }
      if (src[j] === "}" || src[j] === "]") {
        commas++;
        out[i] = " ";
      }
    }
  }
  if (comments) problems.push(`format slip: ${comments} // comment${comments > 1 ? "s" : ""} in the json block (ignored)`);
  if (commas) problems.push(`format slip: ${commas} trailing comma${commas > 1 ? "s" : ""} in the json block (ignored)`);
  return out.join("");
}

/** Where JSON.parse gave up, as `line L column C`: from the message, else (binary search) the shortest prefix that is wrong rather than short. */
function errorAt(src, err) {
  const lc = (p) => {
    const before = src.slice(0, p).split("\n");
    return `line ${before.length} column ${before.at(-1).length + 1}`;
  };
  const m = /at position (\d+)/.exec(err.message);
  if (m) return lc(+m[1]);
  // A prefix is wrong (not just short) from some length on and stays wrong for every longer one, so search for that length.
  const wrong = (k) => {
    try {
      JSON.parse(src.slice(0, k));
      return false;
    } catch (e) {
      const p = /at position (\d+)/.exec(e.message);
      return !/end of JSON/.test(e.message) && !(p && +p[1] >= k - 1);
    }
  };
  if (wrong(src.length)) {
    let lo = 1;
    let hi = src.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (wrong(mid)) hi = mid;
      else lo = mid + 1;
    }
    return lc(lo - 1);
  }
  return "an unknown place";
}

/** Most entries read from one list of a report (loops, screens, findings, questions); a longer list is cut and a problem line says so. */
export const MAX_LIST = 500;
/** The largest report file read at all. */
export const MAX_REPORT_BYTES = 1024 * 1024;
const KEYS = ["id", "tester", "started_utc", "minutes", "width", "finished", "why_not_finished", "loops", "screens", "findings", "first_five", "come_back", "questions"];
/**
 * A longer walk's own keys (whole jobs, perhaps over several sittings), each optional, and read only when given:
 * `jobs`, `remembered`, `would_pay`, and `sitting` (1 to 9) on a loop or screen.
 */
export const DEEP_KEYS = ["jobs", "remembered", "would_pay"];
export const SITTINGS = 9;

const empty = (problems) => ({ id: null, tester: null, started_utc: null, minutes: null, width: null, finished: null, why_not_finished: null, loops: null, screens: null, findings: null, first_five: null, come_back: null, questions: null, notes: "", problems });

export function parseReport(raw, opts) {
  const problems = [];
  const r = empty(problems);
  const text = typeof raw === "string" ? raw.replace(/^\uFEFF/, "") : "";
  if (typeof raw !== "string") problems.push("the report is not text");
  const block = findBlock(text);
  if (!block) {
    problems.push("no fenced json block");
    r.notes = stripFragments(text.trim(), opts);
    return r;
  }
  if (!block.tagged) problems.push("format slip: the block is fenced with ``` and no json tag");
  r.notes = block.prose;
  const src = repair(block.body, problems);
  let d;
  try {
    d = JSON.parse(src);
  } catch (e) {
    problems.push(`the json block could not be read: ${e.message.replace(/ in JSON at position.*$|, (?:\.\.\.)?".*$/s, "")} at ${errorAt(src, e)}`);
    return stripDeep(r, opts);
  }
  if (!d || typeof d !== "object" || Array.isArray(d)) {
    problems.push("the json block is not an object");
    return stripDeep(r, opts);
  }
  for (const k of KEYS) if (!(k in d)) problems.push(`missing key ${k}`);
  for (const k of Object.keys(d)) if (!KEYS.includes(k) && !DEEP_KEYS.includes(k)) problems.push(`unexpected key ${k} (ignored)`);

  const v = reader(problems);
  r.id = v.str("id", d.id, { required: true });
  r.tester = v.str("tester", d.tester);
  r.started_utc = "started_utc" in d ? v.when("started_utc", d.started_utc) : null;
  r.minutes = "minutes" in d ? v.num("minutes", d.minutes, { min: 1, max: 240 }) : null;
  r.width = "width" in d ? v.int("width", d.width, { min: 200, max: 4000 }) : null;
  r.finished = "finished" in d ? v.bool("finished", d.finished) : null;
  r.why_not_finished = v.str("why_not_finished", d.why_not_finished);
  const bound = (r.minutes ?? 240) * 60 + 600;

  r.loops = v.list("loops", d.loops, (x, at) => {
    const loop = { n: v.int(`${at}: n`, x.n, { min: 1 }), start_s: v.time(`${at}: start_s`, x.start_s, bound), result_s: x.result_s === null ? null : v.time(`${at}: result_s`, x.result_s, bound), did: v.str(`${at}: did`, x.did), got: v.str(`${at}: got`, x.got), aha: v.bool(`${at}: aha`, x.aha), stall: v.bool(`${at}: stall`, x.stall), stall_words: v.str(`${at}: stall_words`, x.stall_words) };
    if (loop.start_s !== null && loop.result_s !== null && loop.result_s < loop.start_s) {
      problems.push(`${at}: result_s ${loop.result_s} is before start_s ${loop.start_s} (result_s not used)`);
      loop.result_s = null;
    }
    if (x.result_s === null && loop.stall === false) {
      problems.push(`${at}: no result_s but stall is false (stall not used)`);
      loop.stall = null;
    }
    if ("sitting" in x) loop.sitting = v.int(`${at}: sitting`, x.sitting, { min: 1, max: SITTINGS });
    return loop;
  });
  r.screens = v.list("screens", d.screens, (x, at) => {
    const s = { n: v.int(`${at}: n`, x.n, { min: 1 }), screen: v.str(`${at}: screen`, x.screen), address: v.address(`${at}: address`, x.address), line: v.str(`${at}: line`, x.line) };
    for (const k of STEPS) s[k] = v.score(`${at}: ${k}`, x[k]);
    if ("sitting" in x) s.sitting = v.int(`${at}: sitting`, x.sitting, { min: 1, max: SITTINGS });
    return s;
  });
  r.findings = v.list("findings", d.findings, (x, at) => ({
    n: v.int(`${at}: n`, x.n, { min: 1 }),
    title: v.str(`${at}: title`, x.title, { required: true }),
    severity: v.severity(`${at}: severity`, x.severity),
    screen: v.str(`${at}: screen`, x.screen),
    address: v.address(`${at}: address`, x.address),
    persona_said: v.str(`${at}: persona_said`, x.persona_said),
    what_happened: v.str(`${at}: what_happened`, x.what_happened),
    expected: v.str(`${at}: expected`, x.expected),
    shot: v.str(`${at}: shot`, x.shot),
  }));
  r.first_five = v.obj("first_five", d.first_five, (x) => ({ understood: v.str("first_five.understood", x.understood), thought_first: v.str("first_five.thought_first", x.thought_first), did: v.str("first_five.did", x.did) }));
  r.come_back = v.obj("come_back", d.come_back, (x) => ({ yes: v.bool("come_back.yes", x.yes), reason: v.str("come_back.reason", x.reason) }));
  r.questions = v.list("questions", d.questions, (x, at) => v.str(at, x, { required: true }), { items: "any" });
  if ("jobs" in d)
    r.jobs = v.list("jobs", d.jobs, (x, at) => {
      const job = { n: v.int(`${at}: n`, x.n, { min: 1 }), job: v.str(`${at}: job`, x.job), finished: v.bool(`${at}: finished`, x.finished), steps_done: v.int(`${at}: steps_done`, x.steps_done, { min: 0, max: 50 }), steps: v.int(`${at}: steps`, x.steps, { min: 1, max: 50 }), gave_up_at: v.int(`${at}: gave_up_at`, x.gave_up_at, { min: 1, max: 50 }), line: v.str(`${at}: line`, x.line) };
      if (job.steps_done !== null && job.steps !== null && job.steps_done > job.steps) {
        problems.push(`${at}: steps_done ${job.steps_done} is more than steps ${job.steps} (steps_done not used)`);
        job.steps_done = null;
      }
      if (job.gave_up_at !== null && job.steps !== null && job.gave_up_at > job.steps) {
        problems.push(`${at}: gave_up_at ${job.gave_up_at} is past the last step ${job.steps} (gave_up_at not used)`);
        job.gave_up_at = null;
      }
      return job;
    });
  if ("remembered" in d) r.remembered = v.obj("remembered", d.remembered, (x) => ({ yes: v.bool("remembered.yes", x.yes), missed: v.list("remembered.missed", x.missed, (m, at) => v.str(at, m, { required: true }), { items: "any" }) }));
  if ("would_pay" in d) r.would_pay = v.obj("would_pay", d.would_pay, (x) => ({ yes: v.bool("would_pay.yes", x.yes), reason: v.str("would_pay.reason", x.reason) }));
  return stripDeep(r, opts);
}

/** Strict readers: each answers the value or null, and puts one line in problems for anything it did not take as written. */
function reader(problems) {
  const bad = (at, value, want) => {
    problems.push(`${at}: ${show(value)} is not ${want} (not used)`);
    return null;
  };
  const slip = (at, value, read) => problems.push(`${at}: format slip, ${show(value)} read as ${read}`);
  const words = new Map([["yes", true], ["true", true], ["no", false], ["false", false]]);
  return {
    str(at, x, { required = false } = {}) {
      if (x === undefined || x === null) {
        if (required) problems.push(`${at}: missing`);
        return null;
      }
      return typeof x === "string" ? x : bad(at, x, "text");
    },
    when(at, x) {
      if (x === null) return null;
      return typeof x === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(x) && !Number.isNaN(Date.parse(x)) ? x : bad(at, x, "a UTC date and time like 2026-11-25T17:05:00Z");
    },
    num(at, x, { min, max }) {
      if (x === null) return null;
      return typeof x === "number" && Number.isFinite(x) && x >= min && x <= max ? x : bad(at, x, `a number from ${min} to ${max}`);
    },
    int(at, x, { min, max = Infinity }) {
      if (x === null || x === undefined) return null;
      return Number.isInteger(x) && x >= min && x <= max ? x : bad(at, x, `a whole number${max === Infinity ? ` from ${min}` : ` from ${min} to ${max}`}`);
    },
    time(at, x, bound) {
      if (typeof x !== "number" || !Number.isFinite(x) || x < 0) return bad(at, x === undefined ? null : x, "seconds since the walk started");
      if (x > bound) {
        problems.push(`${at}: ${x} seconds is longer than the walk (over ${bound}) (not used)`);
        return null;
      }
      return x;
    },
    bool(at, x) {
      if (typeof x === "boolean") return x;
      if (x === 1 || x === 0) {
        slip(at, x, String(x === 1));
        return x === 1;
      }
      if (typeof x === "string" && words.has(x.trim().toLowerCase())) {
        const b = words.get(x.trim().toLowerCase());
        slip(at, x, String(b));
        return b;
      }
      return bad(at, x === undefined ? null : x, "true or false");
    },
    score(at, x) {
      if (x === 0 || x === 1) return x;
      if (typeof x === "boolean" || (typeof x === "string" && words.has(x.trim().toLowerCase())) || x === "0" || x === "1") {
        const n = typeof x === "boolean" ? +x : x === "0" || x === "1" ? +x : +words.get(x.trim().toLowerCase());
        slip(at, x, String(n));
        return n;
      }
      return bad(at, x === undefined ? null : x, "0 or 1");
    },
    severity(at, x) {
      if (SEVERITY.includes(x)) return x;
      if (typeof x === "string" && SEVERITY.includes(x.trim().toLowerCase())) {
        slip(at, x, x.trim().toLowerCase());
        return x.trim().toLowerCase();
      }
      problems.push(`${at.replace(/: severity$/, "")}: severity ${show(x ?? null)} is not one of ${SEVERITY.join(", ")} (not used)`);
      return null;
    },
    address(at, x) {
      if (x === null || x === undefined) return null;
      if (typeof x !== "string") return bad(at, x, "a web address");
      let a = x.trim();
      const cut = a.search(/#|%23/i);
      if (cut >= 0) {
        problems.push(`${at} had a # part; it was removed`);
        a = a.slice(0, cut);
      }
      try {
        const u = new URL(a);
        if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("not web");
        return a;
      } catch {
        return bad(at, a, "a web address");
      }
    },
    list(at, x, each, { items = "object" } = {}) {
      if (x === undefined || x === null) return null;
      if (!Array.isArray(x)) return bad(at, x, "a list");
      const out = [];
      if (x.length > MAX_LIST) problems.push(`${at}: ${x.length} entries; only the first ${MAX_LIST} were read`);
      x.slice(0, MAX_LIST).forEach((item, i) => {
        const label = `${at.replace(/s$/, "")} ${i + 1}`;
        if (items === "object" && (!item || typeof item !== "object" || Array.isArray(item))) problems.push(`${label}: not an object (skipped)`);
        else out.push(each(item, label));
      });
      return out;
    },
    obj(at, x, each) {
      if (x === undefined || x === null) return null;
      return typeof x === "object" && !Array.isArray(x) ? each(x) : bad(at, x, "an object");
    },
  };
}

export const UNREADABLE = [/^no fenced json block$/, /^the json block could not be read/, /^the json block is not an object$/, /^the report is not text$/];
/** The problem that made a whole report unreadable (no json block, a cut-off or non-object block), else null. */
export const unreadableProblem = (report) => report.problems.find((p) => UNREADABLE.some((re) => re.test(p))) ?? null;

/**
 * The stricter check a handed-in report passes (the connector's `submit_report`): every problem line the reader
 * would note, plus one when the report's id is not the walk it is handed in for. Empty means accepted. The reader keeps
 * its gentler rule (a readable slip still counts) so old reports read the same.
 */
export function submissionProblems(raw, walkId, opts) {
  const report = parseReport(raw, opts);
  const problems = [...report.problems];
  if (!unreadableProblem(report) && report.id !== null && report.id !== walkId) problems.push(`id: ${show(report.id)} is not this walk's id ${show(String(walkId))}`);
  return { report, problems };
}

/**
 * The report a tester copies: a heading, one fenced json block with every key of the shape, then notes. It passes
 * `submissionProblems` as written (a test holds that), so the example in a guide can never drift from the checker.
 */
export function REPORT_TEMPLATE(walkId = "<walk id>", testerName = "the tester") {
  const example = {
    id: walkId,
    tester: testerName,
    started_utc: "2026-01-15T17:30:00Z",
    minutes: 31,
    width: 1280,
    finished: true,
    why_not_finished: null,
    loops: [{ n: 1, start_s: 95, result_s: 140, did: "Asked for a price sheet", got: "A one-page sheet with my three prices", aha: true, stall: false, stall_words: null }],
    screens: [{ n: 1, screen: "Home", address: "https://app.example.com/", saw: 1, used: 0, reacted: 1, invented: 0, line: "Did not know the card was tappable" }],
    findings: [{ n: 1, title: "One line", severity: "blocker", screen: "Home", address: "https://app.example.com/", persona_said: "What this person would say out loud", what_happened: "Two or three lines.", expected: "One line.", shot: null }],
    first_five: { understood: "What I thought this was", thought_first: "My first thought", did: "The first thing I did" },
    come_back: { yes: false, reason: "One reason, as the persona." },
    questions: [],
  };
  return `# Report ${walkId}\n\n\`\`\`json\n${JSON.stringify(example, null, 2)}\n\`\`\`\n\n## Notes\nAnything a person should read that did not fit above. Optional. Known things you met go here, one line each.\n`;
}
