import { Queue } from "bullmq";
import { redis } from "../redis/index.js";
export const emailQueue = new Queue("emails", { connection: redis });
export const maintenanceQueue = new Queue("maintenance", { connection: redis });
