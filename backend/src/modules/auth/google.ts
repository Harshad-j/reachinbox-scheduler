import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { env } from "../../config/env.js";
import { prisma } from "../../db/index.js";

if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({ clientID:env.GOOGLE_CLIENT_ID,clientSecret:env.GOOGLE_CLIENT_SECRET,callbackURL:env.GOOGLE_CALLBACK_URL,state:true }, async (_access,_refresh,profile,done)=>{
    try { const email=profile.emails?.[0]?.value; if(!email) return done(new Error("Google account did not provide an email"));
      const user=await prisma.user.upsert({where:{googleId:profile.id},update:{email,name:profile.displayName,avatarUrl:profile.photos?.[0]?.value},create:{googleId:profile.id,email,name:profile.displayName,avatarUrl:profile.photos?.[0]?.value}}); done(null,user);
    } catch(error){done(error as Error)}
  }));
}
passport.serializeUser((user,done)=>done(null,(user as {id:string}).id));
passport.deserializeUser(async(id:string,done)=>{try{done(null,await prisma.user.findUnique({where:{id}}))}catch(error){done(error as Error)}});
