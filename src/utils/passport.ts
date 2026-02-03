// import passport from "passport";
// import passportJWT from "passport-jwt";
// import constants from "../helpers/constants";
// import User from "../models/user";
// import { UserAttribute } from "../interfaces/user.interface";

// const JWTStrategy = passportJWT.Strategy;
// const ExtractJWT = passportJWT.ExtractJwt;

// passport.use(
//   new JWTStrategy(
//     {
//       jwtFromRequest: ExtractJWT.fromAuthHeaderAsBearerToken(),
//       secretOrKey: constants.AUTHENTICATION.APP_SECRET,
//     },
//     async (jwtPayload, cb) => {
//       try {
//         await User.findOne({
//           where: { email_id: jwtPayload.email_id },
//         })
//           .then((user: User | null) => {
//             cb(null, (user ? user.dataValues : null) as UserAttribute);
//           })
//           .catch((err) => {
//             cb(err);
//           });
//       } catch (err) {
//         return cb(err, false);
//       }
//     }
//   )
// );

import passport from "passport";
import passportJWT from "passport-jwt";
import constants from "../helpers/constants";
import { UserService } from "../services/user.service";
import { IUser } from "../interfaces/user.interface";

const JWTStrategy = passportJWT.Strategy;
const ExtractJWT = passportJWT.ExtractJwt;

passport.use(
  new JWTStrategy(
    {
      jwtFromRequest: ExtractJWT.fromAuthHeaderAsBearerToken(),
      secretOrKey: constants.AUTHENTICATION.APP_SECRET || process.env.APP_SECRET || 'BAYANAT',
    },
    async (jwtPayload, cb) => {
      try {
        console.log(`[passport.JWT] STEP 1: Validating JWT payload...`);
        
        // Extract all JWT payload data (includes tenantId!)
        const loginid = jwtPayload.loginid;
        const tenantId = jwtPayload.tenantId;
        const email = jwtPayload.email_id;
        
        console.log(`[passport.JWT] STEP 2: JWT contains: loginid=${loginid}, tenantId=${tenantId}, email=${email}`);
        
        // Build user object with JWT data + database fields
        const userData: any = {
          // From JWT (most important!)
          loginid: jwtPayload.loginid,
          tenantId: jwtPayload.tenantId,
          email_id: jwtPayload.email_id,
          username: jwtPayload.username,
          company_code: jwtPayload.company_code,
          
          // From JWT token payload
          iat: jwtPayload.iat,
          exp: jwtPayload.exp,
        };
        
        console.log(`[passport.JWT] ✅ STEP 3 SUCCESS: User data set: ${userData.loginid}`);
        console.log(`[passport.JWT] ✅ User will have: loginid=${userData.loginid}, tenantId=${userData.tenantId}`);
        
        cb(null, userData);
      } catch (err) {
        console.error(`[passport.JWT] ❌ ERROR:`, err);
        return cb(err, false);
      }
    }
  )
);
