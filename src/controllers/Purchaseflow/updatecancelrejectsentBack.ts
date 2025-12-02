import { Request, Response } from "express";
import oracledb from "oracledb";
import { oracleDb } from "../../../src/database/connection";

interface OutCodeResult {
  outCode: string;
}

interface EmailRow {
  EMAIL_ID: string;
}

export const updateCancelRejectSentBack = async (req: Request, res: Response): Promise<void> => {
  let connection: oracledb.Connection | undefined;

  try {
    const { LAST_ACTION, REQUEST_NUMBER, COMPANY_CODE, loginid, REMARKS, CREATEPR, LEVEL } = req.body;

    if (!LAST_ACTION || !REQUEST_NUMBER || !COMPANY_CODE || !loginid || !REMARKS) {
      res.status(400).json({ success: false, message: "Invalid request data" });
      return;
    }

    connection = await oracleDb.getConnection();
    await connection.execute("ALTER SESSION SET NLS_DATE_FORMAT = 'YYYY-MM-DD HH24:MI:SS'");

    const requestNoForDb = REQUEST_NUMBER.replace(/\//g, "$");
    let generatedRequestNumber: string | null = null;

    console.log("STEP:1 Start");

    // ---------------------------------------------------------------------
    // 1. PO CANCELLATION
    // ---------------------------------------------------------------------
    if (REQUEST_NUMBER.includes("PO$")) {
      const formattedDate = new Date().toISOString().split("T")[0];

      await connection.execute(
        `UPDATE PURCHASE_REQUEST_DETAILS
            SET PO_CANCEL = 'Y',
                REASON_FOR_PO_CANCEL = :remarks,
                CANCEL_PO_BY = :loginid,
                PO_CANCEL_DATE = TO_DATE(:dateStr,'YYYY-MM-DD'),
                UPDATED_AT = SYSDATE
          WHERE REF_DOC_NO = :reqNumber
            AND COMPANY_CODE = :companyCode`,
        {
          remarks: REMARKS,
          loginid,
          dateStr: formattedDate,
          reqNumber: requestNoForDb,
          companyCode: COMPANY_CODE,
        }
      );

      console.log("STEP:2 Cancellation Updated");

      if (CREATEPR === "Y") {
        const spResult = await connection.execute(
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
        `BEGIN PROC_LOADMESSAGEBOX(:screen, :type, :doc, :userId, ''); END;`,
        {
          screen: "POCANCEL",
          type: "success",
          doc: "",
          userId: loginid
        }
      );

      await connection.commit();

      res.status(200).json({
        success: true,
        message: generatedRequestNumber
          ? `New PR Generated: ${generatedRequestNumber}`
          : "PO Cancelled Successfully",
        generatedRequestNumber,
      });

      return;
    }

    console.log("STEP:3 PR Sentback Handling");

    // ---------------------------------------------------------------------
    // 2. MATERIAL REQUEST SENT BACK
    // ---------------------------------------------------------------------
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
        {
          lastAction: LAST_ACTION,
          loginid,
          level: LEVEL,
          remarks: REMARKS,
          reqNumber: requestNoForDb,
          companyCode: COMPANY_CODE,
        }
      );

      await connection.commit();
      res.status(200).json({ success: true, message: "Updated Successfully" });
      return;
    }
console.log('befor sentback');
// create a local variable to avoid using reserved word 'level'
const l_level = LEVEL;
    // ---------------------------------------------------------------------
    // 3. NORMAL PR SENT BACK
    // ---------------------------------------------------------------------
    if (LAST_ACTION === "SENTBACK") {
      await connection.execute(
  `UPDATE PURCHASE_REQUEST_HEADER
     SET LAST_ACTION = :lastAction,
         UPDATED_AT = SYSDATE,
         UPDATED_BY = :loginid,
         FLOW_LEVEL_RUNNING = :l_level,
         SENDBACK_HISTRY = NVL(SENDBACK_HISTRY,'') || '; ' || TO_CHAR(:remarks)
   WHERE REQUEST_NUMBER = :reqNumber
     AND COMPANY_CODE = :companyCode`,
  {
    lastAction: LAST_ACTION,
    loginid,
    l_level: LEVEL,
    remarks: REMARKS,
    reqNumber: requestNoForDb,
    companyCode: COMPANY_CODE,
  }
);

console.log('updated sentback');
      await connection.execute(
        `BEGIN PROC_LOADMESSAGEBOX(:screen, :type, :doc, :userId, ''); END;`,
        {
          screen: "PRSENTBACK",
          type: "success",
          doc: "",
          userId: loginid
        }
      );
    } else {
      // other actions (APPROVE/REJECT etc)
      await connection.execute(
        `UPDATE PURCHASE_REQUEST_HEADER
         SET LAST_ACTION = :lastAction,
             UPDATED_AT = SYSDATE,
             UPDATED_BY = :loginid
         WHERE REQUEST_NUMBER = :reqNumber
           AND COMPANY_CODE = :companyCode`,
        {
          lastAction: LAST_ACTION,
          loginid,
          reqNumber: requestNoForDb,
          companyCode: COMPANY_CODE,
        }
      );
    }

    console.log("STEP:4 PR Updated");

    await connection.commit();

    // ---------------------------------------------------------------------
    // 4. FETCH CC EMAIL
    // ---------------------------------------------------------------------
    const ccResult = await connection.execute<EmailRow>(
      `SELECT sl.email_id AS EMAIL_ID
         FROM PURCHASE_REQUEST_HEADER prh
         LEFT JOIN SEC_LOGIN sl 
           ON prh.CREATED_BY = sl.user_id
        WHERE prh.REQUEST_NUMBER = :reqNumber
          AND ROWNUM = 1`,
      { reqNumber: requestNoForDb },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const ccEmail = ccResult.rows?.[0]?.EMAIL_ID || "";

    // ---------------------------------------------------------------------
    // 5. FETCH USER EMAIL (LAST_UPDATED)
    // ---------------------------------------------------------------------
    const emailResult = await connection.execute<EmailRow>(
      `SELECT email_id AS EMAIL_ID
         FROM SEC_LOGIN
        WHERE LOGINID IN (
              SELECT DISTINCT LAST_UPDATED
              FROM PURCHASE_REQUST_RUNING_STATS
              WHERE REQUEST_NUMBER = :reqNumber
        )`,
      { reqNumber: requestNoForDb },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const userEmail = emailResult.rows?.[0]?.EMAIL_ID || "";

    const finalUserEmails =
      LAST_ACTION === "SENTBACK"
        ? `${userEmail},admin1@the-maintainers.com`
        : userEmail;

    console.log("STEP:5 Email fetched");

    res.status(200).json({
      success: true,
      message: "Updated Successfully",
      ccEmail,
      userEmails: finalUserEmails
    });

  } catch (error) {
    console.error("Error occurred, rolling back transaction:", error);
    if (connection) await connection.rollback();
    res.status(500).json({ success: false, message: "Update Unsuccessful" });
  } finally {
    if (connection) await connection.close();
  }
};
