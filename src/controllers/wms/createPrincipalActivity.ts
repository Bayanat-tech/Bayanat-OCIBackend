import oracledb from "oracledb";
import { Response } from "express";

export const createPrincipalActivity = async (req: any, res: Response) => {
  let connection: oracledb.Connection | undefined;

  try {
    const {
      
      prin_code,
      act_code,
      company_code,
      bill_amount,
      jobtype,
      cost,
      uoc,
      moc1,
      moc2,
    } = req.body;

    const loginId = req.user.loginid;

    // ✅ Get connection from Oracle pool
    connection = await oracledb.getConnection();

    const sql = `
      MERGE INTO MS_ACTIVITY_BILLING t
      USING (
        SELECT
          :prin_code AS prin_code,
          :act_code AS act_code,
          :company_code AS company_code
        FROM dual
      ) s
      ON (
        t.prin_code = s.prin_code
        AND t.act_code = s.act_code
        AND t.company_code = s.company_code
      )
      WHEN MATCHED THEN
        UPDATE SET
          t.bill_amount = :bill_amount,
          t.jobtype = :jobtype,
          t.cost = :cost,
          t.uoc = :uoc,
          t.moc1 = :moc1,
          t.moc2 = :moc2,
          t.updated_by = :updated_by,
          t.updated_at = SYSDATE
      WHEN NOT MATCHED THEN
        INSERT (
          prin_code,
          act_code,
          company_code,
          bill_amount,
          jobtype,
          cost,
          uoc,
          moc1,
          moc2,
          created_by,
          created_at
        )
        VALUES (
          :prin_code,
          :act_code,
          :company_code,
          :bill_amount,
          :jobtype,
          :cost,
          :uoc,
          :moc1,
          :moc2,
          :created_by,
          SYSDATE
        )
    `;

    await connection.execute(
      sql,
      {
        prin_code,
        act_code,
        company_code,
        bill_amount,
        jobtype,
        cost,
        uoc,
        moc1,
        moc2,
        created_by: loginId,
        updated_by: loginId,
      },
      { autoCommit: true }
    );

    res.status(200).json({
      success: true,
      message: "Activity billing record inserted/updated successfully",
    });
  } catch (error: any) {
    console.error("Oracle MERGE error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create/update activity billing",
      error: error.message,
    });
  } finally {
    if (connection) {
      try {
        await connection.close(); // returns to pool
      } catch (err) {
        console.error("Error closing Oracle connection", err);
      }
    }
  }
};
