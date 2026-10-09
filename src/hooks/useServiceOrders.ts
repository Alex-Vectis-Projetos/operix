import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./useAuth";
import { useCan } from "./usePermission";
import { useWorkspace } from "./useWorkspace";
import { toast } from "sonner";
import { apiRequest } from "@/lib/api";
import { pdfFirstPageToImageBase64 } from "@/lib/pdfUtils";
import {
  listServiceOrders,
  listClients,
  type ServiceOrderRecord,
} from "@/lib/apiServiceOrders";

export type ServiceOrder = ServiceOrderRecord;
export type ServiceOrderInsert = Partial<ServiceOrderRecord> & { id?: string };

export type FieldConfidence = "high" | "medium" | "low";

export interface ExtractedOrder {
  client: string | null;
  platform: string | null;
  technician: string | null;
  week: string | null;
  car_name: string | null;
  license_plate: string | null;
  service_1_name: string | null;
  service_1_price: number | null;
  service_2_name: string | null;
  service_2_price: number | null;
  service_3_name: string | null;
  service_3_price: number | null;
  service_4_name: string | null;
  service_4_price: number | null;
  total: number | null;
  field_confidence?: Partial<Record<string, FieldConfidence>>;
  handwritten_corrections?: { field: string; original_value?: string; corrected_value: string }[];
  total_mismatch?: boolean;
}

export interface ExtractionResult {
  orders: ExtractedOrder[];
  confidence: "high" | "medium" | "low";
  notes?: string;
}

export function useServiceOrders(filters?: {
  client_id?: string;
  platform?: string;
  assigned_user_id?: string;
  week?: string;
}) {
  const { user } = useAuth();
  const { can, isLoading: permsLoading } = useCan();
  const { workspaceId } = useWorkspace();

  const { allowed } = can("service_orders", "view");

  const query = useQuery({
    queryKey: ["service_orders", workspaceId, filters, allowed, user?.id],
    enabled: !permsLoading && allowed && !!user?.id && !!workspaceId,
    retry: 0,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    placeholderData: (previousData) => previousData ?? [],
    queryFn: () =>
      listServiceOrders(workspaceId!, {
        client_id: filters?.client_id,
        platform: filters?.platform,
        week: filters?.week,
        assigned_user_id: filters?.assigned_user_id,
      }),
  });

  return query;
}

export function useExtractServiceOrder() {
  const [isExtracting, setIsExtracting] = useState(false);

  const extract = async (file: File): Promise<ExtractionResult> => {
    setIsExtracting(true);
    try {
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      const input = isPdf
        ? await pdfFirstPageToImageBase64(file, { maxWidth: 1600, quality: 0.9 })
        : { base64: await fileToBase64(file), mimeType: (file.type || "application/octet-stream") as string };

      const data = await apiRequest<ExtractionResult>("/extract/service-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: input.base64, mimeType: input.mimeType, fileName: file.name }),
        timeoutMs: 60000,
      });

      const cleanStr = (v: string | null | undefined): string | null => {
        if (!v) return null;
        const s = v.trim();
        if (!s || s.toLowerCase() === "null" || s.toLowerCase() === "undefined" || s === "-" || s === "--" || s.toLowerCase() === "n/a" || s.toLowerCase() === "none") {
          return null;
        }
        return s;
      };

      const normalized: ExtractionResult = {
        ...data,
        orders: (data.orders || []).map((o) => {
          const fc = { ...(o.field_confidence || {}) };
          const client = cleanStr(o.client);
          const platform = cleanStr(o.platform);
          const technician = cleanStr(o.technician);
          const week = cleanStr(o.week);
          const car_name = cleanStr(o.car_name);
          const license_plate = cleanStr(o.license_plate);
          const s1 = cleanStr(o.service_1_name);
          const s2 = cleanStr(o.service_2_name);
          const s3 = cleanStr(o.service_3_name);
          const s4 = cleanStr(o.service_4_name);

          // Never flag empty optional fields as low confidence
          if (!platform) delete fc.platform;
          if (!license_plate) delete fc.license_plate;
          if (!s2) delete fc.service_2_price;
          if (!s3) delete fc.service_3_price;
          if (!s4) delete fc.service_4_price;

          return {
            ...o,
            client,
            platform,
            technician,
            week,
            car_name,
            license_plate,
            service_1_name: s1,
            service_2_name: s2,
            service_3_name: s3,
            service_4_name: s4,
            field_confidence: fc,
          };
        }),
      };

      return normalized;
    } finally {
      setIsExtracting(false);
    }
  };

  return { extract, isExtracting };
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function useClients() {
  const { workspaceId } = useWorkspace();
  return useQuery({
    queryKey: ["clients", workspaceId],
    retry: 0,
    placeholderData: (previousData) => previousData ?? [],
    queryFn: () => listClients(workspaceId ?? undefined),
  });
}
