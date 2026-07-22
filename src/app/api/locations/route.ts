import { handleLocations } from "@/server/api/handlers";
import { getMenuApiService } from "@/server/api/menu-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return handleLocations(getMenuApiService());
}
