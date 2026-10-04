import { describe, expect, it } from "vitest";
import { PLACE_CATEGORY_GROUPS, groupForRawCategory, parseCategoryGroups, rawCategoryPrefixesForGroups } from "@/lib/places/categories";

describe("owner-defined place categories", () => {
  it("classifies and filters only the five owner categories, never Geoapify labels", () => {
    for (const [raw, expected] of [["restaurant","restaurant"],[" cafe ","cafe"],["patisserie","patisserie"],["voyage","voyage"],["divers","divers"],["catering.fast_food","divers"],["catering.cafe","divers"],["beach","divers"],[null,"divers"],["","divers"]]) {
      expect(groupForRawCategory(raw)).toBe(expected);
    }
    expect(parseCategoryGroups("cafe,voyage,divers,cafe,hotel,unknown")).toEqual(["cafe","voyage","divers"]);
    expect(rawCategoryPrefixesForGroups(["cafe","cafe","restaurant"])).toEqual(["cafe","restaurant"]);
    expect(PLACE_CATEGORY_GROUPS.find(g=>g.key==="cafe")?.label).toBe("Café & brunch");
  });
});
