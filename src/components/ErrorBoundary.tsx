import { Component, ReactNode } from "react";
import { AlertTriangle, RefreshCw, Home, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  resetKey?: string | number | null;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

const errorSuggestions: Record<string, string> = {
  "Failed to fetch": "Verifique a sua ligação à internet e tente novamente.",
  "NetworkError": "O servidor está inacessível. Verifique a sua ligação.",
  "TypeError": "Ocorreu um problema no formato de dados. Tente recarregar a página.",
  "ChunkLoadError": "A aplicação foi atualizada. Recarregue o navegador.",
  "Loading chunk": "A aplicação foi atualizada. Recarregue o navegador.",
  "PGRST": "Uma consulta à base de dados falhou. Tente novamente ou contacte o suporte.",
  "JWT": "A sua sessão expirou. Inicie sessão novamente.",
  "auth": "Erro de autenticação. Inicie sessão novamente.",
  "total_distance": "Erro na coluna de distância. A base de dados pode precisar de atualização.",
  "non-DEFAULT": "Restrição na base de dados. Tente recarregar a página.",
  "permission denied": "Não tem permissão para esta ação. Verifique as suas credenciais.",
  "duplicate key": "Este registo já existe. Verifique os dados e tente novamente.",
  "violates foreign key": "Este registo está associado a outros dados e não pode ser modificado desta forma.",
  "insertbefore": "Tradução automática ou extensão do navegador interferiu no carregamento. Recarregue a página.",
  "not a child": "Tradução automática ou extensão do navegador interferiu no carregamento. Recarregue a página.",
  "removechild": "Tradução automática ou extensão do navegador interferiu no carregamento. Recarregue a página.",
};

function getSuggestion(error: Error | null): string {
  if (!error) return "Tente recarregar a página.";
  const msg = (error.message || error.name || "").toLowerCase();
  for (const [key, suggestion] of Object.entries(errorSuggestions)) {
    if (msg.includes(key.toLowerCase())) return suggestion;
  }
  return "Tente recarregar a página ou voltar ao painel principal.";
}

function getCategory(error: Error | null): string {
  if (!error) return "Erro Desconhecido";
  const msg = (error.message || "").toLowerCase();
  if (msg.includes("insertbefore") || msg.includes("not a child") || msg.includes("removechild")) return "Interferência de Tradução / Extensão";
  if (msg.includes("fetch") || msg.includes("network")) return "Erro de Rede";
  if (msg.includes("jwt") || msg.includes("auth") || msg.includes("session")) return "Erro de Autenticação";
  if (msg.includes("pgrst") || msg.includes("database") || msg.includes("duplicate") || msg.includes("violates")) return "Erro de Base de Dados";
  if (msg.includes("chunk") || msg.includes("loading chunk")) return "Atualização Necessária";
  return "Erro da Aplicação";
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary] Categoria:", getCategory(error));
    console.error("[ErrorBoundary] Erro:", error.message);
    console.error("[ErrorBoundary] Stack:", error.stack);
    console.error("[ErrorBoundary] Component Stack:", info.componentStack);
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      const category = getCategory(this.state.error);
      const suggestion = getSuggestion(this.state.error);
      const details = this.state.error?.message || "Sem detalhes disponíveis";
      return (
        <div className="min-h-[300px] flex flex-col items-center justify-center gap-5 p-8">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-7 w-7 text-destructive" />
          </div>
          <div className="text-center space-y-2">
            <h2 className="text-lg font-semibold text-foreground">{category}</h2>
            <p className="text-sm text-muted-foreground max-w-md">{suggestion}</p>
            <details className="mt-2">
              <summary className="text-xs text-muted-foreground/60 cursor-pointer">Detalhes técnicos</summary>
              <p className="text-xs text-muted-foreground/60 max-w-md font-mono bg-muted/50 rounded px-3 py-1.5 mt-1">
                {details}
              </p>
            </details>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => this.setState({ hasError: false, error: null })}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Tentar novamente
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.location.assign("/")}
            >
              <Home className="h-4 w-4 mr-2" />
              Painel Principal
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void navigator.clipboard?.writeText?.(`${category}: ${details}`);
              }}
            >
              <Copy className="h-4 w-4 mr-2" />
              Copiar erro
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
