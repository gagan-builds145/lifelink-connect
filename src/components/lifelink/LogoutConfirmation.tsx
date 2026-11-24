import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/use-auth";
import {
  createLogoutGate,
  LOGOUT_CANCEL_LABEL,
  LOGOUT_CONFIRM_LABEL,
  LOGOUT_CONFIRMATION_MESSAGE,
  LOGOUT_SUCCESS_PATH,
} from "@/lib/logout";
import { friendlyError } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

/**
 * Single logout gate for every account menu, settings card and dashboard.
 *
 * The dialog owns the confirmation. The ref lock prevents a double-click from
 * calling signOut twice, and the dialog stays open if signOut fails so the user
 * can retry or cancel.
 */
export function useLogoutConfirmation() {
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const gate = useRef(createLogoutGate()).current;

  const requestLogout = useCallback(() => {
    if (!pending) setOpen(true);
  }, [pending]);

  const onOpenChange = useCallback(
    (next: boolean) => {
      if (!pending) setOpen(next);
    },
    [pending],
  );

  const confirmLogout = useCallback(async () => {
    setPending(true);
    const result = await gate.run(signOut);
    if (result.status === "ignored") return;
    if (result.status === "success") {
      setOpen(false);
      toast.success("Signed out securely");
      // A full document navigation avoids a race where the current protected
      // route re-renders and sends the signed-out user to /auth?returnTo=…
      // before the client router reaches the requested /login destination.
      window.location.replace(LOGOUT_SUCCESS_PATH);
      return;
    } else if (result.status === "error") {
      toast.error("Could not log out", {
        description: friendlyError(result.error, "Please try again."),
      });
    }
    setPending(false);
  }, [gate, signOut]);

  return { open, onOpenChange, pending, requestLogout, confirmLogout };
}

export function LogoutDialog({
  open,
  onOpenChange,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent aria-busy={pending}>
        <AlertDialogHeader>
          <AlertDialogTitle>Log out of LifeLink?</AlertDialogTitle>
          <AlertDialogDescription>{LOGOUT_CONFIRMATION_MESSAGE}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{LOGOUT_CANCEL_LABEL}</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(event) => {
              // Keep the dialog mounted until signOut resolves. This also
              // prevents Radix's default close from racing a failed signout.
              event.preventDefault();
              onConfirm();
            }}
          >
            {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {LOGOUT_CONFIRM_LABEL}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
