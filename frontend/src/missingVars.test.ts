import { describe, expect, it } from "vitest";
import { chosenKeys, createLabel, emptyText, initialSelection, resultLines, toggleAll, toggleKey } from "./missingVars";

describe("Add missing variables", () => {
  const keys = ["access_token", "product_id", "seller_id"];
  it("all checked at first; toggles; select-all flips between all and none", () => {
    let sel = initialSelection(keys);
    expect(chosenKeys(sel, keys)).toEqual(keys);
    sel = toggleKey(sel, "product_id");
    expect(chosenKeys(sel, keys)).toEqual(["access_token", "seller_id"]);
    sel = toggleAll(sel, keys); // not all → all
    expect(chosenKeys(sel, keys)).toEqual(keys);
    sel = toggleAll(sel, keys); // all → none
    expect(chosenKeys(sel, keys)).toEqual([]);
  });
  it("wording", () => {
    expect(createLabel(0)).toBe("Create");
    expect(createLabel(1)).toBe("Create 1 variable");
    expect(createLabel(7)).toBe("Create 7 variables");
    expect(emptyText("dev")).toBe("No missing variables — every {{variable}} this project uses exists in dev.");
    expect(resultLines({ created: ["a", "b"], failed: [{ key: "c", message: "already exists" }] }))
      .toEqual({ ok: "Created 2 variables — fill in their values in the table.", errors: ["c: already exists"] });
  });
});
