# ADR 0001: Next.js backend-for-frontend foundation

- **Status:** Accepted
- **Date:** 2026-07-23

## Context

The challenge requires a web client and a thin Node backend while prohibiting Square credentials in the browser. The repository starts without an application or established conventions.

## Decision

Use a single Next.js 16 App Router application. Route Handlers will form the browser-facing API, while a server-only data-access layer will own Square credentials, upstream calls, normalization, and caching. Browser features consume narrow, validated DTOs and never import server modules.

Use pnpm with Node.js 22 LTS, strict TypeScript, Tailwind CSS, Vitest, React Testing Library, MSW, and Playwright. Keep framework-independent business rules in `src/domain`, interactive UI in `src/features`, serializable contracts in `src/shared`, and privileged code in `src/server`.

## Consequences

- The frontend and backend share one deployment and one type system.
- Square credentials are protected by both module boundaries and Next.js's `server-only` build guard.
- Route Handlers remain public endpoints and must validate every input and minimize every output.
- There is no database; server caching is best effort and browser persistence is limited to public normalized data.
- Future work must preserve these boundaries or supersede this ADR explicitly.
