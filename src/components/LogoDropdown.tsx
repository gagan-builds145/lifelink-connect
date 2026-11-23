// simple logo dropdown component that can be used to go to the landing page or sign out for the user

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import logo from "@/assets/logo.svg";
import { useAuth } from "@/hooks/use-auth";
import { resolveLogoHref } from "@/lib/home-routing";
import { Home, LogOut } from "lucide-react";
import { useNavigate } from "react-router";
import { LogoutDialog, useLogoutConfirmation } from "./lifelink/LogoutConfirmation";

export function LogoDropdown() {
  const { isAuthenticated, user } = useAuth();
  const logout = useLogoutConfirmation();
  const navigate = useNavigate();
  const homeHref = resolveLogoHref({ isAuthenticated, role: user?.role });

  const handleGoHome = () => {
    navigate(homeHref);
  };

  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-10 w-10">
          <img
            src={logo}
            alt="Logo"
            width={32}
            height={32}
            className="rounded-lg"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuItem onClick={handleGoHome} className="cursor-pointer">
          <Home className="mr-2 h-4 w-4" />
          {isAuthenticated ? "Dashboard" : "Landing Page"}
        </DropdownMenuItem>
        {isAuthenticated && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={logout.requestLogout}
              className="cursor-pointer text-destructive focus:text-destructive"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
    <LogoutDialog
      open={logout.open}
      onOpenChange={logout.onOpenChange}
      pending={logout.pending}
      onConfirm={() => void logout.confirmLogout()}
    />
    </>
  );
}
