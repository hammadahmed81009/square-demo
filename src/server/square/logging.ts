import "server-only";

import type { SquareGatewayLogger } from "@/server/square/types";

/**
 * Emits only the fixed observability envelope. Raw Square payloads, errors,
 * cache keys, and credentials are deliberately not accepted by this logger.
 */
export const squareGatewayLogger: SquareGatewayLogger = {
  log(event): void {
    if (process.env.NODE_ENV !== "test") {
      process.stdout.write(
        `${JSON.stringify({ scope: "square-gateway", ...event })}\n`,
      );
    }
  },
};
