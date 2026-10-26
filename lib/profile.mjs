// Validation and the approved-only slice for profile.json. No dependencies.

const REVIEW = ["approved", "pending"];
const PROJECT_STATUS = ["shipped", "learning"];
const SKILL_STATUS = ["used_in_shipped_work", "learning"];

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isStr = (v) => typeof v === "string" && v.trim() !== "";

function* strings(value) {
  if (typeof value === "string") yield value;
  else if (Array.isArray(value)) for (const v of value) yield* strings(v);
  else if (isObj(value)) for (const v of Object.values(value)) yield* strings(v);
}

// A marker is a plain string (case-insensitive substring) or {"regex": "<pattern>"} (flags "i").
// Returns a (text) => boolean test, or null when the marker is malformed.
function compileMarker(m) {
  if (isStr(m)) {
    const needle = m.toLowerCase();
    return (text) => text.toLowerCase().includes(needle);
  }
  if (isObj(m) && isStr(m.regex)) {
    try {
      const re = new RegExp(m.regex, "i");
      return (text) => re.test(text);
    } catch {
      return null;
    }
  }
  return null;
}
const markerText = (m) => (isStr(m) ? m : `/${m.regex}/i`);

const RESERVED_IDS = ["identity", "notYet", "learningGoals"];

export function validateProfile(profile) {
  const errors = [];
  if (!isObj(profile)) return ["The profile is not a JSON object."];
  const arr = (key) => {
    if (!Array.isArray(profile[key])) {
      errors.push(`The profile has no "${key}" list.`);
      return [];
    }
    return profile[key];
  };
  const review = (label, entry) => {
    if (!REVIEW.includes(entry.ownerReview)) {
      errors.push(`${label} needs ownerReview set to approved or pending.`);
    }
  };
  const need = (label, entry, fields) => {
    for (const f of fields) {
      if (!isStr(entry[f])) errors.push(`${label} is missing "${f}".`);
    }
  };

  // a) shape
  if (!isObj(profile.identity)) {
    errors.push("The profile has no identity object.");
  } else {
    need("The identity", profile.identity, ["name"]);
    review("The identity", profile.identity);
  }

  const roles = arr("roles");
  roles.forEach((r, i) => {
    const label = isStr(r?.id) ? `Role "${r.id}"` : `Role #${i + 1}`;
    if (!isObj(r)) return errors.push(`${label} is not an object.`);
    need(label, r, ["id", "org", "title", "dates"]);
    if (typeof r.source !== "string" || !r.source.startsWith("https://")) {
      errors.push(`${label} needs a source that is an https URL.`);
    }
    review(label, r);
  });

  const projects = arr("projects");
  projects.forEach((p, i) => {
    const label = isStr(p?.id) ? `Project "${p.id}"` : `Project #${i + 1}`;
    if (!isObj(p)) return errors.push(`${label} is not an object.`);
    need(label, p, ["id", "name", "whatIsThis", "whyThisChoice", "whatBreaks", "whatILearned"]);
    if (!PROJECT_STATUS.includes(p.status)) errors.push(`${label} needs status shipped or learning.`);
    review(label, p);
    if (!Array.isArray(p.evidence) || p.evidence.length === 0) {
      errors.push(`${label} needs at least one evidence URL.`);
    } else {
      for (const u of p.evidence) {
        if (typeof u !== "string" || !u.startsWith("https://")) {
          errors.push(`${label} has evidence that is not an https URL: ${JSON.stringify(u)}.`);
        }
      }
    }
  });

  const skills = arr("skills");
  skills.forEach((s, i) => {
    const label = isStr(s?.name) ? `Skill "${s.name}"` : `Skill #${i + 1}`;
    if (!isObj(s)) return errors.push(`${label} is not an object.`);
    need(label, s, ["name"]);
    if (!SKILL_STATUS.includes(s.status)) errors.push(`${label} needs status used_in_shipped_work or learning.`);
    if (!Array.isArray(s.projects)) errors.push(`${label} needs a projects list.`);
  });

  arr("notYet").forEach((n, i) => {
    const label = isStr(n?.item) ? `Not-yet entry "${n.item}"` : `Not-yet entry #${i + 1}`;
    if (!isObj(n)) return errors.push(`${label} is not an object.`);
    need(label, n, ["item", "why"]);
    review(label, n);
  });

  if (!Array.isArray(profile.learningGoals)) errors.push(`The profile has no "learningGoals" list.`);

  const pending = arr("pendingClaims");
  const markers = [];
  pending.forEach((c, i) => {
    const label = isStr(c?.claim) ? `Pending claim "${c.claim.slice(0, 40)}"` : `Pending claim #${i + 1}`;
    if (!isObj(c)) return errors.push(`${label} is not an object.`);
    need(label, c, ["claim"]);
    if (!Array.isArray(c.markers) || c.markers.length === 0) {
      errors.push(`${label} needs a non-empty markers list.`);
      return;
    }
    for (const m of c.markers) {
      const test = compileMarker(m);
      if (test) markers.push({ text: markerText(m), test });
      else errors.push(`${label} has a marker that is not a string or a valid {"regex": "..."}: ${JSON.stringify(m)}.`);
    }
  });

  // b) unique ids, skills point at real projects
  const seen = new Set();
  for (const e of [...roles, ...projects]) {
    if (!isObj(e) || !isStr(e.id)) continue;
    if (RESERVED_IDS.includes(e.id)) errors.push(`The id "${e.id}" is reserved for a profile section.`);
    if (seen.has(e.id)) errors.push(`The id "${e.id}" is used by more than one role or project.`);
    seen.add(e.id);
  }
  const projectById = new Map(projects.filter((p) => isObj(p)).map((p) => [p.id, p]));

  // c) shipped skills need a shipped project
  for (const s of skills) {
    if (!isObj(s) || !Array.isArray(s.projects)) continue;
    for (const id of s.projects) {
      if (!projectById.has(id)) errors.push(`Skill "${s.name}" lists the project "${id}", which does not exist.`);
    }
    if (s.status === "used_in_shipped_work" && !s.projects.some((id) => projectById.get(id)?.status === "shipped")) {
      errors.push(`Skill "${s.name}" is marked used in shipped work but has no shipped project as evidence.`);
    }
  }

  // d, e) everything that reaches the model is clean. Skills and learning goals carry no
  // ownerReview, so every one of them is scanned; entries are scanned only when approved.
  const scanned = [
    ...[
      ["The identity", profile.identity],
      ...roles.map((r) => [`Role "${r?.id}"`, r]),
      ...projects.map((p) => [`Project "${p?.id}"`, p]),
      ...arr("notYet").map((n) => [`Not-yet entry "${n?.item}"`, n]),
    ]
      .filter(([, e]) => isObj(e) && e.ownerReview === "approved")
      .map(([label, e]) => [label, e, "approved"]),
    ...skills.map((s) => [`Skill "${s?.name}"`, s, "used"]),
    ...(Array.isArray(profile.learningGoals) ? profile.learningGoals : []).map((g, i) => [`The learning goal #${i + 1}`, g, "used"]),
  ];
  for (const [label, entry, kind] of scanned) {
    const texts = [...strings(entry)];
    const verb = kind === "approved" ? "is approved but" : "is sent to the model and";
    if (texts.some((t) => /\bdraft\b/i.test(t))) errors.push(`${label} ${verb} contains the word DRAFT.`);
    for (const m of markers) {
      if (texts.some(m.test)) errors.push(`${label} ${verb} contains "${m.text}", a marker of a pending claim.`);
    }
  }
  return errors;
}

const approved = (e) => isObj(e) && e.ownerReview === "approved";

// Whitelists: only these keys of each entry type can reach the model. Anything else
// (reviewer notes, ownerReview, source, a skill's note) is dropped.
const FIELDS = {
  identity: ["name", "headline", "location", "education", "links", "contact"],
  role: ["id", "org", "title", "dates", "location", "scope", "current", "metrics"],
  project: [
    "id", "name", "status", "year", "stack", "evidence", "role",
    "whatIsThis", "whyThisChoice", "whatBreaks", "whatILearned", "metrics",
  ],
  skill: ["name", "status", "projects"],
  notYet: ["item", "why"],
};
const pick = (entry, keys) => Object.fromEntries(keys.filter((k) => entry[k] !== undefined).map((k) => [k, entry[k]]));

export function approvedSlice(profile) {
  const problems = validateProfile(profile);
  if (problems.length > 0) {
    throw new Error(`profile.json is not valid:\n- ${problems.join("\n- ")}`);
  }
  const projects = profile.projects.filter(approved);
  const okProjects = new Set(projects.map((p) => p.id));
  return structuredClone({
    identity: approved(profile.identity) ? pick(profile.identity, FIELDS.identity) : null,
    roles: profile.roles.filter(approved).map((r) => pick(r, FIELDS.role)),
    projects: projects.map((p) => pick(p, FIELDS.project)),
    // Skills have no ownerReview by design: a skill is included only when every project it
    // cites is approved. validateProfile guarantees each cited project exists.
    skills: profile.skills.filter((s) => s.projects.every((id) => okProjects.has(id))).map((s) => pick(s, FIELDS.skill)),
    notYet: profile.notYet.filter(approved).map((n) => pick(n, FIELDS.notYet)),
    learningGoals: profile.learningGoals.filter((g) => typeof g === "string"),
  });
}

export function evidenceIds(slice) {
  return new Set([
    ...(slice.roles ?? []).map((r) => r.id),
    ...(slice.projects ?? []).map((p) => p.id),
    "identity",
    "notYet",
    "learningGoals",
  ]);
}
