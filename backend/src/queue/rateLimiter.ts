import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { redis } from "../redis/index.js";
import { env } from "../config/env.js";
const script = await readFile(fileURLToPath(new URL("./rateLimit.lua", import.meta.url)),"utf8");
export type RateDecision = { windowOffset:number; windowStartMs:number; hitLimit:boolean; position:number; delayedCount:number };
export async function reserveRateSlot(senderId:string,limit:number,now=Date.now(),globalLimit=env.MAX_EMAILS_PER_HOUR_GLOBAL??0):Promise<RateDecision>{
  const result=await redis.eval(script,2,`rl:{${senderId}}`,`rl:{global}`,String(limit),String(globalLimit),String(now),String(env.RATE_LIMIT_TTL_MS),String(env.MAX_RATE_WINDOW_PROBES)) as number[];
  return {windowOffset:Number(result[0]),windowStartMs:Number(result[1]),hitLimit:Number(result[2])===1,position:Number(result[3]),delayedCount:Number(result[4]??0)};
}
