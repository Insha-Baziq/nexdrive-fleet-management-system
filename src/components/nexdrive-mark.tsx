import { cn } from "@/lib/utils";

export function NexDriveMark({
  className,
  light = false,
}: {
  className?: string;
  light?: boolean;
}) {
  return (
    <div className={cn("inline-flex items-center gap-3", className)}>
      <svg
        aria-hidden="true"
        className={cn("size-8 shrink-0", light ? "text-emerald-300" : "text-primary")}
        viewBox="0 0 38 38"
        fill="none"
      >
        <path d="M7 29 18 9h8L15 29H7Z" fill="currentColor" />
        <path d="M19 29 30 9h5L24 29h-5Z" fill="currentColor" opacity=".75" />
      </svg>
      <span
        className={cn(
          "text-[1.6rem] font-bold tracking-[-0.055em]",
          light ? "text-white" : "text-foreground",
        )}
      >
        NexDrive
      </span>
    </div>
  );
}
