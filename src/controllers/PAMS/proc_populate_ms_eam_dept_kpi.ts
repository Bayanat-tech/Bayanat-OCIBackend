import { Response } from 'express';
import { QueryExecutor } from '../../database/QueryExecutor';
import { RequestWithUser } from '../../interfaces/common.interface';
import { getPamsTenantSchema } from './pamsTenantSafety';

export const proc_populate_ms_eam_dept_kpi = async (
  req: RequestWithUser,
  res: Response
): Promise<void> => {
  try {
    const { company_code, employee_code, item_type } = req.body;
    const authenticatedCompanyCode = String(req.user?.company_code || '').trim();

    /* ================= VALIDATION ================= */
    if (!company_code || !employee_code || !item_type) {
      res.status(400).json({
        success: false,
        message: 'company_code, employee_code and item_type are required'
      });
      return;
    }

    if (!authenticatedCompanyCode || String(company_code).trim().toUpperCase() !== authenticatedCompanyCode.toUpperCase()) {
      res.status(403).json({
        success: false,
        message: 'The requested company does not match the authenticated company'
      });
      return;
    }

    const tenantSchema = await getPamsTenantSchema();

    /* ================= ORACLE CALL (Tenant-Aware) ================= */
    await QueryExecutor.executeRawQuery(
      `
      BEGIN
        ${tenantSchema}.PROC_POPULATE_BULK_MS_EAM_DEPT_KPI(
          :company_code,
          :employee_code,
          :item_type
        );
      END;
      `,
      {
        company_code: authenticatedCompanyCode,
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
