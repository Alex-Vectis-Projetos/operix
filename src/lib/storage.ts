import { getAccessToken, buildAuthHeaders } from "./authSession";

const API_URL = import.meta.env.VITE_API_URL as string;

const PUBLIC_BUCKETS = new Set(["avatars", "hail-reports", "marketplace", "logos"]);

/**
 * Retorna a URL de acesso a um arquivo armazenado no MinIO via backend.
 * Buckets públicos: sem autenticação (/storage/public/:bucket/*).
 * Buckets privados: endpoint protegido (/storage/file/:bucket/*). Presigned URLs da API devem ser priorizadas.
 */
export function getFileUrl(bucket: string, path: string): string {
  if (PUBLIC_BUCKETS.has(bucket)) {
    return `${API_URL}/storage/public/${bucket}/${path}`;
  }
  return `${API_URL}/storage/file/${bucket}/${path}`;
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
  const form = new FormData();
  form.append("bucket", bucket);
  form.append("path", path);
  form.append(
    "file",
    file instanceof File ? file : new File([file], path.split("/").pop() ?? "file", {
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

  const res = await fetch(`${API_URL}/storage/files`, {
    method: "DELETE",
    headers: buildAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ bucket, paths }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? "Erro ao deletar arquivo(s).");
  }
}
