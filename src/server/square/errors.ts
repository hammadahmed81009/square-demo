import "server-only";

export type SquareGatewayErrorCode =
  | "configuration"
  | "pagination_cycle"
  | "rate_limited"
  | "unavailable";

export class SquareGatewayError extends Error {
  constructor(
    readonly code: SquareGatewayErrorCode,
    readonly retryable: boolean,
    readonly upstreamStatus?: number,
  ) {
    super(code);
    this.name = "SquareGatewayError";
  }
}

interface ErrorWithStatus {
  readonly statusCode?: unknown;
  readonly status?: unknown;
}

interface ErrorWithHeaders {
  readonly headers?: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function getUpstreamStatus(error: unknown): number | undefined {
  if (!isObject(error)) {
    return undefined;
  }

  const candidate = error as ErrorWithStatus;
  if (typeof candidate.statusCode === "number") {
    return candidate.statusCode;
  }

  return typeof candidate.status === "number" ? candidate.status : undefined;
}

export function getRetryAfterMs(error: unknown): number | undefined {
  if (!isObject(error)) {
    return undefined;
  }

  const headers = (error as ErrorWithHeaders).headers;
  const retryAfter =
    headers instanceof Headers
      ? headers.get("retry-after")
      : isObject(headers) && typeof headers["retry-after"] === "string"
        ? headers["retry-after"]
        : undefined;

  if (retryAfter === undefined || retryAfter === null) {
    return undefined;
  }

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1_000;
  }

  const dateMs = Date.parse(retryAfter);
  return Number.isNaN(dateMs) ? undefined : Math.max(0, dateMs - Date.now());
}

export function toSquareGatewayError(error: unknown): SquareGatewayError {
  if (error instanceof SquareGatewayError) {
    return error;
  }

  const status = getUpstreamStatus(error);
  if (status === 401 || status === 403) {
    return new SquareGatewayError("configuration", false, status);
  }

  if (status === 429) {
    return new SquareGatewayError("rate_limited", true, status);
  }

  if (
    status === 408 ||
    status === 425 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    status === undefined
  ) {
    return new SquareGatewayError("unavailable", true, status);
  }

  return new SquareGatewayError("unavailable", false, status);
}
