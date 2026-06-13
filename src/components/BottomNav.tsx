import { NavLink } from "react-router-dom";
import { Home, LayoutGrid, Star, User, Shield } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

export function BottomNav() {
  const { isAdmin } = useAuth();

  const items = [
    { to: "/", icon: Home, label: "Home" },
    { to: "/sfoglia", icon: LayoutGrid, label: "Sfoglia" },
    { to: "/favorites", icon: Star, label: "Salvati" },
    { to: "/account", icon: User, label: "Account" },
    ...(isAdmin
      ? [{ to: "/admin", icon: Shield, label: "Admin" }]
      : []),
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/70 backdrop-blur-md shadow-soft">
      <ul className="mx-auto flex max-w-lg items-stretch justify-around">
        {items.map((it) => (
          <li key={it.to} className="flex-1">
            <NavLink
              to={it.to}
              end={it.to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex flex-col items-center gap-1 py-3 text-[11px] font-medium transition-colors",
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )
              }
            >
              <it.icon className="h-[22px] w-[22px]" />
              <span>{it.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
