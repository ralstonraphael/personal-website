// The tool loop: the model asks, our code decides, the model answers from what it got back.
// runTool never throws on a bad request: the problem goes back to the model as the tool's result.
// runLoop stops when the model answers without asking for a tool, or after maxSteps chat calls.
import { RECENT_COMMITS, recentCommits } from "./github.ts";

type ToolDeps = { fetch: typeof fetch; env: Record<string, string | undefined> };
type Schema = { type: string; function: { name: string; description: string; parameters: any } };
export type Tool = {
  schema: Schema;
  run: (args: any, deps: ToolDeps) => Promise<Record<string, unknown>>;
  sideEffect?: boolean; // never run on the model's request alone
};
export type TraceEntry = { step: number; tool: string; arguments: string; result: Record<string, unknown>; seconds: number };
type Pending = { tool: string; arguments: Record<string, unknown> };

export const TOOLS: Record<string, Tool> = {
  recent_commits: { schema: RECENT_COMMITS as unknown as Schema, run: recentCommits },
};
export const MAX_STEPS = 4;

export function schemasOf(registry: Record<string, Tool> = TOOLS): Schema[] {
  return Object.values(registry).map((t) => t.schema);
}

// Plain code against the schema the model was shown. Returns a message, or null if the call is fine.
export function validate(params: any, args: unknown): string | null {
  if (!args || typeof args !== "object" || Array.isArray(args)) return "arguments must be a JSON object";
  const a = args as Record<string, unknown>;
  const props: Record<string, any> = params.properties ?? {};
  for (const req of params.required ?? []) {
    if (!(req in a)) return `missing required argument '${req}'; send ${JSON.stringify(Object.keys(props))}`;
  }
  for (const [key, val] of Object.entries(a)) {
    const spec = props[key];
    if (!spec) return `unexpected argument '${key}'; the arguments are ${Object.keys(props).join(", ")}`;
    if (spec.type === "string") {
      if (typeof val !== "string") return `argument '${key}' must be a string, got ${typeof val}`;
      if (spec.pattern && !new RegExp(spec.pattern).test(val)) {
        return `argument '${key}' must be the repository name only (letters, digits, . _ -), without an owner; got ${JSON.stringify(val)}`;
      }
    }
    if (spec.type === "integer") {
      const ok = typeof val === "number" && Number.isInteger(val) &&
        (spec.minimum === undefined || val >= spec.minimum) && (spec.maximum === undefined || val <= spec.maximum);
      if (!ok) return `argument '${key}' must be a whole number from ${spec.minimum} to ${spec.maximum}`;
    }
  }
  return null;
}

export async function runTool(
  name: string,
  rawArgs: unknown,
  deps: ToolDeps,
  registry: Record<string, Tool> = TOOLS,
  allowSideEffects = false,
): Promise<{ result: Record<string, unknown>; pending?: Pending }> {
  const tool = Object.hasOwn(registry, name) ? registry[name] : undefined;
  if (!tool) {
    return { result: { error: `unknown tool '${name}'; the tools are [${Object.keys(registry).map((k) => `'${k}'`).join(", ")}]` } };
  }
  let args: unknown = rawArgs;
  if (typeof rawArgs === "string") {
    try {
      args = JSON.parse(rawArgs.trim() === "" ? "{}" : rawArgs);
    } catch (err) {
      return { result: { error: `arguments were not valid JSON (${(err as Error).message}); send an object like {"repo": "personal-website"}` } };
    }
  }
  const problem = validate(tool.schema.function.parameters, args);
  if (problem) return { result: { error: problem } };
  if (tool.sideEffect && !allowSideEffects) {
    const pending = { tool: name, arguments: args as Record<string, unknown> };
    return { result: { error: `${name} has a side effect and needs a person's confirmation first`, pending }, pending };
  }
  try {
    return { result: await tool.run(args, deps) };
  } catch (err) {
    return { result: { error: `${name} failed: ${(err as Error)?.message ?? "unknown error"}` } };
  }
}

type LoopOptions = {
  messages: any[];
  send: (messages: any[]) => Promise<any>; // one billed chat call; throws on a network or HTTP error
  toolDeps: ToolDeps;
  registry?: Record<string, Tool>;
  maxSteps?: number;
  now?: () => number;
};
export type LoopResult = {
  stoppedBy: "answer" | "cap";
  content: string | null; // the model's final text, or null when the cap stopped it
  trace: TraceEntry[];
  steps: number;
  cost: number;
  promptTokens: number | null;
  completionTokens: number | null;
  pending: Pending[];
};

export async function runLoop(opts: LoopOptions): Promise<LoopResult> {
  const { send, toolDeps, registry = TOOLS, maxSteps = MAX_STEPS } = opts;
  const now = opts.now ?? Date.now;
  const messages = opts.messages;
  const trace: TraceEntry[] = [];
  const pending: Pending[] = [];
  let cost = 0;
  let promptTokens: number | null = null;
  let completionTokens: number | null = null;
  const done = (stoppedBy: "answer" | "cap", content: string | null, steps: number): LoopResult =>
    ({ stoppedBy, content, trace, steps, cost, promptTokens, completionTokens, pending });

  for (let step = 1; step <= maxSteps; step++) {
    const data = await send(messages);
    const u = data?.usage;
    if (typeof u?.cost === "number") cost += u.cost;
    if (typeof u?.prompt_tokens === "number") promptTokens = (promptTokens ?? 0) + u.prompt_tokens;
    if (typeof u?.completion_tokens === "number") completionTokens = (completionTokens ?? 0) + u.completion_tokens;
    const msg = data?.choices?.[0]?.message;
    const calls: any[] = Array.isArray(msg?.tool_calls) ? msg.tool_calls : [];
    if (calls.length === 0) return done("answer", typeof msg?.content === "string" ? msg.content : null, step);

    // The model asked for tools: record the request exactly as made, then answer every call.
    messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: calls });
    for (const tc of calls) {
      const t0 = now();
      const name = String(tc?.function?.name ?? "");
      const rawArgs = tc?.function?.arguments ?? "";
      const out = await runTool(name, rawArgs, toolDeps, registry);
      if (out.pending) pending.push(out.pending);
      trace.push({
        step,
        tool: name,
        arguments: typeof rawArgs === "string" ? rawArgs : JSON.stringify(rawArgs),
        result: out.result,
        seconds: Math.round((now() - t0) / 10) / 100,
      });
      messages.push({ role: "tool", tool_call_id: tc?.id, content: JSON.stringify(out.result) });
    }
  }
  // The cap: the model never stopped asking. Whatever it would have said next is not shown.
  return done("cap", null, maxSteps);
}
