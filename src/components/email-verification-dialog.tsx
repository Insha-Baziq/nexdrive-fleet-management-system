"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";

export type VerificationDialogState = "sending" | "waiting" | "verified" | "error";

export function EmailVerificationDialog({
  open,
  onOpenChange,
  state,
  email,
  french,
  busy,
  sent,
  error,
  onResend,
  onRetry,
  onContinue,
  continueLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: VerificationDialogState;
  email: string;
  french: boolean;
  busy: boolean;
  sent: boolean;
  error: string;
  onResend: () => void;
  onRetry?: () => void;
  onContinue: () => void;
  continueLabel: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={state === "verified" || state === "error"}>
        <DialogHeader className="items-center text-center">
          {state === "sending" || state === "waiting"
            ? <LoaderCircle className="size-10 animate-spin text-primary" aria-hidden="true" />
            : state === "verified"
              ? <CircleCheck className="size-10 text-emerald-600" aria-hidden="true" />
              : <CircleAlert className="size-10 text-destructive" aria-hidden="true" />}
          <DialogTitle>
            {state === "verified"
              ? (french ? "Adresse e-mail vérifiée" : "Email verified")
              : state === "error"
                ? (french ? "E-mail non envoyé" : "Email could not be sent")
                : (french ? "En attente de vérification" : "Waiting for verification")}
          </DialogTitle>
          <DialogDescription>
            {state === "verified"
              ? (french ? "Votre adresse est confirmée. Connectez-vous à nouveau pour continuer." : "Your email is confirmed. Sign in again to continue.")
              : state === "error"
                ? error
                : state === "sending"
                  ? (french ? `Envoi du lien de vérification à ${email}…` : `Sending a verification link to ${email}…`)
                  : (french ? `Un lien de vérification a été envoyé à ${email}. Ouvrez-le dans votre boîte de réception. Cette fenêtre se mettra à jour automatiquement.` : `A verification link was sent to ${email}. Open it from your inbox. This window will update automatically.`)}
          </DialogDescription>
        </DialogHeader>
        {state === "waiting" || state === "error" ? <div className="space-y-2 text-center">
          {state === "error" && onRetry ? <Button type="button" variant="outline" disabled={busy} onClick={onRetry}>{french ? "Réessayer" : "Try again"}</Button> : null}
          <Button type="button" variant="link" className="h-auto p-0" disabled={busy} onClick={onResend}>
            {busy ? (french ? "Envoi…" : "Sending…") : (french ? "Renvoyer le lien de vérification" : "Resend verification link")}
          </Button>
          {sent && state === "waiting" ? <p role="status" className="text-sm text-muted-foreground">{french ? "Consultez votre boîte de réception." : "Check your inbox."}</p> : null}
          {error && state === "waiting" ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </div> : null}
        {state === "verified" ? <DialogFooter className="sm:justify-center"><Button type="button" onClick={onContinue}>{continueLabel}</Button></DialogFooter> : null}
      </DialogContent>
    </Dialog>
  );
}
