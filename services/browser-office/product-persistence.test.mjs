import assert from "node:assert/strict";
import test from "node:test";

import { persistedSectionsMatch } from "./harness/product-persistence.mjs";

const opening = {
  id: "{11111111-1111-4111-8111-111111111111}",
  name: "Opening",
  startSlideIndex: 0,
};
const details = {
  id: "{22222222-2222-4222-8222-222222222222}",
  name: "Details",
  startSlideIndex: 1,
};

test("a package-only section edit must persist exact identity and order", () => {
  assert.equal(persistedSectionsMatch([], [], 2), true);
  assert.equal(
    persistedSectionsMatch(
      [opening, details],
      [
        { ...opening, slideCount: 1 },
        { ...details, slideCount: 1 },
      ],
      2,
    ),
    true,
  );
  assert.equal(
    persistedSectionsMatch([opening, details], [details, opening], 2),
    false,
  );
  assert.equal(
    persistedSectionsMatch(
      [opening, details],
      [opening, { ...details, name: "Changed" }],
      2,
    ),
    false,
  );
  assert.equal(persistedSectionsMatch([opening], [], 2), false);
  assert.equal(
    persistedSectionsMatch(
      [opening, details],
      [
        { ...opening, slideCount: 1 },
        { ...details, slideCount: 0 },
      ],
      2,
    ),
    false,
  );
});
