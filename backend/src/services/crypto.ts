import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../config/env.js";
function getKey():Buffer{const key=Buffer.from(env.ENCRYPTION_KEY,"hex");if(key.length!==32)throw new Error("ENCRYPTION_KEY needs 64 hex characters");return key}
export function encryptSecret(value:string):string{const iv=randomBytes(12);const cipher=createCipheriv("aes-256-gcm",getKey(),iv);const encrypted=Buffer.concat([cipher.update(value),cipher.final()]);const tag=cipher.getAuthTag();return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`}
export function decryptSecret(value:string):string{const [iv,tag,data]=value.split(":");if(!iv||!tag||!data)throw new Error("Invalid encrypted secret");const decipher=createDecipheriv("aes-256-gcm",getKey(),Buffer.from(iv,"hex"));decipher.setAuthTag(Buffer.from(tag,"hex"));return Buffer.concat([decipher.update(Buffer.from(data,"hex")),decipher.final()]).toString()}
