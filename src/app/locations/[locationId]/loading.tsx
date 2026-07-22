export default function LocationLoading() {
  return (
    <main aria-busy="true" className="mx-auto w-full max-w-6xl px-6 py-10 sm:px-10">
      <div className="h-8 w-56 animate-pulse rounded bg-slate-200" />
      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <div className="h-80 animate-pulse rounded-3xl bg-slate-100" />
        <div className="h-80 animate-pulse rounded-3xl bg-slate-100" />
        <div className="h-80 animate-pulse rounded-3xl bg-slate-100" />
      </div>
      <p className="sr-only">Loading the location menu.</p>
    </main>
  );
}
