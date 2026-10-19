"use client";

import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/locale-provider";
import { TABLE_PAGE_SIZE } from "@/lib/pagination";

const frenchNouns: Record<string, string> = {
  anomaly: "anomalie", anomalies: "anomalies", claim: "sinistre", claims: "sinistres", assignment: "affectation", assignments: "affectations",
  contacts: "contacts", documents: "documents", driver: "conducteur", drivers: "conducteurs",
  fine: "amende", fines: "amendes", intervention: "intervention", interventions: "interventions", vehicle: "véhicule", vehicles: "véhicules",
  reading: "relevé", readings: "relevés", event: "événement", events: "événements", inspection: "contrôle", inspections: "contrôles",
};
const singularNouns: Record<string, string> = {
  anomalies: "anomalie", claims: "sinistre", assignments: "affectation", contacts: "contact",
  documents: "document", drivers: "conducteur", fines: "amende", interventions: "intervention",
  vehicles: "véhicule", readings: "relevé", events: "événement", inspections: "contrôle",
};
const englishSingularNouns: Record<string, string> = {
  anomalies: "anomaly", claims: "claim", assignments: "assignment", contacts: "contact",
  documents: "document", drivers: "driver", fines: "fine", interventions: "intervention",
  vehicles: "vehicle", readings: "reading", events: "event", inspections: "inspection",
};

export function DataTablePagination({ page, total, onPageChange, noun, pageSize = TABLE_PAGE_SIZE }: {
  page: number;
  total: number;
  onPageChange: (page: number) => void;
  noun?: string;
  pageSize?: number;
}) {
  const { locale } = useLocale();
  const french = locale === "fr";
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(Math.max(1, page), pageCount);
  const first = total ? (currentPage - 1) * pageSize + 1 : 0;
  const last = Math.min(currentPage * pageSize, total);
  const frenchNoun = noun ? (total === 1 ? singularNouns[noun] ?? frenchNouns[noun] ?? noun : frenchNouns[noun] ?? noun) : "";
  const englishNoun = noun ? (total === 1 ? englishSingularNouns[noun] ?? noun : noun) : "";

  return <div className="flex flex-col gap-3 border-t px-3 py-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-4 sm:py-4">
    <span aria-live="polite" className="text-center sm:text-left">{french ? `Affichage ${first}–${last} sur ${total}${frenchNoun ? ` ${frenchNoun}` : ""}` : `Showing ${first}–${last} of ${total}${englishNoun ? ` ${englishNoun}` : ""}`}</span>
    <nav aria-label={french ? "Pages du tableau" : "Table pages"} className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-start">
      <Button type="button" variant="outline" size="sm" className="min-w-20" disabled={currentPage === 1} onClick={() => onPageChange(currentPage - 1)}>{french ? "Précédent" : "Previous"}</Button>
      <span className="whitespace-nowrap text-center text-xs sm:text-sm">{french ? `Page ${currentPage} sur ${pageCount}` : `Page ${currentPage} of ${pageCount}`}</span>
      <Button type="button" variant="outline" size="sm" className="min-w-16" disabled={currentPage === pageCount} onClick={() => onPageChange(currentPage + 1)}>{french ? "Suivant" : "Next"}</Button>
    </nav>
  </div>;
}
