import assert from "node:assert/strict";
import { parseRecipientCells } from "../src/lib/recipients.ts";
assert.deepEqual(parseRecipientCells(["a@example.com","a@example.com","invalid"]),{recipients:["a@example.com"],invalidCount:2});
console.log("CSV recipient parsing passed");
