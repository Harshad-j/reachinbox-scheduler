import { describe, expect, it } from "vitest";
import { selectSender } from "../src/services/senderSelector.js";
describe("selectSender", () => {
  it("skips inactive and circuit-open senders", () => {
    const now = new Date(); const result = selectSender([{ id:"bad",isActive:false,circuitOpenUntil:null },{id:"open",isActive:true,circuitOpenUntil:new Date(now.getTime()+1000)},{id:"ok",isActive:true,circuitOpenUntil:null}],now);
    expect(result.id).toBe("ok");
  });
});
