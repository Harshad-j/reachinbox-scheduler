import { describe, expect, it } from "vitest";
import { classifyDeliveryError } from "../src/services/errorClassifier.js";
describe("classifyDeliveryError", () => {
  it("fails permanent SMTP responses immediately", () => expect(classifyDeliveryError({responseCode:550,message:"bad address"}).transient).toBe(false));
  it("retries temporary SMTP responses", () => expect(classifyDeliveryError({responseCode:450,message:"try again"}).transient).toBe(true));
});
