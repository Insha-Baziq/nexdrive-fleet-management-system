"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FileText, Trash2, Upload } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ProfileDocument = {
  id: string;
  name: string;
  category: "general";
  file_name: string;
  file_extension: string;
  file_size: string;
  created_at: string;
  uploaded_at: string;
};

export function ProfileSettings({ userName, email }: { userName: string; email: string }) {
  const router = useRouter();
  const { locale } = useLocale();
  const french = locale === "fr";
  const [firstName, ...lastParts] = userName.trim().split(/\s+/);
  const [first, setFirst] = useState(firstName ?? "");
  const [last, setLast] = useState(lastParts.join(" "));
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [profileError, setProfileError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [documents, setDocuments] = useState<ProfileDocument[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(true);
  const [documentName, setDocumentName] = useState("");
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [documentBusy, setDocumentBusy] = useState(false);
  const [documentError, setDocumentError] = useState("");
  const [documentMessage, setDocumentMessage] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  async function loadDocuments() {
    const response = await fetch("/api/profile/documents", { cache: "no-store" });
    const result = await response.json() as { documents?: ProfileDocument[]; error?: string };
    if (!response.ok) throw new Error(result.error ?? (french ? "Impossible de charger les documents." : "Could not load documents."));
    setDocuments(result.documents ?? []);
  }

  useEffect(() => {
    let active = true;
    void fetch("/api/profile/documents", { cache: "no-store" }).then(async (response) => {
      const result = await response.json() as { documents?: ProfileDocument[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? (french ? "Impossible de charger les documents." : "Could not load documents."));
      if (active) setDocuments(result.documents ?? []);
    }).catch((cause: unknown) => {
      if (active) setDocumentError(french ? "Impossible de charger les documents. Réessayez." : cause instanceof Error ? cause.message : "Could not load documents.");
    }).finally(() => { if (active) setDocumentsLoading(false); });
    return () => { active = false; };
  }, [french]);

  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!documentFile) {
      setDocumentError(french ? "Sélectionnez un fichier à ajouter." : "Choose a file to upload.");
      return;
    }
    setDocumentBusy(true); setDocumentError(""); setDocumentMessage("");
    let stage: "prepare" | "storage" | "verify" = "prepare";
    try {
      const response = await fetch("/api/profile/documents", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: documentName, fileName: documentFile.name, fileSize: documentFile.size }),
      });
      const result = await response.json() as { upload?: { id: string; uploadUrl: string; fields: Record<string, string> }; error?: string };
      if (!response.ok || !result.upload) throw new Error(result.error ?? (french ? "Impossible de préparer l’envoi." : "Could not prepare the upload."));
      const form = new FormData();
      for (const [key, value] of Object.entries(result.upload.fields)) form.append(key, value);
      form.append("file", documentFile);
      stage = "storage";
      await fetch(result.upload.uploadUrl, { method: "POST", body: form, mode: "no-cors" });
      stage = "verify";
      const completed = await fetch(`/api/profile/documents/${result.upload.id}/complete`, { method: "POST" });
      const completion = await completed.json().catch(() => ({})) as { error?: string };
      if (!completed.ok) throw new Error(completion.error ?? (french ? "Impossible de vérifier le fichier envoyé." : "Could not verify the uploaded file."));
      await loadDocuments();
      setDocumentName(""); setDocumentFile(null);
      const input = document.getElementById("profile-document-file") as HTMLInputElement | null;
      if (input) input.value = "";
      setDocumentMessage(french ? "Document privé ajouté." : "Private document added.");
    } catch (cause) {
      const fallback = stage === "prepare"
        ? (french ? "Échec de la préparation de l’envoi." : "Could not prepare the upload.")
        : stage === "storage"
          ? (french ? "Échec de l’envoi au stockage privé." : "The private storage upload failed.")
          : (french ? "Le fichier envoyé n’a pas pu être vérifié." : "The uploaded file could not be verified.");
      setDocumentError(french ? fallback : cause instanceof Error ? cause.message : fallback);
    } finally { setDocumentBusy(false); }
  }

  async function deleteDocument(documentId: string) {
    setDocumentBusy(true); setDocumentError(""); setDocumentMessage("");
    try {
      const response = await fetch(`/api/profile/documents/${documentId}`, { method: "DELETE" });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? (french ? "Impossible de supprimer le document." : "Could not delete the document."));
      await loadDocuments();
      setConfirmDeleteId(null);
      setDocumentMessage(french ? "Document supprimé." : "Document deleted.");
    } catch (cause) {
      setDocumentError(french ? "Impossible de supprimer le document. Réessayez." : cause instanceof Error ? cause.message : "Could not delete the document.");
    } finally { setDocumentBusy(false); }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileBusy(true); setProfileMessage(""); setProfileError("");
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ firstName: first, lastName: last }),
      });
      const result = await response.json() as { name?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? (french ? "Impossible d’enregistrer le profil." : "Could not save profile."));
      setProfileMessage(french ? "Profil enregistré." : "Profile saved.");
      router.refresh();
    } catch (cause) { setProfileError(french ? "Impossible d’enregistrer le profil. Vérifiez les informations et réessayez." : cause instanceof Error ? cause.message : "Please try again."); }
    finally { setProfileBusy(false); }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordBusy(true); setPasswordMessage(""); setPasswordError("");
    try {
      const response = await fetch("/api/profile/password", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? (french ? "Impossible de modifier le mot de passe." : "Could not change password."));
      setCurrentPassword(""); setNewPassword("");
      setPasswordMessage(french ? "Mot de passe modifié. Les autres sessions ont été fermées." : "Password changed. Other sessions have been signed out.");
    } catch (cause) { setPasswordError(french ? "Impossible de modifier le mot de passe. Vérifiez votre mot de passe actuel et réessayez." : cause instanceof Error ? cause.message : "Please try again."); }
    finally { setPasswordBusy(false); }
  }

  return <main className="mx-auto w-full max-w-[900px] space-y-6 px-4 py-8 sm:px-6 lg:py-10">
    <header><h1 className="text-2xl font-semibold tracking-tight">{french ? "Mon profil" : "My profile"}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{french ? "Gérez votre nom et vos paramètres de connexion." : "Manage your name and sign-in details."}</p></header>
    <section className="rounded-xl border bg-card p-5 shadow-sm sm:p-6">
      <h2 className="text-base font-semibold">{french ? "Informations du profil" : "Profile information"}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{french ? "Votre nom est enregistré dans le profil de votre compte." : "Your name is stored in your account profile."}</p>
      <form onSubmit={(event) => { void saveProfile(event); }} className="mt-5 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2"><Label htmlFor="profile-first-name">{french ? "Prénom" : "First name"}</Label><Input id="profile-first-name" required maxLength={80} value={first} onChange={(event) => setFirst(event.target.value)} /></div>
          <div className="grid gap-2"><Label htmlFor="profile-last-name">{french ? "Nom" : "Last name"}</Label><Input id="profile-last-name" maxLength={80} value={last} onChange={(event) => setLast(event.target.value)} /></div>
        </div>
        <div className="grid gap-2"><Label htmlFor="profile-email">{french ? "Adresse e-mail" : "Email address"}</Label><Input id="profile-email" readOnly value={email} data-no-translate /><p className="text-xs text-muted-foreground">{french ? "Contactez un administrateur pour modifier votre adresse e-mail." : "Contact an administrator to change your email address."}</p></div>
        {profileMessage ? <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">{profileMessage}</p> : null}
        {profileError ? <p role="alert" className="text-sm text-destructive">{profileError}</p> : null}
        <Button type="submit" disabled={profileBusy || !first.trim()}>{profileBusy ? (french ? "Enregistrement…" : "Saving…") : (french ? "Enregistrer le profil" : "Save profile")}</Button>
      </form>
    </section>
    <section className="rounded-xl border bg-card p-5 shadow-sm sm:p-6">
      <h2 className="text-base font-semibold">{french ? "Modifier le mot de passe" : "Change password"}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{french ? "Saisissez votre mot de passe actuel pour confirmer le changement." : "Enter your current password to confirm the change."}</p>
      <form onSubmit={(event) => { void changePassword(event); }} className="mt-5 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2"><Label htmlFor="current-password">{french ? "Mot de passe actuel" : "Current password"}</Label><Input id="current-password" type="password" autoComplete="current-password" required maxLength={128} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></div>
          <div className="grid gap-2"><Label htmlFor="new-password">{french ? "Nouveau mot de passe" : "New password"}</Label><Input id="new-password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /><p className="text-xs text-muted-foreground">{french ? "8 à 128 caractères" : "8 to 128 characters"}</p></div>
        </div>
        {passwordMessage ? <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">{passwordMessage}</p> : null}
        {passwordError ? <p role="alert" className="text-sm text-destructive">{passwordError}</p> : null}
        <Button type="submit" disabled={passwordBusy || currentPassword.length === 0 || newPassword.length < 8}>{passwordBusy ? (french ? "Modification…" : "Changing…") : (french ? "Modifier le mot de passe" : "Change password")}</Button>
      </form>
    </section>
    <section className="rounded-xl border bg-card p-5 shadow-sm sm:p-6" aria-labelledby="profile-documents-title">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><FileText className="size-[18px]" /></div>
        <div><h2 id="profile-documents-title" className="text-base font-semibold">{french ? "Mes documents" : "My documents"}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{french ? "Ces fichiers privés ne sont accessibles que depuis votre compte." : "These private files are accessible only from your account."}</p></div>
      </div>
      <form onSubmit={(event) => { void uploadDocument(event); }} className="mt-5 grid min-w-0 gap-4 sm:grid-cols-2 sm:items-end lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <div className="grid gap-2"><Label htmlFor="profile-document-name">{french ? "Nom du document" : "Document name"}</Label><Input id="profile-document-name" required maxLength={120} value={documentName} onChange={(event) => setDocumentName(event.target.value)} placeholder={french ? "Ex. Justificatif de domicile" : "e.g. Proof of address"} /></div>
        <div className="grid gap-2">
          <Label htmlFor="profile-document-file">{french ? "Fichier" : "File"}</Label>
          <div className="relative flex min-w-0 flex-wrap items-center gap-3">
            <input
              id="profile-document-file"
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.docx"
              aria-required="true"
              aria-describedby="profile-document-file-status"
              onChange={(event) => {
                setDocumentFile(event.target.files?.[0] ?? null);
                setDocumentError("");
              }}
              className="peer absolute left-0 top-0 size-px overflow-hidden border-0 p-0 whitespace-nowrap"
              style={{ clipPath: "inset(50%)" }}
            />
            <Label
              htmlFor="profile-document-file"
              className="inline-flex h-9 w-fit cursor-pointer items-center rounded-md border border-input bg-background px-3 text-sm font-medium shadow-xs hover:bg-accent hover:text-accent-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2"
            >
              {french ? "Choisir un fichier" : "Choose file"}
            </Label>
            <span id="profile-document-file-status" aria-live="polite" aria-atomic="true" className="min-w-0 break-all text-sm text-muted-foreground">
              {documentFile ? <span data-no-translate>{documentFile.name}</span> : (french ? "Aucun fichier sélectionné" : "No file selected")}
            </span>
          </div>
        </div>
        <Button type="submit" disabled={documentBusy || !documentName.trim() || !documentFile} className="sm:col-span-2 lg:col-span-1"><Upload className="size-4" />{documentBusy ? (french ? "Envoi…" : "Uploading…") : (french ? "Ajouter" : "Upload")}</Button>
      </form>
      <p className="mt-2 text-xs text-muted-foreground">{french ? "PDF, PNG, JPG, JPEG ou DOCX · 15 Mo maximum · catégorie générale, sans date d’expiration." : "PDF, PNG, JPG, JPEG, or DOCX · maximum 15 MB · general category, no expiry date."}</p>
      {documentError ? <p role="alert" className="mt-3 text-sm text-destructive">{documentError}</p> : null}
      {documentMessage ? <p role="status" className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">{documentMessage}</p> : null}
      {documentsLoading ? <p role="status" className="mt-5 text-sm text-muted-foreground">{french ? "Chargement des documents…" : "Loading documents…"}</p>
        : documents.length === 0 ? <p className="mt-5 rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{french ? "Aucun document privé pour le moment." : "No private documents yet."}</p>
          : <ul className="mt-5 divide-y rounded-lg border">{documents.map((document) => <li key={document.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0"><p className="break-words text-sm font-medium" data-no-translate>{document.name}</p><p className="mt-1 text-xs text-muted-foreground"><span data-no-translate>{document.file_extension.toUpperCase()}</span> · {(Number(document.file_size) / (1024 * 1024)).toFixed(2)} {french ? "Mo" : "MB"} · <span data-no-translate>{document.file_name}</span></p></div>
            <div className="flex items-center gap-2">
              {confirmDeleteId === document.id ? <><span className="text-xs text-destructive">{french ? "Supprimer définitivement ?" : "Delete permanently?"}</span><Button type="button" variant="destructive" size="sm" disabled={documentBusy} onClick={() => { void deleteDocument(document.id); }}>{french ? "Confirmer" : "Confirm"}</Button><Button type="button" variant="outline" size="sm" disabled={documentBusy} onClick={() => setConfirmDeleteId(null)}>{french ? "Annuler" : "Cancel"}</Button></>
                : <><Button variant="outline" size="sm" render={<a href={`/api/profile/documents/${document.id}/content`} target="_blank" rel="noreferrer">{french ? "Ouvrir" : "Open"}</a>} /><Button type="button" variant="ghost" size="icon" aria-label={french ? `Supprimer ${document.name}` : `Delete ${document.name}`} disabled={documentBusy} onClick={() => setConfirmDeleteId(document.id)}><Trash2 className="size-4" /></Button></>}
            </div>
          </li>)}</ul>}
    </section>
  </main>;
}
