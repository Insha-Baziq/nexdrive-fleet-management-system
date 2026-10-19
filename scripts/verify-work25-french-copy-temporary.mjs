import assert from "node:assert/strict";
import {
  claimStageEvidenceCopy,
  companyPaidEvidenceCopy,
  fineEvidenceCopy,
  fineStatusLabel,
  fineVehicleOptionLabel,
  insuranceEventTypeLabel,
  maintenanceInvoiceCopy,
  vehicleDocumentCategoryLabel,
  vehicleDocumentUploadCopy,
  vehicleInsuranceStatusLabel,
} from "../src/lib/client-feedback-copy.ts";

assert.equal(vehicleDocumentCategoryLabel("registration", "fr"), "Immatriculation");
assert.equal(vehicleDocumentCategoryLabel("rental_agreement", "fr"), "Contrat de location");
assert.equal(vehicleDocumentCategoryLabel("rental_agreement", "en"), "Rental agreement");

assert.equal(vehicleInsuranceStatusLabel("to_complete", "fr"), "À compléter");
assert.equal(vehicleInsuranceStatusLabel("suspended", "fr"), "Suspendu");
assert.equal(insuranceEventTypeLabel("suspension", "fr"), "Suspension");
assert.equal(fineStatusLabel("open", "fr"), "Ouverte");
assert.equal(fineStatusLabel("cancelled", "fr"), "Annulée");

assert.equal(
  fineVehicleOptionLabel({ registration: "AA-123-AA", make: "Renault", model: "Clio" }),
  "AA-123-AA · Renault Clio",
);

assert.equal(vehicleDocumentUploadCopy.fr.chooseFile, "Choisir un fichier");
assert.equal(vehicleDocumentUploadCopy.fr.noFile, "Aucun fichier sélectionné");
assert.match(vehicleDocumentUploadCopy.fr.errors.storage, /stockage privé/);
assert.match(vehicleDocumentUploadCopy.fr.errors.chooseFile, /Choisissez un fichier/);
assert.equal(fineEvidenceCopy.fr.requiredFile, "Choisissez un justificatif.");
assert.match(companyPaidEvidenceCopy.fr.requiredFile, /justificatif/);
assert.equal(claimStageEvidenceCopy.fr.chooseFile, "Choisir un fichier");
assert.equal(maintenanceInvoiceCopy.fr.noFile, "Aucun fichier sélectionné");

assert.equal(vehicleDocumentUploadCopy.en.chooseFile, "Choose a file");
assert.equal(fineEvidenceCopy.en.requiredFile, "Choose an evidence file.");
assert.equal(maintenanceInvoiceCopy.en.fileHelp, "PDF, PNG, JPG, JPEG, or DOCX · maximum 15 MB");

process.stdout.write("Work 25 French/English dynamic labels, validation errors, and upload copy passed.\n");
