export default function AdminDashboardPage() {
  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-950">
      <section className="mx-auto max-w-7xl">
        <h1 className="text-2xl font-semibold">TapGo Operations Center</h1>
        <div className="mt-6 grid gap-4 md:grid-cols-4">
          {["Active rides", "Online drivers", "Gross bookings", "Open tickets"].map((label) => (
            <div key={label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-slate-500">{label}</p>
              <p className="mt-3 text-3xl font-semibold">0</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
