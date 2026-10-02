function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function layout(params: { title: string; preview?: string; body: string }) {
  const title = escapeHtml(params.title);
  const preview = escapeHtml(params.preview ?? "");
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
</head>
<body style="margin:0;background:#0b1220;color:#e5e7eb;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${preview}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0b1220;padding:28px 12px">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#0f172a;border:1px solid rgba(148,163,184,0.2);border-radius:14px;overflow:hidden">
          <tr>
            <td style="padding:22px 24px;border-bottom:1px solid rgba(148,163,184,0.18)">
              <div style="font-weight:700;letter-spacing:0.3px;font-size:16px">Operix</div>
              <div style="font-size:12px;color:#94a3b8;margin-top:4px">${title}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 24px">
              ${params.body}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 24px;border-top:1px solid rgba(148,163,184,0.18);font-size:11px;color:#94a3b8">
              Se não pediu esta ação, ignore este email.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function welcomeEmail(params: { fullName: string }) {
  const name = escapeHtml(params.fullName.trim() || "utilizador");
  const subject = "Bem-vindo ao Operix";
  const body = `
    <p style="margin:0 0 12px;font-size:14px;line-height:1.6">Olá, <strong>${name}</strong>.</p>
    <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#cbd5e1">
      A tua conta foi criada com sucesso. Já podes entrar e começar a operar com IA, documentos e faturação.
    </p>
    <p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8">
      Dica: mantém a tua senha segura e ativa 2FA quando estiver disponível.
    </p>
  `;
  return {
    subject,
    html: layout({ title: subject, preview: "Conta criada com sucesso.", body }),
    text: `Olá, ${params.fullName}.\n\nA tua conta foi criada com sucesso.\n\nOperix`,
  };
}

export function passwordResetEmail(params: { fullName?: string | null; resetUrl: string }) {
  const subject = "Redefinir senha";
  const url = params.resetUrl;
  const safeUrl = escapeHtml(url);
  const name = escapeHtml((params.fullName ?? "").trim() || "utilizador");
  const body = `
    <p style="margin:0 0 12px;font-size:14px;line-height:1.6">Olá, <strong>${name}</strong>.</p>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#cbd5e1">
      Recebemos um pedido para redefinir a tua senha. Usa o botão abaixo para criar uma nova senha.
    </p>
    <p style="margin:0 0 18px">
      <a href="${safeUrl}" style="display:inline-block;background:#6366f1;color:#0b1220;text-decoration:none;font-weight:700;padding:10px 14px;border-radius:10px">
        Redefinir senha
      </a>
    </p>
    <p style="margin:0 0 6px;font-size:12px;line-height:1.6;color:#94a3b8">
      Se o botão não funcionar, copia e cola este link:
    </p>
    <p style="margin:0;font-size:12px;line-height:1.6;word-break:break-all;color:#cbd5e1">${safeUrl}</p>
  `;
  return {
    subject,
    html: layout({ title: subject, preview: "Link seguro para redefinir a senha.", body }),
    text: `Olá, ${params.fullName ?? ""}.\n\nRedefine a tua senha: ${url}\n\nOperix`,
  };
}

export function operationalNotificationEmail(params: {
  title: string;
  body?: string | null;
  source: string;
  priority: "low" | "normal" | "high" | "critical";
}) {
  const subject = `[${params.priority.toUpperCase()}] ${params.title}`;
  const body = `
    <p style="margin:0 0 12px;font-size:14px;line-height:1.6"><strong>${escapeHtml(params.title)}</strong></p>
    ${params.body ? `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#cbd5e1;white-space:pre-wrap">${escapeHtml(params.body)}</p>` : ""}
    <p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8">
      Origem: ${escapeHtml(params.source)} · Prioridade: ${escapeHtml(params.priority)}
    </p>
  `;
  return {
    subject,
    html: layout({ title: subject, preview: params.title, body }),
    text: `${params.title}\n\n${params.body ?? ""}\n\nOrigem: ${params.source}\nPrioridade: ${params.priority}`,
  };
}

export function reportEmail(params: {
  title: string;
  body: string;
}) {
  const subject = params.title;
  const body = `
    <p style="margin:0 0 12px;font-size:14px;line-height:1.6">${escapeHtml(params.body)}</p>
    <p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8">
      O PDF do relatório segue em anexo.
    </p>
  `;
  return {
    subject,
    html: layout({ title: subject, preview: params.body, body }),
    text: `${params.body}\n\nO PDF do relatório segue em anexo.`,
  };
}
