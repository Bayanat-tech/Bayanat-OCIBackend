// Import required dependencies and interfaces
import { Response } from "express";
import constants from "../../../../helpers/constants";
import {
  IFiles,
  RequestWithUser,
} from "../../../../interfaces/common.interface";
import { IUser } from "../../../../interfaces/user.interface";

// Import database models
import Account from "../../../../models/finance/accounts/masters/account_finance.model";
import AccountLevelFour from "../../../../models/finance/accounts/masters/account_level_four.model";
import AccountLevelThree from "../../../../models/finance/accounts/masters/account_level_three.model";

// Import validation schemas
import {
  accountFinanceSchema,
  accountLevelFourFinanceSchema,
  accountLevelThreeFinanceSchema,
  accountLevelTwoFinanceSchema
} from "../../../../validation/finance/accounts/masters.validation";
import AccountLevelTwo from "../../../../models/finance/accounts/masters/account_level_two.model";
import VwAcMaster from "../../../../views/finance/accounts/masters/acTree.view";
import { buildHierarchy } from "../../../../helpers/functions";
// import { sequelize } from "../../../../database/connection";
import Files from "../../../../models/files.model";
import oracledb from "oracledb";

// Get account tree structure
export const getAcTree = async (req: RequestWithUser, res: Response) => {
  let connection;
  try {
    const requestUser: IUser = req.user;
    
    connection = await oracledb.getConnection();

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
    const { ac_code } = req.params;

    connection = await oracledb.getConnection();

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

    // Validate request body
    const { error } = accountLevelTwoFinanceSchema(req.body);
    if (error) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: error.message
      });
      return;
    }
    connection = await oracledb.getConnection();
   
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
    const { ac_code } = req.params; // l3_code
    const { l1_code, l2_description } = req.body;

    //  Validate request body
    const { error } = accountLevelTwoFinanceSchema(req.body);
    if (error) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: error.message
      });
      return;
    }

    connection = await oracledb.getConnection();

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


// Level 3 Account Operations
//---------level3-----------
export const getLevel3AcTreeNode = async (
  req: RequestWithUser,
  res: Response
) => {
  let connection;

  try {
    const { company_code } = req.user;
    const { ac_code } = req.params;

    connection = await oracledb.getConnection();

    const result = await connection.execute(
      `
      SELECT
          l3_code,
          l2_code,
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

    // Validate request body
    const { error } = accountLevelThreeFinanceSchema(req.body);
    if (error) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: error.message
      });
      return;
    }
    connection = await oracledb.getConnection();

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
    const { ac_code } = req.params; // l3_code
    const { l2_code, l3_description } = req.body;

    //  Validate request body
    const { error } = accountLevelThreeFinanceSchema(req.body);
    if (error) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: error.message
      });
      return;
    }

    connection = await oracledb.getConnection();

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
    const { ac_code } = req.params;

    connection = await oracledb.getConnection();

    const result = await connection.execute(
      `
      SELECT
        L4_CODE,
        L4_DESCRIPTION,
        L3_CODE,
        COMPANY_CODE
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
    company_code:row.COMPANY_CODE
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
    const { l3_code, l4_description } = req.body;

    // Validate request body
    const { error } = accountLevelFourFinanceSchema(req.body);
    if (error) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: error.message
      });
      return;
    }

    connection = await oracledb.getConnection();

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
        COMPANY_CODE,
        CREATED_BY,
        UPDATED_BY
      )
      VALUES (
        '',
        :l3_code,
        :l4_description,
        :company_code,
        :loginid,
        :loginid
      )
      `,
      {
        l3_code,
        l4_description,
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
    const { ac_code } = req.params;
    const { l3_code, l4_description } = req.body;

    // Validate request body
    const { error } = accountLevelFourFinanceSchema(req.body);
    if (error) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: error.message
      });
      return;
    }

    connection = await oracledb.getConnection();

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
        UPDATED_BY = :loginid
      WHERE L4_CODE = :l4_code
        AND COMPANY_CODE = :company_code
      `,
      {
        l3_code,
        l4_description,
        loginid,
        l4_code: ac_code,
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
//     const { ac_code } = req.params;
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
    const { ac_code } = req.params;

    connection = await oracledb.getConnection();

    const result = await connection.execute(
      `
      SELECT *
      FROM MS_AC
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

// // Create new account children node
// export const createAccountChildrenAcTreeNode = async (
//   req: RequestWithUser,
//   res: Response
// ) => {
//   try {
//     const requestUser: IUser = req.user;
//     const { company_code } = requestUser;

//     // Validate request body
//     const { error } = accountFinanceSchema(req.body);
//     if (error) {
//       res
//         .status(constants.STATUS_CODES.BAD_REQUEST)
//         .json({ success: false, message: error.message });
//       return;
//     }

//     // Check if parent Level 4 exists
//     const isLevelFourExists = await AccountLevelFour.findOne({
//       where: { l4_code: req.body.l4_code },
//     });
//     if (!isLevelFourExists) {
//       res.status(constants.STATUS_CODES.NOT_FOUND).json({
//         success: false,
//         message: "Level4 " + constants.MESSAGES.NOT_FOUND,
//       });
//       return;
//     }

//     // Separate files from request body
//     const { files, ...data } = req.body;

//     // Create account
//     const response = await Account.create({
//       ac_code: "",
//       company_code,
//       updated_by: requestUser.loginid,
//       created_by: requestUser.loginid,
//       ...data,
//     });

//     // Get session code and handle file uploads
//     const getSessionCode: { code: string }[][] = (await sequelize.query(
//       `SELECT code from GT_SESSION_INFO WHERE USERID='${req.user.loginid}'`
//     )) as { code: string }[][];
//     files.forEach((item: any) => {
//       item.request_number = "ACCT" + getSessionCode[0][0].code;
//     });
//     if (!!files && files.length) {
//       await Files.bulkCreate(
//         (files as IFiles[]).map((eachFile) => {
//           return {
//             ...eachFile,
//             request_number: "ACCT" + getSessionCode[0][0].code,
//           };
//         })
//       );
//     }
//     if (!response) {
//       res
//         .status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR)
//         .json({ success: false, message: response });
//       return;
//     }
//     res.status(constants.STATUS_CODES.OK).json({
//       success: true,
//       message:
//         getSessionCode[0][0].code +
//         " " +
//         constants.MESSAGES.CREATED_SUCCESSFULLY,
//     });
//     return;
//   } catch (error: any) {
//     res
//       .status(constants.STATUS_CODES.BAD_REQUEST)
//       .json({ success: false, message: error.message });
//     return;
//   }
// };


export const createAccountChildrenAcTreeNode = async (
  req: RequestWithUser,
  res: Response
) => {
  let connection;

  try {
    const { company_code, loginid } = req.user;
    const { l4_code, files, ...data } = req.body;

    // Validate request
    const { error } = accountFinanceSchema(req.body);
    if (error) {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: error.message
      });
      return;
    }

    connection = await oracledb.getConnection();

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
      INSERT INTO MS_AC (
        AC_CODE,
        L4_CODE,
        COMPANY_CODE,
        CREATED_BY,
        UPDATED_BY
      )
      VALUES (
        '',
        :l4_code,
        :company_code,
        :loginid,
        :loginid
      )
      `,
      {
        l4_code,
        company_code,
        loginid
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
//     const { ac_code } = req.params;
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


// export const updateAccountChildrenAcTreeNode = async (
//   req: RequestWithUser,
//   res: Response
// ) => {
//   let connection;

//   try {
//     const { company_code, loginid } = req.user;
//     const { ac_code } = req.params;
//     const { l4_code, files, ...data } = req.body;

//     const { error } = accountFinanceSchema(req.body);
//     if (error) {
//       res.status(constants.STATUS_CODES.BAD_REQUEST).json({
//         success: false,
//         message: error.message
//       });
//       return;
//     }

//     connection = await oracledb.getConnection();

//     //  Check Account exists
//     const accountResult = await connection.execute(
//       `
//       SELECT 1
//       FROM MS_AC
//       WHERE AC_CODE = :ac_code
//         AND COMPANY_CODE = :company_code
//       `,
//       { ac_code, company_code },
//       { outFormat: oracledb.OUT_FORMAT_OBJECT }
//     );

//     if (!accountResult.rows || accountResult.rows.length === 0) {
//       res.status(constants.STATUS_CODES.NOT_FOUND).json({
//         success: false,
//         message: constants.MESSAGES.NOT_FOUND
//       });
//       return;
//     }

//     //  Check Level 4 exists
//     const level4Result = await connection.execute(
//       `
//       SELECT 1
//       FROM MS_AC_L4
//       WHERE L4_CODE = :l4_code
//         AND COMPANY_CODE = :company_code
//       `,
//       { l4_code, company_code },
//       { outFormat: oracledb.OUT_FORMAT_OBJECT }
//     );

//     if (!level4Result.rows || level4Result.rows.length === 0) {
//       res.status(constants.STATUS_CODES.NOT_FOUND).json({
//         success: false,
//         message: "Level4 " + constants.MESSAGES.NOT_FOUND
//       });
//       return;
//     }

//     // Update Account
//     await connection.execute(
//       `
//       UPDATE MS_AC
//       SET
//         L4_CODE = :l4_code,
//         UPDATED_BY = :loginid
//       WHERE AC_CODE = :ac_code
//         AND COMPANY_CODE = :company_code
//       `,
//       {
//         l4_code,
//         loginid,
//         ac_code,
//         company_code
//       },
//       { autoCommit: true }
//     );

//     // 📎 Save files
//     if (files && files.length) {
//       await Files.bulkCreate(
//         (files as IFiles[]).map((file) => ({
//           ...file,
//           request_number: "ACCT" + ac_code
//         }))
//       );
//     }

//     res.status(constants.STATUS_CODES.OK).json({
//       success: true,
//       message: constants.MESSAGES.UPDATED_SUCCESSFULLY
//     });
//     return;

//   } catch (error: any) {
//     res.status(constants.STATUS_CODES.BAD_REQUEST).json({
//       success: false,
//       message: error.message
//     });
//     return;

//   } finally {
//     if (connection) await connection.close();
//   }
// };



// //----------------delete----------

// // Delete Operations
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
