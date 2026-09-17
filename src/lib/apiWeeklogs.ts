import { apiRequest } from "@/lib/api";

export type WeeklogStatus = "open" | "pending_validation" | "validated" | "rectification_pending";
export type WeeklogEntryValidationStatus = "pending" | "approved" | "rejected";

export interface WeeklogEntry {
  id: string;
  weeklogId: string;
  productionOrderId: string;
  executionSequence: number;
  technicianUserId: string;
  currencyCode: string;
  totalAmount: string | number;
  servicesSnapshot: any[];
  vehicleSnapshot?: any;
  deliveredAt: string;
  validationStatus: WeeklogEntryValidationStatus;
  rejectionReason: string | null;
  rectificationOriginId: string | null;
  legacyServiceOrderId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WeeklogValidationSummary {
  id: string;
  weeklogId: string;
  workspaceId: string;
  validationSequence: number;
  status: string;
  submittedAt: string | null;
  submittedBy: string | null;
  validatedAt: string | null;
  validatorUserId?: string | null;
  coverageSnapshot?: any;
  createdAt: string;
  updatedAt: string;
}

export interface Weeklog {
  id: string;
  workspaceId: string;
  startsOn: string;
  clientId: string;
  siteKey: string;
  status: WeeklogStatus;
  createdAt: string;
  updatedAt: string;
  validations?: WeeklogValidationSummary[];
  entries?: WeeklogEntry[];
}

export interface WeeklogFilters {
  startsOn?: string;
  clientId?: string;
  status?: string;
  siteKey?: string;
}

export function listWeeklogs(filters?: WeeklogFilters): Promise<Weeklog[]> {
  const params = new URLSearchParams();
  if (filters?.startsOn) params.set("startsOn", filters.startsOn);
  if (filters?.clientId) params.set("clientId", filters.clientId);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.siteKey) params.set("siteKey", filters.siteKey);

  const qs = params.toString();
  return apiRequest<Weeklog[]>(`/weeklogs${qs ? `?${qs}` : ""}`, {
    timeoutMs: 12000,
  });
}

export function getWeeklog(id: string): Promise<Weeklog> {
  return apiRequest<Weeklog>(`/weeklogs/${id}`, {
    timeoutMs: 10000,
  });
}

export function listWeeklogEntries(weeklogId: string): Promise<WeeklogEntry[]> {
  return apiRequest<WeeklogEntry[]>(`/weeklogs/${weeklogId}/entries`, {
    timeoutMs: 10000,
  });
}

export function getWeeklogEntry(weeklogId: string, entryId: string): Promise<WeeklogEntry> {
  return apiRequest<WeeklogEntry>(`/weeklogs/${weeklogId}/entries/${entryId}`, {
    timeoutMs: 10000,
  });
}
