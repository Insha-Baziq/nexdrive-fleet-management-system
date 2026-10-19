"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "@/components/locale-provider";
import { FileText, Plus, Upload, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataTablePagination } from "@/components/data-table-pagination";
import { TABLE_PAGE_SIZE } from "@/lib/pagination";

type Category = "driving_licence" | "identity_document" | "carte_vitale" | "contract" | "other";
type UploadCategory = Category;
type Document = {
  id: string;
  name: string;
  category: Category;
  expiry_date: string | null;
  file_name: string;
  file_extension: string;
  file_size: string;
  uploaded_at: string;
  uploaded_by_name: string;
};
function expiryRequired(category: Category) {
  return category === "driving_licence" || category === "identity_document";
}

function needsExpiryCorrection(document: Document) {
  return expiryRequired(document.category) && !document.expiry_date;
}

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function formatDate(value: string | null, locale: string, noExpiry: string) {
  if (!value) return noExpiry;
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

function formatSize(value: string, locale: string) {
  const size = Number(value) / (1024 * 1024);
  const unit = locale === "fr-FR" ? "Mo" : "MB";
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: size >= 1 ? 1 : 2 }).format(size)} ${unit}`;
}

function FileDetail({ document, locale }: { document: Document; locale: string }) {
  return <span className="text-xs uppercase text-muted-foreground">{document.file_extension} · {formatSize(document.file_size, locale)}</span>;
}

export function DriverDocumentsPanel({ driverId, canUpload = true }: { driverId: string; canUpload?: boolean }) {
  const { locale } = useLocale();
  const french = locale === "fr";
  const dateLocale = french ? "fr-FR" : "en-GB";
  const labels = french ? {
    drivingLicence: "Permis de conduire",
    identityDocument: "Pièce d’identité / titre de séjour",
    carteVitale: "Carte Vitale",
    contract: "Contrat",
    other: "Autre",
    noExpiry: "Sans date d’expiration",
    loadError: "Impossible de charger les documents du conducteur.",
    chooseFile: "Choisissez un fichier à importer.",
    nameRequired: "Saisissez le nom du document.",
    expiryMissing: "Une date d’expiration est obligatoire pour cette catégorie de document.",
    expiryInvalid: "Saisissez une date d’expiration valide.",
    fileUnsupported: "Choisissez un fichier PDF, PNG, JPG, JPEG ou DOCX.",
    fileTooLarge: "Le fichier ne peut pas dépasser 15 Mo.",
    prepareError: "Impossible de préparer l’import du fichier.",
    storageError: "L’import vers le stockage privé a échoué. Réessayez.",
    verifyError: "Impossible de vérifier le fichier importé.",
    uploadError: "Impossible d’importer ce document.",
    open: "Ouvrir",
    title: "Documents du conducteur",
    privacy: "Fichiers privés accessibles au personnel autorisé",
    add: "Ajouter un document",
    missingOne: "ancien document n’a pas de date d’expiration.",
    missingMany: "anciens documents n’ont pas de date d’expiration.",
    correctionHint: "Ajoutez un nouveau document avec sa date d’expiration.",
    loading: "Chargement des documents du conducteur…",
    emptyTitle: "Aucun document pour le moment",
    emptyDescription: "Les documents administratifs de ce conducteur apparaîtront ici.",
    addFirst: "Ajouter le premier document",
    document: "Document",
    category: "Catégorie",
    expiry: "Expiration",
    file: "Fichier",
    expiryRequired: "Date d’expiration obligatoire",
    correctionNeeded: "À compléter",
    requiredMissing: "Obligatoire · manquante",
    addedBy: "Ajouté par",
    addTitle: "Ajouter un document du conducteur",
    addDescription: "Importez un document privé dans le dossier de ce conducteur.",
    documentName: "Nom du document",
    documentNamePlaceholder: "ex. Permis de conduire",
    categoryLabel: "Catégorie",
    expiryLabel: "Date d’expiration",
    optionalExpiry: " (facultative)",
    fileLabel: "Fichier",
    chooseFileButton: "Choisir un fichier",
    noFileSelected: "Aucun fichier sélectionné",
    removeFile: "Retirer le fichier sélectionné",
    formats: "PDF, PNG, JPG, JPEG ou DOCX · 15 Mo maximum",
    cancel: "Annuler",
    uploading: "Importation…",
    upload: "Importer le document",
    noun: "documents",
  } : {
    drivingLicence: "Driving licence",
    identityDocument: "Identity document / residence permit",
    carteVitale: "Carte Vitale",
    contract: "Contract",
    other: "Other",
    noExpiry: "No expiry",
    loadError: "Could not load driver documents.",
    chooseFile: "Choose a file to upload.",
    nameRequired: "Enter a document name.",
    expiryMissing: "An expiry date is required for this document category.",
    expiryInvalid: "Enter a valid expiry date.",
    fileUnsupported: "Choose a PDF, PNG, JPG, JPEG, or DOCX file.",
    fileTooLarge: "The file must not exceed 15 MB.",
    prepareError: "Could not prepare the upload.",
    storageError: "The private storage upload failed. Please try again.",
    verifyError: "Could not verify the uploaded file.",
    uploadError: "Could not upload this document.",
    open: "Open",
    title: "Driver documents",
    privacy: "Private files available to authorized staff",
    add: "Add document",
    missingOne: "legacy document has no expiry date.",
    missingMany: "legacy documents have no expiry date.",
    correctionHint: "Add a replacement document with the expiry date.",
    loading: "Loading driver documents…",
    emptyTitle: "No documents yet",
    emptyDescription: "Administrative documents for this driver will appear here.",
    addFirst: "Add first document",
    document: "Document",
    category: "Category",
    expiry: "Expiry",
    file: "File",
    expiryRequired: "Expiry date required",
    correctionNeeded: "Needs correction",
    requiredMissing: "Required · missing",
    addedBy: "Added by",
    addTitle: "Add driver document",
    addDescription: "Upload a private document to this driver record.",
    documentName: "Document name",
    documentNamePlaceholder: "e.g. Driving licence",
    categoryLabel: "Category",
    expiryLabel: "Expiry date",
    optionalExpiry: " (optional)",
    fileLabel: "File",
    chooseFileButton: "Choose a file",
    noFileSelected: "No file selected",
    removeFile: "Remove selected file",
    formats: "PDF, PNG, JPG, JPEG, or DOCX · maximum 15 MB",
    cancel: "Cancel",
    uploading: "Uploading…",
    upload: "Upload document",
    noun: "documents",
  };
  const categoryLabels: Record<Category, string> = {
    driving_licence: labels.drivingLicence,
    identity_document: labels.identityDocument,
    carte_vitale: labels.carteVitale,
    contract: labels.contract,
    other: labels.other,
  };
  const categories: { value: UploadCategory; label: string }[] = [
    { value: "driving_licence", label: labels.drivingLicence },
    { value: "identity_document", label: labels.identityDocument },
    { value: "carte_vitale", label: labels.carteVitale },
    { value: "contract", label: labels.contract },
    { value: "other", label: labels.other },
  ];
  const localizeError = useCallback((message: string, fallback: string) => {
    if (!french) return message;
    const errors: Record<string, string> = {
      "Could not process driver document.": "Impossible de traiter le document du conducteur.",
      "Restore this driver before adding documents.": "Restaurez ce conducteur avant d’ajouter des documents.",
      "An expiry date is required for this document category.": "Une date d’expiration est obligatoire pour cette catégorie de document.",
      "Enter valid document details and choose a supported file up to 15 MB.": "Saisissez des informations valides et choisissez un fichier pris en charge de 15 Mo maximum.",
      "Forbidden.": "Accès interdit.",
      "Driver not found.": "Conducteur introuvable.",
      "Private document storage is not configured.": "Le stockage privé des documents n’est pas configuré.",
      "Could not prepare a private upload. Check the Tigris bucket setup.": "Impossible de préparer l’import privé. Vérifiez la configuration du stockage.",
      "Upload not found or expired.": "Import introuvable ou expiré.",
      "The uploaded file could not be found in private storage.": "Le fichier importé est introuvable dans le stockage privé.",
      "The uploaded file could not be verified. Please retry.": "Impossible de vérifier le fichier importé. Réessayez.",
      "The uploaded file does not match the selected type and size limit.": "Le fichier importé ne correspond pas au type sélectionné ou dépasse la taille maximale.",
      "Restore this driver before completing document uploads.": "Restaurez ce conducteur avant de terminer l’import des documents.",
      "Could not complete the document upload.": "Impossible de terminer l’import du document.",
      "Document not found.": "Document introuvable.",
      "Document content is unavailable.": "Le contenu du document est indisponible.",
    };
    return errors[message] ?? fallback;
  }, [french]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<Category>("driving_licence");
  const [expiryDate, setExpiryDate] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const page = Math.min(pageIndex, Math.max(0, Math.ceil(documents.length / TABLE_PAGE_SIZE) - 1));
  const visibleDocuments = documents.slice(page * TABLE_PAGE_SIZE, (page + 1) * TABLE_PAGE_SIZE);
  const missingExpiryCount = documents.filter(needsExpiryCorrection).length;

  const loadDocuments = useCallback(async () => {
    const response = await fetch(`/api/drivers/${driverId}/documents`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(localizeError(result.error || "Could not load driver documents.", labels.loadError));
    return result.documents as Document[];
  }, [driverId, labels.loadError, localizeError]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setDocuments(await loadDocuments());
      setError("");
    } catch (cause) {
      setError(localizeError(cause instanceof Error ? cause.message : "Could not load driver documents.", labels.loadError));
    } finally {
      setLoading(false);
    }
  }, [loadDocuments, labels.loadError, localizeError]);

  useEffect(() => {
    let active = true;
    void loadDocuments().then((items) => {
      if (active) { setDocuments(items); setError(""); }
    }).catch((cause: unknown) => {
      if (active) setError(localizeError(cause instanceof Error ? cause.message : "Could not load driver documents.", labels.loadError));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadDocuments, labels.loadError, localizeError]);

  function resetForm() {
    setName("");
    setCategory("driving_licence");
    setExpiryDate("");
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";
    setError("");
  }

  async function uploadDocument(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) { setError(labels.nameRequired); return; }
    if (expiryRequired(category) && !expiryDate) { setError(labels.expiryMissing); return; }
    if (expiryDate && !isValidDate(expiryDate)) { setError(labels.expiryInvalid); return; }
    if (!file) { setError(labels.chooseFile); return; }
    const extension = file.name.toLowerCase().split(".").at(-1);
    if (!extension || !["pdf", "png", "jpg", "jpeg", "docx"].includes(extension)) { setError(labels.fileUnsupported); return; }
    if (file.size > 15 * 1024 * 1024) { setError(labels.fileTooLarge); return; }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/drivers/${driverId}/documents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          category,
          expiryDate: expiryDate || null,
          fileName: file.name,
          fileSize: file.size,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(localizeError(result.error || "Could not prepare a private upload. Check the Tigris bucket setup.", labels.prepareError));
      const upload = result.upload as { id: string; uploadUrl: string; fields: Record<string, string> };
      const form = new FormData();
      for (const [key, value] of Object.entries(upload.fields)) form.append(key, value);
      form.append("file", file);
      const stored = await fetch(upload.uploadUrl, { method: "POST", body: form });
      if (!stored.ok) throw new Error(labels.storageError);
      const completed = await fetch(`/api/drivers/${driverId}/documents/${upload.id}/complete`, { method: "POST" });
      const completionResult = await completed.json();
      if (!completed.ok) throw new Error(localizeError(completionResult.error || "Could not complete the document upload.", labels.verifyError));
      setDialogOpen(false);
      resetForm();
      await refresh();
    } catch (cause) {
      setError(localizeError(cause instanceof Error ? cause.message : "Could not upload this document.", labels.uploadError));
    } finally {
      setBusy(false);
    }
  }

  function OpenButton({ document }: { document: Document }) {
    return <Button variant="outline" size="sm" nativeButton={false} render={<a href={`/api/drivers/${driverId}/documents/${document.id}/content`} target="_blank" rel="noreferrer">{labels.open}</a>} />;
  }

  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-sm" aria-labelledby="driver-documents-title">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b px-5 py-5 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><FileText className="size-[18px]" /></div>
          <div>
            <h2 id="driver-documents-title" className="text-sm font-semibold text-foreground">{labels.title}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{labels.privacy}</p>
          </div>
        </div>
        {canUpload && <Button onClick={() => { resetForm(); setDialogOpen(true); }}><Plus className="size-4" /> {labels.add}</Button>}
      </div>

      {error && !dialogOpen && <p role="alert" className="border-b bg-destructive/5 px-6 py-3 text-sm text-destructive">{error}</p>}
      {!loading && missingExpiryCount > 0 && <p role="status" className="border-b border-amber-500/25 bg-amber-500/10 px-5 py-3 text-sm text-amber-900 dark:text-amber-200 sm:px-6">
        {missingExpiryCount} {missingExpiryCount === 1 ? labels.missingOne : labels.missingMany} {labels.correctionHint}
      </p>}
      {loading ? <div role="status" className="px-6 py-12 text-center text-sm text-muted-foreground">{labels.loading}</div>
        : documents.length === 0 ? (
          <Empty className="min-h-48 rounded-none border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon"><FileText /></EmptyMedia>
              <EmptyTitle>{labels.emptyTitle}</EmptyTitle>
              <EmptyDescription>{labels.emptyDescription}</EmptyDescription>
            </EmptyHeader>
            {canUpload && <Button onClick={() => { resetForm(); setDialogOpen(true); }}><Plus className="size-4" /> {labels.addFirst}</Button>}
          </Empty>
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead className="pl-6">{labels.document}</TableHead>
                    <TableHead>{labels.category}</TableHead>
                    <TableHead>{labels.expiry}</TableHead>
                    <TableHead>{labels.file}</TableHead>
                    <TableHead className="pr-6 text-right">{labels.open}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleDocuments.map((document) => (
                    <TableRow key={document.id}>
                      <TableCell className="min-w-48 pl-6">
                        <div className="font-medium text-foreground">{document.name}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{labels.addedBy} {document.uploaded_by_name}</div>
                      </TableCell>
                      <TableCell><Badge variant="outline" className="font-normal">{categoryLabels[document.category]}</Badge></TableCell>
                      <TableCell className="text-muted-foreground">
                        <div>{needsExpiryCorrection(document) ? labels.expiryRequired : formatDate(document.expiry_date, dateLocale, labels.noExpiry)}</div>
                        {needsExpiryCorrection(document) && <Badge variant="outline" className="mt-1 border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200">{labels.correctionNeeded}</Badge>}
                      </TableCell>
                      <TableCell><FileDetail document={document} locale={dateLocale} /></TableCell>
                      <TableCell className="pr-6 text-right"><OpenButton document={document} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="divide-y lg:hidden">
              {visibleDocuments.map((document) => (
                <div key={document.id} className="min-w-0 px-4 py-4">
                  <div className="min-w-0">
                    <div className="break-words text-sm font-semibold text-foreground">{document.name}</div>
                    <div className="mt-1"><Badge variant="outline" className="font-normal">{categoryLabels[document.category]}</Badge></div>
                    <div className="mt-2 text-xs text-muted-foreground">{labels.expiry}: {needsExpiryCorrection(document) ? labels.requiredMissing : formatDate(document.expiry_date, dateLocale, labels.noExpiry)}</div>
                    {needsExpiryCorrection(document) && <Badge variant="outline" className="mt-1 border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200">{labels.correctionNeeded}</Badge>}
                    <div className="mt-1"><FileDetail document={document} locale={dateLocale} /></div>
                  </div>
                  <div className="mt-3 border-t pt-3"><OpenButton document={document} /></div>
                </div>
              ))}
            </div>
            <DataTablePagination page={page + 1} total={documents.length} noun={labels.noun} onPageChange={(nextPage) => setPageIndex(nextPage - 1)} />
          </>
        )}

      {canUpload && <Dialog open={dialogOpen} onOpenChange={(open) => { if (!busy) { setDialogOpen(open); if (!open) resetForm(); } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{labels.addTitle}</DialogTitle>
            <DialogDescription>{labels.addDescription}</DialogDescription>
          </DialogHeader>
          <form onSubmit={uploadDocument} noValidate className="space-y-4">
            <div className="space-y-2"><Label htmlFor="driver-document-name">{labels.documentName} *</Label><Input id="driver-document-name" autoFocus maxLength={120} value={name} onChange={(event) => setName(event.target.value)} required placeholder={labels.documentNamePlaceholder} /></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="driver-document-category">{labels.categoryLabel} *</Label>
                <Select value={category} onValueChange={(value) => { if (value) setCategory(value as Category); }}>
                  <SelectTrigger id="driver-document-category" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{categories.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="driver-document-expiry">{labels.expiryLabel}{expiryRequired(category) ? " *" : <span className="font-normal text-muted-foreground">{labels.optionalExpiry}</span>}</Label>
                <Input id="driver-document-expiry" type="date" required={expiryRequired(category)} value={expiryDate} onChange={(event) => setExpiryDate(event.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="driver-document-file">{labels.fileLabel} *</Label>
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative inline-flex rounded-md focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                  <Input ref={fileInput} id="driver-document-file" type="file" accept=".pdf,.png,.jpg,.jpeg,.docx" aria-label={labels.fileLabel} onChange={(event) => { setFile(event.currentTarget.files?.[0] ?? null); event.currentTarget.value = ""; }} required className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0" />
                  <Button type="button" variant="outline" tabIndex={-1} aria-hidden="true" className="pointer-events-none"><Upload className="size-4" /> {labels.chooseFileButton}</Button>
                </div>
                <span id="driver-document-file-name" className="min-w-0 max-w-full break-all text-sm text-muted-foreground" aria-live="polite">{file?.name ?? labels.noFileSelected}</span>
                {file && <Button type="button" variant="ghost" size="icon-sm" aria-label={labels.removeFile} disabled={busy} onClick={() => { setFile(null); if (fileInput.current) fileInput.current.value = ""; }}><X className="size-4" /></Button>}
              </div>
              <p className="text-xs text-muted-foreground">{labels.formats}</p>
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={() => { setDialogOpen(false); resetForm(); }}><X className="size-4" /> {labels.cancel}</Button>
              <Button type="submit" disabled={busy || !file || !name.trim()}>{busy ? <><Upload className="size-4 animate-pulse" /> {labels.uploading}</> : <><Upload className="size-4" /> {labels.upload}</>}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>}
    </section>
  );
}
