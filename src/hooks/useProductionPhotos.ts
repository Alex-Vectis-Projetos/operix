import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useWorkspace } from "./useWorkspace";
import { useAuth } from "./useAuth";
import { toast } from "sonner";
import { uploadFile, deleteFiles, getFileUrl } from "@/lib/storage";
import { buildAuthHeaders } from "@/lib/authSession";

const API_URL = import.meta.env.VITE_API_URL as string;

export type PhotoCategory = "before" | "during" | "after" | "damage" | "validation";

export interface ProductionPhoto {
  id: string;
  production_order_id: string;
  workspace_id: string;
  uploaded_by: string;
  category: PhotoCategory;
  storage_path: string;
  caption: string | null;
  size_bytes: number | null;
  created_at: string;
  signed_url?: string;
  url?: string;
  download_url?: string;
}

export const PHOTO_CATEGORIES: { value: PhotoCategory; label: string }[] = [
  { value: "before", label: "Antes" },
  { value: "during", label: "Durante" },
  { value: "after", label: "Depois" },
  { value: "damage", label: "Danos" },
  { value: "validation", label: "Validação" },
];

async function compress(file: File, maxDim = 1600, quality = 0.82): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * ratio);
      const h = Math.round(img.height * ratio);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas error"));
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob((b) => b ? resolve(b) : reject(new Error("Blob error")), "image/jpeg", quality);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(objectUrl);
      reject(err);
    };
    img.src = objectUrl;
  });
}

async function listPhotos(orderId: string): Promise<ProductionPhoto[]> {
  const res = await fetch(`${API_URL}/production-orders/${orderId}/photos`, {
    headers: buildAuthHeaders(),
  });
  if (!res.ok) throw new Error("Falha ao carregar fotos.");
  const list = (await res.json()) as ProductionPhoto[];
  for (const p of list) {
    p.signed_url = p.url || p.download_url || p.signed_url || "";
  }
  return list;
}

async function createPhotoRecord(
  orderId: string,
  data: { storage_path: string; category: string; workspace_id: string; uploaded_by: string; caption?: string; size_bytes?: number },
): Promise<ProductionPhoto> {
  const res = await fetch(`${API_URL}/production-orders/${orderId}/photos`, {
    method: "POST",
    headers: buildAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? "Erro ao registrar foto.");
  }
  return res.json();
}

async function deletePhotoRecord(orderId: string, photoId: string): Promise<void> {
  const res = await fetch(`${API_URL}/production-orders/${orderId}/photos/${photoId}`, {
    method: "DELETE",
    headers: buildAuthHeaders(),
  });
  if (!res.ok) throw new Error("Erro ao remover foto.");
}

export function useProductionPhotos(orderId: string | null) {
  const qc = useQueryClient();
  const { workspaceId } = useWorkspace();
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ["production_photos", orderId],
    enabled: !!orderId && orderId !== "__new__",
    retry: 0,
    staleTime: 30_000,
    placeholderData: (previousData) => previousData ?? [],
    queryFn: () => listPhotos(orderId!),
  });

  const upload = useMutation({
    mutationFn: async ({ file, category, caption }: { file: File; category: PhotoCategory; caption?: string }) => {
      if (!orderId || !workspaceId) throw new Error("Ordem inválida");
      const blob = file.type.startsWith("image/") ? await compress(file) : file;
      const path = `${workspaceId}/${orderId}/${Date.now()}_${category}.jpg`;
      await uploadFile("production-photos", path, blob, "image/jpeg");
      await createPhotoRecord(orderId, {
        storage_path: path,
        category,
        workspace_id: workspaceId,
        uploaded_by: user?.id ?? "",
        caption: caption ?? undefined,
        size_bytes: (blob as Blob).size,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["production_photos", orderId] });
      toast.success("Foto enviada");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (photo: ProductionPhoto) => {
      await deleteFiles("production-photos", [photo.storage_path]);
      await deletePhotoRecord(photo.production_order_id, photo.id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["production_photos", orderId] }),
    onError: (e: any) => toast.error(e.message),
  });

  return { ...query, upload, remove };
}
