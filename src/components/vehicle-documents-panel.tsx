"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, LockKeyhole, Plus, Upload, Users, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataTablePagination } from "@/components/data-table-pagination";
import { useLocale } from "@/components/locale-provider";
import { localizeClientError } from "@/lib/client-error-message";
import { vehicleDocumentCategoryLabel, vehicleDocumentUploadCopy } from "@/lib/client-feedback-copy";
import { TABLE_PAGE_SIZE } from "@/lib/pagination";

type Category = "registration" | "inspection" | "insurance" | "rental_agreement" | "other";
type Document = {
  id: string;
  name: string;
  category: Category;
  expiry_date: string | null;
  visible_to_driver: boolean;
  file_name: string;
  file_extension: string;
  file_size: string;
  uploaded_at: string;
  uploaded_by_name: string;
};
const categories: Category[] = ["registration", "inspection", "insurance", "rental_agreement", "other"];
const copy = {
  fr: {
    title: "Documents du véhicule", description: "Fichiers privés dont l’accès est contrôlé par votre organisation", add: "Ajouter un document",
    loading: "Chargement des documents du véhicule…", emptyTitle: "Aucun document pour le moment",
    emptyDescription: "Les documents du véhicule, comme l’immatriculation, le contrôle technique et l’assurance, apparaîtront ici.", addFirst: "Ajouter le premier document",
    document: "Document", category: "Catégorie", expiry: "Échéance", driverAccess: "Accès conducteur", file: "Fichier", open: "Ouvrir",
    addedBy: "Ajouté par", shared: "Partagé", staffOnly: "Équipe uniquement", dialogTitle: "Ajouter un document au véhicule",
    dialogDescription: "Envoyez un document privé et choisissez si le conducteur actuellement affecté peut l’ouvrir.", name: "Nom du document", namePlaceholder: "Ex. : certificat d’immatriculation",
    expiryDate: "Date d’échéance", optional: "(facultatif)",
    share: "Partager avec le conducteur affecté", shareHelp: "Seul le conducteur actuellement affecté et associé à un compte pourra ouvrir ce fichier.",
    cancel: "Annuler", uploading: "Envoi…", upload: "Envoyer le document", unknownCategory: "Catégorie inconnue",
  },
  en: {
    title: "Vehicle documents", description: "Private files with access controlled by your organization", add: "Add document",
    loading: "Loading vehicle documents…", emptyTitle: "No documents yet",
    emptyDescription: "Vehicle records such as registration, inspection, and insurance documents will appear here.", addFirst: "Add first document",
    document: "Document", category: "Category", expiry: "Expiry", driverAccess: "Driver access", file: "File", open: "Open",
    addedBy: "Added by", shared: "Shared", staffOnly: "Staff only", dialogTitle: "Add vehicle document",
    dialogDescription: "Upload a private document and choose whether the currently assigned driver can open it.", name: "Document name", namePlaceholder: "e.g. Vehicle registration",
    expiryDate: "Expiry date", optional: "(optional)",
    share: "Share with assigned driver", shareHelp: "Only the currently assigned, linked driver will be able to open this file.",
    cancel: "Cancel", uploading: "Uploading…", upload: "Upload document", unknownCategory: "Unknown category",
  },
} as const;

type UploadStage = "prepare" | "storage" | "verify";

function formatDate(value: string | null, locale: "fr" | "en") {
  if (!value) return locale === "fr" ? "Sans échéance" : "No expiry";
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

function formatSize(value: string) {
  return `${(Number(value) / (1024 * 1024)).toFixed(Number(value) >= 1024 * 1024 ? 1 : 2)} MB`;
}

export function VehicleDocumentsPanel({ vehicleId, canUpload }: { vehicleId: string; canUpload: boolean }) {
  const { locale } = useLocale();
  const text = copy[locale];
  const uploadText = vehicleDocumentUploadCopy[locale];
  const uploadErrors = uploadText.errors;
  const categoryLabels = Object.fromEntries(categories.map((value) => [value, vehicleDocumentCategoryLabel(value, locale)])) as Record<Category, string>;
  const [documents, setDocuments] = useState<Document[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<Category>("registration");
  const [expiryDate, setExpiryDate] = useState("");
  const [visibleToDriver, setVisibleToDriver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const page = Math.min(pageIndex, Math.max(0, Math.ceil(documents.length / TABLE_PAGE_SIZE) - 1));
  const visibleDocuments = documents.slice(page * TABLE_PAGE_SIZE, (page + 1) * TABLE_PAGE_SIZE);

  const loadDocuments = useCallback(async () => {
    const response = await fetch(`/api/vehicles/${vehicleId}/documents`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(localizeClientError(result.error, locale, { fr: "Impossible de charger les documents. Réessayez.", en: "Could not load documents. Please try again." }));
    return result.documents as Document[];
  }, [vehicleId, locale]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setDocuments(await loadDocuments());
      setError("");
    } catch (cause) {
      setError(localizeClientError(cause instanceof Error ? cause.message : undefined, locale, { fr: "Impossible de charger les documents. Réessayez.", en: "Could not load documents. Please try again." }));
    } finally {
      setLoading(false);
    }
  }, [loadDocuments, locale]);

  useEffect(() => {
    let active = true;
    void loadDocuments().then((items) => {
      if (active) { setDocuments(items); setError(""); }
    }).catch((cause: unknown) => {
      if (active) setError(localizeClientError(cause instanceof Error ? cause.message : undefined, locale, { fr: "Impossible de charger les documents. Réessayez.", en: "Could not load documents. Please try again." }));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadDocuments, locale]);

  function resetForm() {
    setName("");
    setCategory("registration");
    setExpiryDate("");
    setVisibleToDriver(false);
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";
    setError("");
  }

  async function uploadDocument(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) { setError(uploadErrors.chooseFile); return; }
    setBusy(true);
    setError("");
    let stage: UploadStage = "prepare";
    try {
      const response = await fetch(`/api/vehicles/${vehicleId}/documents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          category,
          expiryDate: expiryDate || null,
          visibleToDriver,
          fileName: file.name,
          fileSize: file.size,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not prepare upload.");
      const upload = result.upload as { id: string; uploadUrl: string; fields: Record<string, string> };
      const form = new FormData();
      for (const [key, value] of Object.entries(upload.fields)) form.append(key, value);
      form.append("file", file);
      stage = "storage";
      // Tigris does not return Access-Control-Allow-Origin for this private bucket.
      // Send its presigned multipart form as an opaque request, then let the
      // authenticated completion route verify the object before it becomes ready.
      await fetch(upload.uploadUrl, { method: "POST", body: form, mode: "no-cors" });
      stage = "verify";
      const completed = await fetch(`/api/vehicles/${vehicleId}/documents/${upload.id}/complete`, { method: "POST" });
      if (!completed.ok) throw new Error("Could not verify the uploaded file.");
      await completed.json();
      setDialogOpen(false);
      resetForm();
      await refresh();
    } catch {
      setError(uploadErrors[stage]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-sm" aria-labelledby="vehicle-documents-title">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b px-5 py-5 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><FileText className="size-[18px]" /></div>
          <div>
            <h2 id="vehicle-documents-title" className="text-sm font-semibold text-foreground">{text.title}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{text.description}</p>
          </div>
        </div>
        {canUpload && <Button onClick={() => { resetForm(); setDialogOpen(true); }}><Plus className="size-4" /> {text.add}</Button>}
      </div>

      {error && !dialogOpen && <p role="alert" className="border-b bg-destructive/5 px-6 py-3 text-sm text-destructive">{error}</p>}
      {loading ? <div role="status" className="px-6 py-12 text-center text-sm text-muted-foreground">{text.loading}</div>
        : documents.length === 0 ? (
          <Empty className="min-h-48 rounded-none border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon"><FileText /></EmptyMedia>
              <EmptyTitle>{text.emptyTitle}</EmptyTitle>
              <EmptyDescription>{text.emptyDescription}</EmptyDescription>
            </EmptyHeader>
            {canUpload && <Button onClick={() => { resetForm(); setDialogOpen(true); }}><Plus className="size-4" /> {text.addFirst}</Button>}
          </Empty>
        ) : (
          <>
          <div className="hidden lg:block"><Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead className="pl-6">{text.document}</TableHead>
                <TableHead>{text.category}</TableHead>
                <TableHead>{text.expiry}</TableHead>
                <TableHead>{text.driverAccess}</TableHead>
                <TableHead>{text.file}</TableHead>
                <TableHead className="pr-6 text-right">{text.open}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleDocuments.map((document) => (
                <TableRow key={document.id}>
                  <TableCell className="min-w-48 pl-6">
                    <div className="font-medium text-foreground">{document.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{text.addedBy} {document.uploaded_by_name}</div>
                  </TableCell>
                  <TableCell><Badge variant="outline" className="font-normal">{categoryLabels[document.category]}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(document.expiry_date, locale)}</TableCell>
                  <TableCell>
                    {document.visible_to_driver
                      ? <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary"><Users className="size-3.5" /> {text.shared}</span>
                      : <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><LockKeyhole className="size-3.5" /> {text.staffOnly}</span>}
                  </TableCell>
                  <TableCell className="text-xs uppercase text-muted-foreground">{document.file_extension} · {formatSize(document.file_size)}</TableCell>
                  <TableCell className="pr-6 text-right">
                    <Button variant="outline" size="sm" render={<a href={`/api/vehicles/${vehicleId}/documents/${document.id}/content`} target="_blank" rel="noreferrer">{text.open}</a>} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table></div>
          <div className="divide-y lg:hidden">{visibleDocuments.map((document) => <article key={document.id} className="min-w-0 space-y-3 px-4 py-4 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="break-words font-semibold">{document.name}</p><p className="mt-1 text-xs text-muted-foreground">{text.addedBy} {document.uploaded_by_name}</p></div><Badge variant="outline">{categoryLabels[document.category] ?? text.unknownCategory}</Badge></div>
            <div className="grid grid-cols-2 gap-3 border-t pt-3 text-xs"><div><p className="text-muted-foreground">{text.expiry}</p><p className="mt-1">{formatDate(document.expiry_date, locale)}</p></div><div><p className="text-muted-foreground">{text.driverAccess}</p><p className="mt-1">{document.visible_to_driver ? text.shared : text.staffOnly}</p></div></div>
            <div className="flex items-center justify-between gap-3 border-t pt-3"><span className="text-xs uppercase text-muted-foreground">{document.file_extension} · {formatSize(document.file_size)}</span><Button variant="outline" size="sm" render={<a href={`/api/vehicles/${vehicleId}/documents/${document.id}/content`} target="_blank" rel="noreferrer">{text.open}</a>} /></div>
          </article>)}</div>
          <DataTablePagination page={page + 1} total={documents.length} noun="documents" onPageChange={(nextPage) => setPageIndex(nextPage - 1)} />
          </>
        )}

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!busy) { setDialogOpen(open); if (!open) resetForm(); } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
          <DialogTitle>{text.dialogTitle}</DialogTitle>
          <DialogDescription>{text.dialogDescription}</DialogDescription>
          </DialogHeader>
          <form onSubmit={uploadDocument} className="space-y-4">
            <div className="space-y-2"><Label htmlFor="document-name">{text.name} *</Label><Input id="document-name" autoFocus maxLength={120} value={name} onChange={(event) => setName(event.target.value)} required placeholder={text.namePlaceholder} /></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="document-category">{text.category} *</Label>
                <Select value={category} onValueChange={(value) => { if (value) setCategory(value as Category); }}>
                  <SelectTrigger id="document-category" aria-label={text.category} className="w-full"><SelectValue>{(value: string) => categoryLabels[value as Category] ?? text.unknownCategory}</SelectValue></SelectTrigger>
                <SelectContent>{categories.map((item) => <SelectItem key={item} value={item}>{vehicleDocumentCategoryLabel(item, locale)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label htmlFor="document-expiry">{text.expiryDate} <span className="font-normal text-muted-foreground">{text.optional}</span></Label><Input id="document-expiry" type="date" value={expiryDate} onChange={(event) => setExpiryDate(event.target.value)} /></div>
            </div>
            <div className="grid min-w-0 gap-2">
              <Label htmlFor="document-file">{uploadText.fileLabel} *</Label>
              <Input ref={fileInput} id="document-file" type="file" accept=".pdf,.png,.jpg,.jpeg,.docx" onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)} className="sr-only w-px" tabIndex={-1} />
              <div className="flex min-w-0 flex-wrap items-center gap-3"><Button type="button" variant="outline" aria-label={uploadText.chooseFile} onClick={() => fileInput.current?.click()}>{uploadText.chooseFile}</Button><span className="min-w-0 max-w-full truncate text-sm text-muted-foreground">{file?.name ?? uploadText.noFile}</span></div>
              <p className="text-xs text-muted-foreground">{uploadText.fileHelp}</p>
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3.5">
              <Checkbox checked={visibleToDriver} onCheckedChange={(checked) => setVisibleToDriver(Boolean(checked))} className="mt-0.5" />
              <span><span className="block text-sm font-medium">{text.share}</span><span className="mt-0.5 block text-xs text-muted-foreground">{text.shareHelp}</span></span>
            </label>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={() => { setDialogOpen(false); resetForm(); }}><X className="size-4" /> {text.cancel}</Button>
              <Button type="submit" disabled={busy || !file || !name.trim()}>{busy ? <><Upload className="size-4 animate-pulse" /> {text.uploading}</> : <><Upload className="size-4" /> {text.upload}</>}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
