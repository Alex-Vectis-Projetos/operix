import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { KeyRound, Copy, Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { withPromiseTimeout } from "@/lib/asyncGuard";

interface TempCred {
  user_id: string;
  email: string;
  full_name: string | null;
  temp_password: string;
  created_at: string;
}

export function TempCredentialsCard() {
  const [copied, setCopied] = useState<string | null>(null);

  const { data = [], isLoading } = useQuery({
    queryKey: ["temp-credentials"],
    retry: 0,
    staleTime: 60_000,
    placeholderData: (previousData) => previousData ?? [],
    queryFn: async (): Promise<TempCred[]> => {
      try {
        const { data, error } = await withPromiseTimeout<any>(
          supabase
            .from("temp_credentials" as any)
            .select("user_id, email, full_name, temp_password, created_at")
            .order("created_at", { ascending: false }),
          3000,
          "temp_credentials",
        );
        if (error) return [];
        return (data as unknown as TempCred[]) ?? [];
      } catch {
        return [];
      }
    },
  });

  const copy = async (val: string, id: string) => {
    try {
      await navigator.clipboard.writeText(val);
      setCopied(id);
      toast.success("Copiado");
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error("Falha ao copiar");
    }
  };

  return (
    <Card className="border-border/50">
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-primary" />
          Senhas temporárias geradas
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
        ) : data.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            Nenhuma senha temporária pendente. Quando um utilizador é convidado, a sua senha temporária aparece aqui até ser alterada.
          </p>
        ) : (
          <div className="space-y-2">
            {data.map((c) => (
              <div key={c.user_id} className="flex items-center justify-between gap-3 rounded-md border border-border/40 bg-muted/20 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{c.full_name || c.email.split("@")[0]}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{c.email}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <code className="font-mono text-[11px] px-2 py-1 rounded bg-background border border-border/50 select-all">
                    {c.temp_password}
                  </code>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0"
                    onClick={() => copy(c.temp_password, c.user_id)}>
                    {copied === c.user_id ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="text-[10px] text-muted-foreground mt-3">
          Visível apenas para administradores. A senha desaparece automaticamente quando o utilizador a altera.
        </p>
      </CardContent>
    </Card>
  );
}
