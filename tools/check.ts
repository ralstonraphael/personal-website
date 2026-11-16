// The claim check: plain code looking for things in the answer that no tool returned this turn.
// It catches commit SHAs, dates and ralstonraphael/<repo> slugs that are not in a tool result, and
// a repository the tool said does not exist being described as if it did. It cannot judge whether
// a paraphrase of a commit message is faithful; tools/CHECKS.md says what that would take.
import type { TraceEntry } from "./loop.ts";

const SHA = /\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b/g;
const DATE = /\b\d{4}-\d{2}-\d{2}\b/g;
const SLUG = /\bralstonraphael\/([A-Za-z0-9._-]+?)(?=[.,;:!?)]?(?:\s|$))/gi;
const NEGATION = /\b(no|not|couldn't|could not|can't|cannot|doesn't|does not|isn't|wasn't|unable|no such|nothing)\b|n't\b/i;

export function checkClaims(answer: string, trace: Array<Partial<TraceEntry>>): { supported: boolean; unsupported: string[] } {
  const shas = new Set<string>();
  const dates = new Set<string>();
  const repos = new Set<string>();
  const notFound: string[] = [];
  for (const t of trace) {
    const r = (t.result ?? {}) as Record<string, any>;
    if (typeof r.repo === "string") {
      if (r.found === false) notFound.push(r.repo.split("/")[1]);
      else repos.add(r.repo.toLowerCase());
    }
    for (const c of Array.isArray(r.commits) ? r.commits : []) {
      if (c?.sha) shas.add(String(c.sha).toLowerCase());
      if (c?.date) dates.add(String(c.date));
    }
  }
  const unsupported: string[] = [];
  for (const m of answer.toLowerCase().match(SHA) ?? []) {
    if (![...shas].some((s) => m.startsWith(s) || s.startsWith(m))) unsupported.push(`commit ${m} is not in any tool result`);
  }
  for (const d of answer.match(DATE) ?? []) {
    if (!dates.has(d)) unsupported.push(`date ${d} is not in any tool result`);
  }
  for (const m of answer.matchAll(SLUG)) {
    const slug = `ralstonraphael/${m[1]}`.toLowerCase();
    if (!repos.has(slug) && !notFound.some((n) => n.toLowerCase() === m[1].toLowerCase())) {
      unsupported.push(`repository ${slug} was not returned by a tool`);
    }
  }
  // A repository GitHub said does not exist may be named only to say so.
  const sentences = answer.split(/(?<=[.!?])\s+/);
  for (const name of notFound) {
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    for (const s of sentences) {
      if (re.test(s) && !NEGATION.test(s)) unsupported.push(`repository ${name} was not found but the answer describes it`);
    }
  }
  return { supported: unsupported.length === 0, unsupported };
}
