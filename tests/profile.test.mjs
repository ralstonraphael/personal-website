import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateProfile, approvedSlice, evidenceIds } from "../lib/profile.mjs";

const real = JSON.parse(readFileSync(new URL("../profile.json", import.meta.url), "utf8"));
const fresh = () => structuredClone(real);
const mentions = (errors, text) => errors.some((e) => e.includes(text));

test("the real profile.json is valid", () => {
  assert.deepEqual(validateProfile(real), []);
});

test("approvedSlice never carries pendingClaims, rules, status or version", () => {
  const slice = approvedSlice(real);
  for (const key of ["pendingClaims", "rules", "status", "version"]) {
    assert.equal(key in slice, false, `${key} must not be in the slice`);
  }
  assert.deepEqual(Object.keys(slice).sort(), ["identity", "learningGoals", "notYet", "projects", "roles", "skills"]);
  assert.equal(JSON.stringify(slice).includes("ownerReview"), false);
});

test("approvedSlice drops a pending project and a skill that depends on it", () => {
  const p = fresh();
  p.projects.find((x) => x.id === "moodle-mcp").ownerReview = "pending";
  const slice = approvedSlice(p);
  assert.equal(slice.projects.some((x) => x.id === "moodle-mcp"), false);
  assert.equal(slice.skills.some((s) => s.projects.includes("moodle-mcp")), false);
  assert.equal(slice.skills.some((s) => s.name === "Python"), false, "Python lists moodle-mcp too");
  assert.equal(slice.skills.some((s) => s.name === "FastAPI"), true);
});

test("rule a: a project missing its evidence is reported by name", () => {
  const p = fresh();
  p.projects[0].evidence = [];
  assert.ok(mentions(validateProfile(p), "personal-website"));
});

test("rule a: a non-https evidence URL is reported", () => {
  const p = fresh();
  p.projects[1].evidence = ["http://example.com/x"];
  assert.ok(mentions(validateProfile(p), "flash-report-ai"));
});

test("rule a: a bad ownerReview value is reported", () => {
  const p = fresh();
  p.roles[1].ownerReview = "maybe";
  assert.ok(mentions(validateProfile(p), "ramp"));
});

test("rule a: a pending claim without markers is reported", () => {
  const p = fresh();
  p.pendingClaims[0].markers = [];
  assert.ok(mentions(validateProfile(p), "Merged 8 PRs"));
});

test("rule b: a duplicate id across roles and projects is reported", () => {
  const p = fresh();
  p.projects[0].id = "gumloop";
  assert.ok(mentions(validateProfile(p), "gumloop"));
});

test("rule b: a skill pointing at a missing project is reported", () => {
  const p = fresh();
  p.skills[0].projects.push("no-such-project");
  const errors = validateProfile(p);
  assert.ok(mentions(errors, "Python") && mentions(errors, "no-such-project"));
});

test("rule c: a skill used in shipped work backed only by a learning project fails", () => {
  const p = fresh();
  p.skills.push({ name: "Luau", status: "used_in_shipped_work", projects: ["roblox-game"] });
  assert.ok(mentions(validateProfile(p), "Luau"));
});

test("rule c: a learning skill may rest on a learning project", () => {
  const p = fresh();
  p.skills.push({ name: "Luau", status: "learning", projects: ["roblox-game"] });
  assert.deepEqual(validateProfile(p), []);
});

test("rule d: DRAFT inside an approved entry fails, nested strings included", () => {
  const p = fresh();
  p.projects[2].stack.push("DRAFT stack item");
  assert.ok(mentions(validateProfile(p), "stone-scraper"));
});

test("rule d: DRAFT in a pending entry is allowed", () => {
  const p = fresh();
  p.projects[2].ownerReview = "pending";
  p.projects[2].whatIsThis = "DRAFT wording";
  assert.deepEqual(validateProfile(p), []);
});

test("rule e: a pending-claim marker in an approved entry fails, any case", () => {
  const p = fresh();
  p.roles[1].scope += " It merged 8 prs.";
  assert.ok(mentions(validateProfile(p), "ramp"));
});

test("evidenceIds holds role ids, project ids and the fixed section names", () => {
  const ids = evidenceIds(approvedSlice(real));
  for (const id of ["gumloop", "longitude-capital", "personal-website", "roblox-game", "identity", "notYet", "learningGoals"]) {
    assert.ok(ids.has(id), `missing ${id}`);
  }
  assert.equal(ids.size, real.roles.length + real.projects.length + 3);
});

// ---- review fixes ----

const base = () => fresh();

test("scan: DRAFT in a learning goal fails", () => {
  const p = base();
  p.learningGoals.push("DRAFT goal about Kubernetes");
  assert.ok(mentions(validateProfile(p), "learning goal"));
});

test("scan: a pending-claim marker in a skill note fails", () => {
  const p = base();
  p.skills[0].note = "Used on a Snowflake pipeline.";
  assert.ok(mentions(validateProfile(p), `Skill "${p.skills[0].name}"`));
});

test("scan: a pending-claim skill name (PyTorch) fails", () => {
  const p = base();
  p.skills.push({ name: "PyTorch", status: "learning", projects: ["personal-website"] });
  assert.ok(mentions(validateProfile(p), "PyTorch"));
});

test("scan: DRAFT in a skill field and in the identity fail", () => {
  const p = base();
  p.skills[0].note = "DRAFT";
  assert.ok(mentions(validateProfile(p), `Skill "${p.skills[0].name}"`));
  const q = base();
  q.identity.headline += " DRAFT";
  assert.ok(mentions(validateProfile(q), "identity"));
});

test("rule d: DRAFT is caught case-insensitively", () => {
  const p = base();
  p.projects[2].stack.push("Draft stack item");
  assert.ok(mentions(validateProfile(p), "stone-scraper"));
});

test("rule d: a word merely containing draft is not flagged", () => {
  const p = base();
  p.projects[2].whatIsThis += " Redrafted twice.";
  assert.deepEqual(validateProfile(p), []);
});

test("markers: regex catches 'eight pull requests' in an approved role", () => {
  const p = base();
  p.roles[1].scope += " Landed eight pull requests.";
  assert.ok(mentions(validateProfile(p), "ramp"));
});

test("markers: regex catches '90 percent' in an approved role", () => {
  const p = base();
  p.roles[1].scope += " Cut extraction by 90 percent.";
  assert.ok(mentions(validateProfile(p), "ramp"));
});

test("markers: a malformed regex marker is reported", () => {
  const p = base();
  p.pendingClaims[0].markers = [{ regex: "(" }];
  assert.ok(mentions(validateProfile(p), "Merged 8 PRs"));
});

test("markers: no marker of the real profile matches the real approved slice", () => {
  const text = JSON.stringify(approvedSlice(real));
  for (const claim of real.pendingClaims) {
    for (const m of claim.markers) {
      const hit = typeof m === "string" ? text.toLowerCase().includes(m.toLowerCase()) : new RegExp(m.regex, "i").test(text);
      assert.equal(hit, false, `marker ${JSON.stringify(m)} of "${claim.claim.slice(0, 30)}" matches the slice`);
    }
  }
});

test("slice: an extra key on an approved role never reaches the slice", () => {
  const p = base();
  p.roles[1].internalNote = "private reviewer remark";
  p.projects[0].internalNote = "also private";
  p.identity.internalNote = "and this";
  p.notYet[0].internalNote = "and this too";
  assert.equal(JSON.stringify(approvedSlice(p)).includes("private"), false);
  assert.equal(JSON.stringify(approvedSlice(p)).includes("internalNote"), false);
});

test("slice: a skill's note never reaches the slice", () => {
  const p = base();
  p.skills[0].note = "reviewer remark about this skill";
  const slice = approvedSlice(p);
  assert.equal(slice.skills.some((s) => "note" in s), false);
  assert.equal(JSON.stringify(slice).includes("reviewer remark"), false);
});

test("slice: whitelisted fields are kept and undefined ones omitted", () => {
  const slice = approvedSlice(real);
  const gumloop = slice.roles.find((r) => r.id === "gumloop");
  assert.equal(gumloop.current, true);
  assert.equal("metrics" in gumloop, false);
  assert.equal("source" in gumloop, false);
  assert.ok(slice.identity.links.github);
});

test("robustness: approvedSlice throws, listing the problems, on an invalid profile", () => {
  const p = base();
  p.projects[0].evidence = [];
  assert.throws(() => approvedSlice(p), (e) => e instanceof Error && e.message.includes("personal-website"));
});

test("robustness: a role without a source fails", () => {
  const p = base();
  delete p.roles[1].source;
  assert.ok(mentions(validateProfile(p), "ramp"));
});

test("robustness: a role with a non-https source fails", () => {
  const p = base();
  p.roles[1].source = "http://example.com";
  assert.ok(mentions(validateProfile(p), "ramp"));
});

test("robustness: reserved ids are rejected on roles and projects", () => {
  for (const id of ["identity", "notYet", "learningGoals"]) {
    const p = base();
    p.roles[1].id = id;
    assert.ok(mentions(validateProfile(p), id), `role id ${id}`);
    const q = base();
    q.projects[0].id = id;
    assert.ok(mentions(validateProfile(q), id), `project id ${id}`);
  }
});
