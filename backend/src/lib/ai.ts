import { env } from "../config/env.js";

interface AIConfig {
  apiKey: string;
  endpoint: string;
  defaultModel: string;
}

export function hasAIProvider(): boolean {
  return Boolean(env.GEMINI_API_KEY || env.OPENAI_API_KEY);
}

export function getAIConfigsSafe(): AIConfig[] {
  const configs: AIConfig[] = [];
  if (env.GEMINI_API_KEY) {
    configs.push({
      apiKey: env.GEMINI_API_KEY,
      endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      defaultModel: "gemini-2.5-flash",
    });
  }
  if (env.OPENAI_API_KEY) {
    configs.push({
      apiKey: env.OPENAI_API_KEY,
      endpoint: "https://api.openai.com/v1/chat/completions",
      defaultModel: "gpt-4o-mini",
    });
  }
  return configs;
}

function getAIConfigs(): AIConfig[] {
  const configs = getAIConfigsSafe();
  if (configs.length === 0) {
    throw new Error("No AI provider configured. Set GEMINI_API_KEY or OPENAI_API_KEY.");
  }
  return configs;
}

export async function fetchAIStream(payload: Record<string, unknown>, signal?: AbortSignal): Promise<globalThis.Response | null> {
  const configs = getAIConfigsSafe();
  if (configs.length === 0) return null;

  for (let i = 0; i < configs.length; i++) {
    const config = configs[i];
    try {
      const res = await fetch(config.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: config.defaultModel, stream: true, ...payload }),
        signal,
      });

      if (res.ok && res.body) {
        return res;
      }
      console.warn(`[ai-stream] Provider ${config.endpoint} returned ${res.status}`);
    } catch (err) {
      if ((err as Error)?.name === "AbortError") throw err;
      console.warn(`[ai-stream] Provider ${config.endpoint} error:`, err);
    }
  }

  return null;
}

function hasToolCalls(data: unknown): boolean {
  return Array.isArray((data as any)?.choices?.[0]?.message?.tool_calls) &&
    (data as any).choices[0].message.tool_calls.length > 0;
}

export async function fetchAICompletion(payload: Record<string, unknown>): Promise<Response> {
  const configs = getAIConfigs();
  let lastBody: unknown = null;
  let lastStatus = 500;

  for (let i = 0; i < configs.length; i++) {
    const config = configs[i];
    const isLast = i === configs.length - 1;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 75_000);
    let res: globalThis.Response;
    try {
      res = await fetch(config.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: config.defaultModel, ...payload }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    // Always read the body so we can inspect or re-wrap it
    const body = await res.json().catch(() => null);

    // Fall back on auth/rate-limit errors
    if ((res.status === 429 || res.status === 401 || res.status === 403) && !isLast) {
      console.warn(`[ai] Provider ${config.endpoint} returned ${res.status}, trying fallback...`);
      lastBody = body;
      lastStatus = res.status;
      continue;
    }

    // Fall back when provider returned 200 but no tool_calls
    if (res.ok && !isLast && !hasToolCalls(body)) {
      console.warn(`[ai] Provider ${config.endpoint} returned no tool_calls, trying fallback...`);
      lastBody = body;
      lastStatus = res.status;
      continue;
    }

    return new Response(JSON.stringify(body), {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(lastBody), {
    status: lastStatus,
    headers: { "Content-Type": "application/json" },
  });
}

export function parseToolCall(data: any): unknown {
  const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) throw new Error("No structured data returned from AI");
  return JSON.parse(toolCall.function.arguments);
}
