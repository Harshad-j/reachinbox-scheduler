import { describe,expect,it } from "vitest";
import { parseRecipientCells } from "./recipients";
describe("parseRecipientCells",()=>{it("deduplicates valid email addresses and counts invalid cells",()=>{expect(parseRecipientCells(["a@example.com","a@example.com","bad"])).toEqual({recipients:["a@example.com"],invalidCount:2})})});
