import { useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef } from "react";
import { Button } from "@/components/ui/button";
import { Eraser, PenTool } from "lucide-react";

export interface WeeklogSignatureCanvasRef {
  getPngBlob: () => Promise<Blob | null>;
  getDataUrl: () => string | null;
  clear: () => void;
  isEmpty: () => boolean;
}

interface WeeklogSignatureCanvasProps {
  disabled?: boolean;
  height?: number;
  placeholder?: string;
  hideControls?: boolean;
  onStrokeChange?: (hasStrokes: boolean) => void;
}

export const WeeklogSignatureCanvas = forwardRef<
  WeeklogSignatureCanvasRef,
  WeeklogSignatureCanvasProps
>(function WeeklogSignatureCanvas(
  {
    disabled = false,
    height = 180,
    placeholder,
    hideControls = false,
    onStrokeChange,
  },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const hasDrawnRef = useRef(false);
  const lastCoordRef = useRef<{ x: number; y: number } | null>(null);

  // Resize canvas according to display width and devicePixelRatio
  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const width = Math.max(280, Math.floor(rect.width));
    const dpr = window.devicePixelRatio || 1;

    // Check if dimensions actually changed before resetting canvas buffer
    const currentW = Math.round(parseFloat(canvas.style.width) || 0);
    const currentH = Math.round(parseFloat(canvas.style.height) || 0);
    if (currentW === width && currentH === height && canvas.width > 0) {
      return; // Dimensions have not changed, avoid wiping context
    }

    // Preserve existing image data if re-scaling
    let tempCanvas: HTMLCanvasElement | null = null;
    if (canvas.width > 0 && canvas.height > 0 && hasDrawnRef.current) {
      tempCanvas = document.createElement("canvas");
      tempCanvas.width = canvas.width;
      tempCanvas.height = canvas.height;
      const tempCtx = tempCanvas.getContext("2d");
      if (tempCtx) {
        tempCtx.drawImage(canvas, 0, 0);
      }
    }

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#0f172a"; // dark slate for contrast
      ctx.lineWidth = 2.5;

      if (tempCanvas && hasDrawnRef.current) {
        ctx.drawImage(
          tempCanvas,
          0,
          0,
          tempCanvas.width,
          tempCanvas.height,
          0,
          0,
          width,
          height
        );
      }
    }
  }, [height]);

  useEffect(() => {
    setupCanvas();

    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver(() => {
      setupCanvas();
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [setupCanvas]);

  const getCoordinates = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled || e.button !== 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Best-effort
    }

    const { x, y } = getCoordinates(e);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2.5;

    ctx.beginPath();
    ctx.arc(x, y, 1.25, 0, Math.PI * 2);
    ctx.fillStyle = "#0f172a";
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(x, y);
    lastCoordRef.current = { x, y };

    setIsDrawing(true);
    hasDrawnRef.current = true;
    if (!hasDrawn) {
      setHasDrawn(true);
    }
    onStrokeChange?.(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || disabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { x, y } = getCoordinates(e);
    const last = lastCoordRef.current;
    if (!last) {
      lastCoordRef.current = { x, y };
      return;
    }

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2.5;

    // Use smooth continuous stroke
    const midX = (last.x + x) / 2;
    const midY = (last.y + y) / 2;

    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.quadraticCurveTo(last.x, last.y, midX, midY);
    ctx.lineTo(x, y);
    ctx.stroke();

    lastCoordRef.current = { x, y };
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    setIsDrawing(false);
    lastCoordRef.current = null;
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      if (canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Best-effort
    }
  };

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    hasDrawnRef.current = false;
    setHasDrawn(false);
    lastCoordRef.current = null;
    onStrokeChange?.(false);
  }, [onStrokeChange]);

  const isEmpty = useCallback(() => {
    return !hasDrawn;
  }, [hasDrawn]);

  const getDataUrl = useCallback((): string | null => {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawn) return null;

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height;
    const expCtx = exportCanvas.getContext("2d");
    if (!expCtx) return canvas.toDataURL("image/png");

    expCtx.fillStyle = "#ffffff";
    expCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    expCtx.drawImage(canvas, 0, 0);

    return exportCanvas.toDataURL("image/png");
  }, [hasDrawn]);

  const getPngBlob = useCallback(async (): Promise<Blob | null> => {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawn) return null;

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height;
    const expCtx = exportCanvas.getContext("2d");
    const targetCanvas = expCtx ? exportCanvas : canvas;
    if (expCtx) {
      expCtx.fillStyle = "#ffffff";
      expCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
      expCtx.drawImage(canvas, 0, 0);
    }

    return new Promise<Blob | null>((resolve) => {
      targetCanvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(null);
            return;
          }
          // Validate max size 1 MB
          if (blob.size > 1024 * 1024) {
            resolve(null);
            return;
          }
          resolve(blob);
        },
        "image/png"
      );
    });
  }, [hasDrawn]);

  useImperativeHandle(
    ref,
    () => ({
      getPngBlob,
      getDataUrl,
      clear,
      isEmpty,
    }),
    [getPngBlob, getDataUrl, clear, isEmpty]
  );

  return (
    <div className="w-full space-y-2" ref={containerRef}>
      <div
        className="relative w-full rounded-lg border border-border/80 bg-white p-1 shadow-sm overflow-hidden"
        style={{ touchAction: "none" }}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className={`block w-full cursor-crosshair rounded select-none ${
            disabled ? "opacity-50 cursor-not-allowed pointer-events-none" : ""
          }`}
          style={{ touchAction: "none" }}
          aria-label="Área de assinatura manuscrita"
        />
        {!hasDrawn && !disabled && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted-foreground/60 select-none">
            <PenTool className="mr-1.5 h-3.5 w-3.5" />
            {placeholder || "Desenhe a assinatura aqui (toque ou mouse)"}
          </div>
        )}
      </div>

      {!hideControls && (
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">
            Formato: PNG autêntico (&le; 1 MB). Salvo sob governança no servidor.
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={clear}
            disabled={disabled || !hasDrawn}
            className="min-h-[44px] min-w-[44px] gap-1.5 text-xs"
            aria-label="Limpar assinatura"
          >
            <Eraser className="h-3.5 w-3.5" />
            Limpar
          </Button>
        </div>
      )}
    </div>
  );
});
