import { afterAll,describe,expect,it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Redis } from "ioredis";
import { randomUUID } from "node:crypto";

const redisUrl=process.env.TEST_REDIS_URL;
const redis=redisUrl?new Redis(redisUrl):null;
afterAll(async()=>{await redis?.quit()});
describe.skipIf(!redis)("rate-limit Lua atomic admission",()=>{
  it("does not over-admit 1000 concurrent reservations into five 200-email windows",async()=>{
    const sender=randomUUID();const prefix=`rl:{${sender}}`;const lua=await readFile(fileURLToPath(new URL("../src/queue/rateLimit.lua",import.meta.url)),"utf8");const now=Date.now();
    const results=await Promise.all(Array.from({length:1000},()=>redis!.eval(lua,2,prefix,"rl:{global}","200","0",String(now),"7200000","48") as Promise<number[]>));
    const counts=new Map<number,number>();for(const result of results){const offset=Number(result[0]);counts.set(offset,(counts.get(offset)??0)+1)}
    expect([...counts.keys()].sort((a,b)=>a-b)).toEqual([0,1,2,3,4]);expect([...counts.values()]).toEqual([200,200,200,200,200]);
    const keys=await redis!.keys(`${prefix}*`);if(keys.length)await redis!.del(...keys);
  },30000);
  it("enforces the optional global quota across independent senders",async()=>{
    const testRun=randomUUID();const senderA=`rl:{${testRun}-a}`;const senderB=`rl:{${testRun}-b}`;const globalKey=`rl:{global-${testRun}}`;const lua=await readFile(fileURLToPath(new URL("../src/queue/rateLimit.lua",import.meta.url)),"utf8");const now=Date.now();
    const calls=Array.from({length:20},(_,index)=>redis!.eval(lua,2,index%2?senderA:senderB,globalKey,"20","7",String(now),"7200000","48") as Promise<number[]>);
    const results=await Promise.all(calls);const currentWindow=results.filter(result=>Number(result[0])===0);
    expect(currentWindow).toHaveLength(7);
    for(const key of [senderA,senderB,globalKey]){const keys=await redis!.keys(`${key}:*`);if(keys.length)await redis!.del(...keys)}
  },30000);
});
