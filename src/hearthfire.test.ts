/**
 * The loading screen's fire is one file in two places: the app's, and a copy
 * in the APK's assets for the phone's boot.html. They must be the same file.
 *
 *   bun test src/hearthfire.test.ts
 */
import { expect, test } from "bun:test";

test("the phone's copy of the fire is the app's", async () => {
  const app = await Bun.file("public/hearthfire.js").text();
  const phone = await Bun.file("mobile/android/app/src/main/assets/hearthfire.js").text();
  expect(phone).toBe(app);
  expect(await Bun.file("mobile/android/app/src/main/assets/boot.html").text()).toContain('<script src="hearthfire.js"></script>');
});
