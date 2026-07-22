import "server-only";

import {
  apiErrorSchema,
  createApiSuccessSchema,
  identifierSchema,
  locationsDataSchema,
  menuSnapshotSchema,
  PUBLIC_SCHEMA_VERSION,
  type ApiErrorDto,
  type WarningDto,
} from "@/shared/contracts";
import { MenuNormalizationError } from "@/server/menu";
import { SquareGatewayError } from "@/server/square/errors";

import type { MenuApiService, ServiceRead } from "./menu-service";

interface ErrorDescriptor {
  readonly code: ApiErrorDto["error"]["code"];
  readonly message: string;
  readonly retryable: boolean;
  readonly status: number;
}

function requestId(): string {
  return crypto.randomUUID();
}

function jsonHeaders(id: string): HeadersInit {
  return {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-request-id": id,
  };
}

function errorResponse(descriptor: ErrorDescriptor, id: string): Response {
  const body = apiErrorSchema.parse({
    error: {
      code: descriptor.code,
      message: descriptor.message,
      requestId: id,
      retryable: descriptor.retryable,
    },
  });
  return Response.json(body, { headers: jsonHeaders(id), status: descriptor.status });
}

function errorFrom(error: unknown): ErrorDescriptor {
  if (error instanceof SquareGatewayError) {
    if (error.code === "configuration") {
      return {
        code: "CONFIGURATION_ERROR",
        message: "The menu service is not configured correctly.",
        retryable: false,
        status: 500,
      };
    }
    if (error.code === "rate_limited") {
      return {
        code: "UPSTREAM_RATE_LIMITED",
        message: "The menu provider is rate limited. Please retry shortly.",
        retryable: true,
        status: 429,
      };
    }
    return {
      code: "UPSTREAM_UNAVAILABLE",
      message: "The menu provider is temporarily unavailable.",
      retryable: error.retryable,
      status: 503,
    };
  }
  if (error instanceof MenuNormalizationError) {
    return {
      code: "INTERNAL_ERROR",
      message: "The menu could not be prepared safely.",
      retryable: false,
      status: 500,
    };
  }
  return {
    code: "INTERNAL_ERROR",
    message: "An unexpected server error occurred.",
    retryable: false,
    status: 500,
  };
}

function successResponse<TData>(
  result: ServiceRead<TData>,
  schema: ReturnType<typeof createApiSuccessSchema>,
  id: string,
): Response {
  const body = schema.parse({
    data: result.data,
    meta: {
      fetchedAt: result.fetchedAt.toISOString(),
      requestId: id,
      schemaVersion: PUBLIC_SCHEMA_VERSION,
      source: result.source,
      warnings: result.warnings satisfies readonly WarningDto[],
    },
  });
  return Response.json(body, { headers: jsonHeaders(id), status: 200 });
}

export async function handleLocations(
  service: MenuApiService,
): Promise<Response> {
  const id = requestId();
  try {
    return successResponse(
      await service.getLocations(),
      createApiSuccessSchema(locationsDataSchema),
      id,
    );
  } catch (error) {
    return errorResponse(errorFrom(error), id);
  }
}

export async function handleMenu(
  request: Request,
  service: MenuApiService,
): Promise<Response> {
  const id = requestId();
  const values = new URL(request.url).searchParams.getAll("locationId");
  const locationId = values.length === 1 ? values[0] : undefined;
  const parsed = locationId === undefined || locationId !== locationId.trim()
    ? undefined
    : identifierSchema.safeParse(locationId);
  if (parsed === undefined || !parsed.success) {
    return errorResponse(
      {
        code: "BAD_REQUEST",
        message: "Provide exactly one valid locationId.",
        retryable: false,
        status: 400,
      },
      id,
    );
  }

  try {
    const result = await service.getMenu(parsed.data);
    if (result === null) {
      return errorResponse(
        {
          code: "NOT_FOUND",
          message: "The requested active location was not found.",
          retryable: false,
          status: 404,
        },
        id,
      );
    }
    return successResponse(result, createApiSuccessSchema(menuSnapshotSchema), id);
  } catch (error) {
    return errorResponse(errorFrom(error), id);
  }
}
