import { MenuBrowser } from "@/features/menu/menu-browser";

export default async function LocationMenuPage({
  params,
}: {
  readonly params: Promise<{ locationId: string }>;
}) {
  const { locationId } = await params;
  return <MenuBrowser locationId={locationId} />;
}
