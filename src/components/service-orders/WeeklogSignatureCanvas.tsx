import { useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef } from "react";
import { Button } from "@/components/ui/button";
import { Eraser, PenTool } from "lucide-react";

export interface WeeklogSignatureCanvasRef {
  getPngBlob: () => Promise<Blob | null>;
  clear: () => void;
  isEmpty: () => boolean;
}

interface WeeklogSignatureCanvasProps {
  disabled?: boolean;
  onStrokeChange?: (hasStrokes: boolean) => void;
}

export const WeeklogSignatureCanvas = forwardRef<
  WeeklogSignatureCanvasRef,
  WeeklogSignatureCanvasProps
>(function WeeklogSignatureCanvas({ disabled = false, onStrokeChange }, ref) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  // Resize canvas according to display width and devicePixelRatio
  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const width = Math.max(280, Math.floor(rect.width));
    const height = 180;
    const dpr = window.devicePixelRatio || 1;

    // Preserve existing image data if re-scaling
    let tempCanvas: HTMLCanvasElement | null = null;
    if (canvas.width > 0 && canvas.height > 0) {
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

      if (tempCanvas) {
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
  }, []);

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
    if (disabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Capture pointer for smooth drawing across boundaries
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Best-effort
    }

    const { x, y } = getCoordinates(e);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
    setHasDrawn(true);
    onStrokeChange?.(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || disabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { x, y } = getCoordinates(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    setIsDrawing(false);
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      canvas.releasePointerCapture(e.pointerId);
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
    setHasDrawn(false);
    onStrokeChange?.(false);
  }, [onStrokeChange]);

  const isEmpty = useCallback(() => {
    return !hasDrawn;
  }, [hasDrawn]);

  const getPngBlob = useCallback(async (): Promise<Blob | null> => {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawn) return null;

    return new Promise<Blob | null>((resolve) => {
      canvas.toBlob(
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
      clear,
      isEmpty,
    }),
    [getPngBlob, clear, isEmpty]
  );

  return (
    <div className="w-full space-y-2" ref={containerRef}>
      <div className="relative w-full rounded-lg border border-border/80 bg-white dark:bg-slate-950/40 p-1 shadow-sm overflow-hidden touch-none">
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className={`block w-full cursor-crosshair rounded select-none ${
            disabled ? "opacity-50 cursor-not-allowed" : ""
          }`}
          style={{ touchAction: "none" }}
          aria-label="Área de assinatura manuscrita"
        />
        {!hasDrawn && !disabled && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted-foreground/60 select-none">
            <PenTool className="mr-1.5 h-3.5 w-3.5" />
            Desenhe a assinatura aqui (toque ou mouse)
          </div>
        )}
      </div>

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
    </div>
  );
});
