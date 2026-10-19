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
  registration: string;
  make: string;
  model: string;
  year: string;
  ownershipType: string;
  registeredHolder: string;
  insuranceCompany: string;
  insuranceExpiryDate: string;
  technicalInspectionDate: string;
  errors: string[];
  emissionsDueDate: string | null;
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

export function VehicleImportDialog() {
  const router = useRouter();
  const { locale } = useLocale();
  const french = locale === "fr";
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const labels = french ? {
    title: "Importer des véhicules",
    description: "Importez un fichier CSV ou un classeur Excel pour vérifier les lignes avant de les enregistrer.",
    policy: "L’import crée uniquement de nouveaux véhicules. Les immatriculations sont comparées dans cette organisation après suppression des espaces et tirets et sans tenir compte de la casse. Si une ligne est invalide ou en doublon, tout l’import est bloqué. Les contrôles techniques importés sont ajoutés à l’historique comme échéances enregistrées par votre compte.",
    ownershipHelp: "Type de propriété : owned (propriété), long_term_rental (location longue durée), short_term_rental (location courte durée) ou loan (prêt). Si le véhicule n’appartient pas à votre organisation, indiquez le titulaire de la carte grise.",
    dateFormat: "Saisissez les dates au format AAAA-MM-JJ.",
    cap: "Maximum : 500 véhicules et 5 Mo par fichier.", csv: "Modèle CSV", excel: "Modèle Excel", file: "Fichier d’import",
    rows: "lignes", ready: "prêtes", errors: "avec des erreurs", noRows: "Aucune ligne de véhicule trouvée.",
    row: "Ligne", registration: "Immatriculation", vehicle: "Véhicule", ownership: "Propriété / titulaire", insurance: "Assurance",
    inspection: "Contrôles", result: "Résultat", readyRow: "Prête", close: "Fermer", importing: "Importation…",
    checking: "Vérification…", preview: "Vérifier l’import", noAccount: "Aucun compte utilisateur n’est créé.",
  } : {
    title: "Import vehicles",
    description: "Upload a CSV or Excel workbook to review vehicle rows before saving them.",
    policy: "Imports create new vehicles only. Registrations are matched within this organization after removing spaces and hyphens and ignoring letter case. If any row is invalid or duplicated, the whole import is blocked. Imported inspections are added to history as due dates recorded by your account.",
    ownershipHelp: "Ownership type: owned, long_term_rental, short_term_rental, or loan. Provide the registered holder whenever the vehicle is not owned by your organization.",
    dateFormat: "Enter dates in YYYY-MM-DD format.",
    cap: "Maximum 500 vehicle rows and 5 MB per file.", csv: "CSV template", excel: "Excel template", file: "Import file",
    rows: "rows", ready: "ready", errors: "with errors", noRows: "No vehicle rows found.",
    row: "Row", registration: "Registration", vehicle: "Vehicle", ownership: "Ownership / holder", insurance: "Insurance",
    inspection: "Inspections", result: "Result", readyRow: "Ready", close: "Close", importing: "Importing…",
    checking: "Checking…", preview: "Preview import", noAccount: "No user account is created.",
  };

  function formatOwnership(value: string) {
    const names = french ? {
      owned: "Propriété",
      long_term_rental: "Location longue durée",
      short_term_rental: "Location courte durée",
      loan: "Prêt",
    } : {
      owned: "Owned",
      long_term_rental: "Long-term rental",
      short_term_rental: "Short-term rental",
      loan: "Loan",
    };
    return names[value as keyof typeof names] ?? value;
  }

  function localizeMessage(message: string) {
    if (!french) {
      const englishFromValidation: Record<string, string> = {
        "Indiquez le titulaire de la carte grise.": "Enter the registered holder.",
        "Choisissez le type de propriété ou d'utilisation du véhicule.": "Choose the vehicle ownership or use type.",
        "Utilisez 160 caractères ou moins.": "Use 160 characters or fewer.",
      };
      return englishFromValidation[message] ?? message;
    }
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
      "The import file needs a header row and at least one vehicle row.": "Le fichier doit contenir une ligne d’en-têtes et au moins une ligne de véhicule.",
      "Only administrators can import vehicles.": "Seuls les administrateurs peuvent importer des véhicules.",
      "Unauthorized.": "Vous n’êtes pas authentifié.",
      "Submit one CSV or .xlsx file.": "Envoyez un seul fichier CSV ou .xlsx.",
      "Submit one intent and one import file.": "Envoyez une seule action et un seul fichier d’import.",
      "Choose preview or commit.": "Choisissez l’aperçu ou l’import.",
      "Choose the CSV or .xlsx file.": "Choisissez un fichier CSV ou .xlsx.",
      "Formulas are not supported; enter a value instead.": "Les formules ne sont pas prises en charge ; saisissez une valeur.",
      "This row contains data outside the provided columns.": "Cette ligne contient des données en dehors des colonnes prévues.",
      "A technical inspection due date is required when an emissions due date is provided.": "L’échéance du contrôle technique est obligatoire si une échéance antipollution est indiquée.",
      "Enter a valid date.": "Saisissez une date valide.",
      "Enter a valid vehicle year.": "Saisissez une année de véhicule valide.",
      "Enter a value from 0 to 999.99 with up to two decimals.": "Saisissez une valeur comprise entre 0 et 999,99 avec au plus deux décimales.",
      "Enter a valid emissions inspection date.": "Saisissez une échéance antipollution valide.",
      "Indiquez le titulaire de la carte grise.": "Indiquez le titulaire de la carte grise.",
      "Choisissez le type de propriété ou d'utilisation du véhicule.": "Choisissez le type de propriété ou d’utilisation du véhicule.",
      "Registration already exists in this organization.": "Cette immatriculation existe déjà dans cette organisation.",
    };
    if (exact[message]) return exact[message];
    let match = message.match(/^Enter a registration \(up to (\d+) characters\)\.$/);
    if (match) return `Saisissez une immatriculation (au plus ${match[1]} caractères).`;
    match = message.match(/^Use (\d+) characters or fewer\.$/);
    if (match) return `Utilisez au plus ${match[1]} caractères.`;
    match = message.match(/^Registration duplicates row (\d+) in this file\.$/);
    if (match) return `Cette immatriculation est identique à celle de la ligne ${match[1]} de ce fichier.`;
    match = message.match(/^A file can contain at most (\d+) vehicle rows\.$/);
    if (match) return `Un fichier peut contenir au plus ${match[1]} lignes de véhicules.`;
    match = message.match(/^Unsupported column “(.+)”\. Use the provided vehicle template\.$/);
    if (match) return `Colonne non reconnue « ${match[1]} ». Utilisez le modèle de véhicules fourni.`;
    match = message.match(/^Column “(.+)” appears more than once\.$/);
    if (match) return `La colonne « ${match[1]} » apparaît plusieurs fois.`;
    match = message.match(/^Missing required columns: (.+)\.$/);
    if (match) {
      const frenchColumns: Record<string, string> = {
        registration: "immatriculation",
        ownershipType: "type de propriété",
      };
      return `Colonnes obligatoires manquantes : ${match[1].split(", ").map((column) => frenchColumns[column] ?? column).join(", ")}.`;
    }
    return "Une erreur de validation est survenue. Vérifiez les valeurs et réessayez.";
  }

  function reset() {
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";
    setResult(null);
    setBusy(false);
    setError("");
  }

  async function runImport(intent: "preview" | "commit") {
    if (!file) {
      setError(localizeMessage("Choose a CSV or Excel file first."));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("intent", intent);
      form.append("file", file);
      const response = await fetch("/api/vehicles/import", { method: "POST", body: form });
      const payload = await response.json();
      if (response.status === 409 && payload && Array.isArray(payload.rows)) {
        setResult(payload as ImportResult);
        setError(french
          ? "L’import a été interrompu : une immatriculation existe déjà ou une ligne contient une erreur. Aucun véhicule n’a été ajouté."
          : "The import stopped because a registration now exists or a row has an error. No vehicles were added.");
        return;
      }
      if (!response.ok) throw new Error(localizeMessage(payload.error || "Could not process this import file."));
      setResult(payload as ImportResult);
      if (intent === "commit" && payload.committed) router.refresh();
    } catch (cause) {
      setError(localizeMessage(cause instanceof Error ? cause.message : "Could not process this import file."));
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next && !busy) reset(); }}>
      <DialogTrigger render={<Button variant="outline" size="sm"><FileSpreadsheet className="size-4" /> {labels.title}</Button>} />
      <DialogContent className="flex max-h-[min(90dvh,850px)] max-w-[calc(100%-1.5rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1040px]">
        <DialogHeader className="shrink-0 border-b px-5 py-5 sm:px-7">
          <DialogTitle className="text-xl">{labels.title}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5 sm:px-7">
          <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
            <p>{labels.policy}</p>
            <p className="mt-2">{labels.ownershipHelp}</p>
            <p className="mt-2">{labels.dateFormat}</p>
            <p className="mt-2">{labels.cap} {labels.noAccount}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" nativeButton={false} render={<a href={`/api/vehicles/import?format=csv&locale=${locale}`} download />}><Download className="size-4" /> {labels.csv}</Button>
              <Button variant="outline" size="sm" nativeButton={false} render={<a href={`/api/vehicles/import?format=xlsx&locale=${locale}`} download />}><Download className="size-4" /> {labels.excel}</Button>
            </div>
          </div>
          <div className="space-y-2">
            <label htmlFor="vehicle-import-file" className="text-sm font-medium">{labels.file}</label>
            <input ref={fileInput} id="vehicle-import-file" type="file" accept=".csv,.xlsx" disabled={busy} className="sr-only" tabIndex={-1} onChange={(event) => {
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
          {result && <section aria-live="polite" aria-label={french ? "Aperçu de l’import des véhicules" : "Vehicle import preview"} className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 rounded-lg border px-4 py-3 text-sm">
              <strong>{result.totalRows} {labels.rows}</strong>
              <Badge variant={result.errorRows ? "outline" : "secondary"} className={result.errorRows ? "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200" : ""}>{result.validRows} {labels.ready}</Badge>
              {result.errorRows > 0 && <Badge variant="destructive">{result.errorRows} {labels.errors}</Badge>}
              {result.committed && <Badge>{french ? `${result.createdCount} véhicules importés` : `Imported ${result.createdCount} vehicles`}</Badge>}
              {result.totalRows === 0 && <span className="text-muted-foreground">{labels.noRows}</span>}
            </div>
            <div className="max-h-[360px] overflow-auto rounded-lg border">
              <Table className="min-w-[900px]">
                <TableHeader className="sticky top-0 z-10 bg-background"><TableRow>
                  <TableHead className="w-14">{labels.row}</TableHead><TableHead>{labels.registration}</TableHead><TableHead>{labels.vehicle}</TableHead>
                  <TableHead>{labels.ownership}</TableHead><TableHead>{labels.insurance}</TableHead><TableHead>{labels.inspection}</TableHead><TableHead>{labels.result}</TableHead>
                </TableRow></TableHeader>
                <TableBody>{result.rows.map((row) => <TableRow key={row.rowNumber}>
                  <TableCell className="tabular-nums">{row.rowNumber}</TableCell>
                  <TableCell className="min-w-32 font-mono text-xs">{row.registration || "—"}</TableCell>
                  <TableCell className="min-w-36">{[row.make, row.model, row.year].filter(Boolean).join(" ") || "—"}</TableCell>
                  <TableCell className="min-w-36">{[formatOwnership(row.ownershipType), row.registeredHolder].filter(Boolean).join(" · ") || "—"}</TableCell>
                  <TableCell className="min-w-40">{[row.insuranceCompany, row.insuranceExpiryDate].filter(Boolean).join(" · ") || "—"}</TableCell>
                  <TableCell className="min-w-40">{[row.technicalInspectionDate, row.emissionsDueDate].filter(Boolean).join(" · ") || "—"}</TableCell>
                  <TableCell className="min-w-56 text-sm">{row.errors.length
                    ? <ul className="list-disc space-y-1 pl-4 text-destructive">{row.errors.map((message, index) => <li key={`${index}:${message}`}>{localizeMessage(message)}</li>)}</ul>
                    : <span className="text-muted-foreground">{labels.readyRow}</span>}</TableCell>
                </TableRow>)}</TableBody>
              </Table>
            </div>
          </section>}
        </div>
        <DialogFooter className="shrink-0 border-t bg-muted/30 px-5 py-4 sm:px-7">
          <Button type="button" variant="outline" disabled={busy} onClick={() => { setOpen(false); reset(); }}>{labels.close}</Button>
          {result?.intent === "preview" && <Button type="button" disabled={busy || !result.canCommit} onClick={() => void runImport("commit")}>
            <Upload className="size-4" /> {busy ? labels.importing : french ? `Importer ${result.validRows} véhicules` : `Import ${result.validRows} vehicles`}
          </Button>}
          {!result && <Button type="button" disabled={busy || !file} onClick={() => void runImport("preview")}>
            {busy ? labels.checking : labels.preview}
          </Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
