"use client";

import { useId, useState } from "react";
import { CarFront, UserRound } from "lucide-react";
import { AssignmentDialog } from "@/components/assignment-dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import type { Driver } from "@/lib/drivers";
import type { Vehicle } from "@/lib/vehicles";

export function AssignmentQuickPicker({ drivers, vehicles }: { drivers: Driver[]; vehicles: Vehicle[] }) {
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const driverInputId = useId();
  const vehicleInputId = useId();
  const selectedDriver = drivers.find((driver) => driver.id === selectedDriverId);
  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === selectedVehicleId);

  const driverOptions: SearchableSelectOption[] = drivers.map((driver) => ({
    value: driver.id,
    label: driver.full_name,
    description: driver.current_vehicle_registration
      ? `Currently assigned to ${driver.current_vehicle_registration}`
      : "No active vehicle",
    keywords: driver.current_vehicle_registration ?? "",
  }));
  const vehicleOptions: SearchableSelectOption[] = vehicles.map((vehicle) => {
    const model = [vehicle.make, vehicle.model].filter(Boolean).join(" ");
    const details = [model, vehicle.year].filter(Boolean).join(" · ");
    return {
      value: vehicle.id,
      label: vehicle.registration,
      description: [details, vehicle.current_driver_name ? `Current driver: ${vehicle.current_driver_name}` : "No active driver"]
        .filter(Boolean)
        .join(" · "),
      keywords: `${model} ${vehicle.year ?? ""} ${vehicle.current_driver_name ?? ""}`,
    };
  });

  return (
    <main className="mx-auto w-full max-w-[1440px] px-4 pb-12 pt-7 sm:px-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Quick assignment</h1>
        <p className="mt-1 text-sm text-muted-foreground">Choose a driver and vehicle. Previous allocations remain in the assignment journal.</p>
      </div>

      <Card className="w-full gap-0 py-0">
        <CardHeader className="border-b px-5 py-4">
          <CardTitle className="text-base">Choose assignment records</CardTitle>
          <CardDescription>Search by driver name, vehicle registration, make, or model.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 py-6 md:grid-cols-2">
          <div className="grid min-w-0 content-start gap-2">
            <div className="flex items-center gap-2">
              <UserRound aria-hidden="true" className="size-4 text-muted-foreground" />
              <Label htmlFor={driverInputId}>Driver</Label>
            </div>
            <SearchableSelect
              id={driverInputId}
              options={driverOptions}
              value={selectedDriverId}
              onValueChange={setSelectedDriverId}
              placeholder={drivers.length ? "Search drivers" : "No drivers available"}
              emptyMessage="No drivers match your search."
              disabled={!drivers.length}
            />
            {(selectedDriver || !drivers.length) && (
              <p className="text-xs leading-4 text-muted-foreground">
                {selectedDriver
                  ? selectedDriver.current_vehicle_registration
                    ? `Currently assigned to ${selectedDriver.current_vehicle_registration}`
                    : "No active vehicle"
                  : "Add a driver before creating an assignment."}
              </p>
            )}
          </div>

          <div className="grid min-w-0 content-start gap-2">
            <div className="flex items-center gap-2">
              <CarFront aria-hidden="true" className="size-4 text-muted-foreground" />
              <Label htmlFor={vehicleInputId}>Vehicle</Label>
            </div>
            <SearchableSelect
              id={vehicleInputId}
              options={vehicleOptions}
              value={selectedVehicleId}
              onValueChange={setSelectedVehicleId}
              placeholder={vehicles.length ? "Search vehicles" : "No vehicles available"}
              emptyMessage="No vehicles match your search."
              disabled={!vehicles.length}
            />
            {(selectedVehicle || !vehicles.length) && (
              <p className="text-xs leading-4 text-muted-foreground">
                {selectedVehicle
                  ? selectedVehicle.current_driver_name
                    ? `Current driver: ${selectedVehicle.current_driver_name}`
                    : "No active driver"
                  : "Add a vehicle before creating an assignment."}
              </p>
            )}
          </div>
        </CardContent>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4">
          <p className="text-sm text-muted-foreground">
            {!drivers.length || !vehicles.length
              ? "Both a driver and a vehicle are required."
              : selectedDriverId && selectedVehicleId
                ? "Set the start time and review current allocations in the next step."
                : "Select one driver and one vehicle to continue."}
          </p>
          <AssignmentDialog
            drivers={drivers}
            vehicles={vehicles}
            fixedDriverId={selectedDriverId || undefined}
            fixedVehicleId={selectedVehicleId || undefined}
            triggerLabel="Assign selected records"
            triggerDisabled={!selectedDriverId || !selectedVehicleId}
            onSuccess={() => { setSelectedDriverId(""); setSelectedVehicleId(""); }}
          />
        </div>
      </Card>
    </main>
  );
}
