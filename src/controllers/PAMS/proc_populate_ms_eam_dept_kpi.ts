import { Request, Response } from 'express';
import oracledb from 'oracledb';

export const proc_populate_ms_eam_dept_kpi = async (
  req: Request,
  res: Response
): Promise<void> => {
  let connection;

  try {
    const { company_code, employee_code, item_type } = req.body;

    /* ================= VALIDATION ================= */
    if (!company_code || !employee_code || !item_type) {
      res.status(400).json({
        success: false,
        message: 'company_code, employee_code and item_type are required'
      });
      return;
    }

    connection = await oracledb.getConnection();

    /* ================= ORACLE CALL ================= */
    await connection.execute(
      `
      BEGIN
        WMSTST.PROC_POPULATE_MS_EAM_DEPT_KPI(
          :company_code,
          :employee_code,
          :item_type
        );
      END;
      `,
      {
        company_code,
        employee_code,
        item_type
      }
    );

    await connection.commit();

    res.json({
      success: true,
      message: 'KPI populated successfully'
    });
  } catch (error: any) {
    console.error('PROC_POPULATE_MS_EAM_DEPT_KPI error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to populate KPI',
      error: error.message
    });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error('Error closing connection', err);
      }
    }
  }
};
