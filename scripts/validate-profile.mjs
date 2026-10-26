import { readFileSync } from "node:fs";
import { validateProfile } from "../lib/profile.mjs";

const profile = JSON.parse(readFileSync(new URL("../profile.json", import.meta.url), "utf8"));
const errors = validateProfile(profile);
if (errors.length > 0) {
  for (const e of errors) console.log(e);
  process.exit(1);
}
console.log(`profile.json: valid (${profile.roles.length} roles, ${profile.projects.length} projects, ${profile.skills.length} skills)`);
