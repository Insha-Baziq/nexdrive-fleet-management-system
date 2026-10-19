"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/components/locale-provider";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type ImportRow = {
  rowNumber: number;
  fullName: string;
  licenceNumber: string;
  dateOfBirth: string;
  streetNumber: string;
  streetName: string;
  postalCode: string;
  city: string;
  errors: string[];
};
type ImportResult = {
  intent: "preview" | "commit";
  rows: ImportRow[];
  totalRows: number;
  validRows: number;
  errorRows: number;
  canCommit: boolean;
  committed?: boolean;
  createdCount?: number;
};

export function DriverImportDialog() {
  const router = useRouter();
  const { locale } = useLocale();
  const french = locale === "fr";
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";
    setResult(null);
    setBusy(false);
    setError("");
  }

  async function runImport(intent: "preview" | "commit") {
    if (!file) {
      setError(french ? "Choisissez d’abord un fichier CSV ou Excel." : "Choose a CSV or Excel file first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("intent", intent);
      form.append("file", file);
      const response = await fetch("/api/drivers/import", { method: "POST", body: form });
      const payload = await response.json();
      if (response.status === 409 && payload && Array.isArray(payload.rows)) {
        setResult(payload as ImportResult);
        setError(french ? "L’import a été interrompu : un numéro de permis existe déjà ou une ligne contient une erreur. Aucune ligne n’a été ajoutée." : "The import stopped because a licence number now exists or a row has an error. No rows were added.");
        return;
      }
      if (!response.ok) throw new Error(localizeMessage(payload.error || "Could not process this import file."));
      setResult(payload as ImportResult);
      if (intent === "commit" && payload.committed) router.refresh();
    } catch (cause) {
      setError(localizeMessage(cause instanceof Error ? cause.message : "Could not process this import file."));
    } finally {
      setBusy(false);
    }
  }

  function localizeMessage(message: string) {
    if (!french) return message;
    const exact: Record<string, string> = {
      "Choose a CSV or Excel file first.": "Choisissez d’abord un fichier CSV ou Excel.",
      "Could not process this import file.": "Impossible de traiter ce fichier d’import.",
      "The import file must be between 1 byte and 5 MB.": "Le fichier d’import doit mesurer entre 1 octet et 5 Mo.",
      "The import request exceeds the 5 MB file limit.": "La requête dépasse la limite de 5 Mo par fichier.",
      "The CSV file must use UTF-8 encoding.": "Le fichier CSV doit être encodé en UTF-8.",
      "The CSV file contains a quote in an unquoted field.": "Le fichier CSV contient un guillemet mal placé.",
      "The CSV file contains characters after a quoted field.": "Le fichier CSV contient des caractères après un champ entre guillemets.",
      "The CSV file has an unclosed quoted field.": "Le fichier CSV contient un champ entre guillemets qui n’est pas fermé.",
      "The Excel workbook must contain exactly one worksheet.": "Le classeur Excel doit contenir exactement une feuille.",
      "The Excel file could not be read. Upload a valid .xlsx workbook.": "Le fichier Excel est illisible. Importez un classeur .xlsx valide.",
      "The import file needs a header row and at least one driver row.": "Le fichier doit contenir une ligne d’en-têtes et au moins une ligne de conducteur.",
      "Only administrators can import drivers.": "Seuls les administrateurs peuvent importer des conducteurs.",
      "Unauthorized.": "Vous n’êtes pas authentifié.",
      "Submit one CSV or .xlsx file.": "Envoyez un seul fichier CSV ou .xlsx.",
      "Submit one intent and one import file.": "Envoyez une seule action et un seul fichier d’import.",
      "Choose preview or commit.": "Choisissez l’aperçu ou l’import.",
      "Choose the CSV or .xlsx file.": "Choisissez un fichier CSV ou .xlsx.",
      "Licence number is required for duplicate matching.": "Le numéro de permis est obligatoire pour vérifier les doublons.",
      "Formulas are not supported; enter a value instead.": "Les formules ne sont pas prises en charge ; saisissez une valeur.",
      "This row contains data outside the provided columns.": "Cette ligne contient des données en dehors des colonnes prévues.",
    };
    if (exact[message]) return exact[message];
    let match = message.match(/^Enter a full name \(up to (\d+) characters\)\.$/);
    if (match) return `Saisissez un nom complet (au plus ${match[1]} caractères).`;
    match = message.match(/^Enter a valid date of birth\.$/);
    if (match) return "Saisissez une date de naissance valide.";
    if (message === "Date of birth cannot be in the future.") return "La date de naissance ne peut pas être dans le futur.";
    if (message === "Enter a valid date.") return "Saisissez une date valide.";
    match = message.match(/^Enter a (street number|street name|postal code|city) \(up to (\d+) characters\)\.$/);
    if (match) {
      const field = ({ "street number": "numéro de rue", "street name": "nom de rue", "postal code": "code postal", city: "ville" } as Record<string, string>)[match[1]];
      return `Saisissez ${match[1] === "city" ? "une" : "un"} ${field} (au plus ${match[2]} caractères).`;
    }
    match = message.match(/^Use (\d+) characters or fewer\.$/);
    if (match) return `Utilisez au plus ${match[1]} caractères.`;
    match = message.match(/^Licence number duplicates row (\d+) in this file\.$/);
    if (match) return `Le numéro de permis est identique à celui de la ligne ${match[1]} de ce fichier.`;
    if (message === "Licence number already exists in this organization.") return "Ce numéro de permis existe déjà dans cette organisation.";
    match = message.match(/^A file can contain at most (\d+) driver rows\.$/);
    if (match) return `Un fichier peut contenir au plus ${match[1]} lignes de conducteurs.`;
    match = message.match(/^Unsupported column “(.+)”\. Use the provided driver template\.$/);
    if (match) return `Colonne non reconnue « ${match[1]} ». Utilisez le modèle de conducteurs fourni.`;
    match = message.match(/^Column “(.+)” appears more than once\.$/);
    if (match) return `La colonne « ${match[1]} » apparaît plusieurs fois.`;
    match = message.match(/^Missing required columns: (.+)\.$/);
    if (match) {
      const frenchColumns: Record<string, string> = {
        fullName: "nom complet", dateOfBirth: "date de naissance", streetNumber: "numéro de rue",
        streetName: "nom de rue", postalCode: "code postal", city: "ville", licenceNumber: "numéro de permis",
      };
      return `Colonnes obligatoires manquantes : ${match[1].split(", ").map((column) => frenchColumns[column] ?? column).join(", ")}.`;
    }
    return "Une erreur de validation est survenue. Vérifiez les données et réessayez.";
  }

  const labels = french ? {
    title: "Importer des conducteurs",
    description: "Importez un fichier CSV ou un classeur Excel pour vérifier les lignes avant de les enregistrer.",
    policy: "L’import crée uniquement de nouveaux dossiers. Les numéros de permis sont comparés dans cette organisation en ignorant les espaces, les tirets et la casse. Si une ligne est invalide ou en doublon, tout l’import est bloqué. Aucun compte de connexion n’est créé ni associé.",
    cap: "Maximum : 500 conducteurs et 5 Mo par fichier.",
    csv: "Modèle CSV",
    excel: "Modèle Excel",
    file: "Fichier d’import",
    rows: "lignes",
    ready: "prêtes",
    errors: "avec des erreurs",
    imported: "conducteurs importés",
    none: "Aucune ligne de conducteur trouvée.",
    row: "Ligne",
    name: "Nom",
    licence: "Permis",
    birth: "Date de naissance",
    address: "Adresse",
    result: "Résultat",
    readyRow: "Prête",
    close: "Fermer",
    importing: "Importation…",
    check: "Vérification…",
    preview: "Vérifier l’import",
  } : {
    title: "Import drivers",
    description: "Upload a CSV or Excel workbook to review driver rows before saving them.",
    policy: "Imports create new records only. Licence numbers are matched within this organization after ignoring spaces, hyphens, and letter case. If any row is invalid or duplicated, the whole import is blocked. No login accounts are created or linked.",
    cap: "Maximum 500 driver rows and 5 MB per file.",
    csv: "CSV template",
    excel: "Excel template",
    file: "Import file",
    rows: "rows",
    ready: "ready",
    errors: "with errors",
    imported: "drivers",
    none: "No driver rows found.",
    row: "Row",
    name: "Name",
    licence: "Licence",
    birth: "Date of birth",
    address: "Address",
    result: "Result",
    readyRow: "Ready",
    close: "Close",
    importing: "Importing…",
    check: "Checking…",
    preview: "Preview import",
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next && !busy) reset(); }}>
      <DialogTrigger render={<Button variant="outline" size="sm"><FileSpreadsheet className="size-4" /> {labels.title}</Button>} />
      <DialogContent className="flex max-h-[min(90dvh,850px)] max-w-[calc(100%-1.5rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[900px]">
        <DialogHeader className="shrink-0 border-b px-5 py-5 sm:px-7">
          <DialogTitle className="text-xl">{labels.title}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5 sm:px-7">
          <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
            <p>{labels.policy}</p>
            <p className="mt-2">{labels.cap}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" nativeButton={false} render={<a href={`/api/drivers/import?format=csv&locale=${locale}`} download />}><Download className="size-4" /> {labels.csv}</Button>
              <Button variant="outline" size="sm" nativeButton={false} render={<a href={`/api/drivers/import?format=xlsx&locale=${locale}`} download />}><Download className="size-4" /> {labels.excel}</Button>
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="driver-import-file" className="text-sm font-medium">{labels.file}</label>
            <input ref={fileInput} id="driver-import-file" type="file" accept=".csv,.xlsx" disabled={busy} className="sr-only" tabIndex={-1} onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setResult(null);
              setError("");
            }} />
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <Button type="button" variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}>{french ? "Choisir un fichier" : "Choose a file"}</Button>
              <span className="min-w-0 max-w-full truncate text-sm text-muted-foreground">{file?.name ?? (french ? "Aucun fichier sélectionné" : "No file selected")}</span>
            </div>
          </div>

          {error && <p role="alert" className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
          {result && <section aria-live="polite" aria-label={french ? "Aperçu de l’import des conducteurs" : "Driver import preview"} className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 rounded-lg border px-4 py-3 text-sm">
              <strong>{result.totalRows} {labels.rows}</strong>
              <Badge variant={result.errorRows ? "outline" : "secondary"} className={result.errorRows ? "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200" : ""}>{result.validRows} {labels.ready}</Badge>
              {result.errorRows > 0 && <Badge variant="destructive">{result.errorRows} {labels.errors}</Badge>}
              {result.committed && <Badge>{french ? `${result.createdCount} conducteurs importés` : `Imported ${result.createdCount} ${labels.imported}`}</Badge>}
              {result.totalRows === 0 && <span className="text-muted-foreground">{labels.none}</span>}
            </div>
            <div className="max-h-[360px] overflow-auto rounded-lg border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead className="w-14">{labels.row}</TableHead>
                    <TableHead>{labels.name}</TableHead>
                    <TableHead>{labels.licence}</TableHead>
                    <TableHead>{labels.birth}</TableHead>
                    <TableHead>{labels.address}</TableHead>
                    <TableHead>{labels.result}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.rows.map((row) => (
                    <TableRow key={row.rowNumber}>
                      <TableCell className="tabular-nums">{row.rowNumber}</TableCell>
                      <TableCell className="min-w-36 font-medium">{row.fullName || "—"}</TableCell>
                      <TableCell className="min-w-28 font-mono text-xs">{row.licenceNumber || "—"}</TableCell>
                      <TableCell className="min-w-28">{row.dateOfBirth || "—"}</TableCell>
                      <TableCell className="min-w-48">{[row.streetNumber, row.streetName, row.postalCode, row.city].filter(Boolean).join(" ") || "—"}</TableCell>
                      <TableCell className="min-w-56 text-sm">
                        {row.errors.length ? <ul className="list-disc space-y-1 pl-4 text-destructive">{row.errors.map((message, index) => <li key={`${index}:${message}`}>{localizeMessage(message)}</li>)}</ul> : <span className="text-muted-foreground">{labels.readyRow}</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>}
        </div>
        <DialogFooter className="shrink-0 border-t bg-muted/30 px-5 py-4 sm:px-7">
          <Button type="button" variant="outline" disabled={busy} onClick={() => { setOpen(false); reset(); }}>{labels.close}</Button>
          {result?.intent === "preview" && <Button type="button" disabled={busy || !result.canCommit} onClick={() => void runImport("commit")}>
            <Upload className="size-4" /> {busy ? labels.importing : french ? `Importer ${result.validRows} conducteurs` : `Import ${result.validRows} drivers`}
          </Button>}
          {!result && <Button type="button" disabled={busy || !file} onClick={() => void runImport("preview")}>
            {busy ? labels.check : labels.preview}
          </Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
