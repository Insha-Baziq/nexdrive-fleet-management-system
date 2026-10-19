"use client";

import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocale } from "@/components/locale-provider";

export function DriverDetailTabs({ overview, documents }: { overview: ReactNode; documents: ReactNode }) {
  const { locale } = useLocale();
  return (
    <Tabs defaultValue="overview" className="mt-8 w-full">
      <TabsList variant="line" className="w-full justify-start gap-5 border-b px-0">
        <TabsTrigger value="overview" className="flex-none px-1">{locale === "fr" ? "Vue d’ensemble" : "Overview"}</TabsTrigger>
        <TabsTrigger value="documents" className="flex-none px-1">{locale === "fr" ? "Documents" : "Documents"}</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="pt-6">{overview}</TabsContent>
      <TabsContent value="documents" className="pt-6">{documents}</TabsContent>
    </Tabs>
  );
}
