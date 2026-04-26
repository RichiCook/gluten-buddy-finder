import { ReactNode } from "react";
import { BottomNav } from "./BottomNav";
import logo from "@/assets/logo.png";
import { Link } from "react-router-dom";

export function AppLayout({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <div className="min-h-screen bg-gradient-warm pb-24">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2">
            <img src={logo} alt="Gluten Baby" className="h-9 w-9" width={36} height={36} />
            <span className="text-lg font-bold tracking-tight text-primary">Gluten Baby</span>
          </Link>
          {title && (
            <span className="ml-auto text-sm font-medium text-muted-foreground">
              {title}
            </span>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-lg px-4 py-6">{children}</main>
      <BottomNav />
    </div>
  );
}
