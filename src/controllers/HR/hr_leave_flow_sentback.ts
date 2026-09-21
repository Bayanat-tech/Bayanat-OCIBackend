import { Request, Response } from "express";
import { QueryExecutor } from "../../database/QueryExecutor";
import constants from "../../helpers/constants";
import { RequestWithUser } from "../../interfaces/common.interface";
import { IUser } from "../../interfaces/user.interface";

export const getRequestFlowUsers = async (req: RequestWithUser, res: Response) => {
  try {
    const requestUser: IUser = req.user;
    // const { loginid1 } = requestUser;
    const { doc_id } = req.query;
    const { loginId } = req.query;
    const currentLoginId = String(loginId || "").trim();

    console.log("All query parameters:", req.query);
    console.log("requestUser", requestUser);
    console.log("doc_id:", doc_id);
    console.log("loginid from user:", currentLoginId);
    console.log("loginid type:", typeof loginId);

    if (!doc_id || typeof doc_id !== "string") {
      return res.status(constants.STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Invalid or missing document ID",
      });
    }

    const finalApproverQuery = `
      SELECT d.LEAVE_FINAL_APPROVER
      FROM MS_HR_DEPARTMENT d
      JOIN MS_HR_EMPLOYEE e
        ON d.DIV_CODE = e.DIV_CODE
       AND d.DEPT_CODE = e.DEPT_CODE
      WHERE e.EMPLOYEE_ID = :loginId
    `;
    const ceoResult = await QueryExecutor.execMaybe(finalApproverQuery, { loginId: currentLoginId });
    const CEO_CODE = String(ceoResult.rows?.[0]?.LEAVE_FINAL_APPROVER || "00001").trim();

    const leaveInfoQuery = `
      SELECT LEAVE_TYPE, LEAVE_DAYS
      FROM VW_HR_LEAVE_REQUEST_FLOW
      WHERE REQUEST_NUMBER = :doc_id
    `;
    const leaveInfoResult = await QueryExecutor.execMaybe(leaveInfoQuery, { doc_id });
    const leaveData = leaveInfoResult.rows?.[0];
    const isCeoFlow =
      leaveData &&
      ["AL", "ANNUAL"].includes(String(leaveData.LEAVE_TYPE).toUpperCase()) &&
      Number(leaveData.LEAVE_DAYS) < 20;

    console.log("CEO FLOW:", isCeoFlow);

    const roleQuery = `
      SELECT HOD, DEPT_HEAD, IMMEDIATE_SUPERVISOR,
             LENGTH(HOD) as HOD_LENGTH,
             LENGTH(DEPT_HEAD) as DEPT_HEAD_LENGTH, 
             LENGTH(IMMEDIATE_SUPERVISOR) as IMMEDIATE_SUPERVISOR_LENGTH
      FROM VW_HR_LEAVE_REQUEST_FLOW
      WHERE REQUEST_NUMBER = :doc_id
    `;

    const roleResult = await QueryExecutor.execMaybe(roleQuery, { doc_id });

    if (!roleResult.rows || roleResult.rows.length === 0) {
      return res.status(constants.STATUS_CODES.NOT_FOUND).json({
        success: false,
        message: "Request number not found",
      });
    }

    const roleData = roleResult.rows[0];
    
    console.log("HOD from DB:", roleData.HOD, "type:", typeof roleData.HOD, "length:", roleData.HOD_LENGTH);
    console.log("DEPT_HEAD from DB:", roleData.DEPT_HEAD, "type:", typeof roleData.DEPT_HEAD, "length:", roleData.DEPT_HEAD_LENGTH);
    console.log("IMMEDIATE_SUPERVISOR from DB:", roleData.IMMEDIATE_SUPERVISOR, "type:", typeof roleData.IMMEDIATE_SUPERVISOR, "length:", roleData.IMMEDIATE_SUPERVISOR_LENGTH);

    const HOD = String(roleData.HOD || "").trim();
    const DEPT_HEAD = String(roleData.DEPT_HEAD || "").trim();
    const IMMEDIATE_SUPERVISOR = String(roleData.IMMEDIATE_SUPERVISOR || "").trim();

    // const paddedLoginId = loginid.padStart(5, '0');
    // console.log("Padded loginid:", paddedLoginId, "length:", paddedLoginId.length);
    const isCaseA = IMMEDIATE_SUPERVISOR !== DEPT_HEAD && DEPT_HEAD === HOD;
    const isCaseB = IMMEDIATE_SUPERVISOR !== DEPT_HEAD && DEPT_HEAD !== HOD;
    const isCaseC = IMMEDIATE_SUPERVISOR === DEPT_HEAD && DEPT_HEAD !== HOD;
    const isCaseD = IMMEDIATE_SUPERVISOR === DEPT_HEAD && DEPT_HEAD === HOD;

    console.log({ isCaseA, isCaseB, isCaseC, isCaseD });

    console.log("Comparison results with padded loginid:");
    console.log("paddedLoginId === HOD:", currentLoginId === HOD, `(${currentLoginId} === ${HOD})`);
    console.log("paddedLoginId === DEPT_HEAD:", currentLoginId === DEPT_HEAD, `(${currentLoginId} === ${DEPT_HEAD})`);
    console.log("paddedLoginId === IMMEDIATE_SUPERVISOR:", currentLoginId === IMMEDIATE_SUPERVISOR, `(${currentLoginId} === ${IMMEDIATE_SUPERVISOR})`);

    let roleBasedQuery = "";
    const queryParams: Record<string, unknown> = { doc_id };

    if (currentLoginId === HOD) {
      console.log("User is HOD");
      roleBasedQuery = `
        SELECT V.CREATED_BY AS login_id, S.USERNAME
        FROM VW_HR_LEAVE_REQUEST_FLOW V
        JOIN SEC_LOGIN S ON V.CREATED_BY = S.LOGINID1
        WHERE V.REQUEST_NUMBER = :doc_id
        UNION
        SELECT V.IMMEDIATE_SUPERVISOR, S.USERNAME
        FROM VW_HR_LEAVE_REQUEST_FLOW V
        JOIN SEC_LOGIN S ON V.IMMEDIATE_SUPERVISOR = S.LOGINID1
        WHERE V.REQUEST_NUMBER = :doc_id
        UNION
        SELECT V.DEPT_HEAD, S.USERNAME
        FROM VW_HR_LEAVE_REQUEST_FLOW V
        JOIN SEC_LOGIN S ON V.DEPT_HEAD = S.LOGINID1
        WHERE V.REQUEST_NUMBER = :doc_id
      `;
      if (isCeoFlow) {
        queryParams.ceoCode = CEO_CODE;
        roleBasedQuery += `
          UNION
          SELECT S.LOGINID1, S.USERNAME
          FROM SEC_LOGIN S
          WHERE S.LOGINID1 = :ceoCode
        `;
      }
    } else if (currentLoginId === DEPT_HEAD) {
      console.log("User is DEPT_HEAD");
      roleBasedQuery = `
        SELECT V.CREATED_BY AS login_id, S.USERNAME
        FROM VW_HR_LEAVE_REQUEST_FLOW V
        JOIN SEC_LOGIN S ON V.CREATED_BY = S.LOGINID1
        WHERE V.REQUEST_NUMBER = :doc_id
        UNION
        SELECT V.IMMEDIATE_SUPERVISOR, S.USERNAME
        FROM VW_HR_LEAVE_REQUEST_FLOW V
        JOIN SEC_LOGIN S ON V.IMMEDIATE_SUPERVISOR = S.LOGINID1
        WHERE V.REQUEST_NUMBER = :doc_id
      `;
      if (isCeoFlow) {
        queryParams.ceoCode = CEO_CODE;
        roleBasedQuery += `
          UNION
          SELECT S.LOGINID1, S.USERNAME
          FROM SEC_LOGIN S
          WHERE S.LOGINID1 = :ceoCode
        `;
      }
    } else if (currentLoginId === CEO_CODE) {
      console.log("User is CEO");
      if (isCaseA) {
        roleBasedQuery = `
          SELECT V.CREATED_BY AS login_id, S.USERNAME
          FROM VW_HR_LEAVE_REQUEST_FLOW V
          JOIN SEC_LOGIN S ON V.CREATED_BY = S.LOGINID1
          WHERE V.REQUEST_NUMBER = :doc_id
          UNION
          SELECT V.IMMEDIATE_SUPERVISOR, S.USERNAME
          FROM VW_HR_LEAVE_REQUEST_FLOW V
          JOIN SEC_LOGIN S ON V.IMMEDIATE_SUPERVISOR = S.LOGINID1
          WHERE V.REQUEST_NUMBER = :doc_id
        `;
      } else if (isCaseB) {
        roleBasedQuery = `
          SELECT V.CREATED_BY AS login_id, S.USERNAME
          FROM VW_HR_LEAVE_REQUEST_FLOW V
          JOIN SEC_LOGIN S ON V.CREATED_BY = S.LOGINID1
          WHERE V.REQUEST_NUMBER = :doc_id
          UNION
          SELECT V.IMMEDIATE_SUPERVISOR, S.USERNAME
          FROM VW_HR_LEAVE_REQUEST_FLOW V
          JOIN SEC_LOGIN S ON V.IMMEDIATE_SUPERVISOR = S.LOGINID1
          WHERE V.REQUEST_NUMBER = :doc_id
          UNION
          SELECT V.DEPT_HEAD, S.USERNAME
          FROM VW_HR_LEAVE_REQUEST_FLOW V
          JOIN SEC_LOGIN S ON V.DEPT_HEAD = S.LOGINID1
          WHERE V.REQUEST_NUMBER = :doc_id
        `;
      } else if (isCaseC) {
        roleBasedQuery = `
          SELECT V.CREATED_BY AS login_id, S.USERNAME
          FROM VW_HR_LEAVE_REQUEST_FLOW V
          JOIN SEC_LOGIN S ON V.CREATED_BY = S.LOGINID1
          WHERE V.REQUEST_NUMBER = :doc_id
          UNION
          SELECT V.IMMEDIATE_SUPERVISOR, S.USERNAME
          FROM VW_HR_LEAVE_REQUEST_FLOW V
          JOIN SEC_LOGIN S ON V.IMMEDIATE_SUPERVISOR = S.LOGINID1
          WHERE V.REQUEST_NUMBER = :doc_id
        `;
      } else if (isCaseD) {
        roleBasedQuery = `
          SELECT V.CREATED_BY AS login_id, S.USERNAME
          FROM VW_HR_LEAVE_REQUEST_FLOW V
          JOIN SEC_LOGIN S ON V.CREATED_BY = S.LOGINID1
          WHERE V.REQUEST_NUMBER = :doc_id
        `;
      }
    } else if (currentLoginId === IMMEDIATE_SUPERVISOR) {
      console.log("User is IMMEDIATE_SUPERVISOR");
      roleBasedQuery = `
        SELECT V.CREATED_BY AS login_id, S.USERNAME
        FROM VW_HR_LEAVE_REQUEST_FLOW V
        JOIN SEC_LOGIN S ON V.CREATED_BY = S.LOGINID1
        WHERE V.REQUEST_NUMBER = :doc_id
      `;
    } else {
      console.log("User is NOT authorized");
      return res.status(constants.STATUS_CODES.UNAUTHORIZED).json({
        success: false,
        message: "User is not authorized to view this request flow",
      });
    }

    if (!roleBasedQuery) {
      return res.status(constants.STATUS_CODES.UNAUTHORIZED).json({
        success: false,
        message: "User is not authorized to view this request flow",
      });
    }

    console.log("Executing query:", roleBasedQuery);
    console.log("With parameters:", queryParams);

    const usersInFlow = await QueryExecutor.execMaybe(roleBasedQuery, queryParams);

    return res.status(constants.STATUS_CODES.OK).json({
      success: false,
      data: usersInFlow.rows,
    });
  } catch (error: unknown) {
    const knownError = error as { message: string };
    console.error("Error in getRequestFlowUsers:", knownError);
    return res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: knownError.message || "Internal server error",
    });
  }
};
