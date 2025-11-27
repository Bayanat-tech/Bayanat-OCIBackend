import { Request, Response } from "express";
import oracledb from "oracledb";
import { oracleDb } from "../../../src/database/connection";


import { QueryTypes } from "sequelize";
import { upsertPurchaseRequest } from "./purchaseRquestdbupdate_pf.Controller";
import { createLog, notifyUser } from "../../helpers/functions";
import constants from "../../helpers/constants";
import { format } from "date-fns";
import { IFiles, RequestWithUser } from "../../interfaces/common.interface";
import { IUser } from "../../interfaces/user.interface";
import { setUserLevel } from "../../helpers/globalVariables";
import { BoldReportsController } from "../BoldReportsController";
import {
  IPurchaseOrder,
  IPurchaseRequestPf,
  IItemPrRequest,
  IPrtermnscondition,
  IBasicPrRequest,
} from "../../interfaces/Purchaseflow/Purucahseflow.interface";
interface OutCodeResult {
  outCode: string;
}

interface EmailResult {
  EMAIL_ID: string;
}

export const updateCancelRejectSentBack = async (req: Request, res: Response): Promise<void> => {
  let connection;

  try {
    //console.log("Incoming request data:", req.body);
    const { LAST_ACTION, REQUEST_NUMBER, COMPANY_CODE, loginid, REMARKS, CREATEPR, LEVEL } = req.body;

    if (!LAST_ACTION || !REQUEST_NUMBER || !COMPANY_CODE || !loginid || !REMARKS) {
      res.status(400).json({ success: false, message: "Invalid request data" });
      return;
    }

    connection = await oracleDb.getConnection();
    await connection.execute("ALTER SESSION SET NLS_DATE_FORMAT = 'YYYY-MM-DD HH24:MI:SS'");

    const requestNoForDb = REQUEST_NUMBER.replace(/\//g, "$");
    let generatedRequestNumber: string | null = null;

    // PO cancellation
    if (REQUEST_NUMBER.includes("PO$")) {
      const todayDate = new Date();
      const formattedDate = todayDate.toISOString().split("T")[0];

      await connection.execute(
        `UPDATE PURCHASE_REQUEST_DETAILS
         SET PO_CANCEL = 'Y',
             REASON_FOR_PO_CANCEL = :remarks,
             CANCEL_PO_BY = :loginid,
             PO_CANCEL_DATE = TO_DATE(:dateStr,'YYYY-MM-DD'),
             UPDATED_AT = SYSDATE
         WHERE REF_DOC_NO = :reqNumber
           AND COMPANY_CODE = :companyCode`,
        { remarks: REMARKS, loginid, dateStr: formattedDate, reqNumber: requestNoForDb, companyCode: COMPANY_CODE }
      );

      if (CREATEPR === "Y") {
        const spResult = await connection.execute<{ outCode: string }>(
          `BEGIN PRO_GEN_PR_FOR_CANCEL_PO(:companyCode, :reqNumber, 'BUYER', 'FULL', :outCode); END;`,
          {
            companyCode: COMPANY_CODE,
            reqNumber: requestNoForDb,
            outCode: { dir: oracledb.BIND_OUT, type: oracledb.STRING },
          }
        );

        generatedRequestNumber = (spResult.outBinds as OutCodeResult).outCode || null;
      }

      await connection.execute(
        `BEGIN PROC_LOADMESSAGEBOX(:screen, :type, :document_number, :userId, ''); END;`,
        { screen: "POCANCEL", type: "success", document_number: "", userId: loginid }
      );

      await connection.commit();
      res.status(200).json({
        success: true,
        message: generatedRequestNumber ? `New PR Generated: ${generatedRequestNumber}` : "PO Cancelled Successfully",
        generatedRequestNumber,
      });
      return;
    }

    // PR updates
    if (LAST_ACTION === "SENTBACK" && REQUEST_NUMBER.includes("MAT$")) {
      await connection.execute(
        `UPDATE MATERIAL_REQUEST_HEADER
         SET LAST_ACTION = :lastAction,
             UPDATED_AT = SYSDATE,
             UPDATED_BY = :loginid,
             FLOW_LEVEL_RUNNING = :level,
             SENDBACK_HISTRY = NVL(SENDBACK_HISTRY,'') || '; ' || :remarks
         WHERE REQUEST_NUMBER = :reqNumber
           AND COMPANY_CODE = :companyCode`,
        { lastAction: LAST_ACTION, loginid, level: LEVEL, remarks: REMARKS, reqNumber: requestNoForDb, companyCode: COMPANY_CODE }
      );

      await connection.commit();
      res.status(200).json({ success: true, message: "Updated Successfully" });
      return;
    }

    if (LAST_ACTION === "SENTBACK") {
      await connection.execute(
        `UPDATE PURCHASE_REQUEST_HEADER
         SET LAST_ACTION = :lastAction,
             UPDATED_AT = SYSDATE,
             UPDATED_BY = :loginid,
             FLOW_LEVEL_RUNNING = :level,
             SENDBACK_HISTRY = NVL(SENDBACK_HISTRY,'') || '; ' || :remarks
         WHERE REQUEST_NUMBER = :reqNumber
           AND COMPANY_CODE = :companyCode`,
        { lastAction: LAST_ACTION, loginid, level: LEVEL, remarks: REMARKS, reqNumber: requestNoForDb, companyCode: COMPANY_CODE }
      );

      await connection.execute(
        `BEGIN PROC_LOADMESSAGEBOX(:screen, :type, :document_number, :userId, ''); END;`,
        { screen: "PRSENTBACK", type: "success", document_number: "", userId: loginid }
      );
    } else {
      await connection.execute(
        `UPDATE PURCHASE_REQUEST_HEADER
         SET LAST_ACTION = :lastAction,
             UPDATED_AT = SYSDATE,
             UPDATED_BY = :loginid
         WHERE REQUEST_NUMBER = :reqNumber
           AND COMPANY_CODE = :companyCode`,
        { lastAction: LAST_ACTION, loginid, reqNumber: requestNoForDb, companyCode: COMPANY_CODE }
      );
    }

    await connection.commit();

    // Fetch CC email
    const ccResult = await connection.execute<EmailResult>(
      `SELECT prh.CREATED_BY, sl.email_id
       FROM PURCHASE_REQUEST_HEADER prh
       LEFT JOIN SEC_LOGIN sl ON prh.CREATED_BY = sl.user_id
       WHERE prh.REQUEST_NUMBER = :reqNumber AND ROWNUM = 1`,
      { reqNumber: requestNoForDb },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const ccEmail = ccResult.rows?.[0]?.EMAIL_ID || "";

    // Fetch last updater email(s)
    const emailResult = await connection.execute<EmailResult>(
      `SELECT email_id FROM SEC_LOGIN
       WHERE LOGINID IN (
         SELECT DISTINCT LAST_UPDATED FROM PURCHASE_REQUST_RUNING_STATS
         WHERE REQUEST_NUMBER = :reqNumber
       )`,
      { reqNumber: requestNoForDb },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const userEmails =
      emailResult.rows?.[0]?.EMAIL_ID
        ? LAST_ACTION === "SENTBACK"
          ? `${emailResult.rows[0].EMAIL_ID},admin1@the-maintainers.com`
          : emailResult.rows[0].EMAIL_ID
        : LAST_ACTION === "SENTBACK"
        ? "admin1@the-maintainers.com"
        : "";

    res.status(200).json({ success: true, message: "Updated Successfully", ccEmail, userEmails });
  } catch (error) {
    console.error("Error occurred, rolling back transaction:", error);
    if (connection) await connection.rollback();
    res.status(500).json({ success: false, message: "Update Unsuccessful" });
  } finally {
    if (connection) await connection.close();
  }
};
