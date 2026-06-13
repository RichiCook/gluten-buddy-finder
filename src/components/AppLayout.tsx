import { ReactNode } from "react";
import { BottomNav } from "./BottomNav";
import appBackground from "@/assets/app-background.jpeg";

import { Link } from "react-router-dom";

export function AppLayout({
  children,
  title,
  topbar,
}: {
  children: ReactNode;
  title?: string;
  topbar?: ReactNode;
}) {
  return (
    <div className="relative min-h-screen pb-24">
      <div
        className="fixed inset-0 -z-10 bg-no-repeat bg-bottom bg-background"
        style={{
          backgroundImage: `url(${appBackground})`,
          backgroundSize: 'min(100%, 420px) auto',
        }}
      />
      <header className="sticky top-0 z-30 bg-transparent backdrop-blur-md">
        <div className="mx-auto max-w-lg px-4 py-3">
          {topbar ?? (
            <div className="relative flex items-center justify-center">
              <Link to="/" className="flex items-center gap-2">
                <span className="text-lg font-bold tracking-tight text-primary">Gluten Baby</span>
              </Link>
              {title && (
                <span className="absolute right-0 text-sm font-medium text-muted-foreground">
                  {title}
                </span>
              )}
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-lg px-4 py-6">{children}</main>
      <BottomNav />
    </div>
  );
}
