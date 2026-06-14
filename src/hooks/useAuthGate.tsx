import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { AuthDialog } from "@/components/AuthDialog";
import { useAuth } from "@/hooks/useAuth";

type PendingAction = (() => void) | null;

interface AuthGateContextValue {
  /**
   * Runs `action` if the user is signed in. If not, opens the AuthDialog and runs
   * the action only after a successful sign-in or sign-up.
   *
   * `reason` is the localized line shown inside the dialog header (e.g.
   * "Crea un account per salvare i tuoi preferiti").
   */
  requestAuth: (action: () => void, reason?: string) => void;
}

const AuthGateContext = createContext<AuthGateContextValue | null>(null);

export function AuthGateProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string | undefined>(undefined);
  // Use ref so the dialog's onSuccess captures the latest pending action
  // even after re-renders.
  const pendingRef = useRef<PendingAction>(null);

  const requestAuth = useCallback(
    (action: () => void, reasonText?: string) => {
      if (user) {
        action();
        return;
      }
      pendingRef.current = action;
      setReason(reasonText);
      setOpen(true);
    },
    [user],
  );

  function handleSuccess() {
    const pending = pendingRef.current;
    pendingRef.current = null;
    // Give the auth state a tick to propagate to other hooks before running
    // the original action (so the action sees `user` populated).
    setTimeout(() => {
      pending?.();
    }, 50);
  }

  return (
    <AuthGateContext.Provider value={{ requestAuth }}>
      {children}
      <AuthDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) pendingRef.current = null;
        }}
        reason={reason}
        onSuccess={handleSuccess}
      />
    </AuthGateContext.Provider>
  );
}

export function useAuthGate(): AuthGateContextValue {
  const ctx = useContext(AuthGateContext);
  if (!ctx) {
    throw new Error("useAuthGate must be used inside <AuthGateProvider>");
  }
  return ctx;
}
