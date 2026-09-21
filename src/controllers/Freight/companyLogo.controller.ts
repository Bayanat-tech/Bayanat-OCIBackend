import { Response, NextFunction } from 'express';
import oracledb from 'oracledb';
import TenantManager from '../../database/TenantManager';
import { getCurrentTenantId } from '../../middleware/tenantContext.middleware';
import { RequestWithUser } from '../../interfaces/common.interface';

/**
 * @fileoverview Company Logo Controller - Fetches company logo directly from MS_COMPANY
 * using raw SQL for optimal performance
 */

/**
 * GET /api/freight/company-logo?company_code=BSG
 * Lightweight lookup: MS_COMPANY has multiple rows per tenant (e.g. BSG, DEMO),
 * so company_code must be passed explicitly.
 *
 * @returns { success: boolean, data: { COMPANY_LOGO_AWSURL: string, COMPANY_LOGO: string } }
 */
export async function getCompanyLogoDirect(req: RequestWithUser, res: Response, next: NextFunction): Promise<void> {
    let conn: oracledb.Connection | undefined;

    try {
        const { company_code } = req.query;

        if (!company_code) {
            res.status(400).json({
                success: false,
                message: "Company code is required"
            });
            return;
        }

        let tenantId = getCurrentTenantId();
        if (!tenantId) tenantId = await TenantManager.getTenantForUser(req.user.loginid);
        if (!tenantId) {
            throw Object.assign(new Error("Unable to determine tenant database"), { status: 400 });
        }

        conn = await TenantManager.getConnection(tenantId);

        const result = await conn.execute(
            `SELECT COMPANY_LOGO_AWSURL, COMPANY_LOGO 
             FROM MS_COMPANY 
             WHERE COMPANY_CODE = :company_code`,
            { company_code: company_code },
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        if (result.rows && result.rows.length > 0) {
            res.status(200).json({
                success: true,
                data: result.rows[0]
            });
        } else {
            res.status(404).json({
                success: false,
                message: "Company logo not found for the provided code"
            });
        }

    } catch (error) {
        next(error);
    } finally {
        if (conn) {
            try {
                await conn.close();
            } catch (e) {
                console.warn("Close conn error:", e);
            }
        }
    }
}