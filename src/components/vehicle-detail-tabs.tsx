"use client";

import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocale } from "@/components/locale-provider";

export function VehicleDetailTabs({ overview, mileage, documents, insurance, inspections, maintenance, history, anomalies }: {
  overview: ReactNode;
  mileage: ReactNode;
  documents: ReactNode;
  insurance: ReactNode;
  inspections: ReactNode;
  maintenance: ReactNode;
  history: ReactNode;
  anomalies: ReactNode;
}) {
  const { locale } = useLocale();
  const labels = locale === "fr"
    ? ["Vue d’ensemble", "Kilométrage", "Documents", "Assurance", "Contrôles", "Entretien", "Historique", "Anomalies"]
    : ["Overview", "Mileage", "Documents", "Insurance", "Inspections", "Maintenance", "Assignment history", "Anomalies"];
  return (
    <Tabs defaultValue="overview" className="mt-8 w-full">
      <TabsList variant="line" className="nexdrive-overflow-tabs w-full justify-start gap-4 overflow-x-auto border-b px-0 sm:gap-5">
        <TabsTrigger value="overview" className="flex-none px-1">{labels[0]}</TabsTrigger>
        <TabsTrigger value="mileage" className="flex-none px-1">{labels[1]}</TabsTrigger>
        <TabsTrigger value="documents" className="flex-none px-1">{labels[2]}</TabsTrigger>
        <TabsTrigger value="insurance" className="flex-none px-1">{labels[3]}</TabsTrigger>
        <TabsTrigger value="inspections" className="flex-none px-1">{labels[4]}</TabsTrigger>
        <TabsTrigger value="maintenance" className="flex-none px-1">{labels[5]}</TabsTrigger>
        <TabsTrigger value="history" className="flex-none px-1">{labels[6]}</TabsTrigger>
        <TabsTrigger value="anomalies" className="flex-none px-1">{labels[7]}</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="pt-6">{overview}</TabsContent>
      <TabsContent value="mileage" className="pt-6">{mileage}</TabsContent>
      <TabsContent value="documents" className="pt-6">{documents}</TabsContent>
      <TabsContent value="insurance" className="pt-6">{insurance}</TabsContent>
      <TabsContent value="inspections" className="pt-6">{inspections}</TabsContent>
      <TabsContent value="maintenance" className="pt-6">{maintenance}</TabsContent>
      <TabsContent value="history" className="pt-6">{history}</TabsContent>
      <TabsContent value="anomalies" className="pt-6">{anomalies}</TabsContent>
    </Tabs>
  );
}
