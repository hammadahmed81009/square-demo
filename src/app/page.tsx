export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center px-6 py-16 sm:px-10">
      <p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-orange-700">
        Per Diem engineering challenge
      </p>
      <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-slate-950 sm:text-6xl">
        A multi-location menu, grounded in what guests can order now.
      </h1>
      <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
        The Next.js foundation is ready. Location-aware catalog browsing,
        availability, modifiers, inventory, and cart behavior are tracked in
        the implementation plan.
      </p>

      <section
        aria-labelledby="foundation-heading"
        className="mt-12 rounded-3xl border border-orange-100 bg-white p-6 shadow-sm sm:p-8"
      >
        <h2
          id="foundation-heading"
          className="text-xl font-semibold text-slate-950"
        >
          Foundation status
        </h2>
        <ul className="mt-5 grid gap-3 text-slate-700 sm:grid-cols-2">
          <li className="rounded-2xl bg-orange-50 px-4 py-3">
            Next.js App Router and strict TypeScript
          </li>
          <li className="rounded-2xl bg-orange-50 px-4 py-3">
            Server-only Square credential boundary
          </li>
          <li className="rounded-2xl bg-orange-50 px-4 py-3">
            Unit, integration, and browser test harnesses
          </li>
          <li className="rounded-2xl bg-orange-50 px-4 py-3">
            CI, auditing, and secret scanning
          </li>
        </ul>
      </section>
    </main>
  );
}
