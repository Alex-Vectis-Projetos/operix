import { useState } from "react";
import { IdCard, Plus, Search, Pencil, Trash2, Loader2, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { usePeople, type Person, type PersonInput, type PersonType, type PersonStatus } from "@/hooks/usePeople";
import { PersonFormDialog } from "@/components/people/PersonFormDialog";

const TYPE_LABELS: Record<PersonType, string> = {
  technician: "Técnico DSP",
  dismantler: "Montador",
  painter: "Pintor",
  polisher: "Polidor",
  appraiser: "Perito / Avaliador",
  driver: "Motorista",
  operations_manager: "Gestor Operacional",
  sales: "Comercial",
  administrative: "Administrativo",
  provider_operational: "Prestador — Operacional",
  provider_administrative: "Prestador — Administrativo",
};

export default function PeoplePage() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | PersonType>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | PersonStatus>("all");
  const { people, isLoading, create, update, remove } = usePeople({
    search: search || undefined,
    type: typeFilter === "all" ? undefined : typeFilter,
    status: statusFilter === "all" ? undefined : statusFilter,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Person | null>(null);
  const [toDelete, setToDelete] = useState<Person | null>(null);

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(person: Person) {
    setEditing(person);
    setDialogOpen(true);
  }

  async function handleSubmit(input: PersonInput): Promise<Person> {
    if (editing) return update.mutateAsync({ id: editing.id, ...input });
    return create.mutateAsync(input);
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <IdCard className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-2xl font-semibold">Pessoas</h1>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" /> Nova Pessoa
        </Button>
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Buscar por nome ou e-mail..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as "all" | PersonType)}>
              <SelectTrigger className="w-[240px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os tipos</SelectItem>
                {Object.entries(TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as "all" | PersonStatus)}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                <SelectItem value="active">Ativo</SelectItem>
                <SelectItem value="inactive">Inativo</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : people.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Nenhuma Pessoa cadastrada.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Local</TableHead>
                  <TableHead>Contato</TableHead>
                  <TableHead>Documentos</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {people.map((person) => (
                  <TableRow key={person.id}>
                    <TableCell className="font-medium">{person.full_name}</TableCell>
                    <TableCell>{TYPE_LABELS[person.type]}</TableCell>
                    <TableCell>{person.location_name ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{person.email ?? person.tax_id ?? "—"}</TableCell>
                    <TableCell>
                      {[
                        "technician",
                        "dismantler",
                        "painter",
                        "polisher",
                        "appraiser",
                        "driver",
                        "provider_operational",
                      ].includes(person.type) ? (
                        (person.documents_pending_count ?? 0) > 0 ? (
                          <Badge variant="secondary" className="gap-1">
                            <AlertTriangle className="h-3 w-3" /> {person.documents_pending_count} pendente(s)
                          </Badge>
                        ) : (
                          <Badge className="bg-green-600 hover:bg-green-600">Em dia</Badge>
                        )
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={person.status === "active" ? "default" : "secondary"}>
                        {person.status === "active" ? "Ativo" : "Inativo"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(person)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => setToDelete(person)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <PersonFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSubmit={handleSubmit}
        saving={create.isPending || update.isPending}
      />

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Pessoa?</AlertDialogTitle>
            <AlertDialogDescription>"{toDelete?.full_name}" será removida da listagem.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={async () => {
                if (toDelete) await remove.mutateAsync(toDelete.id);
                setToDelete(null);
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
