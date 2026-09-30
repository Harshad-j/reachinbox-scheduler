import "./config/env.js";
import { emailWorker } from "./queue/emailWorker.js";
import { redis } from "./redis/index.js";
import { prisma } from "./db/index.js";
import { logger } from "./logger/index.js";
import { reconcileScheduled } from "./queue/reconcile.js";
import { startMaintenanceSchedulers } from "./queue/sweeper.js";
import { emailQueue, maintenanceQueue } from "./queue/emailQueue.js";
import { elastic } from "./services/elastic.js";

await reconcileScheduled();
const maintenanceWorker=await startMaintenanceSchedulers();
logger.info("Email worker ready");
let shuttingDown=false;
async function shutdown():Promise<void>{if(shuttingDown)return;shuttingDown=true;logger.info("Worker shutdown started");await Promise.all([emailWorker.close(),maintenanceWorker.close()]);await Promise.all([emailQueue.close(),maintenanceQueue.close()]);await prisma.$disconnect();await redis.quit();await elastic.close();logger.info("Worker shutdown complete")}
for(const signal of ["SIGTERM","SIGINT"] as const)process.on(signal,()=>{void shutdown().then(()=>process.exit(0)).catch(error=>{logger.error({error},"Worker shutdown failed");process.exit(1)})});
