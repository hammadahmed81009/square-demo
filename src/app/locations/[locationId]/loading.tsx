export default function LocationLoading() {
  return (
    <main aria-busy="true" className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8">
      <div className="h-10 w-48 skeleton rounded-lg" />
      <div className="mt-3 h-4 w-32 skeleton rounded" />
      <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {["one", "two", "three"].map((key) => (
          <div className="overflow-hidden rounded-[1.25rem] border border-line/70 bg-surface" key={key}>
            <div className="aspect-[4/3] skeleton" />
            <div className="space-y-3 p-4">
              <div className="h-5 w-2/3 skeleton rounded" />
              <div className="h-4 w-full skeleton rounded" />
            </div>
          </div>
        ))}
      </div>
      <p className="sr-only">Loading the location menu.</p>
    </main>
  );
}
