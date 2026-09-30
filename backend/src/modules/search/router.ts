import { Router } from "express";
import { z } from "zod";
import { elastic } from "../../services/elastic.js";
import { prisma } from "../../db/index.js";
import type { Prisma } from "@prisma/client";
export const searchRouter=Router();
searchRouter.get("/",async(req,res,next)=>{
  try {
    const input=z.object({q:z.string().default(""),status:z.enum(["scheduled","sent","sending","failed","delivery_unknown","cancelled"]).optional(),page:z.coerce.number().int().positive().default(1),pageSize:z.coerce.number().int().positive().max(100).default(25)}).parse(req.query);
    const userId=(req.user as {id:string}).id;
    const statuses=input.status==="scheduled"?["scheduled","sending"]:input.status==="sent"?["sent","failed","delivery_unknown"]:input.status?[input.status]:undefined;
    const where:Prisma.EmailWhereInput={batch:{userId},...(statuses?{status:{in:statuses as Prisma.EnumEmailStatusFilter["in"]}}:{}),...(input.q?{OR:[{recipient:{contains:input.q,mode:"insensitive"}},{subject:{contains:input.q,mode:"insensitive"}},{body:{contains:input.q,mode:"insensitive"}}]}:{})};
    try {
      const result=await elastic.search({index:"emails",from:(input.page-1)*input.pageSize,size:input.pageSize,query:{bool:{must:[{term:{userId}},...(statuses?[{terms:{status:statuses}}]:[]),...(input.q?[{multi_match:{query:input.q,fields:["recipient","subject","body"]}}]:[])]}}});
      res.json({items:result.hits.hits.map(hit=>({id:hit._id,...(hit._source as Record<string,unknown>)})),total:typeof result.hits.total==="number"?result.hits.total:result.hits.total?.value??0,page:input.page,pageSize:input.pageSize});
    } catch {
      const [items,total]=await Promise.all([prisma.email.findMany({where,skip:(input.page-1)*input.pageSize,take:input.pageSize,orderBy:{scheduledAt:"desc"}}),prisma.email.count({where})]);
      res.json({items,total,page:input.page,pageSize:input.pageSize});
    }
  } catch(error){next(error)}
});
