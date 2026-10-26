// POST /api/ask: answers a visitor's question from the approved profile only.
// askCore is pure apart from the injected fetch, so the tests and the eval runner can import it.
import { readFileSync } from "node:fs";
import { approvedSlice, evidenceIds } from "../lib/profile.mjs";

type AskInput = { question: unknown; origin?: string | null; ip?: string };
type AskDeps = { fetch: typeof fetch; env: Record<string, string | undefined>; now?: () => number };
type AskResult = { status: number; body: Record<string, unknown>; headers?: Record<string, string> };

const DEFAULT_MODEL = "openai/gpt-5.6-luna";
const DEFAULT_ORIGINS = "https://ralstonraphael.github.io,http://localhost:4173,http://127.0.0.1:4173";
const MAX_QUESTION = 500;
const MAX_ANSWER = 1500;
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;
const TIMEOUT_MS = 20_000;

// Read once at module load. Only the text after the first line that is exactly "---" is the prompt.
const grounding = readFileSync(new URL("../grounding.md", import.meta.url), "utf8");
const profile = JSON.parse(readFileSync(new URL("../profile.json", import.meta.url), "utf8"));
const slice = approvedSlice(profile);
const VALID_IDS = evidenceIds(slice);

function promptBody(text: string): string {
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => l === "---");
  if (at === -1) throw new Error('grounding.md has no line that is exactly "---".');
  return lines.slice(at + 1).join("\n").trim();
}
const SYSTEM_PROMPT = promptBody(grounding) + "\n\nPROFILE:\n" + JSON.stringify(slice);

const CONTACT_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.exec(String(slice.identity?.contact ?? ""))?.[0];
if (!CONTACT_EMAIL) throw new Error("identity.contact has no email address.");
const FALLBACK = `I can't answer that reliably right now. You can email Ralston at ${CONTACT_EMAIL}.`;

const failure = (status: number, error: string): AskResult => ({
  status,
  body: { error, answer: FALLBACK, evidence: [], refused: true },
});

// Per-ip request times. Serverless instances each have their own memory and are recycled,
// so this limit is best-effort; the monthly spend cap on the OpenRouter key is the hard stop.
const hits = new Map<string, number[]>();
function rateLimited(ip: string, now: number): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (v.every((t) => now - t >= RATE_WINDOW_MS)) hits.delete(k);
  }
  return false;
}

function allowedOrigins(env: Record<string, string | undefined>): string[] {
  return (env.ALLOWED_ORIGINS || DEFAULT_ORIGINS).split(",").map((s) => s.trim()).filter(Boolean);
}

// The first balanced {...} in the text, ignoring braces inside strings. Fences are stripped first.
function firstJsonObject(text: string): unknown {
  const t = text.replace(/```(?:json)?/gi, "");
  const start = t.indexOf("{");
  if (start === -1) return undefined;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return JSON.parse(t.slice(start, i + 1));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

type Reply = { answer: string; evidence: string[]; refused: boolean };
function validReply(content: unknown): Reply | null {
  if (typeof content !== "string") return null;
  const o = firstJsonObject(content) as Record<string, unknown> | undefined;
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const { answer, evidence, refused } = o;
  if (typeof answer !== "string" || answer.trim() === "" || answer.length > MAX_ANSWER) return null;
  if (typeof refused !== "boolean") return null;
  if (!Array.isArray(evidence) || !evidence.every((e) => typeof e === "string" && VALID_IDS.has(e))) return null;
  if (!refused && evidence.length === 0) return null;
  return { answer, evidence: evidence as string[], refused };
}

export async function askCore(input: AskInput, deps: AskDeps): Promise<AskResult> {
  const { env } = deps;
  const now = (deps.now ?? Date.now)();

  if (input.origin && !allowedOrigins(env).includes(input.origin)) {
    return { status: 403, body: { error: "origin_not_allowed" } };
  }
  if (rateLimited(input.ip || "unknown", now)) {
    return { status: 429, body: { error: "rate_limited" }, headers: { "Retry-After": "60" } };
  }
  const q = typeof input.question === "string" ? input.question.trim() : "";
  if (q.length < 1 || q.length > MAX_QUESTION) return { status: 400, body: { error: "bad_question" } };

  const key = env.OPENROUTER_API_KEY;
  if (!key) return failure(503, "not_configured");

  const model = env.PORTFOLIO_MODEL || DEFAULT_MODEL;
  let res: Response;
  try {
    res = await deps.fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://ralstonraphael.github.io/personal-website/",
        "X-Title": "Ralston's portfolio",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: q },
        ],
        temperature: 0.2,
        max_tokens: 600,
        response_format: { type: "json_object" },
        usage: { include: true },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    return name === "TimeoutError" || name === "AbortError" ? failure(504, "timeout") : failure(502, "provider_error");
  }
  if (!res.ok) return failure(502, "provider_error");

  let data: any;
  try {
    data = await res.json();
  } catch {
    return failure(200, "invalid_reply");
  }
  const reply = validReply(data?.choices?.[0]?.message?.content);
  if (!reply) return failure(200, "invalid_reply");

  return {
    status: 200,
    body: {
      answer: reply.answer,
      evidence: reply.evidence,
      refused: reply.refused,
      model,
      usage: {
        prompt_tokens: data?.usage?.prompt_tokens ?? null,
        completion_tokens: data?.usage?.completion_tokens ?? null,
        cost: data?.usage?.cost ?? null,
      },
    },
  };
}

// --- Vercel Web handlers ------------------------------------------------------

function cors(origin: string | null): Record<string, string> {
  const h: Record<string, string> = { Vary: "Origin" };
  if (origin && allowedOrigins(process.env).includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  let question: unknown;
  try {
    question = ((await request.json()) as { question?: unknown } | null)?.question;
  } catch {
    question = undefined;
  }
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const out = await askCore({ question, origin, ip }, { fetch: globalThis.fetch, env: process.env });
  return new Response(JSON.stringify(out.body), {
    status: out.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(origin), ...out.headers },
  });
}

export function OPTIONS(request: Request): Response {
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins(process.env).includes(origin)) {
    return new Response(JSON.stringify({ error: "origin_not_allowed" }), {
      status: 403,
      headers: { "Content-Type": "application/json", Vary: "Origin" },
    });
  }
  return new Response(null, {
    status: 204,
    headers: {
      ...cors(origin),
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
