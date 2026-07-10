const whatsappUrl =
  "https://wa.me/6283800255588?text=Halo%20TapGo%20Lion%2C%20saya%20ingin%20mendapatkan%20informasi%20mengenai%20membership%20TapGo.";

export function LegalShell({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <main className="min-h-screen px-5 py-10">
      <article className="mx-auto max-w-4xl">
        <a href="/" className="text-sm font-bold text-brand-blue">Kembali ke Home</a>
        <div className="glass mt-8 rounded-[2rem] p-8 md:p-12">
          <p className="text-sm font-bold uppercase tracking-[0.22em] text-brand-green">TapGo Lion</p>
          <h1 className="mt-3 text-4xl font-black text-brand-navy md:text-6xl">{title}</h1>
          <p className="mt-4 text-sm font-semibold text-slate-500">Terakhir diperbarui: {updated}</p>
          <div className="legal-content mt-10 space-y-6 text-base leading-8 text-slate-700">
            {children}
          </div>
        </div>
      </article>
    </main>
  );
}

export function FloatingWhatsApp() {
  return (
    <a
      href={whatsappUrl}
      className="fixed bottom-5 right-5 z-[60] inline-flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-brand-green to-brand-cyan text-white shadow-glow transition hover:-translate-y-1 focus:outline-none focus:ring-4 focus:ring-brand-green/25"
      aria-label="Chat WhatsApp TapGo Lion"
    >
      <svg aria-hidden="true" className="h-7 w-7" viewBox="0 0 24 24" fill="none">
        <path d="M12 3.8a8.2 8.2 0 0 0-7 12.5l-1 3.7 3.8-1a8.2 8.2 0 1 0 4.2-15.2Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M8.9 8.5c.2-.5.4-.5.7-.5h.5c.2 0 .4.1.5.4l.7 1.6c.1.3.1.5-.1.7l-.4.5c.6 1 1.4 1.8 2.5 2.4l.5-.5c.2-.2.4-.2.7-.1l1.6.7c.3.1.4.3.4.6v.4c0 .4-.2.7-.5.8-.5.3-1.3.4-2.4 0-2.8-.9-4.9-3.1-5.8-5.8-.3-.8-.2-1.5.1-2.2Z" fill="currentColor" />
      </svg>
    </a>
  );
}
