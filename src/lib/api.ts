import { getAccessToken } from "@/lib/authSession";

const env = (import.meta as ImportMeta & {
  env?: Record<string, string | undefined>;
}).env;

export const API_BASE_URL =
  env?.VITE_API_URL?.replace(/\/$/, "") ??
  "http://localhost:4000/api";
const DEFAULT_API_TIMEOUT_MS = 12000;

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function parseResponseBody(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  const text = await response.text();
  return text ? { message: text } : {};
}

type ApiRequestInit = RequestInit & { timeoutMs?: number };

export async function apiRequest<T>(path: string, init?: ApiRequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  const token = getAccessToken();
  const controller = new AbortController();
  const timeoutMs = typeof init?.timeoutMs === "number" ? init.timeoutMs : DEFAULT_API_TIMEOUT_MS;
  const timer = window.setTimeout(() => controller.abort(new Error(`API timeout after ${timeoutMs}ms`)), timeoutMs);

  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const selectedWs = typeof window !== "undefined" ? localStorage.getItem("selected_workspace_id") : null;
  if (selectedWs && !headers.has("X-Workspace-Id")) {
    headers.set("X-Workspace-Id", selectedWs);
  }

  try {
    const response = await fetch(`${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`, {
      ...init,
      headers,
      signal: init?.signal ?? controller.signal,
    });
    const body = await parseResponseBody(response);

    if (!response.ok) {
      const message =
        typeof body === "object" && body && "message" in body && typeof body.message === "string"
          ? body.message
          : `API request failed with status ${response.status}`;
      throw new ApiError(message, response.status);
    }

    return body as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("A ligação ao servidor demorou demasiado tempo.", 408);
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}
