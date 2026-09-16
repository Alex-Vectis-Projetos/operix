import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { uploadFile, deleteFiles, getFileUrl } from "@/lib/storage";
import {
  listDocuments,
  listFolders,
  createDocument,
  updateDocument,
  deleteDocument,
  batchDeleteDocuments,
} from "@/lib/apiDocuments";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useLanguage } from "@/hooks/useLanguage";
import { toast } from "sonner";
import {
  FolderOpen, FolderPlus, ChevronRight, Trash2, Download,
  Eye, Printer, FileText, MoveRight, Filter, CheckSquare, Pencil, Check, X,
  ExternalLink, Loader2, Share2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { blobForCurrentVisualState, getDocumentDisplayName, getDocumentRotation, getDocumentZoom } from "@/lib/documentVisualState";
import type { DocumentVisualState } from "@/lib/documentVisualState";
import { withPromiseTimeout } from "@/lib/asyncGuard";

interface Props {
  entityType: "service_order" | "payment_order";
  module?: string;
  sessionFileNames?: string[];
  /** Phase 1C.2 — start collapsed when there is no upload activity. */
  defaultCollapsed?: boolean;
  /** Phase 1E-Z — isolate documents per operational year context. */
  year?: string | null;
}

interface PreviewState {
  id?: string;
  name: string;
  storage_path?: string | null;
  mime_type?: string | null;
  url?: string;
  status: "loading" | "ready" | "error";
  error?: string;
  _blobUrl?: boolean;
  [key: string]: any;
}

function reportUploadDebug(payload: {
  hypothesisId: string;
  location: string;
  msg: string;
  data?: Record<string, unknown>;
}) {
  // #region debug-point U:upload-db-timeout
  void fetch("http://127.0.0.1:7777/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: "upload-db-timeout",
      runId: "migrated-to-api",
      hypothesisId: payload.hypothesisId,
      location: payload.location,
      msg: payload.msg,
      data: payload.data ?? {},
      ts: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

function getFreshSignedUrl(storagePath: string): string {
  return getFileUrl("uploads", storagePath);
}

/** Detect correct Content-Type from filename */
function getMimeType(fileName: string, storedMime?: string | null): string {
  const normalizedStoredMime = storedMime === "image/jpg" ? "image/jpeg" : storedMime;
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    bmp: "image/bmp",
  };
  const inferredMime = map[ext];

  if (inferredMime) return inferredMime;
  if (normalizedStoredMime && normalizedStoredMime !== "application/octet-stream") return normalizedStoredMime;
  return "application/octet-stream";
}

function isImageMime(mime: string) {
  return mime.startsWith("image/");
}

function isPdfMime(mime: string) {
  return mime === "application/pdf";
}

function revokeBlobUrl(url?: string | null) {
  if (url?.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

async function fetchDocumentBlobUrl(
  doc: { name: string; storage_path?: string | null; mime_type?: string | null; [key: string]: any },
  _expiresIn = 120,
) {
  if (!doc.storage_path) {
    throw new Error("File not available — storage path missing.");
  }

  const signedUrl = getFreshSignedUrl(doc.storage_path);


  const mimeType = getMimeType(doc.name, doc.mime_type);
  const response = await fetch(signedUrl);

  if (!response.ok) {
    throw new Error(`Failed to fetch file (${response.status}).`);
  }

  const blob = await response.blob();
  const rawBlob = blob.type === mimeType ? blob : new Blob([blob], { type: mimeType });
  const typedBlob = await blobForCurrentVisualState(rawBlob, {
    displayName: getDocumentDisplayName(doc),
    rotation: getDocumentRotation(doc),
    zoom: getDocumentZoom(doc),
  });
  const blobUrl = URL.createObjectURL(typedBlob);

  return { blobUrl, mimeType, signedUrl, blob: typedBlob };
}

export function EmbeddedFileManager({ entityType, module: moduleName = "orders", sessionFileNames = [], defaultCollapsed = false, year = null }: Props) {
  const { t, formatDate } = useLanguage();
  const { user } = useAuth();
  const { workspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const collapseKey = `fm.collapsed.${entityType}.${moduleName}`;
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return defaultCollapsed;
    const stored = window.localStorage.getItem(collapseKey);
    return stored === null ? defaultCollapsed : stored === "1";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(collapseKey, collapsed ? "1" : "0");
  }, [collapsed, collapseKey]);

  const [parentId, setParentId] = useState<string | null>(null);
  const [path, setPath] = useState<{ id: string | null; name: string }[]>([
    { id: null, name: t("common.root") },
  ]);
  const [folderName, setFolderName] = useState("");
  const [showFolderDialog, setShowFolderDialog] = useState(false);
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [moveTarget, setMoveTarget] = useState<any>(null);
  const [previewDoc, setPreviewDoc] = useState<PreviewState | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [filterMode, setFilterMode] = useState<"all" | "session">("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [newFolderInMove, setNewFolderInMove] = useState("");
  const [moveDestination, setMoveDestination] = useState<string>("__root__");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const queryKey = ["embedded-docs", entityType, parentId];

  const { data: docs = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => listDocuments(entityType, moduleName, parentId),
  });

  const { data: allFolders = [] } = useQuery({
    queryKey: ["embedded-folders", entityType],
    queryFn: () => listFolders(entityType),
    enabled: showMoveDialog,
  });

  const yearFiltered = year && /^\d{4}$/.test(year)
    ? docs.filter((d: any) => {
        if (d.type === "folder") return true;
        if (!d.created_at) return false;
        const dy = new Date(d.created_at).getFullYear();
        return String(dy) === year;
      })
    : docs;
  const filteredDocs = filterMode === "session" && sessionFileNames.length > 0
    ? yearFiltered.filter((d: any) => d.type === "folder" || sessionFileNames.includes(d.name))
    : yearFiltered;

  const allSelected = filteredDocs.length > 0 && filteredDocs.every((d: any) => selectedIds.has(d.id));

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredDocs.map((d: any) => d.id)));
    }
  };

  const clearSelection = () => setSelectedIds(new Set());

  const createFolder = useMutation({
    mutationFn: () =>
      createDocument({
        name: folderName,
        type: "folder",
        parent_id: parentId,
        uploaded_by: user?.id,
        entity_type: entityType,
        module: moduleName,
        ...(workspaceId ? { workspace_id: workspaceId } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["embedded-docs", entityType] });
      setShowFolderDialog(false);
      setFolderName("");
      toast.success(t("docs.folderCreated"));
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (doc: any) => {
      if (doc.storage_path) {
        await deleteFiles("uploads", [doc.storage_path]);
      }
      await deleteDocument(doc.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["embedded-docs", entityType] });
      toast.success(t("toast.deleted"));
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const docsToDelete = docs.filter((d: any) => ids.includes(d.id));
      const storagePaths = docsToDelete
        .filter((d: any) => d.storage_path)
        .map((d: any) => d.storage_path);
      if (storagePaths.length > 0) {
        await deleteFiles("uploads", storagePaths);
      }
      await batchDeleteDocuments(ids);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["embedded-docs", entityType] });
      clearSelection();
      toast.success(t("toast.deleted"));
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const moveMutation = useMutation({
    mutationFn: ({ docIds, newParentId }: { docIds: string[]; newParentId: string | null }) =>
      Promise.all(docIds.map((id) => updateDocument(id, { parent_id: newParentId }))).then(() => undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["embedded-docs", entityType] });
      setShowMoveDialog(false);
      setMoveTarget(null);
      clearSelection();
      toast.success(t("toast.updated"));
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      updateDocument(id, { name, display_name: name, visual_state: { displayName: name, updatedAt: new Date().toISOString() } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["embedded-docs", entityType] });
      setRenamingId(null);
      toast.success(t("toast.updated"));
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const createFolderInMove = useMutation({
    mutationFn: async (name: string) => {
      const doc = await createDocument({
        name,
        type: "folder",
        parent_id: null,
        uploaded_by: user?.id,
        entity_type: entityType,
        module: moduleName,
        ...(workspaceId ? { workspace_id: workspaceId } : {}),
      });
      return doc.id;
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: ["embedded-folders", entityType] });
      setMoveDestination(id);
      setNewFolderInMove("");
      toast.success(t("docs.folderCreated"));
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const navigateTo = (id: string | null, name: string) => {
    clearSelection();
    if (id === null) {
      setParentId(null);
      setPath([{ id: null, name: t("common.root") }]);
      return;
    }
    setParentId(id);
    const idx = path.findIndex((p) => p.id === id);
    if (idx >= 0) setPath(path.slice(0, idx + 1));
    else setPath([...path, { id, name }]);
  };

  const clearPreviewDoc = useCallback(() => {
    if (previewDoc?._blobUrl && previewDoc.url) {
      revokeBlobUrl(previewDoc.url);
    }
    setPreviewDoc(null);
  }, [previewDoc]);

  const ensureStoragePath = (doc: any, action: string): boolean => {
    if (!doc?.storage_path) {
      toast.error("File not available — storage path missing.");
      return false;
    }
    return true;
  };

  const handleDownload = async (doc: any) => {
    if (!ensureStoragePath(doc, "Download")) return;
    try {
      const { blobUrl } = await fetchDocumentBlobUrl(doc, 3600);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = getDocumentDisplayName(doc);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => revokeBlobUrl(blobUrl), 1000);
    } catch (err) {
      reportUploadDebug({
        hypothesisId: "U",
        location: "src/components/file-manager/EmbeddedFileManager.tsx:handleDownload",
        msg: "[DEBUG] DATA_ERROR",
        data: { error: err instanceof Error ? err.message : String(err) },
      });
      toast.error(err instanceof Error ? err.message : "Download failed.");
    }
  };

  const handlePreview = async (doc: any) => {
    if (!ensureStoragePath(doc, "Preview")) return;
    if (previewDoc?._blobUrl && previewDoc.url) {
      revokeBlobUrl(previewDoc.url);
    }

    setPreviewLoading(true);
    const resolvedMime = getMimeType(getDocumentDisplayName(doc), doc.mime_type);
    setPreviewDoc({ ...doc, name: getDocumentDisplayName(doc), mime_type: resolvedMime, status: "loading" });

    try {
      const { blobUrl, mimeType } = await fetchDocumentBlobUrl(doc, 3600);
      setPreviewDoc({ ...doc, name: getDocumentDisplayName(doc), url: blobUrl, mime_type: mimeType, status: "ready", _blobUrl: true });
    } catch (err) {
      reportUploadDebug({
        hypothesisId: "U",
        location: "src/components/file-manager/EmbeddedFileManager.tsx:handlePreview",
        msg: "[DEBUG] DATA_ERROR",
        data: { error: err instanceof Error ? err.message : String(err) },
      });
      const message = err instanceof Error ? err.message : "Preview failed.";
      setPreviewDoc({ ...doc, name: getDocumentDisplayName(doc), mime_type: resolvedMime, status: "error", error: message });
      toast.error(message);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handlePrint = async (doc: any) => {
    if (!ensureStoragePath(doc, "Print")) return;
    try {
      const { blobUrl, mimeType } = await fetchDocumentBlobUrl(doc, 3600);

      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.left = "-9999px";
      iframe.style.width = "1px";
      iframe.style.height = "1px";
      document.body.appendChild(iframe);

      const cleanup = () => {
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe);
        }
        revokeBlobUrl(blobUrl);
      };

      if (isPdfMime(mimeType)) {
        iframe.src = blobUrl;
        iframe.onload = () => {
          window.setTimeout(() => {
            try {
              iframe.contentWindow?.focus();
              iframe.contentWindow?.print();
            } catch (error) {
              reportUploadDebug({
                hypothesisId: "U",
                location: "src/components/file-manager/EmbeddedFileManager.tsx:handlePrint:iframe:onload",
                msg: "[DEBUG] DATA_ERROR",
                data: { error: error instanceof Error ? error.message : String(error) },
              });
              toast.error("Print failed. Try opening the file instead.");
            }
          }, 300);
          window.setTimeout(cleanup, 10000);
        };
        iframe.onerror = () => {
          reportUploadDebug({
            hypothesisId: "U",
            location: "src/components/file-manager/EmbeddedFileManager.tsx:handlePrint:iframe:onerror",
            msg: "[DEBUG] DATA_ERROR",
            data: { file: doc?.name ?? null },
          });
          cleanup();
          toast.error("Print failed. Try opening the file instead.");
        };
      } else if (isImageMime(mimeType)) {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (iframeDoc) {
          iframeDoc.open();
          iframeDoc.write(`<!DOCTYPE html><html><head><title>Print</title><style>body{margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#fff}img{max-width:100%;height:auto}</style></head><body><img src="${blobUrl}" onload="setTimeout(() => window.print(), 150)" /></body></html>`);
          iframeDoc.close();
        }
        window.setTimeout(cleanup, 15000);
      } else {
        // Fallback for unsupported types: open in a new tab so the user can
        // print from the browser's native viewer instead of silently failing.
        cleanup();
        const fallback = window.open(blobUrl, "_blank", "noopener,noreferrer");
        if (!fallback) {
          toast.error("Print not supported for this file type. Allow popups to open it instead.");
        } else {
          toast.message("Opened in a new tab — use your browser's Print menu.");
        }
      }
    } catch (err) {
      reportUploadDebug({
        hypothesisId: "U",
        location: "src/components/file-manager/EmbeddedFileManager.tsx:handlePrint",
        msg: "[DEBUG] DATA_ERROR",
        data: { error: err instanceof Error ? err.message : String(err) },
      });
      toast.error(err instanceof Error ? err.message : "Print failed.");
    }
  };

  const handleOpenInNewTab = async (doc: any) => {
    if (!doc.storage_path) return;
    try {
      const { blobUrl } = await fetchDocumentBlobUrl(doc, 3600);
      const opened = window.open(blobUrl, "_blank", "noopener,noreferrer");

      if (!opened) {
        revokeBlobUrl(blobUrl);
        toast.error("Popup blocked. Please allow popups and try again.");
        return;
      }

      window.setTimeout(() => revokeBlobUrl(blobUrl), 300000);
    } catch (err) {
      reportUploadDebug({
        hypothesisId: "U",
        location: "src/components/file-manager/EmbeddedFileManager.tsx:handleOpenInNewTab",
        msg: "[DEBUG] DATA_ERROR",
        data: { error: err instanceof Error ? err.message : String(err) },
      });
      toast.error("Could not open file.");
    }
  };

  const handleShare = async (doc: any) => {
    if (!ensureStoragePath(doc, "Share")) return;
    try {
      const { blob, blobUrl } = await fetchDocumentBlobUrl(doc, 3600);
      const fileName = getDocumentDisplayName(doc);
      const file = new File([blob], fileName, { type: blob.type || getMimeType(fileName, doc.mime_type) });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title: fileName, files: [file] });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(blobUrl);
        toast.success("Link temporário copiado para partilha.");
        window.setTimeout(() => revokeBlobUrl(blobUrl), 300000);
        return;
      } else {
        window.open(blobUrl, "_blank", "noopener,noreferrer");
        toast.message("Documento aberto para partilha manual.");
        window.setTimeout(() => revokeBlobUrl(blobUrl), 300000);
        return;
      }
      revokeBlobUrl(blobUrl);
    } catch (err) {
      reportUploadDebug({
        hypothesisId: "U",
        location: "src/components/file-manager/EmbeddedFileManager.tsx:handleShare",
        msg: "[DEBUG] DATA_ERROR",
        data: { error: err instanceof Error ? err.message : String(err) },
      });
      toast.error(err instanceof Error ? err.message : "Share failed.");
    }
  };

  const selectedArray = Array.from(selectedIds);
  const isBulkMode = selectedArray.length > 0;

  const openBulkMove = () => {
    setMoveTarget(null);
    setMoveDestination("__root__");
    setNewFolderInMove("");
    setShowMoveDialog(true);
  };

  return (
    <div className="space-y-3">
      {/* Header — minimal, no card wrapper */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FolderOpen className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium text-foreground">{t("fm.title")}</span>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={showFolderDialog} onOpenChange={setShowFolderDialog}>
            <DialogTrigger asChild>
              <Button variant="outline" size="icon" className="h-7 w-7" title={t("docs.newFolder")}>
                <FolderPlus className="h-3 w-3" />
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border">
              <DialogHeader><DialogTitle>{t("docs.createFolder")}</DialogTitle></DialogHeader>
              <div className="space-y-4 pt-2">
                <Input
                  value={folderName}
                  onChange={(e) => setFolderName(e.target.value)}
                  placeholder={t("label.name")}
                />
                <Button
                  className="w-full"
                  onClick={() => createFolder.mutate()}
                  disabled={!folderName.trim()}
                >
                  {t("action.save")}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Bulk action bar */}
      {isBulkMode && (
        <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
          <CheckSquare className="h-4 w-4 text-primary" />
          <span className="text-xs font-medium text-foreground">
            {selectedArray.length} {t("fm.selected")}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={openBulkMove}>
              <MoveRight className="h-3 w-3 mr-1" />{t("fm.move")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px] text-destructive border-destructive/30"
              onClick={() => bulkDeleteMutation.mutate(selectedArray)}
            >
              <Trash2 className="h-3 w-3 mr-1" />{t("action.delete")}
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={clearSelection}>
              {t("action.cancel")}
            </Button>
          </div>
        </div>
      )}

      {/* Breadcrumb — only show when navigated into a subfolder */}
      {path.length > 1 && (
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          {path.slice(1).map((p, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3" />}
              <button
                onClick={() => navigateTo(p.id, p.name)}
                className="hover:text-foreground truncate max-w-[160px]"
                title={p.name}
              >
                {p.name}
              </button>
            </span>
          ))}
        </div>
      )}
      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : filteredDocs.length === 0 ? (
        <div className="text-center py-6 text-xs text-muted-foreground">
          {t("docs.emptyFolder")}
        </div>
      ) : (
        <div className="rounded-md border border-border/30 overflow-auto max-h-[300px]">
          <Table>
            <TableHeader>
              <TableRow className="text-[10px]">
                <TableHead className="w-8">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={toggleAll}
                    aria-label={t("fm.selectAll")}
                  />
                </TableHead>
                <TableHead>{t("label.name")}</TableHead>
                <TableHead>{t("label.type")}</TableHead>
                <TableHead>{t("docs.size")}</TableHead>
                <TableHead>{t("label.date")}</TableHead>
                <TableHead>{t("label.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredDocs.map((d: any) => (
                <TableRow key={d.id} className={`text-[11px] ${selectedIds.has(d.id) ? "bg-primary/5" : ""}`}>
                  <TableCell className="w-8">
                    <Checkbox
                      checked={selectedIds.has(d.id)}
                      onCheckedChange={() => toggleSelect(d.id)}
                    />
                  </TableCell>
                  <TableCell
                    className="font-medium flex items-center gap-2 cursor-pointer"
                    onClick={() => renamingId !== d.id && d.type === "folder" && navigateTo(d.id, d.name)}
                  >
                    {d.type === "folder" ? (
                      <FolderOpen className="h-3.5 w-3.5 text-primary shrink-0" />
                    ) : (
                      <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    )}
                    {renamingId === d.id ? (
                      <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); if (renameValue.trim()) renameMutation.mutate({ id: d.id, name: renameValue.trim() }); }}>
                        <Input
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          className="h-6 text-[11px] w-[160px]"
                          autoFocus
                          onKeyDown={(e) => { if (e.key === "Escape") setRenamingId(null); }}
                        />
                        <Button type="submit" variant="ghost" size="icon" className="h-5 w-5" disabled={!renameValue.trim()}>
                          <Check className="h-3 w-3 text-primary" />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" className="h-5 w-5" onClick={() => setRenamingId(null)}>
                          <X className="h-3 w-3" />
                        </Button>
                      </form>
                    ) : (
                      <span className="truncate max-w-[200px]">{getDocumentDisplayName(d)}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[9px]">
                      {d.type === "folder" ? t("common.folder") : t("common.file")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {d.size_bytes ? `${(d.size_bytes / 1024).toFixed(1)} KB` : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(d.created_at)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {d.type === "file" && (
                        <>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handlePreview(d)} title={t("fm.preview")} disabled={previewLoading}>
                            {previewLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />}
                          </Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleDownload(d)} title={t("fm.download")}>
                            <Download className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handlePrint(d)} title={t("fm.print")}>
                            <Printer className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleShare(d)} title="Compartilhar">
                            <Share2 className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleOpenInNewTab(d)} title={t("fm.openInNewTab")}>
                            <ExternalLink className="h-3 w-3" />
                          </Button>
                        </>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => { setRenamingId(d.id); setRenameValue(getDocumentDisplayName(d)); }}
                        title={t("fm.rename")}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => {
                          setMoveTarget(d);
                          setMoveDestination("__root__");
                          setNewFolderInMove("");
                          setShowMoveDialog(true);
                        }}
                        title={t("fm.move")}
                      >
                        <MoveRight className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-destructive"
                        onClick={() => deleteMutation.mutate(d)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Move dialog */}
      <Dialog open={showMoveDialog} onOpenChange={setShowMoveDialog}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle>{t("fm.moveTo")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-xs text-muted-foreground">
              {moveTarget
                ? <>{t("fm.moveFile")}: <strong>{moveTarget.name}</strong></>
                : <>{selectedArray.length} {t("fm.selected")}</>
              }
            </p>
            <Select value={moveDestination} onValueChange={setMoveDestination}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder={t("fm.selectFolder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__root__">{t("common.root")}</SelectItem>
                {allFolders
                  .filter((f: any) => f.id !== moveTarget?.id && !selectedIds.has(f.id))
                  .map((f: any) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Input
                value={newFolderInMove}
                onChange={(e) => setNewFolderInMove(e.target.value)}
                placeholder={t("fm.newFolderName")}
                className="h-8 text-xs"
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs shrink-0"
                disabled={!newFolderInMove.trim()}
                onClick={() => createFolderInMove.mutate(newFolderInMove.trim())}
              >
                <FolderPlus className="h-3 w-3 mr-1" />{t("action.add")}
              </Button>
            </div>
            <Button
              className="w-full"
              onClick={() => {
                const ids = moveTarget ? [moveTarget.id] : selectedArray;
                const dest = moveDestination === "__root__" ? null : moveDestination;
                moveMutation.mutate({ docIds: ids, newParentId: dest });
              }}
            >
              {t("fm.move")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Preview dialog with pinch-zoom, print, and open-in-new-tab */}
      <Dialog open={!!previewDoc} onOpenChange={(open) => {
        if (!open) clearPreviewDoc();
      }}>
        <DialogContent className="bg-card border-border max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-2">
              <span className="truncate">{previewDoc?.name}</span>
              <div className="flex items-center gap-2 shrink-0">
                {previewDoc && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={() => handlePrint(previewDoc)}
                  >
                    <Printer className="h-3 w-3 mr-1" />
                    {t("fm.print")}
                  </Button>
                )}
                {previewDoc && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={() => handleOpenInNewTab(previewDoc)}
                  >
                    <ExternalLink className="h-3 w-3 mr-1" />
                    {t("fm.openInNewTab")}
                  </Button>
                )}
              </div>
            </DialogTitle>
          </DialogHeader>
          <PinchZoomContainer>
            {previewDoc?.status === "loading" ? (
              <div className="flex h-[60vh] flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <p>{t("fm.preview")}&hellip;</p>
              </div>
            ) : previewDoc?.status === "error" ? (
              <div className="flex h-[60vh] flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
                <p>{previewDoc.error || t("fm.previewError")}</p>
                <Button variant="outline" size="sm" className="h-8 text-[11px]" onClick={() => handleDownload(previewDoc)}>
                  <Download className="mr-1 h-3 w-3" />
                  {t("fm.download")}
                </Button>
              </div>
            ) : previewDoc?.mime_type && isImageMime(previewDoc.mime_type) ? (
              <img
                src={previewDoc.url}
                alt={previewDoc.name}
                className="max-w-full rounded"
                onError={() => {
                  toast.error(t("fm.previewError"));
                }}
              />
            ) : previewDoc?.mime_type && isPdfMime(previewDoc.mime_type) ? (
              <div className="relative">
              <iframe
                  src={previewDoc.url}
                  className="w-full h-[60vh] rounded border-0"
                  title={previewDoc.name}
                  onError={() => {
                    reportUploadDebug({
                      hypothesisId: "U",
                      location: "src/components/file-manager/EmbeddedFileManager.tsx:preview:pdf:onError",
                      msg: "[DEBUG] DATA_ERROR",
                      data: { name: previewDoc.name },
                    });
                    setPreviewDoc(prev => prev ? { ...prev, status: "error", error: "PDF rendering failed." } : null);
                  }}
                />
              </div>
            ) : (
              <div className="text-center py-8 text-sm text-muted-foreground">
                <p className="mb-2">{t("fm.previewError")}</p>
                <Button variant="link" size="sm" className="text-primary" onClick={() => handleDownload(previewDoc)}>
                  <ExternalLink className="mr-1 h-3 w-3" />
                  {t("fm.download")}
                </Button>
              </div>
            )}
          </PinchZoomContainer>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Pinch-zoom container: allows touch zoom only inside document preview */
function PinchZoomContainer({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const lastDistance = useRef<number | null>(null);

  const getDistance = (touches: React.TouchList) => {
    const a = touches[0];
    const b = touches[1];
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  };

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      lastDistance.current = getDistance(e.touches);
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
        setOrigin({ x: midX, y: midY });
      }
    }
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && lastDistance.current !== null) {
      e.preventDefault();
      const dist = getDistance(e.touches);
      const delta = dist / lastDistance.current;
      setScale(prev => Math.min(Math.max(prev * delta, 1), 5));
      lastDistance.current = dist;
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    lastDistance.current = null;
  }, []);

  const lastTap = useRef(0);
  const onDoubleTap = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    const now = Date.now();
    if (now - lastTap.current < 300) {
      setScale(1);
    }
    lastTap.current = now;
  }, []);

  return (
    <div
      ref={containerRef}
      className="overflow-auto max-h-[65vh] touch-manipulation"
      style={{ touchAction: "pan-x pan-y" }}
      onTouchStart={(e) => { onDoubleTap(e); onTouchStart(e); }}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div
        style={{
          transform: `scale(${scale})`,
          transformOrigin: `${origin.x}px ${origin.y}px`,
          transition: lastDistance.current ? "none" : "transform 0.2s ease-out",
        }}
      >
        {children}
      </div>
    </div>
  );
}


const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
];

export async function storeFileInDocuments(
  file: File,
  entityType: "service_order" | "payment_order",
  userId?: string,
  module: string = "orders",
  targetYear?: string | null,
) {
  try {
    if (!file || file.size === 0) {
      reportUploadDebug({
        hypothesisId: "U",
        location: "src/components/file-manager/EmbeddedFileManager.tsx:storeFileInDocuments:reject-empty",
        msg: "[DEBUG] DATA_ERROR",
        data: { entityType, module, fileName: file?.name ?? null },
      });
      throw new Error("Ficheiro inválido (vazio).");
    }
    const resolvedMime = getMimeType(file.name, file.type);
    if (!ALLOWED_MIME_TYPES.includes(resolvedMime)) {
      reportUploadDebug({
        hypothesisId: "U",
        location: "src/components/file-manager/EmbeddedFileManager.tsx:storeFileInDocuments:reject-type",
        msg: "[DEBUG] DATA_ERROR",
        data: { entityType, module, fileName: file.name, resolvedMime },
      });
      throw new Error("Tipo de ficheiro não suportado.");
    }

    const storagePath = `${entityType}/${Date.now()}_${file.name}`;
    reportUploadDebug({
      hypothesisId: "U",
      location: "src/components/file-manager/EmbeddedFileManager.tsx:storeFileInDocuments:start",
      msg: "[DEBUG] DATA_START",
      data: { entityType, module, storagePath, size: file.size, mime: resolvedMime, targetYear: targetYear ?? null },
    });

    const { error: uploadErr } = await withPromiseTimeout<{ error: Error | null }>(
      uploadFile("uploads", storagePath, file, resolvedMime).then(() => ({ error: null })),
      10000,
      "documents_storage_upload",
    );
    if (uploadErr) {
      reportUploadDebug({
        hypothesisId: "U",
        location: "src/components/file-manager/EmbeddedFileManager.tsx:storeFileInDocuments:storage:error",
        msg: "[DEBUG] DATA_ERROR",
        data: { entityType, module, storagePath, error: uploadErr.message },
      });
      throw new Error(uploadErr.message);
    }

    // Upload confirmed by backend response — no separate verify step needed

    // Honor active operational year context — uploads must attach to the
    // year currently active in the operational tree, NOT "today".
    // Rule: contexto da árvore SEMPRE prevalece. Só usa o ano atual quando
    // nenhum ano operacional estiver ativo.
    let createdAtOverride: string | undefined;
    if (targetYear && /^\d{4}$/.test(targetYear)) {
      const y = parseInt(targetYear, 10);
      const now = new Date();
      const d = new Date(now);
      d.setFullYear(y);
      createdAtOverride = d.toISOString();
    }

    const insertPayload: Record<string, any> = {
      name: file.name,
      display_name: file.name,
      rotation: 0,
      zoom: 1,
      validated: false,
      visual_state: { displayName: file.name, rotation: 0, zoom: 1, validated: false, updatedAt: new Date().toISOString() },
      type: "file",
      parent_id: null,
      uploaded_by: userId || null,
      storage_path: storagePath,
      mime_type: resolvedMime,
      size_bytes: file.size,
      entity_type: entityType,
      module,
    };
    if (createdAtOverride) insertPayload.created_at = createdAtOverride;

    let data: any;
    try {
      data = await createDocument(insertPayload);
    } catch (insertErr) {
      reportUploadDebug({
        hypothesisId: "U",
        location: "src/components/file-manager/EmbeddedFileManager.tsx:storeFileInDocuments:documents:insert:error",
        msg: "[DEBUG] DATA_ERROR",
        data: { entityType, module, storagePath, error: (insertErr as Error).message },
      });
      throw insertErr;
    }
    reportUploadDebug({
      hypothesisId: "U",
      location: "src/components/file-manager/EmbeddedFileManager.tsx:storeFileInDocuments:success",
      msg: "[DEBUG] DATA_SUCCESS",
      data: { entityType, module, storagePath, documentId: data?.id ?? null },
    });
    return data;
  } catch (err) {
    reportUploadDebug({
      hypothesisId: "U",
      location: "src/components/file-manager/EmbeddedFileManager.tsx:storeFileInDocuments:catch",
      msg: "[DEBUG] DATA_ERROR",
      data: { error: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}

export async function persistDocumentVisualState(documentId: string | undefined, state: DocumentVisualState, validated = false) {
  if (!documentId) return;
  const visualState = { ...state, validated, updatedAt: new Date().toISOString() };
  await updateDocument(documentId, {
    name: state.displayName,
    display_name: state.displayName,
    rotation: state.rotation,
    zoom: state.zoom,
    validated,
    visual_state: visualState,
  });
}
