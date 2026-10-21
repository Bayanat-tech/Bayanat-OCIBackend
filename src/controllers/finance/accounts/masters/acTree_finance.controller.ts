// Import required dependencies and interfaces
import { Response } from "express";
import constants from "../../../../helpers/constants";
import {
  RequestWithUser,
} from "../../../../interfaces/common.interface";
import { IUser } from "../../../../interfaces/user.interface";

// Import validation schemas
import {
  accountFinanceSchema,
  accountLevelFourFinanceSchema,
  accountLevelThreeFinanceSchema,
  accountLevelTwoFinanceSchema
} from "../../../../validation/finance/accounts/masters.validation";
import { buildHierarchy } from "../../../../helpers/functions";
import oracledb from "oracledb";
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";

function paramValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

// Helper to fetch all rows from an Oracle SYS_REFCURSOR
async function fetchAllFromCursor(cursor: oracledb.ResultSet<any>): Promise<any[]> {
  const rows: any[] = [];
  let chunk: any[];
  while ((chunk = await cursor.getRows(1000)) && chunk.length > 0) {
    rows.push(...chunk);
  }
  await cursor.close();
  return rows;
}

// =========================================================================
// 1. GET COMPLETE ACCOUNT TREE HIERARCHY
// =========================================================================
export const getAcTree = async (req: RequestWithUser, res: Response) => {
  let connection: oracledb.Connection | undefined;
  try {
    const requestUser: IUser = req.user;
    const tenantId = getCurrentTenantId();
    
    if (!tenantId) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Tenant context not found"
      });
      return;
    }
    
    connection = await TenantManager.getConnection(tenantId);

    // Call database stored procedure
    const result: any = await connection.execute(
      `BEGIN PROC_GET_AC_TREE(:p_company_code, :p_cursor); END;`,
      {
        p_company_code: requestUser.company_code,
        p_cursor: { type: oracledb.CURSOR, dir: oracledb.BIND_OUT }
      },
      {
        outFormat: oracledb.OUT_FORMAT_OBJECT
      }
    );

    const cursor = result.outBinds.p_cursor;
    const rows = await fetchAllFromCursor(cursor);

    if (!rows || rows.length === 0) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({ success: false });
      return;
    }

    const normalizedData = rows.map((row: any) => ({
      l1_code: row.L1_CODE,
      l1_description: row.L1_DESCRIPTION,
      l2_code: row.L2_CODE,
      l2_description: row.L2_DESCRIPTION,
      l3_code: row.L3_CODE,
      l3_description: row.L3_DESCRIPTION,
      l4_code: row.L4_CODE,
      l4_description: row.L4_DESCRIPTION,
      ac_code: row.AC_CODE,
      ac_name: row.AC_NAME,
      ac_active: row.AC_ACTIVE,
      ac_status: row.AC_STATUS,
      approved_by: row.APPROVED_BY,
    }));
    
    // Build hierarchy
    const response = buildHierarchy(normalizedData);
    
    res.status(constants.STATUS_CODES.OK).json({ 
      success: true, 
      data: response 
    });
    return;
  } catch (error: any) {
    console.error('Error in getAcTree:', error);
    res.status(constants.STATUS_CODES.BAD_REQUEST).json({ 
      success: false, 
      message: error.message 
    });
    return;
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error('Error closing connection:', err);
      }
    }
  }
};

// =========================================================================
// 2. LEVEL 2 OPERATIONS (CRUD via Database Stored Procedures)
// =========================================================================
export const getLevel2AcTreeNode = async (req: RequestWithUser, res: Response) => {
  let connection: oracledb.Connection | undefined;
  try {
    const { company_code } = req.user;
    const ac_code = paramValue(req.params.ac_code);
    const tenantId = getCurrentTenantId();
    
    if (!tenantId) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Tenant context not found"
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    const result: any = await connection.execute(
      `BEGIN PROC_GET_AC_NODE(:p_level, :p_company_code, :p_code, :p_cursor); END;`,
      {
        p_level: 'L2',
        p_company_code: company_code,
        p_code: ac_code,
        p_cursor: { type: oracledb.CURSOR, dir: oracledb.BIND_OUT }
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const cursor = result.outBinds.p_cursor;
    const rows = await fetchAllFromCursor(cursor);

    if (!rows || rows.length === 0) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: constants.MESSAGES.NOT_FOUND,
      });
      return;
    }

    const row: any = rows[0];
    const normalizedData = {
      l1_code: row.L1_CODE,
      l2_code: row.L2_CODE,
      l2_description: row.L2_DESCRIPTION,
      company_code: row.COMPANY_CODE
    };

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: normalizedData
    });
    return;
  } catch (error: any) {
    res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: error.message,
    });
    return;
  } finally {
    if (connection) await connection.close();
  }
};

export const createLevel2AcTreeNode = async (req: RequestWithUser, res: Response) => {
  let connection: oracledb.Connection | undefined;
  try {
    const requestUser: IUser = req.user;
    const { company_code, loginid } = requestUser;
    const { l1_code, l2_description } = req.body;
    const tenantId = getCurrentTenantId();
    
    if (!tenantId) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Tenant context not found"
      });
      return;
    }

    const { error } = accountLevelTwoFinanceSchema(req.body);
    if (error) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: error.message
      });
      return;
    }
    
    connection = await TenantManager.getConnection(tenantId);
   
    const result: any = await connection.execute(
      `BEGIN 
         PROC_MANAGE_AC_L2(
           'INSERT', :company_code, :l1_code, :l2_code, :l2_description, 
           :loginid, :status, :message
         ); 
       END;`,
      {
        company_code,
        l1_code,
        l2_code: { dir: oracledb.BIND_INOUT, type: oracledb.STRING, val: '' },
        l2_description,
        loginid,
        status: { dir: oracledb.BIND_OUT, type: oracledb.STRING },
        message: { dir: oracledb.BIND_OUT, type: oracledb.STRING }
      }
    );

    const { status, message, l2_code } = result.outBinds;
    if (status === 'ERROR') {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message
      });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: `${l2_code} ${constants.MESSAGES.CREATED_SUCCESSFULLY}`
    });
    return;
  } catch (error: any) {
    res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: error.message
    });
    return;
  } finally {
    if (connection) await connection.close();
  }
};

export const updateLevel2AcTreeNode = async (req: RequestWithUser, res: Response) => {
  let connection: oracledb.Connection | undefined;
  try {
    const { company_code, loginid } = req.user;
    const ac_code = paramValue(req.params.ac_code);
    const { l1_code, l2_description } = req.body;
    const tenantId = getCurrentTenantId();
    
    if (!tenantId) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Tenant context not found"
      });
      return;
    }

    const { error } = accountLevelTwoFinanceSchema(req.body);
    if (error) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: error.message
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    const result: any = await connection.execute(
      `BEGIN 
         PROC_MANAGE_AC_L2(
           'UPDATE', :company_code, :l1_code, :l2_code, :l2_description, 
           :loginid, :status, :message
         ); 
       END;`,
      {
        company_code,
        l1_code: l1_code || '',
        l2_code: { dir: oracledb.BIND_INOUT, type: oracledb.STRING, val: ac_code },
        l2_description,
        loginid,
        status: { dir: oracledb.BIND_OUT, type: oracledb.STRING },
        message: { dir: oracledb.BIND_OUT, type: oracledb.STRING }
      }
    );

    const { status, message } = result.outBinds;
    if (status === 'ERROR') {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message
      });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.UPDATED_SUCCESSFULLY
    });
    return;
  } catch (error: any) {
    res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: error.message
    });
    return;
  } finally {
    if (connection) await connection.close();
  }
};

export const deleteLevel2AcTreeNode = async (req: RequestWithUser, res: Response) => {
  let connection: oracledb.Connection | undefined;
  try {
    const { company_code, loginid } = req.user;
    const ac_code = paramValue(req.params.ac_code);
    const tenantId = getCurrentTenantId();
    
    if (!tenantId) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Tenant context not found"
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    const result: any = await connection.execute(
      `BEGIN 
         PROC_MANAGE_AC_L2(
           'DELETE', :company_code, '', :l2_code, '', 
           :loginid, :status, :message
         ); 
       END;`,
      {
        company_code,
        l2_code: { dir: oracledb.BIND_INOUT, type: oracledb.STRING, val: ac_code },
        loginid: loginid || '',
        status: { dir: oracledb.BIND_OUT, type: oracledb.STRING },
        message: { dir: oracledb.BIND_OUT, type: oracledb.STRING }
      }
    );

    const { status, message } = result.outBinds;
    if (status === 'ERROR') {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message
      });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.DELETED_SUCCESSFULLY
    });
    return;
  } catch (error: any) {
    res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: error.message
    });
    return;
  } finally {
    if (connection) await connection.close();
  }
};

// =========================================================================
// 3. LEVEL 3 OPERATIONS (CRUD via Database Stored Procedures)
// =========================================================================
export const getLevel3AcTreeNode = async (req: RequestWithUser, res: Response) => {
  let connection: oracledb.Connection | undefined;
  try {
    const { company_code } = req.user;
    const ac_code = paramValue(req.params.ac_code);
    const tenantId = getCurrentTenantId();
    
    if (!tenantId) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Tenant context not found"
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    const result: any = await connection.execute(
      `BEGIN PROC_GET_AC_NODE(:p_level, :p_company_code, :p_code, :p_cursor); END;`,
      {
        p_level: 'L3',
        p_company_code: company_code,
        p_code: ac_code,
        p_cursor: { type: oracledb.CURSOR, dir: oracledb.BIND_OUT }
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const cursor = result.outBinds.p_cursor;
    const rows = await fetchAllFromCursor(cursor);

    if (!rows || rows.length === 0) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: constants.MESSAGES.NOT_FOUND,
      });
      return;
    }

    const row: any = rows[0];
    const normalizedData = {
      l3_code: row.L3_CODE,
      l2_code: row.L2_CODE,
      l3_description: row.L3_DESCRIPTION,
      company_code: row.COMPANY_CODE
    };

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: normalizedData
    });
    return;
  } catch (error: any) {
    res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: error.message,
    });
    return;
  } finally {
    if (connection) await connection.close();
  }
};

export const createLevel3AcTreeNode = async (req: RequestWithUser, res: Response) => {
  let connection: oracledb.Connection | undefined;
  try {
    const requestUser: IUser = req.user;
    const { company_code, loginid } = requestUser;
    const { l2_code, l3_description } = req.body;
    const tenantId = getCurrentTenantId();
    
    if (!tenantId) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Tenant context not found"
      });
      return;
    }

    const { error } = accountLevelThreeFinanceSchema(req.body);
    if (error) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: error.message
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    const result: any = await connection.execute(
      `BEGIN 
         PROC_MANAGE_AC_L3(
           'INSERT', :company_code, '', :l2_code, :l3_code, :l3_description, 
           :loginid, :status, :message
         ); 
       END;`,
      {
        company_code,
        l2_code,
        l3_code: { dir: oracledb.BIND_INOUT, type: oracledb.STRING, val: '' },
        l3_description,
        loginid,
        status: { dir: oracledb.BIND_OUT, type: oracledb.STRING },
        message: { dir: oracledb.BIND_OUT, type: oracledb.STRING }
      }
    );

    const { status, message, l3_code } = result.outBinds;
    if (status === 'ERROR') {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message
      });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: `${l3_code} ${constants.MESSAGES.CREATED_SUCCESSFULLY}`
    });
    return;
  } catch (error: any) {
    res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: error.message
    });
    return;
  } finally {
    if (connection) await connection.close();
  }
};

export const updateLevel3AcTreeNode = async (req: RequestWithUser, res: Response) => {
  let connection: oracledb.Connection | undefined;
  try {
    const { company_code, loginid } = req.user;
    const ac_code = paramValue(req.params.ac_code);
    const { l2_code, l3_description } = req.body;
    const tenantId = getCurrentTenantId();
    
    if (!tenantId) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Tenant context not found"
      });
      return;
    }

    const { error } = accountLevelThreeFinanceSchema(req.body);
    if (error) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: error.message
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    const result: any = await connection.execute(
      `BEGIN 
         PROC_MANAGE_AC_L3(
           'UPDATE', :company_code, '', :l2_code, :l3_code, :l3_description, 
           :loginid, :status, :message
         ); 
       END;`,
      {
        company_code,
        l2_code: l2_code || '',
        l3_code: { dir: oracledb.BIND_INOUT, type: oracledb.STRING, val: ac_code },
        l3_description,
        loginid,
        status: { dir: oracledb.BIND_OUT, type: oracledb.STRING },
        message: { dir: oracledb.BIND_OUT, type: oracledb.STRING }
      }
    );

    const { status, message } = result.outBinds;
    if (status === 'ERROR') {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message
      });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.UPDATED_SUCCESSFULLY
    });
    return;
  } catch (error: any) {
    res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: error.message
    });
    return;
  } finally {
    if (connection) await connection.close();
  }
};

export const deleteLevel3AcTreeNode = async (req: RequestWithUser, res: Response) => {
  let connection: oracledb.Connection | undefined;
  try {
    const { company_code, loginid } = req.user;
    const ac_code = paramValue(req.params.ac_code);
    const tenantId = getCurrentTenantId();
    
    if (!tenantId) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Tenant context not found"
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    const result: any = await connection.execute(
      `BEGIN 
         PROC_MANAGE_AC_L3(
           'DELETE', :company_code, '', '', :l3_code, '', 
           :loginid, :status, :message
         ); 
       END;`,
      {
        company_code,
        l3_code: { dir: oracledb.BIND_INOUT, type: oracledb.STRING, val: ac_code },
        loginid: loginid || '',
        status: { dir: oracledb.BIND_OUT, type: oracledb.STRING },
        message: { dir: oracledb.BIND_OUT, type: oracledb.STRING }
      }
    );

    const { status, message } = result.outBinds;
    if (status === 'ERROR') {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message
      });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.DELETED_SUCCESSFULLY
    });
    return;
  } catch (error: any) {
    res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: error.message
    });
    return;
  } finally {
    if (connection) await connection.close();
  }
};

// =========================================================================
// 4. LEVEL 4 OPERATIONS (CRUD via Database Stored Procedures)
// =========================================================================
export const getLevel4AcTreeNode = async (req: RequestWithUser, res: Response) => {
  let connection: oracledb.Connection | undefined;
  try {
    const { company_code } = req.user;
    const ac_code = paramValue(req.params.ac_code);
    const tenantId = getCurrentTenantId();
    
    if (!tenantId) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Tenant context not found"
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    const result: any = await connection.execute(
      `BEGIN PROC_GET_AC_NODE(:p_level, :p_company_code, :p_code, :p_cursor); END;`,
      {
        p_level: 'L4',
        p_company_code: company_code,
        p_code: ac_code,
        p_cursor: { type: oracledb.CURSOR, dir: oracledb.BIND_OUT }
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const cursor = result.outBinds.p_cursor;
    const rows = await fetchAllFromCursor(cursor);

    if (!rows || rows.length === 0) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: constants.MESSAGES.NOT_FOUND
      });
      return;
    }

    const row: any = rows[0];
    const normalizedData = {
      l4_code: row.L4_CODE,
      l3_code: row.L3_CODE,
      l4_description: row.L4_DESCRIPTION,
      company_code: row.COMPANY_CODE,
      l4_type: row.L4_TYPE,   
      l4_bill: row.L4_BILL,   
      l4_job: row.L4_JOB, 
      l4_dept: row.L4_DEPT,
      l4_pl_code: row.L4_PL_CODE
    };

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: normalizedData
    });
    return;
  } catch (error: any) {
    res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: error.message
    });
    return;
  } finally {
    if (connection) await connection.close();
  }
};

export const createLevel4AcTreeNode = async (req: RequestWithUser, res: Response) => {
  let connection: oracledb.Connection | undefined;
  try {
    const { company_code, loginid } = req.user;
    const { l3_code, l4_description, l4_type, l4_job, l4_bill, l4_dept, l4_pl_code } = req.body;
    const tenantId = getCurrentTenantId();
    
    if (!tenantId) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Tenant context not found"
      });
      return;
    }

    const { error } = accountLevelFourFinanceSchema(req.body);
    if (error) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: error.message
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    const result: any = await connection.execute(
      `BEGIN 
         PROC_MANAGE_AC_L4(
           'INSERT', :company_code, :l3_code, :l4_code, :l4_description, 
           :l4_type, :l4_job, :l4_dept, :l4_bill, :l4_pl_code,
           :loginid, :status, :message
         ); 
       END;`,
      {
        company_code,
        l3_code,
        l4_code: { dir: oracledb.BIND_INOUT, type: oracledb.STRING, val: '' },
        l4_description,
        l4_type: l4_type || null,
        l4_job: l4_job || null,
        l4_dept: l4_dept || null,
        l4_bill: l4_bill || null,
        l4_pl_code: l4_pl_code || null,
        loginid,
        status: { dir: oracledb.BIND_OUT, type: oracledb.STRING },
        message: { dir: oracledb.BIND_OUT, type: oracledb.STRING }
      }
    );

    const { status, message, l4_code } = result.outBinds;
    if (status === 'ERROR') {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message
      });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: `${l4_code} ${constants.MESSAGES.CREATED_SUCCESSFULLY}`
    });
    return;
  } catch (error: any) {
    res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: error.message
    });
    return;
  } finally {
    if (connection) await connection.close();
  }
};

export const updateLevel4AcTreeNode = async (req: RequestWithUser, res: Response) => {
  let connection: oracledb.Connection | undefined;
  try {
    const { company_code, loginid } = req.user;
    const ac_code = paramValue(req.params.ac_code);
    const { l3_code, l4_description, l4_type, l4_job, l4_bill, l4_dept, l4_pl_code } = req.body;
    const tenantId = getCurrentTenantId();
    
    if (!tenantId) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Tenant context not found"
      });
      return;
    }

    const { error } = accountLevelFourFinanceSchema(req.body);
    if (error) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: error.message
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    const result: any = await connection.execute(
      `BEGIN 
         PROC_MANAGE_AC_L4(
           'UPDATE', :company_code, :l3_code, :l4_code, :l4_description, 
           :l4_type, :l4_job, :l4_dept, :l4_bill, :l4_pl_code,
           :loginid, :status, :message
         ); 
       END;`,
      {
        company_code,
        l3_code: l3_code || '',
        l4_code: { dir: oracledb.BIND_INOUT, type: oracledb.STRING, val: ac_code },
        l4_description,
        l4_type: l4_type || null,
        l4_job: l4_job || null,
        l4_dept: l4_dept || null,
        l4_bill: l4_bill || null,
        l4_pl_code: l4_pl_code || null,
        loginid,
        status: { dir: oracledb.BIND_OUT, type: oracledb.STRING },
        message: { dir: oracledb.BIND_OUT, type: oracledb.STRING }
      }
    );

    const { status, message } = result.outBinds;
    if (status === 'ERROR') {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message
      });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.UPDATED_SUCCESSFULLY
    });
    return;
  } catch (error: any) {
    res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: error.message
    });
    return;
  } finally {
    if (connection) await connection.close();
  }
};

export const deleteLevel4AcTreeNode = async (req: RequestWithUser, res: Response) => {
  let connection: oracledb.Connection | undefined;
  try {
    const { company_code, loginid } = req.user;
    const ac_code = paramValue(req.params.ac_code);
    const tenantId = getCurrentTenantId();
    
    if (!tenantId) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Tenant context not found"
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    const result: any = await connection.execute(
      `BEGIN 
         PROC_MANAGE_AC_L4(
           'DELETE', :company_code, '', :l4_code, '', 
           '', '', '', '', '',
           :loginid, :status, :message
         ); 
       END;`,
      {
        company_code,
        l4_code: { dir: oracledb.BIND_INOUT, type: oracledb.STRING, val: ac_code },
        loginid: loginid || '',
        status: { dir: oracledb.BIND_OUT, type: oracledb.STRING },
        message: { dir: oracledb.BIND_OUT, type: oracledb.STRING }
      }
    );

    const { status, message } = result.outBinds;
    if (status === 'ERROR') {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message
      });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.DELETED_SUCCESSFULLY
    });
    return;
  } catch (error: any) {
    res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: error.message
    });
    return;
  } finally {
    if (connection) await connection.close();
  }
};

// =========================================================================
// 5. LEVEL 5 / ACCOUNT OPERATIONS (CRUD via Database Stored Procedures)
// =========================================================================
export const getAccountChildrenAcTreeNode = async (req: RequestWithUser, res: Response) => {
  let connection: oracledb.Connection | undefined;
  try {
    const { company_code } = req.user;
    const ac_code = paramValue(req.params.ac_code);
    const tenantId = getCurrentTenantId();
    
    if (!tenantId) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Tenant context not found"
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    const result: any = await connection.execute(
      `BEGIN PROC_GET_AC_NODE(:p_level, :p_company_code, :p_code, :p_cursor); END;`,
      {
        p_level: 'L5',
        p_company_code: company_code,
        p_code: ac_code,
        p_cursor: { type: oracledb.CURSOR, dir: oracledb.BIND_OUT }
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const cursor = result.outBinds.p_cursor;
    const rows = await fetchAllFromCursor(cursor);

    if (!rows || rows.length === 0) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: constants.MESSAGES.NOT_FOUND
      });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: rows[0]
    });
    return;
  } catch (error: any) {
    res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: error.message
    });
    return;
  } finally {
    if (connection) await connection.close();
  }
};

export const createAccountChildrenAcTreeNode = async (req: RequestWithUser, res: Response) => {
  let connection: oracledb.Connection | undefined;
  try {
    const { company_code, loginid } = req.user;
    const { l4_code, files, ...data } = req.body;
    const tenantId = getCurrentTenantId();
    
    if (!tenantId) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Tenant context not found"
      });
      return;
    }

    const { error } = accountFinanceSchema(req.body);
    if (error) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: error.message
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    const result: any = await connection.execute(
      `BEGIN 
         PROC_MANAGE_ACCODES(
           'INSERT', :company_code, :l4_code, :ac_code, :ac_name,
           :ac_type, :ac_active, :ac_status, :curr_code, :address_1,
           :address_2, :address_3, :territory_code, :city_name, :country_code,
           :phone, :mobile_no, :fax, :e_mail, :contact_person,
           :dept_code, :credit_period, :credit_amount, :bank_ac_code, :bank_name,
           :bank_swift, :contract_expry_date, :ac_infze, :salesman_code, :sector_code,
           :trn_no, :tax_registrd, :tax_country_code, :rcm_apply, :bi_main_group,
           :bi_sub_group, :pl_bl_code, :bi_exp_type, :bi_pl_bs_ind, :bi_dept,
           :exp_type_code, :exp_subtype_code, :exp_alloc, :loginid, :status,
           :message
         ); 
       END;`,
      {
        company_code,
        l4_code,
        ac_code: { dir: oracledb.BIND_INOUT, type: oracledb.STRING, val: '' },
        ac_name: data.ac_name,
        ac_type: data.ac_type || null,
        ac_active: data.ac_active || 'Y',
        ac_status: data.ac_status || 'A',
        curr_code: data.curr_code || null,
        address_1: data.address_1 || null,
        address_2: data.address_2 || null,
        address_3: data.address_3 || null,
        territory_code: data.territory_code || null,
        city_name: data.city_name || null,
        country_code: data.country_code || null,
        phone: data.phone || null,
        mobile_no: data.mobile_no || null,
        fax: data.fax || null,
        e_mail: data.e_mail || null,
        contact_person: data.contact_person || null,
        dept_code: data.dept_code || null,
        credit_period: data.credit_period ? Number(data.credit_period) : null,
        credit_amount: data.credit_amount ? Number(data.credit_amount) : null,
        bank_ac_code: data.bank_ac_code || null,
        bank_name: data.bank_name || null,
        bank_swift: data.bank_swift || null,
        contract_expry_date: data.contract_expry_date ? new Date(data.contract_expry_date) : null,
        ac_infze: data.ac_infze || null,
        salesman_code: data.salesman_code || null,
        sector_code: data.sector_code || null,
        trn_no: data.trn_no || null,
        tax_registrd: data.tax_registrd || null,
        tax_country_code: data.tax_country_code || null,
        rcm_apply: data.rcm_apply || null,
        bi_main_group: data.bi_main_group || null,
        bi_sub_group: data.bi_sub_group || null,
        pl_bl_code: data.pl_bl_code || null,
        bi_exp_type: data.bi_exp_type || null,
        bi_pl_bs_ind: data.bi_pl_bs_ind || null,
        bi_dept: data.bi_dept || null,
        exp_type_code: data.exp_type_code || null,
        exp_subtype_code: data.exp_subtype_code || null,
        exp_alloc: data.exp_alloc || null,
        loginid,
        status: { dir: oracledb.BIND_OUT, type: oracledb.STRING },
        message: { dir: oracledb.BIND_OUT, type: oracledb.STRING }
      }
    );

    const { status, message, ac_code } = result.outBinds;
    if (status === 'ERROR') {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message
      });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: `${ac_code} ${constants.MESSAGES.CREATED_SUCCESSFULLY}`
    });
    return;
  } catch (error: any) {
    res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: error.message
    });
    return;
  } finally {
    if (connection) await connection.close();
  }
};

export const updateAccountChildrenAcTreeNode = async (req: RequestWithUser, res: Response) => {
  let connection: oracledb.Connection | undefined;
  try {
    const { company_code, loginid } = req.user;
    const ac_code = paramValue(req.params.ac_code);
    const { l4_code, files, ...data } = req.body;
    const tenantId = getCurrentTenantId();
    
    if (!tenantId) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Tenant context not found"
      });
      return;
    }

    const { error } = accountFinanceSchema(req.body);
    if (error) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: error.message
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    const result: any = await connection.execute(
      `BEGIN 
         PROC_MANAGE_ACCODES(
           'UPDATE', :company_code, :l4_code, :ac_code, :ac_name,
           :ac_type, :ac_active, :ac_status, :curr_code, :address_1,
           :address_2, :address_3, :territory_code, :city_name, :country_code,
           :phone, :mobile_no, :fax, :e_mail, :contact_person,
           :dept_code, :credit_period, :credit_amount, :bank_ac_code, :bank_name,
           :bank_swift, :contract_expry_date, :ac_infze, :salesman_code, :sector_code,
           :trn_no, :tax_registrd, :tax_country_code, :rcm_apply, :bi_main_group,
           :bi_sub_group, :pl_bl_code, :bi_exp_type, :bi_pl_bs_ind, :bi_dept,
           :exp_type_code, :exp_subtype_code, :exp_alloc, :loginid, :status,
           :message
         ); 
       END;`,
      {
        company_code,
        l4_code: l4_code || null,
        ac_code: { dir: oracledb.BIND_INOUT, type: oracledb.STRING, val: ac_code },
        ac_name: data.ac_name,
        ac_type: data.ac_type || null,
        ac_active: data.ac_active || 'Y',
        ac_status: data.ac_status || 'A',
        curr_code: data.curr_code || null,
        address_1: data.address_1 || null,
        address_2: data.address_2 || null,
        address_3: data.address_3 || null,
        territory_code: data.territory_code || null,
        city_name: data.city_name || null,
        country_code: data.country_code || null,
        phone: data.phone || null,
        mobile_no: data.mobile_no || null,
        fax: data.fax || null,
        e_mail: data.e_mail || null,
        contact_person: data.contact_person || null,
        dept_code: data.dept_code || null,
        credit_period: data.credit_period ? Number(data.credit_period) : null,
        credit_amount: data.credit_amount ? Number(data.credit_amount) : null,
        bank_ac_code: data.bank_ac_code || null,
        bank_name: data.bank_name || null,
        bank_swift: data.bank_swift || null,
        contract_expry_date: data.contract_expry_date ? new Date(data.contract_expry_date) : null,
        ac_infze: data.ac_infze || null,
        salesman_code: data.salesman_code || null,
        sector_code: data.sector_code || null,
        trn_no: data.trn_no || null,
        tax_registrd: data.tax_registrd || null,
        tax_country_code: data.tax_country_code || null,
        rcm_apply: data.rcm_apply || null,
        bi_main_group: data.bi_main_group || null,
        bi_sub_group: data.bi_sub_group || null,
        pl_bl_code: data.pl_bl_code || null,
        bi_exp_type: data.bi_exp_type || null,
        bi_pl_bs_ind: data.bi_pl_bs_ind || null,
        bi_dept: data.bi_dept || null,
        exp_type_code: data.exp_type_code || null,
        exp_subtype_code: data.exp_subtype_code || null,
        exp_alloc: data.exp_alloc || null,
        loginid,
        status: { dir: oracledb.BIND_OUT, type: oracledb.STRING },
        message: { dir: oracledb.BIND_OUT, type: oracledb.STRING }
      }
    );

    const { status, message } = result.outBinds;
    if (status === 'ERROR') {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message
      });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.UPDATED_SUCCESSFULLY
    });
    return;
  } catch (error: any) {
    res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: error.message
    });
    return;
  } finally {
    if (connection) await connection.close();
  }
};

export const deleteLevel5AcTreeNode = async (req: RequestWithUser, res: Response) => {
  let connection: oracledb.Connection | undefined;
  try {
    const { company_code, loginid } = req.user;
    const ac_code = paramValue(req.params.ac_code);
    const tenantId = getCurrentTenantId();
    
    if (!tenantId) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Tenant context not found"
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    const result: any = await connection.execute(
      `BEGIN 
         PROC_MANAGE_ACCODES(
           'DELETE', :company_code, '', :ac_code, '',
           NULL, NULL, NULL, NULL, NULL,
           NULL, NULL, NULL, NULL, NULL,
           NULL, NULL, NULL, NULL, NULL,
           NULL, NULL, NULL, NULL, NULL,
           NULL, NULL, NULL, NULL, NULL,
           NULL, NULL, NULL, NULL, NULL,
           NULL, NULL, NULL, NULL, NULL,
           NULL, NULL, NULL, :loginid, :status,
           :message
         ); 
       END;`,
      {
        company_code,
        ac_code: { dir: oracledb.BIND_INOUT, type: oracledb.STRING, val: ac_code },
        loginid: loginid || '',
        status: { dir: oracledb.BIND_OUT, type: oracledb.STRING },
        message: { dir: oracledb.BIND_OUT, type: oracledb.STRING }
      }
    );

    const { status, message } = result.outBinds;
    if (status === 'ERROR') {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message
      });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.DELETED_SUCCESSFULLY
    });
    return;
  } catch (error: any) {
    res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: error.message
    });
    return;
  } finally {
    if (connection) await connection.close();
  }
};

// =========================================================================
// 6. SAVE FILES (via Database Stored Procedure PROC_SAVE_ACCOUNTS_FILE)
// =========================================================================
export const saveFile = async (
  req: RequestWithUser,
  res: Response
): Promise<Response | void> => {
  const { request_number, files } = req.body;
  const tenantId = getCurrentTenantId();
  
  if (!tenantId) {
    return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: "Tenant context not found"
    });
  }

  if (!request_number || !files || !Array.isArray(files) || files.length === 0) {
    return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
      success: false,
      message: "request_number and files are required.",
    });
  }

  const duplicateRecords: string[] = [];
  const successfulRecords: { org_file_name: string; sr_no: number }[] = [];
  let connection: oracledb.Connection | undefined;

  try {
    connection = await TenantManager.getConnection(tenantId);
    const loginid = req.user.loginid || '';

    for (const file of files) {
      const {
        company_code,
        file_name,
        extensions,
        org_file_name,
        aws_file_locn,
        flow_level,
        modules,
        user_file_name,
      } = file;

      const result: any = await connection.execute(
        `BEGIN 
           PROC_SAVE_ACCOUNTS_FILE(
             :company_code, :request_number, :file_name, :extensions, :org_file_name,
             :aws_file_locn, :flow_level, :modules, :loginid, :user_file_name,
             :sr_no, :is_duplicate, :status, :message
           ); 
         END;`,
        {
          company_code: company_code || req.user.company_code || null,
          request_number,
          file_name: file_name || null,
          extensions: extensions || null,
          org_file_name: org_file_name || null,
          aws_file_locn: aws_file_locn || null,
          flow_level: flow_level || null,
          modules: modules || null,
          loginid,
          user_file_name: user_file_name || null,
          sr_no: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
          is_duplicate: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
          status: { dir: oracledb.BIND_OUT, type: oracledb.STRING },
          message: { dir: oracledb.BIND_OUT, type: oracledb.STRING }
        }
      );

      const { is_duplicate, sr_no } = result.outBinds;
      if (is_duplicate === 1) {
        duplicateRecords.push(org_file_name);
      } else if (sr_no) {
        successfulRecords.push({ org_file_name, sr_no });
      }
    }

    return res.status(200).json({
      success: true,
      message: "File data processed successfully.",
      data: {
        successfulRecords,
        duplicateRecords,
      },
    });
  } catch (error: any) {
    console.error("Error storing file data:", error);
    res.status(500).json({
      success: false,
      message: "An error occurred while storing file data.",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  } finally {
    if (connection) await connection.close();
  }
};

// =========================================================================
// 7. VENDOR ACTIVITIES (via Database Stored Procedure PROC_GET_VENDOR_ACTIVITIES)
// =========================================================================
export const getVendorActivities = async (req: RequestWithUser, res: Response): Promise<void> => {
  let connection: oracledb.Connection | undefined;
  try {
    const ac_code = paramValue(req.query.ac_code as string | string[] | undefined);
    const { company_code } = req.user;       
    
    const tenantId = getCurrentTenantId();
    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant context not found" });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);
    const result: any = await connection.execute(
      `BEGIN PROC_GET_VENDOR_ACTIVITIES(:p_company_code, :p_ac_code, :p_cursor); END;`,
      {
        p_company_code: company_code,
        p_ac_code: ac_code,
        p_cursor: { type: oracledb.CURSOR, dir: oracledb.BIND_OUT }
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const cursor = result.outBinds.p_cursor;
    const rows = await fetchAllFromCursor(cursor);

    res.json({ success: true, data: rows });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (connection) await connection.close().catch(() => {});
  }
};
