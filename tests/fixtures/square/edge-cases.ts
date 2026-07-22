export const malformedCatalogFixture = {
  type: "ITEM",
  id: "ITEM_MALFORMED",
  is_deleted: false,
  item_data: {
    name: 42,
    variations: "not-an-array",
  },
};

export const incompleteCatalogFixture = {
  type: "ITEM",
  id: "ITEM_INCOMPLETE",
  present_at_all_locations: true,
  is_deleted: false,
  item_data: {
    name: "No variations",
    image_ids: ["IMG_MISSING"],
    variations: [],
  },
};

export const duplicateCatalogFixture = [
  {
    type: "CATEGORY",
    id: "CAT_DUPLICATE",
    version: 100,
    category_data: { name: "Older duplicate" },
  },
  {
    type: "CATEGORY",
    id: "CAT_DUPLICATE",
    version: 200,
    category_data: { name: "Newer duplicate" },
  },
] as const;

export const archivedCatalogFixture = {
  type: "ITEM",
  id: "ITEM_ARCHIVED",
  is_deleted: false,
  item_data: {
    name: "Archived item",
    is_archived: true,
    variations: [],
  },
};

export const deletedCatalogFixture = {
  type: "ITEM",
  id: "ITEM_DELETED",
  is_deleted: true,
  updated_at: "2026-07-20T12:00:00.000Z",
};

export const categoryCycleFixture = [
  {
    type: "CATEGORY",
    id: "CAT_CYCLE_A",
    category_data: {
      name: "Cycle A",
      parent_category: { id: "CAT_CYCLE_B", ordinal: 1 },
    },
  },
  {
    type: "CATEGORY",
    id: "CAT_CYCLE_B",
    category_data: {
      name: "Cycle B",
      parent_category: { id: "CAT_CYCLE_A", ordinal: 1 },
    },
  },
] as const;
