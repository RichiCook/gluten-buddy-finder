import { ReactNode } from "react";
import { BottomNav } from "./BottomNav";
import appBackground from "@/assets/app-background.jpeg";

import { Link } from "react-router-dom";

export function AppLayout({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <div className="relative min-h-screen pb-24">
      <div
        className="fixed inset-0 -z-10 bg-no-repeat bg-center bg-cover"
        style={{ backgroundImage: `url(${appBackground})` }}
      />
      <header className="sticky top-0 z-30 border-b border-border/50 bg-transparent backdrop-blur-md">
        <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2">
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
