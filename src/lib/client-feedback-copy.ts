export type ClientLocale = "fr" | "en";

export type VehicleDocumentCategory = "registration" | "inspection" | "insurance" | "rental_agreement" | "other";
export type VehicleInsuranceStatus = "to_complete" | "insured" | "suspended" | "unpaid";
export type InsuranceEventType = "insured" | "suspension" | "unpaid";
export type FineStatus = "open" | "closed" | "cancelled";
export type FineVehicleOption = { registration: string; make: string; model: string };

const documentCategoryLabels: Record<ClientLocale, Record<VehicleDocumentCategory, string>> = {
  fr: { registration: "Immatriculation", inspection: "Contrôle technique", insurance: "Assurance", rental_agreement: "Contrat de location", other: "Autre" },
  en: { registration: "Registration", inspection: "Inspection", insurance: "Insurance", rental_agreement: "Rental agreement", other: "Other" },
};

export function vehicleDocumentCategoryLabel(category: VehicleDocumentCategory, locale: ClientLocale) {
  return documentCategoryLabels[locale][category];
}

const insuranceStatusLabels: Record<ClientLocale, Record<VehicleInsuranceStatus, string>> = {
  fr: { to_complete: "À compléter", insured: "Assuré", suspended: "Suspendu", unpaid: "Impayé" },
  en: { to_complete: "To complete", insured: "Insured", suspended: "Suspended", unpaid: "Unpaid" },
};

export function vehicleInsuranceStatusLabel(status: VehicleInsuranceStatus, locale: ClientLocale) {
  return insuranceStatusLabels[locale][status];
}

const insuranceEventLabels: Record<ClientLocale, Record<InsuranceEventType, string>> = {
  fr: { insured: "Assuré", suspension: "Suspension", unpaid: "Impayé" },
  en: { insured: "Insured", suspension: "Suspension", unpaid: "Unpaid" },
};

export function insuranceEventTypeLabel(type: InsuranceEventType, locale: ClientLocale) {
  return insuranceEventLabels[locale][type];
}

const fineStatusLabels: Record<ClientLocale, Record<FineStatus, string>> = {
  fr: { open: "Ouverte", closed: "Clôturée", cancelled: "Annulée" },
  en: { open: "Open", closed: "Closed", cancelled: "Cancelled" },
};

export function fineStatusLabel(status: FineStatus, locale: ClientLocale) {
  return fineStatusLabels[locale][status];
}

export function fineVehicleOptionLabel(vehicle: FineVehicleOption) {
  return `${vehicle.registration} · ${vehicle.make} ${vehicle.model}`;
}

export const vehicleDocumentUploadCopy = {
  fr: {
    fileLabel: "Fichier", chooseFile: "Choisir un fichier", noFile: "Aucun fichier sélectionné", fileHelp: "PDF, PNG, JPG, JPEG ou DOCX · 15 Mo maximum",
    errors: {
      prepare: "Échec de la préparation de l’envoi. Vérifiez les informations du document, puis réessayez.",
      storage: "Échec de l’envoi au stockage privé. Vérifiez votre connexion, puis réessayez.",
      verify: "Le fichier a été envoyé, mais sa vérification dans le stockage privé a échoué. Réessayez.",
      chooseFile: "Choisissez un fichier à envoyer.",
    },
  },
  en: {
    fileLabel: "File", chooseFile: "Choose a file", noFile: "No file selected", fileHelp: "PDF, PNG, JPG, JPEG, or DOCX · maximum 15 MB",
    errors: {
      prepare: "Could not prepare the upload. Check the document details and try again.",
      storage: "The private storage upload failed. Check your connection and try again.",
      verify: "The file was sent, but could not be verified in private storage. Please try again.",
      chooseFile: "Choose a file to upload.",
    },
  },
} as const;

export const fineEvidenceCopy = {
  fr: { chooseFile: "Choisir un fichier", noFile: "Aucun fichier sélectionné", requiredFile: "Choisissez un justificatif.", fileHelp: "PDF, PNG, JPG, JPEG ou DOCX · 15 Mo maximum. Stocké de façon privée." },
  en: { chooseFile: "Choose a file", noFile: "No file selected", requiredFile: "Choose an evidence file.", fileHelp: "PDF, PNG, JPG, JPEG, or DOCX · up to 15 MB. Stored privately." },
} as const;

export const claimStageEvidenceCopy = {
  fr: { chooseFile: "Choisir un fichier", noFile: "Aucun fichier sélectionné", fileHelp: "PDF, PNG, JPG, JPEG ou DOCX · 15 Mo maximum" },
  en: { chooseFile: "Choose a file", noFile: "No file selected", fileHelp: "PDF, PNG, JPG, JPEG, or DOCX · 15 MB maximum" },
} as const;

export const claimCreateEvidenceCopy = {
  fr: { chooseFile: "Choisir un fichier", noFile: "Aucun fichier sélectionné", requiredFile: "Choisissez un justificatif initial.", fileHelp: "PDF, PNG, JPG, JPEG ou DOCX · 15 Mo maximum. Stocké de façon privée." },
  en: { chooseFile: "Choose a file", noFile: "No file selected", requiredFile: "Choose initial evidence.", fileHelp: "PDF, PNG, JPG, JPEG, or DOCX · up to 15 MB. Stored privately." },
} as const;

export const maintenanceInvoiceCopy = {
  fr: { chooseFile: "Choisir un fichier", noFile: "Aucun fichier sélectionné", fileHelp: "PDF, PNG, JPG, JPEG ou DOCX · 15 Mo maximum" },
  en: { chooseFile: "Choose a file", noFile: "No file selected", fileHelp: "PDF, PNG, JPG, JPEG, or DOCX · maximum 15 MB" },
} as const;

export const companyPaidEvidenceCopy = {
  fr: { chooseFile: "Choisir un fichier", noFile: "Aucun fichier sélectionné", requiredFile: "Choisissez un justificatif.", fileHelp: "PDF, PNG, JPG, JPEG ou DOCX · 15 Mo maximum" },
  en: { chooseFile: "Choose a file", noFile: "No file selected", requiredFile: "Choose a proof file.", fileHelp: "PDF, PNG, JPG, JPEG, or DOCX · 15 MB maximum" },
} as const;
