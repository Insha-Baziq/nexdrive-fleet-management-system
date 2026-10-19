"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PlatformHeader({
  title,
  description,
  backHref,
  backLabel = "All organizations",
  action,
}: {
  title: string;
  description: string;
  backHref?: string;
  backLabel?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {backHref ? (
          <Button nativeButton={false} render={<Link href={backHref} />} variant="ghost" size="sm" className="-ml-2 mb-2">
            <ArrowLeft data-icon="inline-start" />{backLabel}
          </Button>
        ) : null}
        <h1 className="break-words text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-2 self-start">{action}</div> : null}
    </header>
  );
}
