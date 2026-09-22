import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";
import { uploadFile } from "@/lib/storage";
import { useAuth } from "./useAuth";
import { useCan } from "./usePermission";
import { useWorkspace } from "./useWorkspace";
import { toast } from "sonner";

export type PaymentOrder = {
  id: string;
  workspace_id: string | null;
  visibility_scope: string;
  user_id: string;
  assigned_user_id: string;
  client_id: string | null;
  client_name: string | null;
  car_name: string | null;
  license_plate: string | null;
  platform: string | null;
  operational_unit: string | null;
  group_id: string | null;
  list_name: string | null;
  year_reference: number | null;
  technician_id: string | null;
  technician_name: string | null;
  services: any | null;
  service_order_id: string | null;
  amount_paid: number;
  total: number | null;
  status: string;
  created_by: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type FieldConfidence = "high" | "medium" | "low";

export interface ExtractedPaymentOrder {
  client: string | null;
  platform: string | null;
  list_name: string | null;
  technician: string | null;
  car_name: string | null;
  license_plate: string | null;
  services: { name: string; price: number; confidence?: FieldConfidence }[];
  total: number | null;
  field_confidence?: Partial<Record<string, FieldConfidence>>;
  handwritten_corrections?: { field: string; original_value?: string; corrected_value: string }[];
  total_mismatch?: boolean;
}

export interface PaymentExtractionResult {
  orders: ExtractedPaymentOrder[];
  confidence: "high" | "medium" | "low";
  notes?: string;
}

/** Legacy projection read only. Canonical PaymentList mutations live in usePaymentLists. */
export function usePaymentOrders(filters?: {
  client_id?: string;
  platform?: string;
  assigned_user_id?: string;
  list_name?: string;
}) {
  const { user } = useAuth();
  const { can, isLoading: permsLoading } = useCan();
  const { workspaceId } = useWorkspace();
  const { allowed } = can("payment_orders", "view");

  const query = useQuery({
    queryKey: ["payment_orders", workspaceId, filters, allowed, user?.id],
    enabled: !permsLoading && allowed && !!user?.id,
    retry: 0,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    placeholderData: (previousData: any) => previousData ?? [],
    queryFn: async () => {
      if (!allowed) return [];

      const params = new URLSearchParams();
      if (workspaceId) params.set("workspace_id", workspaceId);
      if (filters?.client_id) params.set("client_id", filters.client_id);
      if (filters?.platform) params.set("platform", filters.platform);
      if (filters?.assigned_user_id) params.set("assigned_user_id", filters.assigned_user_id);
      if (filters?.list_name) params.set("list_name", filters.list_name);

      const qs = params.toString();
      return apiRequest<PaymentOrder[]>(`/payment-orders${qs ? `?${qs}` : ""}`);
    },
  });

  return query;
}

const VALID_EXTRACT_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp"];

/**
 * @deprecated The ephemeral extractor is retained only for isolated legacy display work.
 * New PaymentList flows must use the governed ExternalListImport client instead.
 */
export function useExtractPaymentOrder() {
  const [isExtracting, setIsExtracting] = useState(false);

  const extract = async (file: File): Promise<PaymentExtractionResult> => {
    setIsExtracting(true);
    try {
      if (!file || file.size === 0) {
        throw new Error("File is empty or invalid. Please select a valid document.");
      }
      const mimeType = file.type || guessMimeType(file.name);
      if (!VALID_EXTRACT_TYPES.includes(mimeType)) {
        throw new Error(`Unsupported file type: ${mimeType}. Please upload PDF, JPG, or PNG.`);
      }

      const safeName = (file.name || "document").replace(/[^\w.\-()]+/g, "_").slice(0, 160);
      const filePath = `payment-orders/${Date.now()}_${safeName}`;
      await uploadFile("uploads", filePath, file, mimeType);

      // Send file directly as base64 — backend handles PDF/image uniformly.
      // Avoids PDF.js worker dependency in the browser.
      const ocrInput = { base64: await fileToBase64(file), mimeType: mimeType || "application/octet-stream" };

      let lastError: Error | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const data = await apiRequest<PaymentExtractionResult>("/extract/payment-order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageBase64: ocrInput.base64, mimeType: ocrInput.mimeType, fileName: file.name }),
            timeoutMs: 90_000,
          });

          if ((data as any)?.error) {
            throw new Error(`AI could not process this document: ${(data as any).error}`);
          }

          return data;
        } catch (retryErr) {
          lastError = retryErr as Error;
          if (attempt === 0 && (lastError.message.includes("fetch") || lastError.message.includes("network"))) {
            await new Promise(r => setTimeout(r, 1500));
            continue;
          }
          throw lastError;
        }
      }
      throw lastError || new Error("OCR extraction failed after retries.");
    } finally {
      setIsExtracting(false);
    }
  };

  return { extract, isExtracting };
}

function guessMimeType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg",
    png: "image/png", gif: "image/gif", webp: "image/webp", bmp: "image/bmp",
  };
  return map[ext] || "application/octet-stream";
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = () => reject(new Error("Failed to read file. The file may be corrupted."));
    reader.readAsDataURL(file);
  });
}

export function useDiscrepancyDetection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      return apiRequest("/extract/detect-discrepancies", { method: "POST" });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["discrepancies"] });
      queryClient.invalidateQueries({ queryKey: ["financial-summary"] });
      if (data?.total === 0) {
        toast.success("No discrepancies found — all payments match.");
      } else {
        toast.warning(`Found ${data?.total} discrepancies: ${data?.missing} missing, ${data?.mismatches} mismatches.`);
      }
    },
    onError: (err) => {
      toast.error("Detection failed: " + (err as Error).message);
    },
  });
}

export function useDiscrepancies() {
  const { can, isLoading: permsLoading } = useCan();
  const { allowed } = can("financial", "view");
  return useQuery({
    queryKey: ["discrepancies", allowed],
    enabled: !permsLoading && allowed,
    retry: 0,
    placeholderData: (previousData: any) => previousData ?? [],
    queryFn: async () => {
      if (!allowed) return [];
      return apiRequest("/discrepancies");
    },
  });
}

export function useFinancialSummary() {
  const { user } = useAuth();
  const { can, isLoading: permsLoading } = useCan();
  const { workspaceId } = useWorkspace();
  const finView = can("financial", "view");
  const soView = can("service_orders", "view");
  const poView = can("payment_orders", "view");
  const allowed = finView.allowed || soView.allowed || poView.allowed;

  return useQuery({
    queryKey: ["financial-summary", workspaceId, allowed, user?.id],
    enabled: !permsLoading && allowed && !!user?.id,
    retry: 0,
    queryFn: async () => {
      if (!allowed) {
        return {
          expectedRevenue: 0, realRevenue: 0, difference: 0, missingMoney: 0, mismatchDiff: 0,
          totalDiscrepancies: 0, missingCount: 0, mismatchCount: 0, correctCount: 0,
          discrepancies: [], serviceOrders: [], paymentOrders: [],
        };
      }

      const params = new URLSearchParams();
      if (workspaceId) params.set("workspace_id", workspaceId);
      const qs = params.toString();

      const [serviceOrders, paymentOrders] = await Promise.all([
        apiRequest<any[]>(`/service-orders${qs ? `?${qs}` : ""}`),
        apiRequest<any[]>(`/payment-orders${qs ? `?${qs}` : ""}`),
      ]);

      const expectedRevenue = (serviceOrders ?? []).reduce((s: number, o: any) => s + Number(o.total || 0), 0);
      const realRevenue = (paymentOrders ?? []).reduce((s: number, o: any) => s + Number(o.total || 0), 0);
      const difference = expectedRevenue - realRevenue;

      return {
        expectedRevenue,
        realRevenue,
        difference,
        missingMoney: 0,
        mismatchDiff: 0,
        totalDiscrepancies: 0,
        missingCount: 0,
        mismatchCount: 0,
        correctCount: (serviceOrders ?? []).length,
        discrepancies: [],
        serviceOrders: serviceOrders ?? [],
        paymentOrders: paymentOrders ?? [],
      };
    },
  });
}
