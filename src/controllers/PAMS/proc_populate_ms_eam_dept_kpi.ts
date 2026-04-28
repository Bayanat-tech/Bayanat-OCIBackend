import { Request, Response } from 'express';
import { QueryExecutor } from '../../database/QueryExecutor';

export const proc_populate_ms_eam_dept_kpi = async (
  req: Request,
  res: Response
): Promise<void> => {
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

    /* ================= ORACLE CALL (Tenant-Aware) ================= */
    await QueryExecutor.executeRawQuery(
      `
      BEGIN
        PROC_POPULATE_BULK_MS_EAM_DEPT_KPI(
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
  }
};
