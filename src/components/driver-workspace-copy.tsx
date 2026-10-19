"use client";

import { useLocale } from "@/components/locale-provider";

const copy = {
  workspaceLabel: { en: "Driver workspace", fr: "Espace conducteur" },
  documentsTitle: { en: "My Documents", fr: "Mes documents" },
  documentsDescription: {
    en: "Your administrative documents attached to your Driver record.",
    fr: "Vos documents administratifs associés à votre dossier conducteur.",
  },
  vehicleTitle: { en: "My Vehicle", fr: "Mon véhicule" },
  vehicleDescription: {
    en: "Your currently assigned vehicle and its basic details.",
    fr: "Votre véhicule actuel et ses informations principales.",
  },
  registration: { en: "Registration", fr: "Immatriculation" },
  vehicle: { en: "Vehicle", fr: "Véhicule" },
  currentMileage: { en: "Current mileage", fr: "Kilométrage actuel" },
  notRecorded: { en: "Not recorded", fr: "Non renseigné" },
  assignedVehicle: { en: "Assigned vehicle", fr: "Véhicule attribué" },
  noAssignedVehicle: { en: "No vehicle is currently assigned", fr: "Aucun véhicule n’est actuellement attribué" },
  setupIncomplete: { en: "Your driver setup is not complete", fr: "Votre dossier conducteur n’est pas complet" },
  vehicleWillAppear: { en: "A vehicle assigned to you will appear here.", fr: "Un véhicule qui vous sera attribué apparaîtra ici." },
  accountNotLinked: {
    en: "Your account is not linked to a driver record yet. Ask your organization administrator to complete your setup.",
    fr: "Votre compte n’est pas encore associé à un dossier conducteur. Demandez à l’administrateur de votre organisation de terminer la configuration.",
  },
} as const;

export type DriverWorkspaceCopyKey = keyof typeof copy;

export function DriverWorkspaceCopy({ id }: { id: DriverWorkspaceCopyKey }) {
  const { locale } = useLocale();
  return copy[id][locale === "fr" ? "fr" : "en"];
}

export function DriverWorkspaceMileage({ mileage }: { mileage: number | null }) {
  const { locale } = useLocale();
  if (mileage === null) return copy.notRecorded[locale === "fr" ? "fr" : "en"];
  return `${new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en").format(mileage)} km`;
}
