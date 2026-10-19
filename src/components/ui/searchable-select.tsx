"use client";

import { useId } from "react";
import { Combobox } from "@base-ui/react/combobox";
import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "cn";

export type SearchableSelectOption = {
  value: string;
  label: string;
  description?: string;
  keywords?: string;
  disabled?: boolean;
};

type SearchableSelectProps = {
  id?: string;
  options: SearchableSelectOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  emptyMessage: string;
  disabled?: boolean;
  className?: string;
};

export function SearchableSelect({
  id,
  options,
  value,
  onValueChange,
  placeholder,
  emptyMessage,
  disabled = false,
  className,
}: SearchableSelectProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const values = options.map((option) => option.value);
  const findOption = (optionValue: string) => options.find((option) => option.value === optionValue);

  return (
    <Combobox.Root
      items={values}
      value={value || null}
      autoHighlight
      onValueChange={(optionValue) => onValueChange(optionValue ?? "")}
      itemToStringLabel={(optionValue: string) => findOption(optionValue)?.label ?? ""}
      filter={(optionValue, query) => {
        const option = findOption(optionValue);
        if (!option) return false;
        const normalizedQuery = query.trim().toLocaleLowerCase();
        if (!normalizedQuery) return true;
        return `${option.label} ${option.description ?? ""} ${option.keywords ?? ""}`
          .toLocaleLowerCase()
          .includes(normalizedQuery);
      }}
      disabled={disabled}
    >
      <Combobox.InputGroup
        className={cn(
          "relative flex h-10 w-full min-w-0 items-center rounded-md border border-input bg-background transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 data-disabled:cursor-not-allowed data-disabled:opacity-50",
          className,
        )}
      >
        <Combobox.Input
          id={inputId}
          placeholder={placeholder}
          className="h-full min-w-0 flex-1 rounded-md border-0 bg-transparent px-3 pr-16 text-sm leading-none outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        />
        <span className="absolute right-1 flex h-full items-center gap-0.5 text-muted-foreground">
          <Combobox.Clear className="flex size-8 items-center justify-center rounded-md outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring data-[disabled]:pointer-events-none data-[disabled]:opacity-50" aria-label="Clear selection">
            <X className="size-4" />
          </Combobox.Clear>
          <Combobox.Trigger className="flex size-8 items-center justify-center rounded-md outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring data-[disabled]:pointer-events-none data-[disabled]:opacity-50" aria-label="Show options">
            <ChevronDown className="size-4" />
          </Combobox.Trigger>
        </span>
      </Combobox.InputGroup>

      <Combobox.Portal>
        <Combobox.Positioner className="isolate z-50 outline-none" sideOffset={4}>
          <Combobox.Popup className="w-(--anchor-width) max-w-(--available-width) overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            <Combobox.Empty className="px-3 py-3 text-sm text-muted-foreground">
              {emptyMessage}
            </Combobox.Empty>
            <Combobox.List className="max-h-[min(22rem,var(--available-height))] overflow-y-auto overscroll-contain p-1 outline-none">
              {(optionValue: string) => {
                const option = findOption(optionValue);
                if (!option) return null;
                return (
                  <Combobox.Item
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                    className="group relative flex w-full cursor-default items-center justify-between gap-3 rounded-md px-3 py-2 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium leading-5">{option.label}</span>
                      {option.description && <span className="block truncate text-xs leading-4 text-muted-foreground group-data-highlighted:text-accent-foreground/75">{option.description}</span>}
                    </span>
                    <Combobox.ItemIndicator className="flex size-4 shrink-0 items-center justify-center text-primary">
                      <Check className="size-4" />
                    </Combobox.ItemIndicator>
                  </Combobox.Item>
                );
              }}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
