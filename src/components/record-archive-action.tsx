"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, RotateCcw } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";

type Props = {
  kind: "vehicle" | "driver";
  id: string;
  name: string;
  archived: boolean;
  compact?: boolean;
};

export function RecordArchiveAction({ kind, id, name, archived, compact = false }: Props) {
  const router = useRouter();
  const { locale } = useLocale();
  const french = locale === "fr";
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const noun = kind === "vehicle" ? "vehicle" : "driver";
  const localizedNoun = kind === "vehicle" ? "véhicule" : "conducteur";
  const restoreNotice = kind === "driver"
    ? french
      ? "Son historique et ses documents seront conservés. Un administrateur, un responsable de flotte ou un gestionnaire pourra le restaurer."
      : "Its history and documents will be kept, and an Administrator, Fleet Manager, or Manager can restore it."
    : french
      ? "Son historique et ses documents seront conservés. Un administrateur ou un responsable de flotte pourra le restaurer."
      : "Its history and documents will be kept, and an Administrator or Fleet Manager can restore it.";
  const failure = french
    ? `Impossible de ${archived ? "restaurer" : "archiver"} ce ${localizedNoun}.`
    : `Could not ${archived ? "restore" : "archive"} this ${noun}.`;

  async function transition() {
    setError("");
    setPending(true);
    try {
      const response = await fetch(`/api/${kind === "vehicle" ? "vehicles" : "drivers"}/${id}/${archived ? "restore" : "archive"}`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(french ? failure : (data.error || failure));
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : failure);
    } finally {
      setPending(false);
    }
  }

  return <span className="inline-flex flex-col items-end gap-1">
    <Button type="button" variant={archived ? "outline" : "ghost"} size={compact ? "icon" : "sm"} disabled={pending}
      aria-label={french ? `${archived ? "Restaurer" : "Archiver"} ${localizedNoun} ${name}` : `${archived ? "Restore" : "Archive"} ${noun} ${name}`}
      title={french ? `${archived ? "Restaurer" : "Archiver"} ${localizedNoun}` : `${archived ? "Restore" : "Archive"} ${noun}`}
      onClick={() => {
        if (!archived && !window.confirm(french
          ? `Archiver le ${localizedNoun} « ${name} » ? ${restoreNotice}`
          : `Archive ${noun} “${name}”? ${restoreNotice}`)) return;
        void transition();
      }}>
      {archived ? <RotateCcw /> : <Archive />}
      {!compact && (french ? (archived ? "Restaurer" : "Archiver") : (archived ? "Restore" : "Archive"))}
    </Button>
    {error && <span role="alert" className="max-w-56 text-right text-xs text-destructive">{error}</span>}
  </span>;
}
