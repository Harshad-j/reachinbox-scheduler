import { describe, expect, it } from "vitest";
import { interruptedSendStatus, isAmbiguousSmtpFailure } from "../src/services/deliveryRecovery.js";

describe("email send recovery", () => {
  it("does not automatically retry a network failure after SMTP may have accepted the message", () => {
    expect(isAmbiguousSmtpFailure(Object.assign(new Error("socket closed"), { code: "ECONNRESET" }))).toBe(true);
    expect(interruptedSendStatus(new Date())).toBe("delivery_unknown");
  });

  it("allows retry when the worker stopped before entering SMTP", () => {
    expect(interruptedSendStatus(null)).toBe("scheduled");
  });

  it("retries explicit SMTP 4xx responses because the provider rejected acceptance", () => {
    expect(isAmbiguousSmtpFailure(Object.assign(new Error("try later"), { code: "ETIMEDOUT", responseCode: 421 }))).toBe(false);
  });
});
