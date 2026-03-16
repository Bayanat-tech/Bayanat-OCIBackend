import { IUser } from "../../../interfaces/user.interface";
import express, {
  Request,
  Response,
  RequestHandler,
  NextFunction,
} from "express";


export interface RequestWithUser extends Request {
  user?: IUser; // Optional user if not always present
}

const router = express.Router();

console.log("gm_purchaserequest.routes.ts");



export default router;
