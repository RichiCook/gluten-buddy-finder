import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { LogOut, Shield, User as UserIcon } from "lucide-react";

export default function Account() {
  const navigate = useNavigate();
  const { user, isAdmin, signOut, loading } = useAuth();

  if (loading) {
    return (
      <AppLayout title="Account">
        <p className="text-center text-muted-foreground">Caricamento…</p>
      </AppLayout>
    );
  }

  if (!user) {
    return (
      <AppLayout title="Account">
        <Card className="space-y-3 p-6 text-center">
          <UserIcon className="mx-auto h-12 w-12 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Non sei loggato</h2>
          <p className="text-sm text-muted-foreground">
            Accedi per salvare i tuoi preferiti.
          </p>
          <Button
            className="w-full bg-gradient-primary"
            onClick={() => navigate("/auth")}
          >
            Accedi o registrati
          </Button>
        </Card>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Account">
      <div className="space-y-4">
        <Card className="space-y-1 p-5">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Email
          </p>
          <p className="font-medium">{user.email}</p>
          {isAdmin && (
            <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              <Shield className="h-3 w-3" /> Admin
            </p>
          )}
        </Card>

        {isAdmin && (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => navigate("/admin")}
          >
            <Shield className="h-4 w-4" /> Pannello Admin
          </Button>
        )}

        <Button
          variant="outline"
          className="w-full"
          onClick={async () => {
            await signOut();
            navigate("/");
          }}
        >
          <LogOut className="h-4 w-4" /> Esci
        </Button>
      </div>
    </AppLayout>
  );
}
