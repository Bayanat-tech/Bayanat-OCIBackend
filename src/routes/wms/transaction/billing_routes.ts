import express, { Request, Response, NextFunction } from "express";
import passport from "passport";
import { updatebilling } from "../../../controllers/billing/updatebilling";

const router = express.Router();

//router.use(express.json()); // parses JSON for this router only
router.post("/updatebilling", updatebilling);

export default router;
