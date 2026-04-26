import { NavLink } from "react-router-dom";
import { Camera, Star, User, Shield } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

export function BottomNav() {
  const { isAdmin } = useAuth();

  const items = [
    { to: "/", icon: Camera, label: "Scansiona" },
    { to: "/favorites", icon: Star, label: "Preferiti" },
    { to: "/account", icon: User, label: "Account" },
    ...(isAdmin
      ? [{ to: "/admin", icon: Shield, label: "Admin" }]
      : []),
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 backdrop-blur-md shadow-soft">
      <ul className="mx-auto flex max-w-lg items-stretch justify-around">
        {items.map((it) => (
          <li key={it.to} className="flex-1">
            <NavLink
              to={it.to}
              end={it.to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors",
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )
              }
            >
              <it.icon className="h-5 w-5" />
              <span>{it.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
