export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-surface-muted flex min-h-dvh flex-col">
      <header className="px-6 py-5">
        <span className="text-fg text-base font-semibold tracking-tight">OpsFlow</span>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-8">{children}</main>
      <footer className="text-fg-muted px-6 py-5 text-center text-xs">
        Multi-tenant business operations platform
      </footer>
    </div>
  );
}
