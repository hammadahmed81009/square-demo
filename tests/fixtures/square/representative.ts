/**
 * Square-SDK-shaped data intentionally remains outside the public contract
 * layer. Money uses bigint here to prove normalization is mandatory before a
 * response is serialized.
 */
export const squareLocationsFixture = [
  {
    id: "LOC_DOWNTOWN",
    name: "Downtown",
    status: "ACTIVE",
    timezone: "America/New_York",
    currency: "USD",
    language_code: "en-US",
    address: {
      address_line_1: "100 Main Street",
      locality: "New York",
      administrative_district_level_1: "NY",
      postal_code: "10001",
      country: "US",
    },
    business_hours: {
      periods: [
        {
          day_of_week: "MON",
          start_local_time: "07:00:00",
          end_local_time: "18:00:00",
        },
        {
          day_of_week: "TUE",
          start_local_time: "07:00:00",
          end_local_time: "18:00:00",
        },
      ],
    },
  },
  {
    id: "LOC_AIRPORT",
    name: "Airport",
    status: "ACTIVE",
    timezone: "America/Chicago",
    currency: "USD",
    language_code: "en-US",
    address: {
      address_line_1: "1 Terminal Way",
      locality: "Chicago",
      administrative_district_level_1: "IL",
      postal_code: "60666",
      country: "US",
    },
    business_hours: {
      periods: [
        {
          day_of_week: "MON",
          start_local_time: "05:00:00",
          end_local_time: "23:00:00",
        },
      ],
    },
  },
] as const;

export const squareCatalogFixture = [
  {
    type: "AVAILABILITY_PERIOD",
    id: "AVAIL_BREAKFAST_MON",
    is_deleted: false,
    availability_period_data: {
      day_of_week: "MON",
      start_local_time: "07:00:00",
      end_local_time: "11:00:00",
    },
  },
  {
    type: "AVAILABILITY_PERIOD",
    id: "AVAIL_BREAKFAST_TUE",
    is_deleted: false,
    availability_period_data: {
      day_of_week: "TUE",
      start_local_time: "07:00:00",
      end_local_time: "11:00:00",
    },
  },
  {
    type: "CATEGORY",
    id: "CAT_BREAKFAST",
    is_deleted: false,
    category_data: {
      name: "Breakfast",
      category_type: "MENU_CATEGORY",
      is_top_level: true,
      availability_period_ids: [
        "AVAIL_BREAKFAST_MON",
        "AVAIL_BREAKFAST_TUE",
      ],
    },
  },
  {
    type: "CATEGORY",
    id: "CAT_COFFEE",
    is_deleted: false,
    category_data: {
      name: "Coffee",
      category_type: "MENU_CATEGORY",
      parent_category: { id: "CAT_BREAKFAST", ordinal: 1 },
    },
  },
  {
    type: "CATEGORY",
    id: "CAT_FOOD",
    is_deleted: false,
    category_data: {
      name: "Breakfast Food",
      category_type: "MENU_CATEGORY",
      parent_category: { id: "CAT_BREAKFAST", ordinal: 2 },
    },
  },
  {
    type: "CATEGORY",
    id: "CAT_PASTRIES",
    is_deleted: false,
    category_data: {
      name: "Pastries",
      category_type: "REGULAR_CATEGORY",
    },
  },
  {
    type: "IMAGE",
    id: "IMG_COFFEE",
    is_deleted: false,
    image_data: {
      name: "Latte hero",
      url: "https://images.squareup.com/example/latte.jpg",
      caption: "A latte with foam art",
    },
  },
  {
    type: "MODIFIER_LIST",
    id: "MOD_MILK",
    present_at_all_locations: true,
    is_deleted: false,
    modifier_list_data: {
      name: "Milk",
      modifier_type: "LIST",
      allow_quantities: false,
      min_selected_modifiers: 1,
      max_selected_modifiers: 1,
      modifiers: [
        {
          type: "MODIFIER",
          id: "MOD_WHOLE",
          modifier_data: {
            name: "Whole milk",
            ordinal: 1,
            on_by_default: true,
            price_money: { amount: BigInt(0), currency: "USD" },
          },
        },
        {
          type: "MODIFIER",
          id: "MOD_OAT",
          modifier_data: {
            name: "Oat milk",
            ordinal: 2,
            price_money: { amount: BigInt(100), currency: "USD" },
            location_overrides: [
              {
                location_id: "LOC_AIRPORT",
                price_money: { amount: BigInt(150), currency: "USD" },
              },
            ],
          },
        },
      ],
    },
  },
  {
    type: "MODIFIER_LIST",
    id: "MOD_CUP_NAME",
    present_at_all_locations: true,
    is_deleted: false,
    modifier_list_data: {
      name: "Name on cup",
      modifier_type: "TEXT",
      text_required: false,
      max_length: 24,
    },
  },
  {
    type: "ITEM",
    id: "ITEM_LATTE",
    version: 1_721_000_001,
    updated_at: "2026-07-20T10:00:00.000Z",
    present_at_all_locations: true,
    absent_at_location_ids: [],
    is_deleted: false,
    item_data: {
      name: "Latte",
      buyer_facing_name: "House Latte",
      description_plaintext: "Espresso with steamed milk.",
      image_ids: ["IMG_COFFEE"],
      categories: [{ id: "CAT_COFFEE", ordinal: 1 }],
      modifier_list_info: [
        {
          modifier_list_id: "MOD_MILK",
          min_selected_modifiers: 1,
          max_selected_modifiers: 1,
          enabled: true,
          ordinal: 1,
        },
        {
          modifier_list_id: "MOD_CUP_NAME",
          enabled: true,
          ordinal: 2,
        },
      ],
      variations: [
        {
          type: "ITEM_VARIATION",
          id: "VAR_LATTE_SMALL",
          present_at_all_locations: true,
          item_variation_data: {
            item_id: "ITEM_LATTE",
            name: "Small",
            ordinal: 1,
            sellable: true,
            track_inventory: true,
            pricing_type: "FIXED_PRICING",
            price_money: { amount: BigInt(450), currency: "USD" },
            location_overrides: [
              {
                location_id: "LOC_AIRPORT",
                price_money: { amount: BigInt(500), currency: "USD" },
                pricing_type: "FIXED_PRICING",
              },
            ],
          },
        },
        {
          type: "ITEM_VARIATION",
          id: "VAR_LATTE_LARGE",
          present_at_all_locations: false,
          present_at_location_ids: ["LOC_DOWNTOWN"],
          item_variation_data: {
            item_id: "ITEM_LATTE",
            name: "Large",
            ordinal: 2,
            sellable: true,
            track_inventory: true,
            pricing_type: "FIXED_PRICING",
            price_money: { amount: BigInt(550), currency: "USD" },
          },
        },
      ],
    },
  },
  {
    type: "ITEM",
    id: "ITEM_SANDWICH",
    version: 1_721_000_002,
    updated_at: "2026-07-20T10:05:00.000Z",
    present_at_all_locations: false,
    present_at_location_ids: ["LOC_DOWNTOWN"],
    is_deleted: false,
    item_data: {
      name: "Egg Sandwich",
      description_plaintext: "Egg, cheddar, and tomato on a brioche bun.",
      categories: [{ id: "CAT_FOOD", ordinal: 1 }],
      variations: [
        {
          type: "ITEM_VARIATION",
          id: "VAR_SANDWICH",
          present_at_all_locations: false,
          present_at_location_ids: ["LOC_DOWNTOWN"],
          item_variation_data: {
            item_id: "ITEM_SANDWICH",
            name: "Regular",
            ordinal: 1,
            sellable: true,
            track_inventory: false,
            pricing_type: "FIXED_PRICING",
            price_money: { amount: BigInt(850), currency: "USD" },
          },
        },
      ],
    },
  },
  {
    type: "ITEM",
    id: "ITEM_CROISSANT",
    version: 1_721_000_003,
    updated_at: "2026-07-20T10:10:00.000Z",
    present_at_all_locations: true,
    is_deleted: false,
    item_data: {
      name: "Butter Croissant",
      description_plaintext: "A flaky all-butter pastry.",
      categories: [{ id: "CAT_PASTRIES", ordinal: 1 }],
      variations: [
        {
          type: "ITEM_VARIATION",
          id: "VAR_CROISSANT",
          present_at_all_locations: true,
          item_variation_data: {
            item_id: "ITEM_CROISSANT",
            name: "Regular",
            ordinal: 1,
            sellable: true,
            track_inventory: true,
            pricing_type: "FIXED_PRICING",
            price_money: { amount: BigInt(425), currency: "USD" },
            location_overrides: [
              {
                location_id: "LOC_AIRPORT",
                sold_out: true,
                sold_out_valid_until: "2026-07-24T12:00:00.000Z",
              },
            ],
          },
        },
      ],
    },
  },
] as const;

export const squareInventoryFixture = [
  {
    catalog_object_id: "VAR_LATTE_SMALL",
    catalog_object_type: "ITEM_VARIATION",
    location_id: "LOC_DOWNTOWN",
    state: "IN_STOCK",
    quantity: "12",
    calculated_at: "2026-07-23T08:00:00.000Z",
  },
  {
    catalog_object_id: "VAR_LATTE_LARGE",
    catalog_object_type: "ITEM_VARIATION",
    location_id: "LOC_DOWNTOWN",
    state: "IN_STOCK",
    quantity: "0",
    calculated_at: "2026-07-23T08:00:00.000Z",
  },
  {
    catalog_object_id: "VAR_CROISSANT",
    catalog_object_type: "ITEM_VARIATION",
    location_id: "LOC_AIRPORT",
    state: "IN_STOCK",
    quantity: "4.5",
    calculated_at: "2026-07-23T08:00:00.000Z",
  },
] as const;

export const representativeSquareFixture = {
  locations: squareLocationsFixture,
  catalog: squareCatalogFixture,
  inventory: squareInventoryFixture,
};
