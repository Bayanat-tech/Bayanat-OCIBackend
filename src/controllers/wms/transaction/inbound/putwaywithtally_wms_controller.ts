import { Response } from "express";
import oracledb from "oracledb";
import { oracleDb } from "../../../../database/connection";
import constants from "../../../../helpers/constants";
import { RequestWithUser } from "../../../../interfaces/common.interface";

export const Putawaywithpalletid = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  const { prin_code, job_no, prod_code, packdet_no, pallet_id, location_from } = req.body;

  let connection: oracledb.Connection | undefined;

  try {
    connection = await oracleDb.getConnection();
    await connection.execute("BEGIN NULL; END;"); // Ensure connection

    const replacementsFlag = {
      p_flag: "Y",
      p_company_code: req.user.company_code,
      p_prin_code: prin_code,
      p_job_no: job_no,
      p_prod_code: prod_code,
      p_packdet_no: packdet_no,
      p_pallet_id: pallet_id,
      p_location_code: location_from,
    };

    // Step 1: Set flag = 'Y'
    await connection.execute(
      `BEGIN SP_UPDATE_FLAG_BF_SP_PUT_TALLY(
          :p_flag, :p_company_code, :p_prin_code, :p_job_no, 
          :p_prod_code, :p_packdet_no, :p_pallet_id, :p_location_code
        ); END;`,
      replacementsFlag
    );

    try {
      // Step 2: Call Putaway procedure
      await connection.execute(
        `BEGIN SP_PUTAWAY_MADINA_WITHTALLY(
          :vs_company_code, :principal_code, :vs_job_no
        ); END;`,
        {
          vs_company_code: req.user.company_code,
          principal_code: prin_code,
          vs_job_no: job_no,
        }
      );

      // Commit if everything succeeds
      await connection.commit();

      res.status(constants.STATUS_CODES.OK).json({
        success: true,
        message: "Putaway with pallet id processed successfully",
      });
    } catch (putawayError) {
      // Step 3: Rollback flag = 'N' if putaway fails
      await connection.execute(
        `BEGIN SP_UPDATE_FLAG_BF_SP_PUT_TALLY(
            :p_flag, :p_company_code, :p_prin_code, :p_job_no, 
            :p_prod_code, :p_packdet_no, :p_pallet_id, :p_location_code
          ); END;`,
        { ...replacementsFlag, p_flag: "N" }
      );

      await connection.rollback();
      throw putawayError;
    }
  } catch (error: any) {
    res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: error.message || "Error processing putaway with pallet id",
    });
  } finally {
    if (connection) await connection.close();
  }
};
