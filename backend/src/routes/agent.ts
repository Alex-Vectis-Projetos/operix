import { Router, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { resolveRequestContext } from "../middleware/requestContext.js";
import { fetchAIStream, hasAIProvider } from "../lib/ai.js";

export const agentRouter = Router();

agentRouter.use(requireAuth);
agentRouter.use(resolveRequestContext);

type Part =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "input_audio"; input_audio: { data: string; format: string } };

interface IncomingMsg {
  role: "user" | "assistant";
  content: string | Part[];
}

interface AgentContext {
  workspace_id?: string;
  route?: string;
  module?: string;
  online?: boolean;
  realtime?: string;
  signals?: Array<{ id: string; level: string; title: string; detail?: string }>;
  recentEvents?: Array<{ kind: string; level: string; title: string; detail?: string; at: number }>;
  consoleErrors?: number;
  renderCrashes?: number;
  runtimeSnapshot?: Record<string, unknown>;
  errorAttachments?: Array<{ source: string; message: string; at?: number }>;
}

const SYSTEM_PROMPT = `Você é o Operix Copilot — copiloto OPERACIONAL e TÉCNICO do ecossistema Operix.

Idioma: Português (PT-BR), tom técnico, direto, objetivo. Máximo ~8 linhas por resposta.

Função:
- Observador inteligente do sistema operacional Operix.
- Realiza troubleshooting com base em screenshots, logs, contexto injetado e integridade de rede.
- Quando recebe IMAGEM: analisa estritamente elementos operacionais (erros, métricas, formulários, tabelas). Faz OCR técnico se houver texto.
- Quando recebe ÁUDIO: assume relato técnico ou ditado do operador.
- Recusa solicitações fora do escopo do Operix ou fora do contexto operacional.

REGRAS DE SEGURANÇA E INTEGRIDADE:
- NUNCA execute ou simule ações destrutivas no banco de dados.
- NUNCA invente métricas, dados ou IDs inexistentes no contexto.
- Se faltar informação para diagnosticar, oriente o operador com precisão sobre o que coletar.

Estilo:
- Markdown limpo (negrito, listas curtas, código/rotas quando pertinente).
- Vá direto à causa mais provável e indique a ação recomendada.`;

function buildContextMessage(ctx: AgentContext): string {
  const lines: string[] = ["[CONTEXTO OPERACIONAL DO OPERIX]"];
  lines.push(`Rota: ${ctx.route ?? "?"} · Módulo: ${ctx.module ?? "?"}`);
  lines.push(`Conectividade: ${ctx.online ? "Online" : "Offline"} · Realtime: ${ctx.realtime ?? "unknown"}`);
  if (typeof ctx.consoleErrors === "number" || typeof ctx.renderCrashes === "number") {
    lines.push(`Erros de console: ${ctx.consoleErrors ?? 0} · Render crashes: ${ctx.renderCrashes ?? 0}`);
  }
  if (ctx.signals?.length) {
    lines.push("Sinais operacionais ativos:");
    ctx.signals.slice(0, 8).forEach((s) => {
      lines.push(`  - [${s.level.toUpperCase()}] ${s.title}${s.detail ? " — " + s.detail : ""}`);
    });
  }
  if (ctx.recentEvents?.length) {
    lines.push(`Eventos de rede recentes (${Math.min(ctx.recentEvents.length, 10)}):`);
    ctx.recentEvents.slice(-10).forEach((e) => {
      lines.push(`  - [${e.level.toUpperCase()}] ${e.kind} · ${e.title}${e.detail ? " — " + e.detail : ""}`);
    });
  }
  if (ctx.errorAttachments?.length) {
    lines.push("Erros reportados pelo operador:");
    ctx.errorAttachments.slice(0, 6).forEach((e) => {
      lines.push(`  - ${e.source}: ${String(e.message).slice(0, 280)}`);
    });
  }
  if (ctx.runtimeSnapshot && Object.keys(ctx.runtimeSnapshot).length) {
    lines.push("Snapshot técnico:");
    lines.push("```json");
    lines.push(JSON.stringify(ctx.runtimeSnapshot).slice(0, 1500));
    lines.push("```");
  }
  return lines.join("\n");
}

function normaliseTurn(m: IncomingMsg): IncomingMsg {
  const role = m.role === "assistant" ? "assistant" : "user";
  if (typeof m.content === "string") {
    return { role, content: String(m.content).slice(0, 2000) };
  }
  if (!Array.isArray(m.content)) return { role, content: "" };
  const parts: Part[] = [];
  let images = 0;
  let audios = 0;
  for (const p of m.content) {
    if (!p || typeof p !== "object") continue;
    if (p.type === "text" && typeof p.text === "string") {
      parts.push({ type: "text", text: p.text.slice(0, 2000) });
    } else if (p.type === "image_url" && p.image_url?.url && images < 3) {
      if (p.image_url.url.length < 6_500_000) {
        parts.push({ type: "image_url", image_url: { url: p.image_url.url } });
        images += 1;
      }
    } else if (p.type === "input_audio" && p.input_audio?.data && audios < 1) {
      if (p.input_audio.data.length < 4_000_000) {
        parts.push({
          type: "input_audio",
          input_audio: {
            data: p.input_audio.data,
            format: p.input_audio.format || "wav",
          },
        });
        audios += 1;
      }
    }
  }
  if (parts.length === 0) parts.push({ type: "text", text: "" });
  return { role, content: parts };
}

function streamLocalDiagnostic(res: Response, ctx: AgentContext, userQuery: string) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const errorCount = ctx.signals?.filter((s) => s.level === "error").length ?? 0;
  const warnCount = ctx.signals?.filter((s) => s.level === "warn").length ?? 0;

  const lines = [
    `**Operix Copilot** (Diagnóstico Operacional Integrado)`,
    ``,
    `• **Módulo Atual:** ${ctx.module ?? "Geral"} (\`${ctx.route ?? "/"}\`)`,
    `• **Status do Sistema:** ${errorCount > 0 ? "Atenção Crítica" : warnCount > 0 ? "Alerta" : "Operacionalmente Estável"}`,
  ];

  if (errorCount > 0 || warnCount > 0) {
    lines.push(`• **Sinais Detectados:**`);
    ctx.signals?.filter((s) => s.level === "error" || s.level === "warn").forEach((s) => {
      lines.push(`  - [${s.level.toUpperCase()}] ${s.title}${s.detail ? ` (${s.detail})` : ""}`);
    });
  } else {
    lines.push(`• **Observação:** Não foram detectadas anomalias nos endpoints observados.`);
  }

  if (userQuery) {
    lines.push(``);
    lines.push(`*Análise sobre "${userQuery.slice(0, 60)}...":*`);
    lines.push(`O backend registrou sua solicitação no workspace ativo. Para raciocínio de linguagem natural com LLM generativo em nuvem, certifique-se de configurar \`GEMINI_API_KEY\` ou \`OPENAI_API_KEY\` no ambiente do servidor.`);
  }

  const fullText = lines.join("\n");
  const chunks = fullText.match(/.{1,40}/g) || [fullText];

  for (const chunk of chunks) {
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`);
  }
  res.write("data: [DONE]\n\n");
  res.end();
}

agentRouter.post("/chat", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = req.body ?? {};
    const messages: IncomingMsg[] = Array.isArray(body?.messages) ? body.messages : [];
    const context: AgentContext = body?.context ?? {};

    const workspaceId = req.ctx?.activeWorkspaceId;
    if (!workspaceId) {
      return res.status(400).json({ message: "Workspace ativo não identificado." });
    }

    const lastUserTurn = [...messages].reverse().find((m) => m.role === "user");
    const lastUserText = typeof lastUserTurn?.content === "string"
      ? lastUserTurn.content
      : Array.isArray(lastUserTurn?.content)
        ? (lastUserTurn.content.find((p) => p.type === "text") as { text: string } | undefined)?.text ?? ""
        : "";

    // If no external AI provider configured, fallback smoothly to local diagnostic stream
    if (!hasAIProvider()) {
      return streamLocalDiagnostic(res, { ...context, workspace_id: workspaceId }, lastUserText);
    }

    // External AI provider available (Gemini / OpenAI)
    const trimmed = messages.slice(-12).map(normaliseTurn);
    const payload = {
      stream: true,
      max_tokens: 800,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "system", content: buildContextMessage({ ...context, workspace_id: workspaceId }) },
        ...trimmed,
      ],
    };

    const upstream = await fetchAIStream(payload);
    if (!upstream || !upstream.body) {
      return streamLocalDiagnostic(res, { ...context, workspace_id: workspaceId }, lastUserText);
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const reader = upstream.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    } finally {
      reader.releaseLock();
      res.end();
    }
  } catch (err) {
    console.error("[agent-chat] error:", err);
    if (!res.headersSent) {
      res.status(500).json({ message: "Falha ao processar resposta do copiloto." });
    } else {
      res.end();
    }
  }
});
