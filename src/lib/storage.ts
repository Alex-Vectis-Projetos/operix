import { getAccessToken, buildAuthHeaders } from "./authSession";

const API_URL = import.meta.env.VITE_API_URL as string;

const PUBLIC_BUCKETS = new Set(["avatars", "hail-reports", "marketplace", "logos"]);

function getActiveWorkspaceId(): string | null {
  try {
    return localStorage.getItem("selected_workspace_id");
  } catch {
    return null;
  }
}

export function qualifyTenantPath(path: string, bucket?: string): string {
  if (bucket && PUBLIC_BUCKETS.has(bucket)) return path;
  const clean = path.startsWith("/") ? path.slice(1) : path;
  if (clean.startsWith("tenants/")) return clean;
  const wsId = getActiveWorkspaceId();
  if (wsId) return `tenants/${wsId}/${clean}`;
  return clean;
}

/**
 * Retorna a URL de acesso a um arquivo armazenado no MinIO via backend.
 * Buckets públicos: sem autenticação (/storage/public/:bucket/*).
 * Buckets privados: endpoint protegido (/storage/file/:bucket/*). Presigned URLs da API devem ser priorizadas.
 */
export function getFileUrl(bucket: string, path: string): string {
  if (PUBLIC_BUCKETS.has(bucket)) {
    return `${API_URL}/storage/public/${bucket}/${path}`;
  }
  const resolvedPath = qualifyTenantPath(path, bucket);
  return `${API_URL}/storage/file/${bucket}/${resolvedPath}`;
}

/**
 * Faz upload de um arquivo para o MinIO via backend.
 * Retorna o path armazenado ou lança erro.
 */
export async function uploadFile(
  bucket: string,
  path: string,
  file: File | Blob,
  contentType?: string
): Promise<{ path: string; bucket: string }> {
  const resolvedPath = qualifyTenantPath(path, bucket);
  const form = new FormData();
  form.append("bucket", bucket);
  form.append("path", resolvedPath);
  form.append(
    "file",
    file instanceof File ? file : new File([file], resolvedPath.split("/").pop() ?? "file", {
      type: contentType ?? "application/octet-stream",
    })
  );

  const res = await fetch(`${API_URL}/storage/upload`, {
    method: "POST",
    headers: buildAuthHeaders(),
    body: form,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? "Erro ao fazer upload.");
  }

  return res.json() as Promise<{ path: string; bucket: string }>;
}

/**
 * Deleta um ou mais arquivos de um bucket.
 */
export async function deleteFiles(bucket: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const resolvedPaths = paths.map((p) => qualifyTenantPath(p, bucket));

  const res = await fetch(`${API_URL}/storage/files`, {
    method: "DELETE",
    headers: buildAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ bucket, paths: resolvedPaths }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? "Erro ao deletar arquivo(s).");
  }
}

/**
 * Abre ou descarrega arquivos com segurança cross-browser.
 * Resolve a restrição de segurança dos navegadores Chromium (Chrome/Edge/Brave) que bloqueiam
 * a abertura direta de Data URLs (data:application/pdf ou data:image) via window.open().
 * Converte Data URLs para Blob URLs gerenciadas ou faz download direto.
 */
export function openOrDownloadFile(
  urlOrData: string,
  fileName = "documento",
  forceDownload = false
): void {
  if (!urlOrData) return;

  if (urlOrData.startsWith("data:")) {
    try {
      const parts = urlOrData.split(";base64,");
      const contentType = parts[0].replace("data:", "") || "application/octet-stream";
      const base64Data = parts[1] || "";
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Uint8Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const blob = new Blob([byteNumbers], { type: contentType });
      const blobUrl = URL.createObjectURL(blob);

      const isViewable =
        !forceDownload &&
        (contentType.startsWith("image/") ||
          contentType === "application/pdf" ||
          contentType.startsWith("text/"));

      if (isViewable) {
        const win = window.open(blobUrl, "_blank");
        if (win) {
          setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
          return;
        }
      }

      // Se pop-up bloqueado ou download forçado ou outro formato (CSV, JSON, etc.):
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
      return;
    } catch (err) {
      console.error("[openOrDownloadFile] Falha ao decodificar Data URL:", err);
    }
  }

  // URL regular (HTTP/HTTPS)
  if (forceDownload) {
    const a = document.createElement("a");
    a.href = urlOrData;
    a.download = fileName;
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } else {
    window.open(urlOrData, "_blank", "noopener,noreferrer");
  }
}

