"use client";

import { useState } from "react";
import { useLocale } from "@/components/locale-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DataTablePagination } from "@/components/data-table-pagination";
import { TABLE_PAGE_SIZE } from "@/lib/pagination";

export type DriverPaperworkItem = {
  id: string;
  name: string;
  category: string;
  expiry_date: string | null;
  file_name: string;
  open_url: string;
};

function formatCategory(category: string, french: boolean) {
  const labels: Record<string, string> = french ? {
    driving_licence: "Permis de conduire",
    identity_document: "Pièce d’identité / titre de séjour",
    carte_vitale: "Carte Vitale",
    contract: "Contrat",
    registration: "Immatriculation",
    inspection: "Contrôle technique",
    insurance: "Assurance",
    other: "Autre",
  } : {
    driving_licence: "Driving licence",
    identity_document: "Identity document",
    carte_vitale: "Carte Vitale",
    contract: "Contract",
    registration: "Registration",
    inspection: "Inspection",
    insurance: "Insurance",
    other: "Other",
  };
  return labels[category] ?? (french ? "Document" : "Document");
}

function formatExpiry(date: string | null, french: boolean) {
  if (!date) return french ? "Sans date d’expiration" : "No expiry";
  const value = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(value.getTime())) return "—";
  return new Intl.DateTimeFormat(french ? "fr-FR" : "en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
}

function expiryStatus(category: string, date: string | null, french: boolean) {
  if (!date && (category === "driving_licence" || category === "identity_document")) {
    return { label: french ? "Date d’expiration requise" : "Expiry date needed", expired: false, incomplete: true };
  }
  if (!date) return { label: french ? "Sans date d’expiration" : "No expiry", expired: false, incomplete: false };
  const today = new Date().toISOString().slice(0, 10);
  return date < today
    ? { label: french ? "Expiré" : "Expired", expired: true, incomplete: false }
    : { label: french ? "Valide" : "Current", expired: false, incomplete: false };
}

export function DriverPaperworkList({
  title,
  description,
  documents,
  emptyMessage,
}: {
  title: string;
  description: string;
  documents: DriverPaperworkItem[];
  emptyMessage: string;
}) {
  const { locale } = useLocale();
  const french = locale === "fr";
  const translatedProps: Record<string, string> = french ? {
    "Personal documents": "Documents personnels",
    "Administrative documents attached to your Driver record.": "Documents administratifs associés à votre dossier conducteur.",
    "No administrative documents have been added to your record.": "Aucun document administratif n’a été ajouté à votre dossier.",
    "Your account is not linked to a Driver record yet. Ask your organization administrator to complete your setup.": "Votre compte n’est pas encore associé à un dossier conducteur. Demandez à l’administrateur de votre organisation de terminer la configuration.",
    "Vehicle documents": "Documents du véhicule",
    "Paperwork shared with you for your currently assigned vehicle.": "Documents partagés avec vous pour le véhicule qui vous est actuellement attribué.",
    "No vehicle documents have been shared with you.": "Aucun document de véhicule n’a été partagé avec vous.",
    "Vehicle documents appear here only while a vehicle is assigned to you.": "Les documents du véhicule apparaissent ici uniquement lorsqu’un véhicule vous est attribué.",
  } : {};
  const visibleTitle = translatedProps[title] ?? title;
  const visibleDescription = translatedProps[description] ?? description;
  const visibleEmptyMessage = translatedProps[emptyMessage] ?? emptyMessage;
  const [page, setPage] = useState(1);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(documents.length / TABLE_PAGE_SIZE)));
  const visibleDocuments = documents.slice((currentPage - 1) * TABLE_PAGE_SIZE, currentPage * TABLE_PAGE_SIZE);
  return (
    <section className="mt-8 max-w-5xl" aria-labelledby="paperwork-title">
      <div className="mb-3">
        <h2 id="paperwork-title" className="text-lg font-semibold tracking-tight text-foreground">{visibleTitle}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{visibleDescription}</p>
      </div>

      <Card>
        {documents.length === 0 ? (
          <CardContent className="p-0">
            <Empty className="min-h-40 border-0">
              <EmptyHeader>
                <EmptyTitle>{french ? "Aucun document disponible" : "No documents available"}</EmptyTitle>
                <EmptyDescription>{visibleEmptyMessage}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </CardContent>
        ) : (
          <CardContent className="p-0">
            <div className="hidden overflow-x-auto lg:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{french ? "Nom" : "Name"}</TableHead>
                    <TableHead>{french ? "Catégorie" : "Category"}</TableHead>
                    <TableHead>{french ? "Expiration" : "Expiry"}</TableHead>
                    <TableHead>{french ? "État" : "Status"}</TableHead>
                    <TableHead className="w-24 text-right">{french ? "Fichier" : "File"}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleDocuments.map((document) => {
                    const status = expiryStatus(document.category, document.expiry_date, french);
                    return (
                      <TableRow key={document.id}>
                        <TableCell>
                          <p className="font-medium text-foreground">{document.name}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{document.file_name}</p>
                        </TableCell>
                        <TableCell>{formatCategory(document.category, french)}</TableCell>
                        <TableCell>{formatExpiry(document.expiry_date, french)}</TableCell>
                        <TableCell>
                          <Badge variant={status.expired ? "destructive" : status.incomplete ? "outline" : "secondary"} className={status.incomplete ? "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200" : undefined}>{status.label}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            render={<a href={document.open_url} target="_blank" rel="noopener noreferrer" />}
                          >
                            {french ? "Ouvrir" : "Open"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <ul className="divide-y lg:hidden">
              {visibleDocuments.map((document) => {
                const status = expiryStatus(document.category, document.expiry_date, french);
                return (
                  <li key={document.id} className="min-w-0 p-4">
                    <div className="min-w-0">
                      <p className="break-words font-semibold text-foreground">{document.name}</p>
                      <p className="mt-1 break-all text-xs text-muted-foreground">{document.file_name}</p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {formatCategory(document.category, french)} · {formatExpiry(document.expiry_date, french)}
                      </p>
                      <Badge className={`mt-2 ${status.incomplete ? "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200" : ""}`} variant={status.expired ? "destructive" : status.incomplete ? "outline" : "secondary"}>{status.label}</Badge>
                    </div>
                    <Button
                      className="mt-3"
                      variant="outline"
                      size="sm"
                      render={<a href={document.open_url} target="_blank" rel="noopener noreferrer" />}
                    >
                      {french ? "Ouvrir" : "Open"}
                    </Button>
                  </li>
                );
              })}
            </ul>
            <DataTablePagination page={currentPage} total={documents.length} noun="documents" onPageChange={setPage} />
          </CardContent>
        )}
      </Card>
    </section>
  );
}
