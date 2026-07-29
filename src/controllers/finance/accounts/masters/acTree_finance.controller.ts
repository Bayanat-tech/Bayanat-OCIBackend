// Import required dependencies and interfaces
import { Response } from "express";
import constants from "../../../../helpers/constants";
import {
  IFiles,
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

// Get account tree structure
export const getAcTree = async (req: RequestWithUser, res: Response) => {
  let connection;
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

    const result = await connection.execute(
      `SELECT 
          *
       FROM VW_AC_MASTER
       WHERE COMPANY_CODE = :company_code
       ORDER BY l1_code, l2_code, l3_code, l4_code, ac_code`,
      {
        company_code: requestUser.company_code
      },
      {
        outFormat: oracledb.OUT_FORMAT_OBJECT
      }
    );

    console.log('Raw result:', result.rows); 
    console.log('First row:', result.rows?.[0]); 

    if (!result.rows || result.rows.length === 0) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({ success: false });
      return;
    }

    const normalizedData = result.rows.map((row: any) => ({
      l1_code:row.L1_CODE,
      l1_description: row.L1_DESCRIPTION,
      l2_code: row.L2_CODE,
      l2_description: row.L2_DESCRIPTION,
      l3_code: row.L3_CODE,
      l3_description: row.L3_DESCRIPTION,
      l4_code: row.L4_CODE,
      l4_description: row.L4_DESCRIPTION,
      ac_code: row.AC_CODE,
      ac_name: row.AC_NAME,
    }));
    
    // Build hierarchy
    const response = buildHierarchy(normalizedData);

    console.log('Hierarchy response:', response);
    
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

// Level 2 Account Operations
//---------level2-----------
export const getLevel2AcTreeNode = async (
  req: RequestWithUser,
  res: Response
) => {
  let connection;

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

    const result = await connection.execute(
      `
      SELECT
          l2_code,
          l1_code,
          l2_description,
          company_code
      FROM MS_AC_L2
      WHERE company_code = :company_code
        AND l2_code = :l2_code
      `,
      {
        company_code,
        l2_code: ac_code,
      },
      {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
      }
    );

    if (!result.rows || result.rows.length === 0) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: constants.MESSAGES.NOT_FOUND,
      });
      return;
    }

    // Normalize uppercase Oracle keys to lowercase
    const row: any = result.rows[0];
    const normalizedData = {
      l1_code: row.L1_CODE,
      l2_code: row.L2_CODE,
      l2_description: row.L2_DESCRIPTION,
      company_code: row.COMPANY_CODE
    };

    console.log('Original row: ', row);
    console.log('Normalized data: ', normalizedData);

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

// Create new Level 2 account node
export const createLevel2AcTreeNode = async (
  req: RequestWithUser,
  res: Response
) => {
  let connection;

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

    // Validate request body
    const { error } = accountLevelTwoFinanceSchema(req.body);
    if (error) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: error.message
      });
      return;
    }
    connection = await TenantManager.getConnection(tenantId);
   
    // Check if Level 2 exists
    const level2Result = await connection.execute(
      `
      SELECT 1
      FROM MS_AC_L2
      WHERE L1_CODE = :l1_code
        AND COMPANY_CODE = :company_code
      `,
      { l1_code, company_code },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (!level2Result.rows || level2Result.rows.length === 0) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: `Level2 ${constants.MESSAGES.NOT_FOUND}`
      });
      return;
    }
    // Insert Level 3 record
    await connection.execute(
      `
      INSERT INTO MS_AC_L2 (
        L2_CODE,
        L1_CODE,
        L2_DESCRIPTION,
        COMPANY_CODE,
        CREATED_BY,
        UPDATED_BY
      )
      VALUES (
        '',
        :l1_code,
        :l2_description,
        :company_code,
        :loginid,
        :loginid
      )
      `,
      {
        l1_code,
        l2_description,
        company_code,
        loginid
      },
      { autoCommit: true }
    );
    // Get session code
    const sessionResult = await connection.execute(
      `
      SELECT CODE
      FROM GT_SESSION_INFO
      WHERE USERID = :loginid
      `,
      { loginid },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const sessionCode =
      sessionResult.rows && sessionResult.rows.length > 0
        ? (sessionResult.rows[0] as any).CODE
        : '';

    // Success response
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: `${sessionCode} ${constants.MESSAGES.CREATED_SUCCESSFULLY}`
    });
    return;

  } catch (error: any) {
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
        console.error('Error closing Oracle connection', err);
      }
    }
  }
};

// // Update Level 2 account node
export const updateLevel2AcTreeNode = async (
  req: RequestWithUser,
  res: Response
) => {
  let connection;

  try {
    const { company_code, loginid } = req.user;
    const ac_code = paramValue(req.params.ac_code); // l3_code
    const { l1_code, l2_description } = req.body;
    const tenantId = getCurrentTenantId();
    
    if (!tenantId) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Tenant context not found"
      });
      return;
    }

    //  Validate request body
    const { error } = accountLevelTwoFinanceSchema(req.body);
    if (error) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: error.message
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    // Check Level-2 exists
    const level2Result = await connection.execute(
      `
      SELECT 1
      FROM MS_AC_L2
      WHERE L2_CODE = :l2_code
        AND COMPANY_CODE = :company_code
      `,
      {
        l2_code: ac_code,
        company_code
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    if (!level2Result.rows || level2Result.rows.length === 0) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: constants.MESSAGES.NOT_FOUND
      });
      return;
    }

    // Check parent Level-1 exists
    const level1Result = await connection.execute(
      `
      SELECT 1
      FROM MS_AC_L1
      WHERE L1_CODE = :l1_code
        AND COMPANY_CODE = :company_code
      `,
      {
        l1_code,
        company_code
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (!level1Result.rows || level1Result.rows.length === 0) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "Level2 " + constants.MESSAGES.NOT_FOUND
      });
      return;
    }

    // Update Level-2
    await connection.execute(
      `
      UPDATE MS_AC_L2
      SET
        L1_CODE = :l1_code,
        L2_DESCRIPTION = :l2_description,
        UPDATED_BY = :loginid
      WHERE L2_CODE = :l2_code
        AND COMPANY_CODE = :company_code
      `,
      {
        l1_code,
        l2_description,
        loginid,
        l2_code: ac_code,
        company_code
      },
      { autoCommit: true }
    );

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
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error("Error closing Oracle connection", err);
      }
    }
  }
};

export const deleteLevel2AcTreeNode = async (
  req: RequestWithUser,
  res: Response
) => {
  let connection;

  try {
    const { company_code } = req.user;
    const ac_code = paramValue(req.params.ac_code); // L2_CODE
    const tenantId = getCurrentTenantId();
    
    if (!tenantId) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Tenant context not found"
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    /* ---------- Check Level-2 exists ---------- */
    const level2Result = await connection.execute(
      `
      SELECT 1
      FROM MS_AC_L2
      WHERE L2_CODE = :l2_code
        AND COMPANY_CODE = :company_code
      `,
      { l2_code: ac_code, company_code },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (!level2Result.rows || level2Result.rows.length === 0) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: constants.MESSAGES.NOT_FOUND
      });
      return;
    }

    /* ---------- Check child Level-3 exists ---------- */
    const childResult = await connection.execute(
      `
      SELECT 1
      FROM MS_AC_L3
      WHERE L2_CODE = :l2_code
        AND COMPANY_CODE = :company_code
      FETCH FIRST 1 ROWS ONLY
      `,
      { l2_code: ac_code, company_code },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (childResult.rows && childResult.rows.length > 0) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Cannot delete. Level-2 has child Level-3 accounts."
      });
      return;
    }

    /* ---------- Delete Level-2 ---------- */
    await connection.execute(
      `
      DELETE FROM MS_AC_L2
      WHERE L2_CODE = :l2_code
        AND COMPANY_CODE = :company_code
      `,
      { l2_code: ac_code, company_code },
      { autoCommit: true }
    );

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
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error("Error closing Oracle connection", err);
      }
    }
  }
};

export const deleteLevel3AcTreeNode = async (
  req: RequestWithUser,
  res: Response
) => {
  let connection;

  try {
    const { company_code } = req.user;
    const ac_code = paramValue(req.params.ac_code); // L2_CODE
    const tenantId = getCurrentTenantId();
    
    if (!tenantId) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Tenant context not found"
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    /* ---------- Check Level-3 exists ---------- */
    const level3Result = await connection.execute(
      `
      SELECT 1
      FROM MS_AC_L3
      WHERE L3_CODE = :l3_code
        AND COMPANY_CODE = :company_code
      `,
      { l3_code: ac_code, company_code },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (!level3Result.rows || level3Result.rows.length === 0) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: constants.MESSAGES.NOT_FOUND
      });
      return;
    }

    /* ---------- Check child Level-4 exists ---------- */
    const childResult = await connection.execute(
      `
      SELECT 1
      FROM MS_AC_L4
      WHERE L4_CODE = :l4_code
        AND COMPANY_CODE = :company_code
      FETCH FIRST 1 ROWS ONLY
      `,
      { l4_code: ac_code, company_code },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (childResult.rows && childResult.rows.length > 0) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Cannot delete. Level-2 has child Level-3 accounts."
      });
      return;
    }

    /* ---------- Delete Level-3 ---------- */
    await connection.execute(
      `
      DELETE FROM MS_AC_L3
      WHERE L3_CODE = :l3_code
        AND COMPANY_CODE = :company_code
      `,
      { l3_code: ac_code, company_code },
      { autoCommit: true }
    );

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
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error("Error closing Oracle connection", err);
      }
    }
  }
};

export const deleteLevel4AcTreeNode = async (
  req: RequestWithUser,
  res: Response
) => {
  let connection;

  try {
    const { company_code } = req.user;
    const ac_code = paramValue(req.params.ac_code); // L2_CODE
    const tenantId = getCurrentTenantId();
    
    if (!tenantId) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Tenant context not found"
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    /* ---------- Check Level-4 exists ---------- */
    const level4Result = await connection.execute(
      `
      SELECT 1
      FROM MS_AC_L4
      WHERE L4_CODE = :l4_code
        AND COMPANY_CODE = :company_code
      `,
      { l4_code: ac_code, company_code },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (!level4Result.rows || level4Result.rows.length === 0) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: constants.MESSAGES.NOT_FOUND
      });
      return;
    }

    // /* ---------- Check child Level-5 exists ---------- */
    const childResult = await connection.execute(
      `
      SELECT 1
      FROM MS_ACCODES
      WHERE AC_CODE = :ac_code
        AND COMPANY_CODE = :company_code
      FETCH FIRST 1 ROWS ONLY
      `,
      { ac_code: ac_code, company_code },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (childResult.rows && childResult.rows.length > 0) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Cannot delete. Level-2 has child Level-3 accounts."
      });
      return;
    }

    /* ---------- Delete Level-2 ---------- */
    await connection.execute(
      `
      DELETE FROM MS_AC_L4
      WHERE L4_CODE = :l4_code
        AND COMPANY_CODE = :company_code
      `,
      { l4_code: ac_code, company_code },
      { autoCommit: true }
    );

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
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error("Error closing Oracle connection", err);
      }
    }
  }
};

export const deleteLevel5AcTreeNode = async (
  req: RequestWithUser,
  res: Response
) => {
  let connection;

  try {
    const { company_code } = req.user;
    const ac_code = paramValue(req.params.ac_code); // L2_CODE
    const tenantId = getCurrentTenantId();
    
    if (!tenantId) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Tenant context not found"
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    /* ---------- Check Level-5 exists ---------- */
    const level5Result = await connection.execute(
      `
      SELECT 1
      FROM MS_ACCODES
      WHERE AC_CODE = :ac_code
        AND COMPANY_CODE = :company_code
      `,
      { ac_code: ac_code, company_code },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (!level5Result.rows || level5Result.rows.length === 0) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: constants.MESSAGES.NOT_FOUND
      });
      return;
    }

    /* ---------- Delete Level-5 ---------- */
    await connection.execute(
      `
      DELETE FROM MS_ACCODES
      WHERE AC_CODE = :ac_code
        AND COMPANY_CODE = :company_code
      `,
      { ac_code: ac_code, company_code },
      { autoCommit: true }
    );

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
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error("Error closing Oracle connection", err);
      }
    }
  }
};



// Level 3 Account Operations
//---------level3-----------
export const getLevel3AcTreeNode = async (
  req: RequestWithUser,
  res: Response
) => {
  let connection;

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

    const result = await connection.execute(
      `
      SELECT
          l3_code,
          l2_code,
          l1_code,
          l3_description,
          company_code
      FROM MS_AC_L3
      WHERE company_code = :company_code
        AND l3_code = :l3_code
      `,
      {
        company_code,
        l3_code: ac_code,
      },
      {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
      }
    );

    if (!result.rows || result.rows.length === 0) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: constants.MESSAGES.NOT_FOUND,
      });
      return;
    }

    // Normalize uppercase Oracle keys to lowercase
    const row: any = result.rows[0];
    const normalizedData = {
      l3_code: row.L3_CODE,
      l2_code: row.L2_CODE,
      l3_description: row.L3_DESCRIPTION,
      company_code: row.COMPANY_CODE
    };

    console.log('Original row: ', row);
    console.log('Normalized data: ', normalizedData);

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


// Create new Level 3 account node
export const createLevel3AcTreeNode = async (
  req: RequestWithUser,
  res: Response
) => {
  let connection;

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

    // Validate request body
    const { error } = accountLevelThreeFinanceSchema(req.body);
    if (error) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: error.message
      });
      return;
    }
    connection = await TenantManager.getConnection(tenantId);

    // Check if Level 2 exists
    const level2Result = await connection.execute(
      `
      SELECT L1_CODE
      FROM MS_AC_L2
      WHERE L2_CODE = :l2_code
        AND COMPANY_CODE = :company_code
      `,
      { l2_code, company_code },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    if (!level2Result.rows || level2Result.rows.length === 0) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: `Level2 ${constants.MESSAGES.NOT_FOUND}`
      });
      return;
    }
    const l1_code = (level2Result.rows[0] as any).L1_CODE;
    // Insert Level 3 record
    await connection.execute(
      `
      INSERT INTO MS_AC_L3 (
        L3_CODE,
        L2_CODE,
        L3_DESCRIPTION,
        L1_CODE,
        COMPANY_CODE,
        CREATED_BY,
        UPDATED_BY
      )
      VALUES (
        '',
        :l2_code,
        :l3_description,
        :l1_code,
        :company_code,
        :loginid,
        :loginid
      )
      `,
      {
        l2_code,
        l3_description,
        l1_code,
        company_code,
        loginid
      },
      { autoCommit: true }
    );
    // Get session code
    const sessionResult = await connection.execute(
      `
      SELECT CODE
      FROM GT_SESSION_INFO
      WHERE USERID = :loginid
      `,
      { loginid },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const sessionCode =
      sessionResult.rows && sessionResult.rows.length > 0
        ? (sessionResult.rows[0] as any).CODE
        : '';

    // Success response
    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: `${sessionCode} ${constants.MESSAGES.CREATED_SUCCESSFULLY}`
    });
    return;

  } catch (error: any) {
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
        console.error('Error closing Oracle connection', err);
      }
    }
  }
};

// // Update Level 3 account node
export const updateLevel3AcTreeNode = async (
  req: RequestWithUser,
  res: Response
) => {
  let connection;

  try {
    const { company_code, loginid } = req.user;
    const ac_code = paramValue(req.params.ac_code); // l3_code
    const { l2_code, l3_description } = req.body;
    const tenantId = getCurrentTenantId();
    
    if (!tenantId) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Tenant context not found"
      });
      return;
    }

    //  Validate request body
    const { error } = accountLevelThreeFinanceSchema(req.body);
    if (error) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: error.message
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    // Check Level-3 exists
    const level3Result = await connection.execute(
      `
      SELECT 1
      FROM MS_AC_L3
      WHERE L3_CODE = :l3_code
        AND COMPANY_CODE = :company_code
      `,
      {
        l3_code: ac_code,
        company_code
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (!level3Result.rows || level3Result.rows.length === 0) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: constants.MESSAGES.NOT_FOUND
      });
      return;
    }

    // Check parent Level-2 exists
    const level2Result = await connection.execute(
      `
      SELECT 1
      FROM MS_AC_L2
      WHERE L2_CODE = :l2_code
        AND COMPANY_CODE = :company_code
      `,
      {
        l2_code,
        company_code
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (!level2Result.rows || level2Result.rows.length === 0) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "Level2 " + constants.MESSAGES.NOT_FOUND
      });
      return;
    }

    // Update Level-3
    await connection.execute(
      `
      UPDATE MS_AC_L3
      SET
        L2_CODE = :l2_code,
        L3_DESCRIPTION = :l3_description,
        UPDATED_BY = :loginid
      WHERE L3_CODE = :l3_code
        AND COMPANY_CODE = :company_code
      `,
      {
        l2_code,
        l3_description,
        loginid,
        l3_code: ac_code,
        company_code
      },
      { autoCommit: true }
    );

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
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error("Error closing Oracle connection", err);
      }
    }
  }
};

// Level 4 Account Operations
// ---------level4-----------

// Get Level 4 account node details
export const getLevel4AcTreeNode = async (
  req: RequestWithUser,
  res: Response
) => {
  let connection;

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

    const result = await connection.execute(
      `
      SELECT
       *
      FROM MS_AC_L4
      WHERE COMPANY_CODE = :company_code
        AND L4_CODE = :l4_code
      `,
      {
        company_code,
        l4_code: ac_code
      },
      {
        outFormat: oracledb.OUT_FORMAT_OBJECT
      }
    );

    if (!result.rows || result.rows.length === 0) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: constants.MESSAGES.NOT_FOUND
      });
      return;
    }

    const row: any = result.rows[0];
    const normalizedData = {
    l4_code: row.L4_CODE,
    l3_code:row.L3_CODE,
    l4_description:row.L4_DESCRIPTION,
    company_code:row.COMPANY_CODE,
    l4_type: row.L4_TYPE,   
    l4_bill: row.L4_BILL,   
    l4_job: row.L4_JOB, 
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
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error("Error closing Oracle connection", err);
      }
    }
  }
};

// Create new Level 4 account node
export const createLevel4AcTreeNode = async (
  req: RequestWithUser,
  res: Response
) => {
  let connection;

  try {
    const { company_code, loginid } = req.user;
    const { l3_code, l4_description, l4_type, l4_job, l4_bill, l4_dept } = req.body;
    const tenantId = getCurrentTenantId();
    
    if (!tenantId) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Tenant context not found"
      });
      return;
    }

    // Validate request body
    const { error } = accountLevelFourFinanceSchema(req.body);
    if (error) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: error.message
      });
      return;
    }
    connection = await TenantManager.getConnection(tenantId);

    // Check if parent Level 3 exists
    const level3Result = await connection.execute(
      `
      SELECT 1
      FROM MS_AC_L3
      WHERE L3_CODE = :l3_code
        AND COMPANY_CODE = :company_code
      `,
      { l3_code, company_code },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (!level3Result.rows || level3Result.rows.length === 0) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "Level3 " + constants.MESSAGES.NOT_FOUND
      });
      return;
    }

    // Insert Level 4
    await connection.execute(
      `
      INSERT INTO MS_AC_L4 (
        L4_CODE,
        L3_CODE,
        L4_DESCRIPTION,
        L4_TYPE,
        L4_JOB,
        L4_BILL,
        L4_DEPT,
        COMPANY_CODE,
        CREATED_BY,
        UPDATED_BY
      )
      VALUES (
        '',
        :l3_code,
        :l4_description,
        :l4_type,
        :l4_job,
        :l4_bill,
        :l4_dept,
        :company_code,
        :loginid,
        :loginid
      )
      `,
      {
        l3_code,
        l4_description,
        l4_type,
        l4_job,
        l4_bill,
        l4_dept,
        company_code,
        loginid
      },
      { autoCommit: true }
    );

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: constants.MESSAGES.CREATED_SUCCESSFULLY
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

// Update Level 4 account node
export const updateLevel4AcTreeNode = async (
  req: RequestWithUser,
  res: Response
) => {
  let connection;

  try {
    const { company_code, loginid } = req.user;
    const ac_code = paramValue(req.params.ac_code);
    const { l3_code, l4_description, l4_type, l4_job, l4_bill, l4_dept } = req.body;
    const tenantId = getCurrentTenantId();
    
    if (!tenantId) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Tenant context not found"
      });
      return;
    }

    // Validate request body
    const { error } = accountLevelFourFinanceSchema(req.body);
    if (error) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: error.message
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    // Check Level 4 exists
    const level4Result = await connection.execute(
      `
      SELECT 1
      FROM MS_AC_L4
      WHERE L4_CODE = :l4_code
        AND COMPANY_CODE = :company_code
      `,
      { l4_code: ac_code, company_code },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (!level4Result.rows || level4Result.rows.length === 0) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: constants.MESSAGES.NOT_FOUND
      });
      return;
    }

    // Check parent Level 3 exists
    const level3Result = await connection.execute(
      `
      SELECT 1
      FROM MS_AC_L3
      WHERE L3_CODE = :l3_code
        AND COMPANY_CODE = :company_code
      `,
      { l3_code, company_code },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (!level3Result.rows || level3Result.rows.length === 0) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "Level3 " + constants.MESSAGES.NOT_FOUND
      });
      return;
    }

    // Update Level 4
    await connection.execute(
      `
      UPDATE MS_AC_L4
      SET
        L3_CODE = :l3_code,
        L4_DESCRIPTION = :l4_description,
        L4_TYPE = :l4_type,
        L4_JOB = :l4_job,
        L4_BILL = :l4_bill,
        L4_DEPT = :l4_dept,
        UPDATED_BY = :loginid
      WHERE L4_CODE = :l4_code
        AND COMPANY_CODE = :company_code
      `,
      {
        l3_code,
        l4_description,
        l4_type,
        l4_job,
        l4_bill,
        l4_dept,
        l4_code: ac_code,
        loginid,
        company_code
      },
      { autoCommit: true }
    );

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


// // Level 5 Account Operations (Account Children)
// //---------level5-----------

// // Get account children node details
// export const getAccountChildrenAcTreeNode = async (
//   req: RequestWithUser,
//   res: Response
// ) => {
//   try {
//     const requestUser: IUser = req.user;
//     const ac_code = paramValue(req.params.ac_code);
//     const accountData = await Account.findOne({
//       where: { company_code: requestUser.company_code, ac_code },
//     });
//     if (!accountData) {
//       res
//         .status(constants.STATUS_CODES.NOT_FOUND)
//         .json({ success: false, message: constants.MESSAGES.NOT_FOUND });
//       return;
//     }
//     res
//       .status(constants.STATUS_CODES.OK)
//       .json({ success: true, data: accountData });
//     return;
//   } catch (error: any) {
//     res
//       .status(constants.STATUS_CODES.BAD_REQUEST)
//       .json({ success: false, message: error.message });
//     return;
//   }
// };

export const getAccountChildrenAcTreeNode = async (
  req: RequestWithUser,
  res: Response
) => {
  let connection;

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

    const result = await connection.execute(
      `
      SELECT *
      FROM MS_ACCODES
      WHERE AC_CODE = :ac_code
        AND COMPANY_CODE = :company_code
      `,
      { ac_code, company_code },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (!result.rows || result.rows.length === 0) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: constants.MESSAGES.NOT_FOUND
      });
      return;
    }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: result.rows[0]
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

export const createAccountChildrenAcTreeNode = async (
  req: RequestWithUser,
  res: Response
) => {
  let connection;

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

    // Validate request
    const { error } = accountFinanceSchema(req.body);
    if (error) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: error.message
      });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);

    // Check Level 4 exists
    const level4Result = await connection.execute(
      `
      SELECT 1
      FROM MS_AC_L4
      WHERE L4_CODE = :l4_code
        AND COMPANY_CODE = :company_code
      `,
      { l4_code, company_code },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (!level4Result.rows || level4Result.rows.length === 0) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "Level4 " + constants.MESSAGES.NOT_FOUND
      });
      return;
    }

    // Insert Account
    await connection.execute(
  `
  INSERT INTO MS_ACCODES (
    AC_CODE,
    L4_CODE,
    AC_NAME,
    ADDRESS_1,
    ADDRESS_2,
    ADDRESS_3,
    TERRITORY_CODE,
    CITY_NAME,
    COUNTRY_CODE,
    PHONE,
    MOBILE_NO,
    FAX,
    E_MAIL,
    CONTACT_PERSON,
    DEPT_CODE,
    CREDIT_PERIOD,
    CREDIT_AMOUNT,
    CURR_CODE,
    BANK_AC_CODE,
    BANK_NAME,
    BANK_SWIFT,
    CONTRACT_EXPRY_DATE,
    AC_INFZE,
    SALESMAN_CODE,
    SECTOR_CODE,
    TRN_NO,
    TAX_REGISTRD,
    TAX_COUNTRY_CODE,
    RCM_APPLY,
    BI_MAIN_GROUP,
    BI_SUB_GROUP,
    PL_BL_CODE,
    BI_EXP_TYPE,
    BI_PL_BS_IND,
    BI_DEPT,
    COMPANY_CODE,
    EXP_TYPE_CODE,
    EXP_SUBTYPE_CODE,
    CREATED_BY,
    UPDATED_BY,
    AC_STATUS,
    EXP_ALLOC,
    AC_TYPE,
    AC_ACTIVE
  )
  VALUES (
    '',
    :l4_code,
    :ac_name,
    :address_1,
    :address_2,
    :address_3,
    :territory_code,
    :city_name,
    :country_code,
    :phone,
    :mobile_no,
    :fax,
    :e_mail,
    :contact_person,
    :dept_code,
    :credit_period,
    :credit_amount,
    :curr_code,
    :bank_ac_code,
    :bank_name,
    :bank_swift,
    :contract_expry_date,
    :ac_infze,
    :salesman_code,
    :sector_code,
    :trn_no,
    :tax_registrd,
    :tax_country_code,
    :rcm_apply,
    :bi_main_group,
    :bi_sub_group,
    :pl_bl_code,
    :bi_exp_type,
    :bi_pl_bs_ind,
    :bi_dept,
    :company_code,
    :exp_type_code,
    :exp_subtype_code,
    :loginid,
    :loginid,
    :ac_status,
    :exp_alloc,
    :ac_type,
    :ac_active
  )
  `,
  {
    l4_code,
    ac_name: data.ac_name,
    address_1: data.address_1,
    address_2: data.address_2,
    address_3: data.address_3,
    territory_code: data.territory_code,
    city_name: data.city_name,
    country_code: data.country_code,
    phone: data.phone,
    mobile_no: data.mobile_no,
    fax: data.fax,
    e_mail: data.e_mail,
    contact_person: data.contact_person,
    dept_code: data.dept_code,
    credit_period: data.credit_period,
    credit_amount: data.credit_amount,
    curr_code: data.curr_code,
    bank_ac_code: data.bank_ac_code,
    bank_name: data.bank_name,
    bank_swift: data.bank_swift,
    // contract_expry_date: data.contract_expry_date,
    contract_expry_date: data.contract_expry_date ? new Date(data.contract_expry_date) : null,
    ac_infze: data.ac_infze,
    salesman_code: data.salesman_code,
    sector_code: data.sector_code,
    trn_no: data.trn_no,
    tax_registrd: data.tax_registrd,
    tax_country_code: data.tax_country_code,
    rcm_apply: data.rcm_apply,
    bi_main_group: data.bi_main_group,
    bi_sub_group: data.bi_sub_group,
    pl_bl_code: data.pl_bl_code,
    bi_exp_type: data.bi_exp_type,
    bi_pl_bs_ind: data.bi_pl_bs_ind,
    bi_dept: data.bi_dept,
    company_code,
    exp_type_code: data.exp_type_code,
    exp_subtype_code: data.exp_subtype_code,
    loginid,
    ac_status: data.ac_status,
    exp_alloc: data.exp_alloc,
    ac_type: data.ac_type,
    ac_active: data.ac_active
  },
  { autoCommit: true }
);


    //  Get session code
    const sessionResult = await connection.execute(
      `
      SELECT CODE
      FROM GT_SESSION_INFO
      WHERE USERID = :loginid
      `,
      { loginid },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const sessionCode =
      (sessionResult.rows?.[0] as any)?.CODE ?? "";

    //  Save files
    // if (files && files.length) {
    //   await Files.bulkCreate(
    //     (files as IFiles[]).map((file) => ({
    //       ...file,
    //       request_number: "ACCT" + sessionCode
    //     }))
    //   );
    // }

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      message: sessionCode + " " + constants.MESSAGES.CREATED_SUCCESSFULLY
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

// export const updateAccountChildrenAcTreeNode = async (
//   // Update account children node
//   req: RequestWithUser,
//   res: Response
// ) => {
//   try {
//     const requestUser: IUser = req.user;
//     const ac_code = paramValue(req.params.ac_code);
//     const { error } = accountFinanceSchema(req.body);

//     // Validate request body
//     if (error) {
//       res
//         .status(constants.STATUS_CODES.BAD_REQUEST)
//         .json({ success: false, message: error.message });
//       return;
//     }
//     const accountData = await Account.findOne({
//       // Check if account exists
//       where: { ac_code, company_code: requestUser.company_code },
//     });
//     if (!accountData) {
//       res
//         .status(constants.STATUS_CODES.NOT_FOUND)
//         .json({ success: false, message: constants.MESSAGES.NOT_FOUND });
//       return;
//     }
//     const isLevelFourExists = await AccountLevelFour.findOne({
//       // Check if parent Level 4 exists
//       where: { l4_code: req.body.l4_code },
//     });
//     if (!isLevelFourExists) {
//       res.status(constants.STATUS_CODES.NOT_FOUND).json({
//         success: false,
//         message: "Level4 " + constants.MESSAGES.NOT_FOUND,
//       });
//       return;
//     }

//     const { files, ...data } = req.body;
//     // Handle file uploads
//     files.forEach((item: any) => {
//       item.request_number = "ACCT" + ac_code;
//     });
//     if (!!files && files.length) {
//       await Files.bulkCreate(
//         (files as IFiles[]).map((eachFile) => {
//           return {
//             ...eachFile,
//             request_number: "ACCT" + ac_code,
//           };
//         })
//       );
//     }
//     const response = await Account.update(
//       // Update account
//       {
//         ac_code,
//         ...data,
//         updated_by: requestUser.loginid,
//       },
//       { where: { ac_code, company_code: requestUser.company_code } }
//     );
//     if (!response) {
//       res
//         .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
//         .json({ success: false, message: response });
//       return;
//     }
//     res.status(constants.STATUS_CODES.OK).json({
//       success: true,
//       message: constants.MESSAGES.UPDATED_SUCCESSFULLY,
//     });
//     return;
//   } catch (error: any) {
//     res
//       .status(constants.STATUS_CODES.BAD_REQUEST)
//       .json({ success: false, message: error.message });
//     return;
//   }
// };


export const updateAccountChildrenAcTreeNode = async (
  req: RequestWithUser,
  res: Response
) => {
  let connection;

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

    //  Check Account exists
    const accountResult = await connection.execute(
      `
      SELECT 1
      FROM MS_ACCODES
      WHERE AC_CODE = :ac_code
        AND COMPANY_CODE = :company_code
      `,
      { ac_code, company_code },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (!accountResult.rows || accountResult.rows.length === 0) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: constants.MESSAGES.NOT_FOUND
      });
      return;
    }

    //  Check Level 4 exists
    const level4Result = await connection.execute(
      `
      SELECT 1
      FROM MS_AC_L4
      WHERE L4_CODE = :l4_code
        AND COMPANY_CODE = :company_code
      `,
      { l4_code, company_code },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (!level4Result.rows || level4Result.rows.length === 0) {
      res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "Level4 " + constants.MESSAGES.NOT_FOUND
      });
      return;
    }

    // Update Account
    await connection.execute(
      `
      UPDATE MS_ACCODES
      SET
        L4_CODE = :l4_code,
        AC_NAME = :ac_name,
        ADDRESS_1 = :address_1,
        ADDRESS_2 = :address_2,
        ADDRESS_3 = :address_3,
        TERRITORY_CODE = :territory_code,
        CITY_NAME = :city_name,
        COUNTRY_CODE = :country_code,
        PHONE = :phone,
        MOBILE_NO = :mobile_no,
        FAX = :fax,
        E_MAIL = :e_mail,
        CONTACT_PERSON = :contact_person,
        DEPT_CODE = :dept_code,
        CREDIT_PERIOD = :credit_period,
        CREDIT_AMOUNT = :credit_amount,
        CURR_CODE = :curr_code,
        BANK_AC_CODE = :bank_ac_code,
        BANK_NAME = :bank_name,
        BANK_SWIFT = :bank_swift,
        CONTRACT_EXPRY_DATE = :contract_expry_date,
        AC_INFZE = :ac_infze,
        SALESMAN_CODE = :salesman_code,
        SECTOR_CODE = :sector_code,
        TRN_NO = :trn_no,
        TAX_REGISTRD = :tax_registrd,
        TAX_COUNTRY_CODE = :tax_country_code,
        RCM_APPLY = :rcm_apply,
        BI_MAIN_GROUP = :bi_main_group,
        BI_SUB_GROUP = :bi_sub_group,
        PL_BL_CODE = :pl_bl_code,
        BI_EXP_TYPE = :bi_exp_type,
        BI_PL_BS_IND = :bi_pl_bs_ind,
        BI_DEPT = :bi_dept,
        EXP_TYPE_CODE = :exp_type_code,
        EXP_SUBTYPE_CODE = :exp_subtype_code,
        UPDATED_BY = :loginid,
        AC_STATUS = :ac_status,
        EXP_ALLOC = :exp_alloc,
        AC_TYPE = :ac_type,
        AC_ACTIVE = :ac_active
      WHERE AC_CODE = :ac_code
        AND COMPANY_CODE = :company_code
      `,
      {
        l4_code: l4_code,
        ac_name: data.ac_name,
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
        credit_period: data.credit_period || null,
        credit_amount: data.credit_amount || null,
        curr_code: data.curr_code || null,
        bank_ac_code: data.bank_ac_code || null,
        bank_name: data.bank_name || null,
        bank_swift: data.bank_swift || null,
        // contract_expry_date: data.contract_expry_date || null,
        contract_expry_date: data.contract_expry_date ? new Date(data.contract_expry_date) : null,
        ac_infze: data.ac_infze || 'N',
        salesman_code: data.salesman_code || null,
        sector_code: data.sector_code || null,
        trn_no: data.trn_no || null,
        tax_registrd: data.tax_registrd || 'N',
        tax_country_code: data.tax_country_code || null,
        rcm_apply: data.rcm_apply || 'N',
        bi_main_group: data.bi_main_group || null,
        bi_sub_group: data.bi_sub_group || null,
        pl_bl_code: data.pl_bl_code || null,
        bi_exp_type: data.bi_exp_type || null,
        bi_pl_bs_ind: data.bi_pl_bs_ind || null,
        bi_dept: data.bi_dept || null,
        exp_type_code: data.exp_type_code || null,
        exp_subtype_code: data.exp_subtype_code || null,
        loginid,
        ac_status: data.ac_status || 'A',
        exp_alloc: data.exp_alloc || 'N',
        ac_type: data.ac_type || null,
        ac_active: data.ac_active || 'Y',
        ac_code,
        company_code
      },
      { autoCommit: true }
    );

    // 📎 Save files
    // if (files && files.length) {
    //   await Files.bulkCreate(
    //     (files as IFiles[]).map((file) => ({
    //       ...file,
    //       request_number: "ACCT" + ac_code
    //     }))
    //   );
    // }

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

//---------------------SaveFiles----------------------------//
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

  // Validate required fields
  if (!request_number || !files || !Array.isArray(files) || files.length === 0) {
    return res.status(constants.STATUS_CODES.BAD_REQUEST)
    .json({
      success: false,
      message: "request_number and files are required.",
    });
  }

  const duplicateRecords: string[] = [];
  const successfulRecords: { org_file_name: string; sr_no: number }[] = [];
  let connection: any;

  try {
    connection = await TenantManager.getConnection(tenantId);

    for (const file of files) {
      const { org_file_name } = file;

      // Check for duplicate entry
      const duplicateCheckQuery = `
        SELECT COUNT(*) AS COUNT
        FROM ACCOUNTS_FILES
        WHERE request_number = :request_number AND org_file_name = :org_file_name
      `;

      const duplicateCheckResult = await connection.execute(
        duplicateCheckQuery,
        { request_number, org_file_name },
        {}
      //  { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );

      if (duplicateCheckResult.rows?.[0]?.COUNT > 0) {
        duplicateRecords.push(org_file_name);
        continue;
      }

      // Insert new file record
      const query = `
        INSERT INTO ACCOUNTS_FILES (
          company_code, request_number, file_name, extensions, org_file_name, 
          aws_file_locn, flow_level, modules, updated_by, created_by, user_file_name, created_at, updated_at
        ) VALUES (
          :company_code, :request_number, :file_name, :extensions, :org_file_name, 
          :aws_file_locn, :flow_level, :modules, :updated_by, :created_by, :user_file_name, SYSDATE, SYSDATE
        )
      `;

      const {
        company_code,
        file_name,
        extensions,
        aws_file_locn,
        flow_level,
        modules,
        updated_by,
        created_by,
        user_file_name,
      } = file;

      await connection.execute(
        query,
        {
          company_code: company_code || null,
          request_number,
          file_name: file_name || null,
          extensions: extensions || null,
          org_file_name: org_file_name || null,
          aws_file_locn: aws_file_locn || null,
          flow_level: flow_level || null,
          modules: modules || null,
          updated_by: updated_by || null,
          created_by: created_by || null,
          user_file_name: user_file_name || null,
        },
        { autoCommit: true }
      );

      // Fetch the SR_NO generated by the sequence
      const fetchSrNoQuery = `
        SELECT SR_NO
        FROM (
          SELECT SR_NO
          FROM ACCOUNTS_FILES
          WHERE request_number = :request_number AND org_file_name = :org_file_name
          ORDER BY created_at DESC
        )
        WHERE ROWNUM = 1
      `;

      const srNoResult = await connection.execute(
        fetchSrNoQuery,
        { request_number, org_file_name },
        {}
      );

      if (srNoResult.rows?.[0]?.SR_NO) {
        successfulRecords.push({ 
          org_file_name, 
          sr_no: srNoResult.rows[0].SR_NO 
        });
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
  } catch (error) {
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


// Get AcTree Detail- Activity
export const getVendorActivities = async (req: RequestWithUser, res: Response): Promise<void> => {
  let connection;
  try {
    const ac_code = paramValue(req.query.ac_code as string | string[] | undefined);
    const { company_code } = req.user;       
    
    const tenantId = getCurrentTenantId();
    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant context not found" });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);
    const result = await connection.execute(
      `SELECT SRNO, ACT_CODE, ACT_DESC, USER_ID, USER_DT
       FROM MS_AC_VENDOR_ACTVY
       WHERE COMPANY_CODE = :company_code AND AC_CODE = :ac_code
       ORDER BY SRNO`,
      { company_code, ac_code },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    res.json({ success: true, data: result.rows });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (connection) await connection.close().catch(() => {});
  }
};

// //----------------delete----------

// Delete Operations
// export const deleteAccountItem = async (
//   // Delete account item based on level
//   req: RequestWithUser,
//   res: Response
// ) => {
//   try {
//     const level = req.params.level,
//       ac_code = req.query.ac_code;
//     const requestUser = req.user;
//     let response;
//     await sequelize.transaction(async (t) => {
//       // Use transaction for delete operations
//       switch (Number(level)) {
//         case 3:
//           // Delete Level 3 account
//           await AccountLevelThree.update(
//             {
//               updated_by: requestUser.loginid,
//             },
//             {
//               where: {
//                 l3_code: ac_code,
//                 company_code: requestUser.company_code,
//               },
//               transaction: t,
//             }
//           );
//           response = await AccountLevelThree.destroy({
//             where: { l3_code: ac_code, company_code: requestUser.company_code },
//             transaction: t,
//           });
//           break;
//         case 4:
//           // Delete Level 4 account
//           response = await AccountLevelFour.destroy({
//             where: { l4_code: ac_code, company_code: requestUser.company_code },
//           });
//           break;
//         case 5:
//           // Delete Level 5 account (Account)
//           await Account.update(
//             {
//               updated_by: requestUser.loginid,
//             },
//             {
//               where: {
//                 ac_code,
//                 company_code: requestUser.company_code,
//               },
//               transaction: t,
//             }
//           );
//           response = await Account.destroy({
//             where: { ac_code, company_code: requestUser.company_code },
//             transaction: t,
//           });
//           break;
//       }
//     });
//     if (!response) {
//       res
//         .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
//         .json({ success: false, message: response });
//     }
//     res.status(constants.STATUS_CODES.OK).json({
//       message: constants.MESSAGES.DELETED_SUCCESSFULLY,
//       success: true,
//     });
//     return;
//   } catch (error: any) {
//     res
//       .status(constants.STATUS_CODES.BAD_REQUEST)
//       .json({ success: false, message: error.message });
//     return;
//   }
// };

// export const deleteAccountItem = async (
//   req: RequestWithUser,
//   res: Response
// ) => {
//   try {
//     const level = Number(req.params.level);
//     const ac_code = req.query.ac_code as string;
//     const requestUser = req.user;

//     if (!ac_code) {
//       return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
//         success: false,
//         message: "Account code is required",
//       });
//     }

//     // Ensure TypeORM connection is ready
//     await TypeORMService.ensureConnection();

//     // Run transactional delete
//     const result = await TypeORMService.AppDataSource.manager.transaction(
//       async (manager: { getRepository: (arg0: typeof AccountLevelThree) => any; }) => {
//         switch (level) {
//           case 3: {
//             const repo = manager.getRepository(AccountLevelThree);

//             // Update "updated_by" before deleting
//             await repo.update(
//               { l3_code: ac_code, company_code: requestUser.company_code },
//               { updated_by: requestUser.loginid }
//             );

//             const deleteResult = await repo.delete({
//               l3_code: ac_code,
//               company_code: requestUser.company_code,
//             });
//             return deleteResult;
//           }

//           case 4: {
//             const repo = manager.getRepository(AccountLevelFour);

//             const deleteResult = await repo.delete({
//               l4_code: ac_code,
//               company_code: requestUser.company_code,
//             });
//             return deleteResult;
//           }

//           case 5: {
//             const repo = manager.getRepository(Account);

//             // Update "updated_by" before deleting
//             await repo.update(
//               { ac_code, company_code: requestUser.company_code },
//               { updated_by: requestUser.loginid }
//             );

//             const deleteResult = await repo.delete({
//               ac_code,
//               company_code: requestUser.company_code,
//             });
//             return deleteResult;
//           }

//           default:
//             throw new Error("Invalid account level");
//         }
//       }
//     );

//     if (!result.affected || result.affected === 0) {
//       return res.status(constants.STATUS_CODES.NOT_FOUND).json({
//         success: false,
//         message: "No record found to delete",
//       });
//     }

//     res.status(constants.STATUS_CODES.OK).json({
//       success: true,
//       message: constants.MESSAGES.DELETED_SUCCESSFULLY,
//     });
//   } catch (error: any) {
//     console.error("Delete account error:", error);
//     res.status(constants.STATUS_CODES.BAD_REQUEST).json({
//       success: false,
//       message: error.message || "Failed to delete account",
//     });
//   }
// };

// export const deleteAccountItem = async (req: RequestWithUser, res: Response) => {
//   const level = Number(req.params.level);
//   const ac_code = req.query.ac_code as string;
//   const requestUser = req.user;
// console.log("-----------CALLING DELETE1-----------------------")
//   const queryRunner = AppDataSource.createQueryRunner();

//   try {
//     // Start transaction
//     await queryRunner.connect();
//     await queryRunner.startTransaction();

//     let result;
//     console.log("-----------error1-----------------------") 
//     switch (level) {
      
//       case 2:
//         // Check Level-2 exists
//         console.log("-----------error2-----------------------") 
//         const level2 = await queryRunner.manager.findOne(AccountLevelTwo, {
//           where: { l2_code: ac_code, company_code: requestUser.company_code },
//         });

//         if (!level2) {
//           res.status(constants.STATUS_CODES.NOT_FOUND).json({
//             success: false,
//             message: constants.MESSAGES.NOT_FOUND,
//           });
//           throw new Error("Level-2 not found"); // stop transaction
//         }

//         // Check child Level-3 exists
//         const childL3 = await queryRunner.manager.findOne(AccountLevelThree, {
//           where: { l2_code: ac_code, company_code: requestUser.company_code },
//         });

//         if (childL3) {
//           res.status(constants.STATUS_CODES.BAD_REQUEST).json({
//             success: false,
//             message: "Cannot delete. Level-2 has child Level-3 accounts.",
//           });
//           throw new Error("Level-2 has children"); // stop transaction
//         }

//         // Delete Level-2
//         result = await queryRunner.manager.delete(AccountLevelTwo, {
//           l2_code: ac_code,
//           company_code: requestUser.company_code,
//         });
//         break;
        

//       case 3:
//         console.log("-----------error3-----------------------") 
//         // Update updated_by first
//         await queryRunner.manager.update(
//           AccountLevelThree,
//           { l3_code: ac_code, company_code: requestUser.company_code },
//           { updated_by: requestUser.loginid }
//         );

//         result = await queryRunner.manager.delete(AccountLevelThree, {
//           l3_code: ac_code,
//           company_code: requestUser.company_code,
//         });
//         break;

//       case 4:
//         console.log("-----------error4-----------------------") 
//         result = await queryRunner.manager.delete(AccountLevelFour, {
//           l4_code: ac_code,
//           company_code: requestUser.company_code,
//         });
//         break;

//       case 5:
//         console.log("-----------error5-----------------------") 
//         await queryRunner.manager.update(
//           Account,
//           { ac_code, company_code: requestUser.company_code },
//           { updated_by: requestUser.loginid }
//         );

//         result = await queryRunner.manager.delete(Account, {
//           ac_code,
//           company_code: requestUser.company_code,
//         });
//         break;
        

//       default:
//         res.status(constants.STATUS_CODES.BAD_REQUEST).json({
//           success: false,
//           message: "Invalid level",
//         });
//         throw new Error("Invalid level");
//     }
//     console.log("-----------error6-----------------------") 

//     await queryRunner.commitTransaction();

//     res.status(constants.STATUS_CODES.OK).json({
//       success: true,
//       message: constants.MESSAGES.DELETED_SUCCESSFULLY,
//     });
//   } catch (error: any) {
//     await queryRunner.rollbackTransaction();

//     if (!res.headersSent) {
//       res.status(constants.STATUS_CODES.BAD_REQUEST).json({
//         success: false,
//         message: error.message,
//       });
//     }
//   } finally {
//     await queryRunner.release();
//   }
// };

