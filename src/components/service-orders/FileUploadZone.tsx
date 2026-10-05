import { useCallback, useState, useRef, useEffect } from "react";
import { Upload, FileText, Image, Loader2, Camera, ScanLine, SwitchCamera, X, Check, RotateCcw } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/hooks/useLanguage";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Can } from "@/components/Can";

interface FileUploadZoneProps {
  onFilesSelected: (files: File[]) => void;
  isProcessing: boolean;
  disabled?: boolean;
  /** Compact horizontal variant for ERP-style toolbars (Phase 1C.2). */
  compact?: boolean;
}

const ACCEPTED = ".pdf,.jpg,.jpeg,.png,.webp,.heic";

function enhanceImageCanvas(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  // Increase contrast + sharpness for document readability
  const contrast = 1.3;
  const brightness = 10;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.min(255, Math.max(0, contrast * (data[i] - 128) + 128 + brightness));
    data[i + 1] = Math.min(255, Math.max(0, contrast * (data[i + 1] - 128) + 128 + brightness));
    data[i + 2] = Math.min(255, Math.max(0, contrast * (data[i + 2] - 128) + 128 + brightness));
  }
  ctx.putImageData(imageData, 0, 0);
}

export function FileUploadZone({ onFilesSelected, isProcessing, disabled = false, compact = false }: FileUploadZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const { t } = useLanguage();

  const isInactive = isProcessing || disabled;

  // Camera state
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraMode, setCameraMode] = useState<"photo" | "scan">("photo");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [preview, setPreview] = useState<{ url: string; file: File } | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (isProcessing || disabled) return;
      const files = Array.from(e.dataTransfer.files).filter((f) =>
        /\.(pdf|jpe?g|png|webp|heic)$/i.test(f.name)
      );
      if (files.length) onFilesSelected(files);
    },
    [onFilesSelected, isProcessing, disabled]
  );

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isProcessing || disabled) return;
    const files = Array.from(e.target.files || []);
    if (files.length) onFilesSelected(files);
    e.target.value = "";
  };

  // Camera logic
  const canUseCamera = typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function";

  const startCamera = useCallback(async (mode: "photo" | "scan", facing?: "environment" | "user") => {
    setCameraMode(mode);
    setCameraError(null);
    setPreview(null);
    setCameraOpen(true);

    const useFacing = facing || facingMode;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }

    if (!canUseCamera) {
      setCameraError(
        "Câmera indisponível neste ambiente. Use o botão Enviar arquivo para escolher uma imagem ou PDF existente."
      );
      return;
    }

    try {
      const videoConstraint = useFacing === "environment"
        ? { facingMode: { exact: "environment" as const }, width: { ideal: 1920 }, height: { ideal: 1080 } }
        : { facingMode: "user" as const, width: { ideal: 1920 }, height: { ideal: 1080 } };

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraint, audio: false });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("NotAllowed") || msg.includes("Permission")) {
        setCameraError("Permissão de câmera negada. Verifique as configurações do navegador ou envie um arquivo.");
      } else if (msg.includes("NotFound") || msg.includes("DevicesNotFound")) {
        setCameraError("Nenhuma câmera encontrada neste dispositivo. Envie um arquivo.");
      } else {
        setCameraError(`Erro na câmera: ${msg}. Use Enviar arquivo como alternativa.`);
      }
    }
  }, [facingMode, canUseCamera]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setCameraOpen(false);
    setCameraError(null);
    setPreview(null);
  }, []);

  const toggleCamera = useCallback(async () => {
    const newFacing = facingMode === "environment" ? "user" : "environment";
    setFacingMode(newFacing);
    if (cameraOpen && !preview) {
      await startCamera(cameraMode, newFacing);
    }
  }, [facingMode, cameraOpen, cameraMode, startCamera, preview]);

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    // Apply enhancement in scan mode
    if (cameraMode === "scan") {
      enhanceImageCanvas(canvas);
    }

    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `${cameraMode}_${Date.now()}.jpg`, { type: "image/jpeg" });
      const url = URL.createObjectURL(blob);
      setPreview({ url, file });
      // Pause video
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.enabled = false);
      }
    }, "image/jpeg", 0.88);
  }, [cameraMode]);

  const confirmCapture = useCallback(() => {
    if (!preview) return;
    onFilesSelected([preview.file]);
    URL.revokeObjectURL(preview.url);
    stopCamera();
  }, [preview, onFilesSelected, stopCamera]);

  const retakeCapture = useCallback(async () => {
    if (preview) {
      URL.revokeObjectURL(preview.url);
      setPreview(null);
    }
    // Re-enable tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.enabled = true);
    } else {
      await startCamera(cameraMode);
    }
  }, [preview, startCamera, cameraMode]);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  useEffect(() => {
    if (cameraOpen && !preview && streamRef.current && videoRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [cameraOpen, preview]);

  if (compact) {
    return (
      <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="h-11 w-11 touch-manipulation md:h-8 md:w-8"
              disabled={isInactive}
              aria-label={t("upload.add") || "Adicionar"}
            >
              {isProcessing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[180px]">
            <DropdownMenuItem onClick={() => fileInputRef.current?.click()} disabled={isInactive}>
              <FileText className="h-3.5 w-3.5 mr-2" />
              {t("upload.file", "Enviar arquivo")}
            </DropdownMenuItem>
            {canUseCamera ? (
              <Can permission="service_orders.scan_document">
                <DropdownMenuItem onClick={() => startCamera("photo")} disabled={isInactive}>
                  <Camera className="h-3.5 w-3.5 mr-2" />
                  {t("upload.photo", "Tirar foto")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => startCamera("scan")} disabled={isInactive}>
                  <ScanLine className="h-3.5 w-3.5 mr-2" />
                  {t("upload.scan", "Escanear documento")}
                </DropdownMenuItem>
              </Can>
            ) : (
                <DropdownMenuItem onClick={() => fileInputRef.current?.click()} disabled={isInactive}>
                  <Image className="h-3.5 w-3.5 mr-2" />
                  {t("upload.chooseExisting", "Escolher foto existente")}
                </DropdownMenuItem>
              )}
          </DropdownMenuContent>
        </DropdownMenu>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED}
          multiple
          onChange={handleInput}
          className="hidden"
          disabled={isInactive}
        />
        <Dialog open={cameraOpen} onOpenChange={(o) => { if (!o) stopCamera(); }}>
          <DialogContent className="max-h-[calc(100svh-1rem)] max-w-lg overflow-y-auto p-0">
            <DialogHeader className="p-4 pb-2">
              <DialogTitle>{cameraMode === "scan" ? t("upload.scanMode", "Escanear documento") : t("upload.photoMode", "Tirar foto")}</DialogTitle>
              <DialogDescription>
                {cameraMode === "scan"
                  ? t("upload.scanHint", "Posicione o documento no enquadramento e capture.")
                  : t("upload.photoHint", "Posicione o documento e tire uma foto.")}
              </DialogDescription>
            </DialogHeader>
            {cameraError ? (
              <div className="p-6 text-center space-y-3">
                <p className="text-sm text-destructive">{cameraError}</p>
                <Button variant="outline" onClick={stopCamera}>{t("label.close") || "Close"}</Button>
              </div>
            ) : preview ? (
              <>
                <div className="relative bg-black">
                  <img src={preview.url} alt="Captured" className="w-full max-h-[60vh] object-contain" />
                </div>
                <div className="grid grid-cols-1 gap-2 p-4 sm:flex sm:items-center sm:justify-between">
                  <Button variant="ghost" size="sm" onClick={retakeCapture}>
                    <RotateCcw className="h-4 w-4 mr-1" /> {t("upload.retake", "Tirar novamente")}
                  </Button>
                  <Button onClick={confirmCapture}>
                    <Check className="h-4 w-4 mr-1" /> {t("upload.confirm", "Confirmar e processar")}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="relative bg-black aspect-video">
                  <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                </div>
                <div className="flex items-center justify-between p-4">
                  <Button variant="ghost" size="sm" onClick={stopCamera}>
                    <X className="h-4 w-4 mr-1" /> {t("label.close") || "Close"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={toggleCamera}>
                    <SwitchCamera className="h-4 w-4 mr-1" />
                    {facingMode === "environment" ? (t("upload.frontCam") || "Front") : (t("upload.rearCam") || "Rear")}
                  </Button>
                  <Button onClick={captureFrame}>
                    <Camera className="h-4 w-4 mr-1" />
                    {cameraMode === "scan" ? (t("upload.capture") || "Capture") : (t("upload.takePhoto") || "Take Photo")}
                  </Button>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
        <canvas ref={canvasRef} className="hidden" />
      </>
    );
  }

  return (
    <>
      <div
        onDragOver={(e) => { e.preventDefault(); if (!isInactive) setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        onClick={() => { if (!isInactive) fileInputRef.current?.click(); }}
        className={cn(
          "relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-6 transition-all duration-300",
          isDragOver
            ? "border-primary bg-primary/5 scale-[1.01]"
            : "border-border/60 hover:border-primary/50 hover:bg-card/50",
          isInactive && "pointer-events-none opacity-60"
        )}
      >
        {isProcessing ? (
          <>
            <Loader2 className="h-10 w-10 text-primary animate-spin" />
            <p className="text-sm font-medium text-foreground">{t("upload.extracting")}</p>
            <p className="text-xs text-muted-foreground">{t("upload.wait")}</p>
          </>
        ) : disabled ? (
          <>
            <div className="flex items-center gap-2">
              <Upload className="h-7 w-7 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-foreground">
                {t("upload.dropOrClick")}
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                ⚠ {t("upload.dropOrClick") ? (typeof t === "string" ? "" : "") : ""}
                Bloqueado temporariamente — tente novamente em instantes.
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Upload className="h-7 w-7 text-primary" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-foreground">
                {t("upload.dropOrClick")}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {t("upload.formats")}
              </p>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 mt-2 flex-wrap justify-center">
              <Can permission="service_orders.upload_document">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1.5"
                  onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                >
                  <FileText className="h-3.5 w-3.5" /> {t("upload.file", "Enviar arquivo")}
                </Button>
              </Can>
              {canUseCamera ? (
                <Can permission="service_orders.scan_document">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs gap-1.5"
                    onClick={(e) => { e.stopPropagation(); startCamera("photo"); }}
                  >
                    <Camera className="h-3.5 w-3.5" /> {t("upload.photo", "Tirar foto")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs gap-1.5"
                    onClick={(e) => { e.stopPropagation(); startCamera("scan"); }}
                  >
                    <ScanLine className="h-3.5 w-3.5" /> {t("upload.scan", "Escanear documento")}
                  </Button>
                </Can>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1.5"
                  onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                >
                  <Image className="h-3.5 w-3.5" /> {t("upload.chooseExisting", "Escolher imagem")}
                </Button>
              )}
            </div>

            <div className="flex gap-2 mt-1">
              <span className="flex items-center gap-1 text-xs text-muted-foreground bg-secondary/50 px-2 py-1 rounded">
                <FileText className="h-3 w-3" /> PDF
              </span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground bg-secondary/50 px-2 py-1 rounded">
                <Image className="h-3 w-3" /> {t("upload.images")}
              </span>
              {canUseCamera ? (
                <span className="flex items-center gap-1 text-xs text-muted-foreground bg-secondary/50 px-2 py-1 rounded">
                  <Camera className="h-3 w-3" /> Camera
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded">
                  <Camera className="h-3 w-3" /> Camera indisponível
                </span>
              )}
            </div>
          </>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED}
          multiple
          onChange={handleInput}
          className="hidden"
          disabled={isInactive}
        />
      </div>

      {/* Camera Dialog */}
      <Dialog open={cameraOpen} onOpenChange={(o) => { if (!o) stopCamera(); }}>
          <DialogContent className="max-h-[calc(100svh-1rem)] max-w-lg overflow-y-auto p-0">
          <DialogHeader className="p-4 pb-2">
            <DialogTitle>{cameraMode === "scan" ? (t("upload.scanMode") || "Scan Document") : (t("upload.photoMode") || "Take Photo")}</DialogTitle>
            <DialogDescription>
              {cameraMode === "scan"
                ? (t("upload.scanHint") || "Position the document within the frame and capture.")
                : (t("upload.photoHint") || "Position the document and take a photo.")}
            </DialogDescription>
          </DialogHeader>

          {cameraError ? (
            <div className="p-6 text-center space-y-3">
              <p className="text-sm text-destructive">{cameraError}</p>
              <p className="text-xs text-muted-foreground">
                {t("upload.cameraFallback") || "Try using the Upload option to select a file instead."}
              </p>
              <Button variant="outline" onClick={stopCamera}>{t("label.close") || "Close"}</Button>
            </div>
          ) : preview ? (
            <>
              <div className="relative bg-black">
                <img src={preview.url} alt="Captured" className="w-full max-h-[60vh] object-contain" />
              </div>
              <div className="grid grid-cols-1 gap-2 p-4 sm:flex sm:items-center sm:justify-between">
                <Button variant="ghost" size="sm" onClick={retakeCapture}>
                  <RotateCcw className="h-4 w-4 mr-1" /> {t("upload.retake") || "Retake"}
                </Button>
                <Button onClick={confirmCapture}>
                  <Check className="h-4 w-4 mr-1" /> {t("upload.confirm") || "Confirm & Process"}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="relative bg-black aspect-video">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
                {cameraMode === "scan" && (
                  <div className="absolute inset-8 border-2 border-white/40 rounded-lg pointer-events-none">
                    <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-primary rounded-tl" />
                    <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-primary rounded-tr" />
                    <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-primary rounded-bl" />
                    <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-primary rounded-br" />
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 gap-2 p-4 sm:flex sm:items-center sm:justify-between">
                <Button variant="ghost" size="sm" onClick={stopCamera}>
                  <X className="h-4 w-4 mr-1" /> {t("label.close") || "Close"}
                </Button>
                <Button variant="outline" size="sm" onClick={toggleCamera}>
                  <SwitchCamera className="h-4 w-4 mr-1" />
                  {facingMode === "environment" ? (t("upload.frontCam") || "Front") : (t("upload.rearCam") || "Rear")}
                </Button>
                <Button onClick={captureFrame}>
                  <Camera className="h-4 w-4 mr-1" />
                  {cameraMode === "scan" ? (t("upload.capture") || "Capture") : (t("upload.takePhoto") || "Take Photo")}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <canvas ref={canvasRef} className="hidden" />
    </>
  );
}
