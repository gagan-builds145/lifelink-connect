import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  LogoutDialog,
  useLogoutConfirmation,
} from "@/components/lifelink/LogoutConfirmation";
import { LayoutDashboard, LogOut } from "lucide-react";

export default function Dashboard() {
  const logout = useLogoutConfirmation();

  return (
    <main className="min-h-screen bg-background px-6 py-10 text-foreground">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          </div>
          <Button
            type="button"
            variant="outline"
            className="cursor-pointer gap-2 self-start"
            onClick={logout.requestLogout}
          >
            <LogOut className="size-4" />
            Sign out
          </Button>
        </header>

        <Card className="border-border/70 shadow-none">
          <CardHeader>
            <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <LayoutDashboard className="size-5" />
            </div>
            <CardTitle>Your dashboard is ready</CardTitle>
          </CardHeader>
          <CardContent className="text-sm leading-6 text-muted-foreground">
            Replace this starter content with the product&apos;s authenticated
            experience. The route is protected and sign-in returns here by
            default.
          </CardContent>
        </Card>
      </div>

      <LogoutDialog
        open={logout.open}
        onOpenChange={logout.onOpenChange}
        pending={logout.pending}
        onConfirm={() => void logout.confirmLogout()}
      />
    </main>
  );
}
