import { MenuBrowser } from "@/features/menu/menu-browser";

export default async function ItemDetailPage({
  params,
}: {
  readonly params: Promise<{ itemId: string; locationId: string }>;
}) {
  const { itemId, locationId } = await params;
  return <MenuBrowser itemId={itemId} locationId={locationId} />;
}
