/**
 * The project file: the one file a person edits (`persona-testing/project.json`). `checkProject` reads any value and
 * never throws; `loadProject` reads the file and throws one sentence naming the first problems. `withDefaults` fills
 * everything optional, so the planner and the brief writer read one complete shape.
 */
import fs from "node:fs";
import path from "node:path";

export const PROJECT_FILE = "project.json";
/** An id: lower-case letters, digits and single hyphens. */
export const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const DEFAULTS = { walks: 12, jobs_per_walk: 2, minutes: 30, widths: [1280, 500] };
export const TARGETS = { loops: 5, within_minutes: 30, first_aha_seconds: 120, stalls: 0 };

const TOP_KEYS = ["kind", "v", "product", "rules", "rig", "secret_paths", "personas", "doors", "jobs", "known", "fixing", "defaults", "targets", "words"];
const PRODUCT_KEYS = ["name", "what", "tester"];
const PERSONA_KEYS = ["id", "name", "role", "context", "voice", "facts", "tags"];
const DOOR_KEYS = ["id", "label", "family", "start", "steps", "areas", "needs", "site_only", "reader", "exclusive"];
const JOB_KEYS = ["id", "title", "areas", "steps", "for", "doors"];
const STEP_KEYS = ["do", "done_when"];
const FOR_KEYS = ["roles", "tags", "personas"];
const KNOWN_KEYS = ["id", "text", "instead", "area"];
const DEFAULT_KEYS = ["walks", "jobs_per_walk", "minutes", "widths"];
const TARGET_KEYS = ["loops", "within_minutes", "first_aha_seconds", "stalls"];
const WORDS_KEYS = ["loop", "steps", "who"];
const WORD_STEP_KEYS = ["saw", "used", "reacted", "invented"];

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isStr = (v) => typeof v === "string" && v.trim() !== "";
const isInt = (v) => Number.isInteger(v) && v >= 1;
const isNum = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;
const clip = (v) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  const t = String(s ?? "");
  return JSON.stringify(t.length > 40 ? `${t.slice(0, 40)}…` : t);
};

/** `{ok, problems: [{path, message, fix}]}` for any value; never throws. */
export function checkProject(obj) {
  const problems = [];
  const bad = (p, message, fix) => problems.push({ path: p, message, fix });
  try {
    run(obj, bad);
  } catch {
    bad("", "The project file could not be read as a project.", "Start again from the example: it shows every field.");
  }
  return { ok: problems.length === 0, problems };
}

function run(o, bad) {
  if (!isObj(o)) {
    bad("", "The project file must be one JSON object.", "Start again from the example: it shows every field.");
    return;
  }
  unknownKeys(o, TOP_KEYS, "", bad);
  if (o.kind !== "persona-project") bad("kind", `kind must be "persona-project", not ${clip(o.kind)}.`, 'Set "kind": "persona-project".');
  if (o.v !== 1) bad("v", `v must be 1, not ${clip(o.v)}.`, 'Set "v": 1.');

  if (!isObj(o.product)) bad("product", "product is missing.", 'Add "product": {"name": "...", "what": "One sentence on what it does."}.');
  else {
    unknownKeys(o.product, PRODUCT_KEYS, "product", bad);
    reqStr(o.product, "name", "product", bad, "The product's name, as a person would say it.");
    reqStr(o.product, "what", "product", bad, "One sentence on what the product does.");
    optStr(o.product, "tester", "product", bad);
  }
  strList(o.rules, "rules", bad);
  strList(o.rig, "rig", bad);
  strList(o.secret_paths, "secret_paths", bad, (s) => (s.startsWith("/") && s.length >= 2 ? null : 'a secret path starts with "/", like "/sign-in/tester"'));
  strList(o.fixing, "fixing", bad, (s) => (ID_RE.test(s) ? null : "an area is a lower-case slug like \"billing\""));

  const personas = list(o.personas, "personas", bad, true, "Add at least one persona: a person the tester plays.");
  const doors = list(o.doors, "doors", bad, true, "Add at least one door: a way the tester arrives.");
  const jobs = list(o.jobs, "jobs", bad, true, "Add at least one job: something the tester tries to get done.");
  const known = list(o.known, "known", bad, false);

  const personaIds = idSet(personas, "personas", PERSONA_KEYS, bad, (p, at) => {
    reqStr(p, "name", at, bad, "The person's name.");
    reqStr(p, "role", at, bad, 'Their role, like "owner".');
    reqStr(p, "context", at, bad, "One or two sentences on their business.");
    optStr(p, "voice", at, bad);
    strList(p.facts, `${at}.facts`, bad);
    strList(p.tags, `${at}.tags`, bad, (s) => (ID_RE.test(s) ? null : "a tag is a lower-case slug"));
  });
  const doorIds = idSet(doors, "doors", DOOR_KEYS, bad, (d, at) => {
    reqStr(d, "label", at, bad, "A few words on how the tester arrives.");
    optStr(d, "family", at, bad);
    optStr(d, "start", at, bad);
    optStr(d, "needs", at, bad);
    if (d.reader !== undefined && d.reader !== null && !isStr(d.reader)) bad(`${at}.reader`, "reader must be words or null.", "Say who reads the page, or use null.");
    for (const k of ["site_only", "exclusive"]) if (d[k] !== undefined && typeof d[k] !== "boolean") bad(`${at}.${k}`, `${k} must be true or false.`, `Set ${k} to true or false.`);
    strList(d.steps, `${at}.steps`, bad);
    strList(d.areas, `${at}.areas`, bad, (s) => (ID_RE.test(s) ? null : "an area is a lower-case slug like \"billing\""));
    const hasSteps = Array.isArray(d.steps) && d.steps.some(isStr);
    if (!isStr(d.start) && !hasSteps) bad(at, "A door needs a start address or steps.", 'Add "start": "https://..." or "steps": ["..."].');
  });
  idSet(jobs, "jobs", JOB_KEYS, bad, (j, at) => {
    reqStr(j, "title", at, bad, "A few words on what the job is.");
    strList(j.areas, `${at}.areas`, bad, (s) => (ID_RE.test(s) ? null : "an area is a lower-case slug like \"billing\""));
    if (!Array.isArray(j.steps) || j.steps.length === 0) bad(`${at}.steps`, "A job needs at least one step.", 'Add "steps": [{"do": "...", "done_when": "..."}].');
    else
      j.steps.forEach((s, i) => {
        const sp = `${at}.steps[${i}]`;
        if (!isObj(s)) return bad(sp, "A step is an object with a do.", 'Write {"do": "...", "done_when": "..."}.');
        unknownKeys(s, STEP_KEYS, sp, bad);
        reqStr(s, "do", sp, bad, "What the tester does.");
        optStr(s, "done_when", sp, bad);
      });
    if (j.for !== undefined) {
      if (!isObj(j.for)) bad(`${at}.for`, "for must be an object with roles, tags and personas.", 'Write {"roles": [], "tags": [], "personas": []}.');
      else {
        unknownKeys(j.for, FOR_KEYS, `${at}.for`, bad);
        for (const k of FOR_KEYS) strList(j.for[k], `${at}.for.${k}`, bad);
        for (const id of Array.isArray(j.for.personas) ? j.for.personas : []) if (isStr(id) && personaIds.size && !personaIds.has(id)) bad(`${at}.for.personas`, `${clip(id)} is not a persona in this file.`, `Use one of: ${[...personaIds].join(", ")}.`);
      }
    }
    strList(j.doors, `${at}.doors`, bad);
    for (const id of Array.isArray(j.doors) ? j.doors : []) if (isStr(id) && doorIds.size && !doorIds.has(id)) bad(`${at}.doors`, `${clip(id)} is not a door in this file.`, `Use one of: ${[...doorIds].join(", ")}.`);
  });
  idSet(known, "known", KNOWN_KEYS, bad, (k, at) => {
    reqStr(k, "text", at, bad, "What the tester will meet.");
    optStr(k, "instead", at, bad);
    if (k.area !== undefined && k.area !== null && !(isStr(k.area) && ID_RE.test(k.area))) bad(`${at}.area`, "area must be a lower-case slug or null.", 'Use a slug like "setup", or null.');
  });

  sub(o.defaults, "defaults", DEFAULT_KEYS, bad, (d) => {
    for (const k of ["walks", "jobs_per_walk", "minutes"]) if (d[k] !== undefined && !isInt(d[k])) bad(`defaults.${k}`, `${k} must be a whole number of at least 1.`, `Set ${k} to a number like ${DEFAULTS[k]}.`);
    if (d.widths !== undefined && !(Array.isArray(d.widths) && d.widths.length > 0 && d.widths.every(isInt))) bad("defaults.widths", "widths must be a list of window widths in pixels.", "Write [1280, 500].");
  });
  sub(o.targets, "targets", TARGET_KEYS, bad, (t) => {
    for (const k of TARGET_KEYS) if (t[k] !== undefined && !isNum(t[k])) bad(`targets.${k}`, `${k} must be a number, 0 or more.`, `Set ${k} to a number like ${TARGETS[k]}.`);
  });
  sub(o.words, "words", WORDS_KEYS, bad, (w) => {
    if (w.loop !== undefined && w.loop !== null && !isStr(w.loop)) bad("words.loop", "loop must be words or null.", "Use null for the built-in wording.");
    if (w.who !== undefined && !isStr(w.who)) bad("words.who", "who must be a word like \"person\".", 'Set "who": "person".');
    if (w.steps !== undefined) {
      if (!isObj(w.steps)) bad("words.steps", "steps must be an object.", "Use null for each of saw, used, reacted, invented.");
      else {
        unknownKeys(w.steps, WORD_STEP_KEYS, "words.steps", bad);
        for (const k of WORD_STEP_KEYS) if (w.steps[k] !== undefined && w.steps[k] !== null && !isStr(w.steps[k])) bad(`words.steps.${k}`, `${k} must be words or null.`, "Use null for the built-in wording.");
      }
    }
  });
}

function unknownKeys(o, allowed, at, bad) {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) bad(at ? `${at}.${k}` : k, `${clip(k)} is not a field of ${at || "the project file"}.`, `Remove it or fix the spelling. Fields: ${allowed.join(", ")}.`);
}
function reqStr(o, k, at, bad, hint) {
  if (!isStr(o[k])) bad(`${at}.${k}`, `${at}.${k} is missing or empty.`, hint);
}
function optStr(o, k, at, bad) {
  if (o[k] !== undefined && o[k] !== null && typeof o[k] !== "string") bad(`${at}.${k}`, `${k} must be words.`, `Write ${k} as a sentence, or remove it.`);
}
function strList(v, at, bad, rule) {
  if (v === undefined) return;
  if (!Array.isArray(v)) return bad(at, `${at} must be a list of sentences.`, `Write ${at} as ["...", "..."].`);
  v.forEach((s, i) => {
    if (!isStr(s)) return bad(`${at}[${i}]`, `${at}[${i}] must be words.`, "Write it as a sentence.");
    const why = rule?.(s);
    if (why) bad(`${at}[${i}]`, `${clip(s)}: ${why}.`, "Fix the spelling.");
  });
}
function list(v, at, bad, required, hint) {
  if (v === undefined || v === null) {
    if (required) bad(at, `${at} is missing.`, hint);
    return [];
  }
  if (!Array.isArray(v)) {
    bad(at, `${at} must be a list.`, `Write ${at} as [...].`);
    return [];
  }
  if (required && v.length === 0) bad(at, `${at} is empty.`, hint);
  return v;
}
/** Checks each object of a list (keys, an id that is a slug and unique) and returns the set of ids. */
function idSet(items, name, keys, bad, each) {
  const ids = new Set();
  items.forEach((it, i) => {
    const at = `${name}[${i}]`;
    if (!isObj(it)) return bad(at, `${at} must be an object.`, "Write it as {...}.");
    unknownKeys(it, keys, at, bad);
    if (!isStr(it.id) || !ID_RE.test(it.id)) bad(`${at}.id`, `${at}.id must be lower-case letters, digits and hyphens, not ${clip(it.id)}.`, 'Use an id like "cafe-owner".');
    else if (ids.has(it.id)) bad(`${at}.id`, `${clip(it.id)} is used twice in ${name}.`, "Give each one its own id.");
    else ids.add(it.id);
    each(it, at);
  });
  return ids;
}
function sub(v, at, keys, bad, each) {
  if (v === undefined) return;
  if (!isObj(v)) return bad(at, `${at} must be an object.`, `Write ${at} as {...}.`);
  unknownKeys(v, keys, at, bad);
  each(v);
}

/** The project with every optional field filled (a copy; call on a project that passed `checkProject`). */
export function withDefaults(p) {
  const arr = (v) => (Array.isArray(v) ? v : []);
  const w = p.words ?? {};
  return {
    kind: p.kind,
    v: p.v,
    product: { name: p.product.name, what: p.product.what, tester: p.product.tester ?? "the tester" },
    rules: arr(p.rules),
    rig: arr(p.rig),
    secret_paths: arr(p.secret_paths),
    personas: arr(p.personas).map((x) => ({ ...x, voice: x.voice ?? "", facts: arr(x.facts), tags: arr(x.tags) })),
    doors: arr(p.doors).map((d) => ({ ...d, family: d.family ?? null, start: d.start ?? "", steps: arr(d.steps), areas: arr(d.areas), needs: d.needs ?? "", site_only: d.site_only === true, reader: d.reader ?? null, exclusive: d.exclusive === true })),
    jobs: arr(p.jobs).map((j) => ({
      ...j,
      areas: arr(j.areas),
      steps: arr(j.steps).map((s) => ({ do: s.do, done_when: s.done_when ?? "" })),
      for: { roles: arr(j.for?.roles), tags: arr(j.for?.tags), personas: arr(j.for?.personas) },
      doors: arr(j.doors),
    })),
    known: arr(p.known).map((k) => ({ ...k, instead: k.instead ?? "", area: k.area ?? null })),
    fixing: arr(p.fixing),
    defaults: { ...DEFAULTS, ...(p.defaults ?? {}) },
    targets: { ...TARGETS, ...(p.targets ?? {}) },
    words: { loop: w.loop ?? null, steps: { saw: w.steps?.saw ?? null, used: w.steps?.used ?? null, reacted: w.steps?.reacted ?? null, invented: w.steps?.invented ?? null }, who: w.who ?? "person" },
  };
}

/** Does the job suit this person? Empty `for` suits everyone; otherwise a match on role, tag or persona id is enough. */
export function personaFits(job, persona) {
  const f = job.for ?? {};
  const roles = f.roles ?? [];
  const tags = f.tags ?? [];
  const personas = f.personas ?? [];
  if (!roles.length && !tags.length && !personas.length) return true;
  return roles.includes(persona.role) || personas.includes(persona.id) || tags.some((t) => (persona.tags ?? []).includes(t));
}
/** Does the job suit this door? No `doors` means every door that is not site-only; a list means exactly those. */
export function doorFits(job, door) {
  const ds = job.doors ?? [];
  return ds.length ? ds.includes(door.id) : !door.site_only;
}
export const jobFits = (job, persona, door) => personaFits(job, persona) && doorFits(job, door);
/** Do two lists of areas share one? */
export const touches = (a, b) => (a ?? []).some((x) => (b ?? []).includes(x));

/** Reads `<dir>/project.json`, checks it and returns it with defaults filled; throws one sentence naming the first problems. */
export function loadProject(dir) {
  const file = path.join(dir, PROJECT_FILE);
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    throw new Error(`There is no ${PROJECT_FILE} in ${dir}: run init to make one.`);
  }
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error(`${file} is not valid JSON: check for a missing comma or quote.`);
  }
  const { ok, problems } = checkProject(obj);
  if (!ok) {
    const shown = problems.slice(0, 3).map((p) => `${p.path || "file"}: ${p.message} ${p.fix}`).join(" | ");
    throw new Error(`${file} has ${problems.length} problem${problems.length === 1 ? "" : "s"}: ${shown}${problems.length > 3 ? " | and more." : ""}`);
  }
  return withDefaults(obj);
}

/** A complete, generic example: it is what `init` writes and what the tests plan from. */
export const EXAMPLE_PROJECT = {
  kind: "persona-project",
  v: 1,
  product: { name: "Tillbook", what: "A stock and orders book for small shops.", tester: "the tester" },
  rules: ["Never press Send on anything that would reach a real person.", "Never buy, pay or connect an outside account."],
  rig: ["The test shop is wiped before each walk; a banner saying 'test data' is not a finding."],
  secret_paths: ["/sign-in/tester"],
  personas: [
    { id: "plant-shop-owner", name: "Priya Nair", role: "owner", context: "Runs a plant shop with two part-timers and a stockroom she keeps in her head.", voice: "Warm but quick; types in short bursts between customers.", facts: ["Opens 9 to 5.30", "Fern 6.50, cactus 4.00, large pot 12.00"], tags: ["team"] },
    { id: "stall-seller", name: "Marcus Bell", role: "solo", context: "Sells handmade candles from a market stall on weekends and online in the evenings. Works alone.", voice: "Flat and practical; leaves if a screen asks for setup before it does anything.", facts: ["Candle 8.00", "Gift box of three 21.00"], tags: ["solo"] },
    { id: "shop-assistant", name: "Lena Fischer", role: "team-member", context: "Works three days a week in the plant shop. Was shown the app once by the owner.", voice: "Careful; reads every label and asks what a button will do before pressing it.", facts: ["Does not set prices", "Counts stock on Mondays"], tags: ["team"] },
  ],
  doors: [
    { id: "cold-app", label: "Opens the app cold", family: "app", start: "https://app.example.com/", steps: ["Open the first link and sign in with the link you were given in chat."], areas: ["sign-in"], needs: "The sign-in link, given in chat.", site_only: false, reader: null, exclusive: true },
    { id: "invite-link", label: "Follows an invitation to the shop", family: "app", start: "https://app.example.com/join", steps: ["Open the first link, then accept the invitation shown there."], areas: ["invite"], needs: "The sign-in link, given in chat.", site_only: false, reader: null, exclusive: true },
    { id: "public-page", label: "Reads the public page", family: "site", start: "https://www.example.com/", steps: ["Open the first link and read the page without signing in."], areas: ["pricing"], needs: "", site_only: true, reader: "a shop owner who found the page through a search", exclusive: false },
  ],
  jobs: [
    {
      id: "first-stock-list",
      title: "A first stock list made",
      areas: ["stock"],
      steps: [
        { do: "Add three of your own products with their prices and how many you have.", done_when: "All three are listed with the right price and count." },
        { do: "Change the count of one product after a pretend sale.", done_when: "The new count shows and the old one is gone." },
      ],
      for: { roles: ["owner", "solo"], tags: [], personas: [] },
      doors: ["cold-app", "invite-link"],
    },
    {
      id: "record-a-sale",
      title: "A sale written down",
      areas: ["sales"],
      steps: [
        { do: "Record a sale of two of your products to a customer paying cash.", done_when: "The sale is listed with the right total." },
        { do: "Undo the sale as if you had pressed the wrong product.", done_when: "The sale is gone and the stock is back." },
      ],
      for: { roles: [], tags: [], personas: [] },
      doors: [],
    },
    {
      id: "supplier-order",
      title: "A supplier order drafted",
      areas: ["orders", "billing"],
      steps: [
        { do: "Ask for an order of ten of your lowest-stock product from a supplier you name.", done_when: "A draft order with the product, the count and the supplier." },
        { do: "Change the count and leave the draft unsent.", done_when: "The draft shows the new count and is marked unsent." },
      ],
      for: { roles: ["owner", "solo"], tags: [], personas: [] },
      doors: [],
    },
    {
      id: "weekly-report",
      title: "The week's numbers read",
      areas: ["reports"],
      steps: [{ do: "Open the report of last week's sales and say what sold best.", done_when: "You can name the best seller and its total from the screen alone." }],
      for: { roles: [], tags: [], personas: [] },
      doors: ["cold-app", "invite-link"],
    },
    {
      id: "find-pricing",
      title: "The price of the product found",
      areas: ["pricing"],
      steps: [{ do: "Find what the product costs and what you would get for it.", done_when: "You can say the price and what it covers without opening a second page." }],
      for: { roles: [], tags: [], personas: [] },
      doors: ["public-page"],
    },
  ],
  known: [
    { id: "k1", text: "Importing stock from a spreadsheet shows a spinner for up to a minute.", instead: "Add three items by hand instead.", area: "stock" },
    { id: "k2", text: "The first screen guesses the currency as dollars.", instead: "Leave it and carry on.", area: "setup" },
  ],
  fixing: ["setup", "billing"],
  defaults: { walks: 12, jobs_per_walk: 2, minutes: 30, widths: [1280, 500] },
  targets: { loops: 5, within_minutes: 30, first_aha_seconds: 120, stalls: 0 },
  words: { loop: null, steps: { saw: null, used: null, reacted: null, invented: null }, who: "person" },
};
