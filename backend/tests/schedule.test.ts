import { beforeEach,describe,expect,it,vi } from "vitest";
import express from "express";
import request from "supertest";

const mocks=vi.hoisted(()=>({senderFindMany:vi.fn(),batchFindFirst:vi.fn(),transaction:vi.fn()}));
vi.mock("../src/db/index.js",()=>({prisma:{sender:{findMany:mocks.senderFindMany},batch:{findFirst:mocks.batchFindFirst},$transaction:mocks.transaction}}));
import { scheduleRouter } from "../src/modules/schedule/router.js";

const app=express();app.use(express.json());app.use((req,_res,next)=>{Object.defineProperty(req,"user",{value:{id:"user-1"}});next()});app.use("/schedule",scheduleRouter);
beforeEach(()=>{vi.clearAllMocks();mocks.senderFindMany.mockResolvedValue([{id:"sender-1",isActive:true,circuitOpenUntil:null}]);mocks.batchFindFirst.mockResolvedValue(null);mocks.transaction.mockImplementation(async(run:(tx:unknown)=>Promise<unknown>)=>run({batch:{create:vi.fn().mockResolvedValue({id:"batch-1",totalCount:2})},email:{createMany:vi.fn(),findMany:vi.fn().mockResolvedValue([{id:"email-1"},{id:"email-2"}])},outbox:{createMany:vi.fn()}}))});
describe("POST /schedule",()=>{
  it("creates the batch once and honors the idempotency key",async()=>{const payload={subject:"Hello",body:"Body",recipients:["a@example.com","b@example.com"],startTime:new Date(Date.now()+60000).toISOString(),delayBetweenMs:1000};const first=await request(app).post("/schedule").set("Idempotency-Key","request-1").send(payload);expect(first.status).toBe(201);expect(first.body.totalCount).toBe(2);mocks.batchFindFirst.mockResolvedValue({id:"batch-1",totalCount:2});const replay=await request(app).post("/schedule").set("Idempotency-Key","request-1").send(payload);expect(replay.status).toBe(200);expect(replay.body.idempotentReplay).toBe(true);expect(mocks.transaction).toHaveBeenCalledTimes(1)});
  it("rejects invalid recipients before opening a transaction",async()=>{const response=await request(app).post("/schedule").send({subject:"Hello",body:"Body",recipients:["not-an-email"],startTime:new Date().toISOString(),delayBetweenMs:0});expect(response.status).toBe(400);expect(mocks.transaction).not.toHaveBeenCalled()});
});
