// Vitest runs server modules directly in Node. Next.js enforces this marker at
// bundle time, so tests replace the package's throwing client-module shim.
export {};
