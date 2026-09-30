import nodemailer from "nodemailer";
import "../backend/src/config/env.js";
import { prisma } from "../backend/src/db/index.js";
import { encryptSecret } from "../backend/src/services/crypto.js";
async function main() {
  const count=Math.max(1,Number(process.argv[2]??3));
  for(let index=0;index<count;index++){const account=await nodemailer.createTestAccount();await prisma.sender.upsert({where:{email:account.user},update:{smtpPass:encryptSecret(account.pass),isActive:true},create:{email:account.user,smtpHost:account.smtp.host,smtpPort:account.smtp.port,smtpUser:account.user,smtpPass:encryptSecret(account.pass)}});console.log(`Seeded Ethereal sender ${index+1}/${count}: ${account.user}`)}
}
main().finally(() => prisma.$disconnect());
