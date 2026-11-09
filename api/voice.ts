// POST /api/voice: hear, think, speak. The body is the recording; Content-Type says its format.
// The transcript goes through askCore, the typed path's answer function, so the answer guard and
// held claims apply to what is said aloud. The key stays here; the browser sends only audio.
import { askCore, allowedOrigins, cors } from "./ask.ts";

type VoiceInput = { audio: Uint8Array; contentType: string | null; origin?: string | null; ip?: string };
type VoiceDeps = { fetch: typeof fetch; env: Record<string, string | undefined>; now?: () => number };
type VoiceResult = { status: number; body: Record<string, unknown> };

const API = "https://openrouter.ai/api/v1";
const STT_MODEL = "openai/whisper-large-v3-turbo";
const TTS_MODEL = "microsoft/mai-voice-2.1-flash";
const TTS_VOICE = "en-US-Harper:MAI-Voice-2.1-Flash";
// The speech reply is bytes with no usage object, so its cost is the catalog price per character
// (checked November 9, 2026) times characters, marked as an estimate.
const TTS_PRICE_PER_CHAR = 0.000015;
const MAX_AUDIO = 10_000_000;
const MAX_QUESTION = 500;
const TIMEOUT_MS = 20_000;

export const FORMATS: Record<string, string> = {
  "audio/webm": "webm", "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav",
  "audio/x-wav": "wav", "audio/wave": "wav", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/flac": "flac",
};

// An email address said as words: the speech model read "ralstone2005" as "20 zero 5"
// (heard November 9), and "gmail.com." would otherwise end a sentence early.
function spokenEmail(_: string, local: string, domain: string): string {
  const say = (part: string) => part.replace(/([A-Za-z])(\d)/g, "$1 $2").replace(/(\d)([A-Za-z])/g, "$1 $2");
  return `${local.split(".").map(say).join(" dot ")} at ${domain.split(".").join(" dot ")}`;
}

// At most three sentences, with markdown, list markers and URLs removed, for the speech call.
export function spokenText(answer: string): string {
  const plain = answer
    .replace(/\b([A-Za-z0-9_%+-]+(?:\.[A-Za-z0-9_%+-]+)*)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})\b/g, spokenEmail)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, "")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .replace(/ +([.,;:!?])/g, "$1")
    .trim();
  return plain.split(/(?<=[.!?])\s+/).slice(0, 3).join(" ");
}

const failed = (status: number, error: string): VoiceResult => ({ status, body: { error } });

export async function voiceCore(input: VoiceInput, deps: VoiceDeps): Promise<VoiceResult> {
  const { env } = deps;
  if (input.origin && !allowedOrigins(env).includes(input.origin)) return failed(403, "origin_not_allowed");
  const fmt = FORMATS[(input.contentType ?? "").split(";")[0].trim().toLowerCase()];
  if (!fmt) return failed(415, "unsupported_audio");
  if (input.audio.length === 0) return failed(400, "empty_audio");
  if (input.audio.length > MAX_AUDIO) return failed(413, "audio_too_large");
  const key = env.OPENROUTER_API_KEY;
  if (!key) return failed(503, "not_configured");
  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const clock = deps.now ?? Date.now;

  // 1. hear
  const t0 = clock();
  let heard: { text?: unknown; usage?: { seconds?: number; cost?: number } };
  try {
    const res = await deps.fetch(`${API}/audio/transcriptions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: STT_MODEL, input_audio: { data: Buffer.from(input.audio).toString("base64"), format: fmt } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return failed(502, "provider_error");
    heard = await res.json();
  } catch {
    return failed(502, "provider_error");
  }
  const transcript = typeof heard?.text === "string" ? heard.text.trim() : "";
  const sttCost = heard?.usage?.cost ?? null;
  const audioSeconds = heard?.usage?.seconds ?? null;
  const t1 = clock();
  if (!transcript) {
    return {
      status: 200,
      body: { error: "empty_transcript", transcript: "", answer: "I didn't catch that.", audio_b64: null,
        audio_seconds: audioSeconds, cost: { stt: sttCost, chat: 0, tts: 0 } },
    };
  }

  // 2. think: the typed path's function, unchanged
  const asked = await askCore({ question: transcript.slice(0, MAX_QUESTION), origin: input.origin, ip: input.ip }, deps);
  const t2 = clock();
  const answer = typeof asked.body.answer === "string" ? asked.body.answer : "I can't answer that right now.";
  const spoken = spokenText(answer);

  // 3. speak; a failed speech call still returns the text
  let audioB64: string | null = null;
  let audioType: string | null = null;
  let ttsError: string | null = null;
  try {
    const res = await deps.fetch(`${API}/audio/speech`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: TTS_MODEL, input: spoken, voice: TTS_VOICE, response_format: "mp3" }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const ctype = res.headers.get("content-type") ?? "";
    if (!res.ok) ttsError = "speech_failed";
    else if (!ctype.startsWith("audio/")) ttsError = "speech_not_audio";
    else {
      audioB64 = Buffer.from(await res.arrayBuffer()).toString("base64");
      audioType = ctype.split(";")[0];
    }
  } catch {
    ttsError = "speech_failed";
  }
  const ttsCost = audioB64 ? +(TTS_PRICE_PER_CHAR * spoken.length).toFixed(6) : 0;
  const chatCost = (asked.body.usage as { cost?: number } | undefined)?.cost ?? null;

  return {
    status: 200,
    body: {
      ...(asked.body.error ? { error: asked.body.error } : {}),
      transcript,
      answer,
      spoken,
      evidence: asked.body.evidence ?? [],
      refused: asked.body.refused ?? true,
      audio_b64: audioB64,
      audio_type: audioType,
      tts_error: ttsError,
      audio_seconds: audioSeconds,
      cost: { stt: sttCost, chat: chatCost, tts: ttsCost, tts_is_estimate: true,
        total: +((sttCost ?? 0) + (chatCost ?? 0) + ttsCost).toFixed(6) },
      seconds: { stt: (t1 - t0) / 1000, chat: (t2 - t1) / 1000, tts: (clock() - t2) / 1000 },
      models: { stt: STT_MODEL, chat: asked.body.model ?? null, tts: `${TTS_MODEL} / ${TTS_VOICE}` },
    },
  };
}

// --- Vercel Web handlers ------------------------------------------------------

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  const declared = Number(request.headers.get("content-length") ?? 0);
  const audio = declared > MAX_AUDIO ? new Uint8Array(MAX_AUDIO + 1) : new Uint8Array(await request.arrayBuffer());
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const out = await voiceCore({ audio, contentType: request.headers.get("content-type"), origin, ip }, { fetch: globalThis.fetch, env: process.env });
  return new Response(JSON.stringify(out.body), {
    status: out.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(origin) },
  });
}

export function OPTIONS(request: Request): Response {
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins(process.env).includes(origin)) {
    return new Response(JSON.stringify({ error: "origin_not_allowed" }), { status: 403, headers: { "Content-Type": "application/json", Vary: "Origin" } });
  }
  return new Response(null, {
    status: 204,
    headers: { ...cors(origin), "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" },
  });
}
