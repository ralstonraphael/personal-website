// recent_commits: the chatbot's one real tool. The schema is what the model sees; the function is
// what our code runs after it has checked the arguments itself (tools/loop.ts). The owner is fixed
// here, so the model can only name one of Ralston's repositories, never anyone else's.
// Everything GitHub can do wrong comes back as a result the model can read, never an exception.

type ToolDeps = { fetch: typeof fetch; env: Record<string, string | undefined> };

export const OWNER = "ralstonraphael";
const TIMEOUT_MS = 10_000;

export const RECENT_COMMITS = {
  type: "function",
  function: {
    name: "recent_commits",
    description:
      "The most recent commits in one of Ralston's public GitHub repositories. Use this before saying anything " +
      "about what he has worked on lately, and say plainly when a repository is not found.",
    parameters: {
      type: "object",
      properties: {
        repo: {
          type: "string",
          description: "Repository name only, without the owner, for example personal-website",
          pattern: "^[A-Za-z0-9._-]{1,100}$",
        },
        count: { type: "integer", description: "How many commits, 1 to 10 (default 5)", minimum: 1, maximum: 10 },
      },
      required: ["repo"],
      additionalProperties: false,
    },
  },
} as const;

export async function recentCommits(args: { repo: string; count?: number }, deps: ToolDeps): Promise<Record<string, unknown>> {
  const slug = `${OWNER}/${args.repo}`;
  const count = args.count ?? 5;
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "ralstonraphael-portfolio" };
  if (deps.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${deps.env.GITHUB_TOKEN}`;
  let res: Response;
  try {
    res = await deps.fetch(`https://api.github.com/repos/${slug}/commits?per_page=${count}`, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return { error: `could not reach GitHub (${(err as { name?: string })?.name ?? "error"}); try again later` };
  }
  if (res.status === 404) return { error: `no public repository named ${slug}`, repo: slug, found: false };
  if (res.status === 409) return { repo: slug, commits: [], note: "the repository is empty" };
  if (res.status === 403 || res.status === 429) {
    return { error: "GitHub rate limit reached; the commits can't be read right now, try again in an hour" };
  }
  if (!res.ok) return { error: `GitHub answered ${res.status}` };
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { error: "GitHub sent a reply that was not JSON" };
  }
  if (!Array.isArray(data)) return { error: "GitHub sent an unexpected reply" };
  return {
    repo: slug,
    commits: data.map((c: any) => ({
      sha: String(c?.sha ?? "").slice(0, 7),
      date: String(c?.commit?.author?.date ?? "").slice(0, 10),
      message: String(c?.commit?.message ?? "").split("\n")[0].slice(0, 100),
    })),
  };
}
