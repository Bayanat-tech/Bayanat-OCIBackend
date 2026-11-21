import { Response } from "express";
import oracledb from "oracledb";
import constants from "../../helpers/constants";
import { RequestWithUser } from "../../interfaces/common.interface";
import TenantManager from "../../database/TenantManager";
import { getCurrentTenantId } from "../../middleware/tenantContext.middleware";

// Helper to get connection
const getTenantConn = async () => {
  const tenantId = getCurrentTenantId();
  if (!tenantId) throw new Error("Tenant context not found");
  return await TenantManager.getConnection(tenantId);
};

// ======================== DRIVERS ========================
export const getDrivers = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn;
  try {
    conn = await getTenantConn();
    const companyCode = req.user?.company_code || 'BSG';
    const result = await conn.execute(
      `SELECT EMP_ID, EMP_NAME, DEPT_CODE, GRADE_CODE, CATEGORY_CODE,
              MOBILE_NO, PHONE_NO, E_MAIL, PERMANENT_ADDRESS,
              DRIVING_LIC_NO, ISSUE_PLACE, ISSUE_DATE, VALID_UPTO, EMPSTATUS_CODE
       FROM MS_HR_EMP
       WHERE COMPANY_CODE = :comp AND (CATEGORY_CODE = 'DRIVER' OR CATEGORY_CODE IS NULL OR EMP_ID LIKE 'DRV%')
       ORDER BY EMP_ID DESC`,
      { comp: companyCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    res.status(constants.STATUS_CODES.OK).json({ success: true, data: result.rows });
  } catch (error: any) {
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({ success: false, message: error.message });
  } finally {
    if (conn) await conn.close();
  }
};

export const saveDriver = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn;
  try {
    conn = await getTenantConn();
    const companyCode = req.user?.company_code || 'BSG';
    const userId = req.user?.user_id || 'MHDL_BTS';
    const {
      emp_id, emp_name, dept_code, grade_code, category_code,
      mobile_no, phone_no, e_mail, permanent_address,
      driving_lic_no, issue_place, issue_date, valid_upto, empstatus_code
    } = req.body;

    const binds = {
      P_COMPANY_CODE: companyCode,
      P_EMP_ID: { dir: oracledb.BIND_INOUT, type: oracledb.STRING, val: emp_id || null },
      P_EMP_NAME: emp_name,
      P_DEPT_CODE: dept_code || null,
      P_GRADE_CODE: grade_code || null,
      P_CATEGORY_CODE: category_code || 'DRIVER',
      P_MOBILE_NO: mobile_no || null,
      P_PHONE_NO: phone_no || null,
      P_E_MAIL: e_mail || null,
      P_PERMANENT_ADDRESS: permanent_address || null,
      P_DRIVING_LIC_NO: driving_lic_no || null,
      P_ISSUE_PLACE: issue_place || null,
      P_ISSUE_DATE: issue_date ? new Date(issue_date) : null,
      P_VALID_UPTO: valid_upto ? new Date(valid_upto) : null,
      P_EMPSTATUS_CODE: empstatus_code || 'ACTIVE',
      P_USER_ID: userId,
      P_OUT_STATUS: { dir: oracledb.BIND_OUT, type: oracledb.STRING },
      P_OUT_MSG: { dir: oracledb.BIND_OUT, type: oracledb.STRING }
    };

    const result: any = await conn.execute(
      `BEGIN PROC_TMS_DRIVER_SAVE(:P_COMPANY_CODE, :P_EMP_ID, :P_EMP_NAME, :P_DEPT_CODE, :P_GRADE_CODE, :P_CATEGORY_CODE, :P_MOBILE_NO, :P_PHONE_NO, :P_E_MAIL, :P_PERMANENT_ADDRESS, :P_DRIVING_LIC_NO, :P_ISSUE_PLACE, :P_ISSUE_DATE, :P_VALID_UPTO, :P_EMPSTATUS_CODE, :P_USER_ID, :P_OUT_STATUS, :P_OUT_MSG); END;`,
      binds,
      { autoCommit: true }
    );

    const outStatus = result.outBinds.P_OUT_STATUS;
    const outMsg = result.outBinds.P_OUT_MSG;
    const outEmpId = result.outBinds.P_EMP_ID;

    if (outStatus === 'ERROR') {
      res.status(constants.STATUS_CODES.BAD_REQUEST).json({ success: false, message: outMsg });
    } else {
      res.status(constants.STATUS_CODES.OK).json({ success: true, message: outMsg, emp_id: outEmpId });
    }
  } catch (error: any) {
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({ success: false, message: error.message });
  } finally {
    if (conn) await conn.close();
  }
};

export const deleteDriver = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn;
  try {
    conn = await getTenantConn();
    const companyCode = req.user?.company_code || 'BSG';
    const { emp_id } = req.params;

    const binds = {
      P_COMPANY_CODE: companyCode,
      P_EMP_ID: emp_id,
      P_OUT_STATUS: { dir: oracledb.BIND_OUT, type: oracledb.STRING },
      P_OUT_MSG: { dir: oracledb.BIND_OUT, type: oracledb.STRING }
    };

    const result: any = await conn.execute(
      `BEGIN PROC_TMS_DRIVER_DELETE(:P_COMPANY_CODE, :P_EMP_ID, :P_OUT_STATUS, :P_OUT_MSG); END;`,
      binds,
      { autoCommit: true }
    );

    res.status(constants.STATUS_CODES.OK).json({
      success: result.outBinds.P_OUT_STATUS === 'SUCCESS',
      message: result.outBinds.P_OUT_MSG
    });
  } catch (error: any) {
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({ success: false, message: error.message });
  } finally {
    if (conn) await conn.close();
  }
};

// ======================== VEHICLES ========================
export const getVehicles = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn;
  try {
    conn = await getTenantConn();
    const companyCode = req.user?.company_code || 'BSG';
    const result = await conn.execute(
      `SELECT V.VEHICLE_NO, V.VEHICLE_REGNO, V.VEHICLE_TYPE, T.VTYPE_NAME,
              V.VEHICLE_WEIGHT, V.VEHICLE_VOLUME, V.TRANSPORTER_CODE, V.VEHICLE_DESC
       FROM MS_VEHICLE V
       LEFT JOIN MS_VEHICLE_TYPE T ON V.VEHICLE_TYPE = T.VTYPE_CODE
       WHERE V.COMPANY_CODE = :comp
       ORDER BY V.VEHICLE_NO ASC`,
      { comp: companyCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    res.status(constants.STATUS_CODES.OK).json({ success: true, data: result.rows });
  } catch (error: any) {
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({ success: false, message: error.message });
  } finally {
    if (conn) await conn.close();
  }
};

export const saveVehicle = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn;
  try {
    conn = await getTenantConn();
    const companyCode = req.user?.company_code || 'BSG';
    const userId = req.user?.user_id || 'MHDL_BTS';
    const {
      vehicle_no, vehicle_regno, vehicle_type,
      vehicle_weight, vehicle_volume, transporter_code, vehicle_desc
    } = req.body;

    const binds = {
      P_COMPANY_CODE: companyCode,
      P_VEHICLE_NO: vehicle_no,
      P_VEHICLE_REGNO: vehicle_regno || null,
      P_VEHICLE_TYPE: vehicle_type || null,
      P_VEHICLE_WEIGHT: Number(vehicle_weight) || 0,
      P_VEHICLE_VOLUME: Number(vehicle_volume) || 0,
      P_TRANSPORTER_CODE: transporter_code || null,
      P_VEHICLE_DESC: vehicle_desc || null,
      P_USER_ID: userId,
      P_OUT_STATUS: { dir: oracledb.BIND_OUT, type: oracledb.STRING },
      P_OUT_MSG: { dir: oracledb.BIND_OUT, type: oracledb.STRING }
    };

    const result: any = await conn.execute(
      `BEGIN PROC_TMS_VEHICLE_SAVE(:P_COMPANY_CODE, :P_VEHICLE_NO, :P_VEHICLE_REGNO, :P_VEHICLE_TYPE, :P_VEHICLE_WEIGHT, :P_VEHICLE_VOLUME, :P_TRANSPORTER_CODE, :P_VEHICLE_DESC, :P_USER_ID, :P_OUT_STATUS, :P_OUT_MSG); END;`,
      binds,
      { autoCommit: true }
    );

    res.status(constants.STATUS_CODES.OK).json({
      success: result.outBinds.P_OUT_STATUS === 'SUCCESS',
      message: result.outBinds.P_OUT_MSG
    });
  } catch (error: any) {
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({ success: false, message: error.message });
  } finally {
    if (conn) await conn.close();
  }
};

export const deleteVehicle = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn;
  try {
    conn = await getTenantConn();
    const companyCode = req.user?.company_code || 'BSG';
    const { vehicle_no } = req.params;

    const binds = {
      P_COMPANY_CODE: companyCode,
      P_VEHICLE_NO: vehicle_no,
      P_OUT_STATUS: { dir: oracledb.BIND_OUT, type: oracledb.STRING },
      P_OUT_MSG: { dir: oracledb.BIND_OUT, type: oracledb.STRING }
    };

    const result: any = await conn.execute(
      `BEGIN PROC_TMS_VEHICLE_DELETE(:P_COMPANY_CODE, :P_VEHICLE_NO, :P_OUT_STATUS, :P_OUT_MSG); END;`,
      binds,
      { autoCommit: true }
    );

    res.status(constants.STATUS_CODES.OK).json({
      success: result.outBinds.P_OUT_STATUS === 'SUCCESS',
      message: result.outBinds.P_OUT_MSG
    });
  } catch (error: any) {
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({ success: false, message: error.message });
  } finally {
    if (conn) await conn.close();
  }
};

export const getVehicleTypes = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn;
  try {
    conn = await getTenantConn();
    const result = await conn.execute(
      `SELECT VTYPE_CODE, VTYPE_NAME, AXLE_TYPE, NO_OF_TYRES, VOLUMN, WEIGHT
       FROM MS_VEHICLE_TYPE
       ORDER BY VTYPE_CODE ASC`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    res.status(constants.STATUS_CODES.OK).json({ success: true, data: result.rows });
  } catch (error: any) {
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({ success: false, message: error.message });
  } finally {
    if (conn) await conn.close();
  }
};

// ======================== TRANSPORT REQUESTS ========================
export const getRequests = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn;
  try {
    conn = await getTenantConn();
    const companyCode = req.user?.company_code || 'BSG';
    const result = await conn.execute(
      `SELECT DOC_TYPE, DOC_NO, DOC_DATE, REQUESTED_BY, REQUESTED_DATE,
              JOB_TYPE, DEPT_CODE, PRIORITY, REMARKS, NO_OF_CONTAINER, CONTAINER_TYPE
       FROM TP_REQUEST_HDR
       WHERE COMPANY_CODE = :comp
       ORDER BY DOC_NO DESC`,
      { comp: companyCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    res.status(constants.STATUS_CODES.OK).json({ success: true, data: result.rows });
  } catch (error: any) {
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({ success: false, message: error.message });
  } finally {
    if (conn) await conn.close();
  }
};

export const saveRequest = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn;
  try {
    conn = await getTenantConn();
    const companyCode = req.user?.company_code || 'BSG';
    const userId = req.user?.user_id || 'MHDL_BTS';
    const {
      doc_type, doc_no, doc_date, requested_by, requested_date,
      job_type, dept_code, priority, remarks, items
    } = req.body;

    const binds = {
      P_COMPANY_CODE: companyCode,
      P_DOC_TYPE: doc_type || 'TR',
      P_DOC_NO: { dir: oracledb.BIND_INOUT, type: oracledb.NUMBER, val: doc_no ? Number(doc_no) : null },
      P_DOC_DATE: doc_date ? new Date(doc_date) : new Date(),
      P_REQUESTED_BY: requested_by || userId,
      P_REQUESTED_DATE: requested_date ? new Date(requested_date) : new Date(),
      P_JOB_TYPE: job_type || null,
      P_DEPT_CODE: dept_code || null,
      P_PRIORITY: priority || 'N',
      P_REMARKS: remarks || null,
      P_USER_ID: userId,
      P_OUT_STATUS: { dir: oracledb.BIND_OUT, type: oracledb.STRING },
      P_OUT_MSG: { dir: oracledb.BIND_OUT, type: oracledb.STRING }
    };

    const result: any = await conn.execute(
      `BEGIN PROC_TMS_REQUEST_SAVE(:P_COMPANY_CODE, :P_DOC_TYPE, :P_DOC_NO, :P_DOC_DATE, :P_REQUESTED_BY, :P_REQUESTED_DATE, :P_JOB_TYPE, :P_DEPT_CODE, :P_PRIORITY, :P_REMARKS, :P_USER_ID, :P_OUT_STATUS, :P_OUT_MSG); END;`,
      binds,
      { autoCommit: false }
    );

    const savedDocNo = result.outBinds.P_DOC_NO;

    // Save line items if provided
    if (Array.isArray(items) && items.length > 0) {
      await conn.execute(
        `DELETE FROM TP_REQUEST_DET WHERE COMPANY_CODE = :comp AND DOC_TYPE = :dtype AND DOC_NO = :dno`,
        { comp: companyCode, dtype: doc_type || 'TR', dno: savedDocNo }
      );

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        await conn.execute(
          `INSERT INTO TP_REQUEST_DET (
            COMPANY_CODE, DOC_TYPE, DOC_NO, SERIAL_NO,
            CUST_CODE, JOB_NO, START_POINT, END_POINT,
            TOTAL_VOLUME, TOTAL_TONNAGE, REMARKS, USER_ID, USER_DT
          ) VALUES (
            :comp, :dtype, :dno, :sno,
            :cust, :job, :spoint, :epoint,
            :vol, :ton, :rem, :usr_id, SYSDATE
          )`,
          {
            comp: companyCode,
            dtype: doc_type || 'TR',
            dno: savedDocNo,
            sno: i + 1,
            cust: item.cust_code || null,
            job: item.job_no || null,
            spoint: item.start_point || null,
            epoint: item.end_point || null,
            vol: Number(item.total_volume) || 0,
            ton: Number(item.total_tonnage) || 0,
            rem: item.remarks || null,
            usr_id: userId
          }
        );
      }
    }

    await conn.commit();

    res.status(constants.STATUS_CODES.OK).json({
      success: result.outBinds.P_OUT_STATUS === 'SUCCESS',
      message: result.outBinds.P_OUT_MSG,
      doc_no: savedDocNo
    });
  } catch (error: any) {
    if (conn) await conn.rollback();
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({ success: false, message: error.message });
  } finally {
    if (conn) await conn.close();
  }
};

export const deleteRequest = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn;
  try {
    conn = await getTenantConn();
    const companyCode = req.user?.company_code || 'BSG';
    const { doc_no } = req.params;
    const docType = (req.query.doc_type as string) || 'TR';

    const binds = {
      P_COMPANY_CODE: companyCode,
      P_DOC_TYPE: docType,
      P_DOC_NO: Number(doc_no),
      P_OUT_STATUS: { dir: oracledb.BIND_OUT, type: oracledb.STRING },
      P_OUT_MSG: { dir: oracledb.BIND_OUT, type: oracledb.STRING }
    };

    const result: any = await conn.execute(
      `BEGIN PROC_TMS_REQUEST_DELETE(:P_COMPANY_CODE, :P_DOC_TYPE, :P_DOC_NO, :P_OUT_STATUS, :P_OUT_MSG); END;`,
      binds,
      { autoCommit: true }
    );

    res.status(constants.STATUS_CODES.OK).json({
      success: result.outBinds.P_OUT_STATUS === 'SUCCESS',
      message: result.outBinds.P_OUT_MSG
    });
  } catch (error: any) {
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({ success: false, message: error.message });
  } finally {
    if (conn) await conn.close();
  }
};

// ======================== TRIP TICKETS ========================
export const getTripTickets = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn;
  try {
    conn = await getTenantConn();
    const companyCode = req.user?.company_code || 'BSG';
    const result = await conn.execute(
      `SELECT H.DOC_TYPE, H.DOC_NO, H.DOC_DATE, H.CLASSIFICATION,
              H.START_POINT, H.END_POINT, H.START_DATE, H.CONFIRM_DATE,
              H.START_METER_READING, H.END_METER_READING,
              (NVL(H.END_METER_READING, 0) - NVL(H.START_METER_READING, 0)) AS TOTAL_KM,
              H.EMP_ID, E.EMP_NAME AS DRIVER_NAME,
              H.VEHICLE_CODE, H.JOB_NO, H.CUST_CODE,
              H.BASE_AMOUNT, H.ADVANCE_AMOUNT, H.CONTAINER_NO,
              H.CONFIRMED, H.CANCELLED, H.REMARKS
       FROM TP_DOCUMENT_HDR H
       LEFT JOIN MS_HR_EMP E ON H.EMP_ID = E.EMP_ID AND H.COMPANY_CODE = E.COMPANY_CODE
       WHERE H.COMPANY_CODE = :comp
       ORDER BY H.DOC_NO DESC`,
      { comp: companyCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    res.status(constants.STATUS_CODES.OK).json({ success: true, data: result.rows });
  } catch (error: any) {
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({ success: false, message: error.message });
  } finally {
    if (conn) await conn.close();
  }
};

export const saveTripTicket = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn;
  try {
    conn = await getTenantConn();
    const companyCode = req.user?.company_code || 'BSG';
    const userId = req.user?.user_id || 'MHDL_BTS';
    const {
      doc_type, doc_no, doc_date, classification,
      start_point, end_point, start_date, start_meter_reading,
      emp_id, vehicle_code, prin_code, job_no, req_doc_no,
      cust_code, base_amount, advance_amount, container_no, remarks
    } = req.body;

    const binds = {
      P_COMPANY_CODE: companyCode,
      P_DOC_TYPE: doc_type || 'TT',
      P_DOC_NO: { dir: oracledb.BIND_INOUT, type: oracledb.NUMBER, val: doc_no ? Number(doc_no) : null },
      P_DOC_DATE: doc_date ? new Date(doc_date) : new Date(),
      P_CLASSIFICATION: classification || 'LOCAL',
      P_START_POINT: start_point || null,
      P_END_POINT: end_point || null,
      P_START_DATE: start_date ? new Date(start_date) : new Date(),
      P_START_METER_READING: Number(start_meter_reading) || 0,
      P_EMP_ID: emp_id || null,
      P_VEHICLE_CODE: vehicle_code || null,
      P_PRIN_CODE: prin_code || null,
      P_JOB_NO: job_no || null,
      P_REQ_DOC_NO: req_doc_no ? Number(req_doc_no) : null,
      P_CUST_CODE: cust_code || null,
      P_BASE_AMOUNT: Number(base_amount) || 0,
      P_ADVANCE_AMOUNT: Number(advance_amount) || 0,
      P_CONTAINER_NO: container_no || null,
      P_REMARKS: remarks || null,
      P_USER_ID: userId,
      P_OUT_STATUS: { dir: oracledb.BIND_OUT, type: oracledb.STRING },
      P_OUT_MSG: { dir: oracledb.BIND_OUT, type: oracledb.STRING }
    };

    const result: any = await conn.execute(
      `BEGIN PROC_TMS_TRIPTICKET_SAVE(:P_COMPANY_CODE, :P_DOC_TYPE, :P_DOC_NO, :P_DOC_DATE, :P_CLASSIFICATION, :P_START_POINT, :P_END_POINT, :P_START_DATE, :P_START_METER_READING, :P_EMP_ID, :P_VEHICLE_CODE, :P_PRIN_CODE, :P_JOB_NO, :P_REQ_DOC_NO, :P_CUST_CODE, :P_BASE_AMOUNT, :P_ADVANCE_AMOUNT, :P_CONTAINER_NO, :P_REMARKS, :P_USER_ID, :P_OUT_STATUS, :P_OUT_MSG); END;`,
      binds,
      { autoCommit: true }
    );

    res.status(constants.STATUS_CODES.OK).json({
      success: result.outBinds.P_OUT_STATUS === 'SUCCESS',
      message: result.outBinds.P_OUT_MSG,
      doc_no: result.outBinds.P_DOC_NO
    });
  } catch (error: any) {
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({ success: false, message: error.message });
  } finally {
    if (conn) await conn.close();
  }
};

export const confirmTripTicket = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn;
  try {
    conn = await getTenantConn();
    const companyCode = req.user?.company_code || 'BSG';
    const userId = req.user?.user_id || 'MHDL_BTS';
    const { doc_no } = req.params;
    const { end_meter_reading, confirm_date, confirm_remarks, doc_type } = req.body;

    const binds = {
      P_COMPANY_CODE: companyCode,
      P_DOC_TYPE: doc_type || 'TT',
      P_DOC_NO: Number(doc_no),
      P_END_METER_READING: Number(end_meter_reading) || 0,
      P_CONFIRM_DATE: confirm_date ? new Date(confirm_date) : new Date(),
      P_CONFIRM_REMARKS: confirm_remarks || 'Completed',
      P_USER_ID: userId,
      P_OUT_STATUS: { dir: oracledb.BIND_OUT, type: oracledb.STRING },
      P_OUT_MSG: { dir: oracledb.BIND_OUT, type: oracledb.STRING }
    };

    const result: any = await conn.execute(
      `BEGIN PROC_TMS_TRIPTICKET_CONFIRM(:P_COMPANY_CODE, :P_DOC_TYPE, :P_DOC_NO, :P_END_METER_READING, :P_CONFIRM_DATE, :P_CONFIRM_REMARKS, :P_USER_ID, :P_OUT_STATUS, :P_OUT_MSG); END;`,
      binds,
      { autoCommit: true }
    );

    res.status(constants.STATUS_CODES.OK).json({
      success: result.outBinds.P_OUT_STATUS === 'SUCCESS',
      message: result.outBinds.P_OUT_MSG
    });
  } catch (error: any) {
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({ success: false, message: error.message });
  } finally {
    if (conn) await conn.close();
  }
};

export const cancelTripTicket = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn;
  try {
    conn = await getTenantConn();
    const companyCode = req.user?.company_code || 'BSG';
    const userId = req.user?.user_id || 'MHDL_BTS';
    const { doc_no } = req.params;
    const { reason, doc_type } = req.body;

    const binds = {
      P_COMPANY_CODE: companyCode,
      P_DOC_TYPE: doc_type || 'TT',
      P_DOC_NO: Number(doc_no),
      P_REASON: reason || 'Cancelled by user',
      P_USER_ID: userId,
      P_OUT_STATUS: { dir: oracledb.BIND_OUT, type: oracledb.STRING },
      P_OUT_MSG: { dir: oracledb.BIND_OUT, type: oracledb.STRING }
    };

    const result: any = await conn.execute(
      `BEGIN PROC_TMS_TRIPTICKET_CANCEL(:P_COMPANY_CODE, :P_DOC_TYPE, :P_DOC_NO, :P_REASON, :P_USER_ID, :P_OUT_STATUS, :P_OUT_MSG); END;`,
      binds,
      { autoCommit: true }
    );

    res.status(constants.STATUS_CODES.OK).json({
      success: result.outBinds.P_OUT_STATUS === 'SUCCESS',
      message: result.outBinds.P_OUT_MSG
    });
  } catch (error: any) {
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({ success: false, message: error.message });
  } finally {
    if (conn) await conn.close();
  }
};

// ======================== FUEL FILLING ========================
export const getFuelFilling = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn;
  try {
    conn = await getTenantConn();
    const companyCode = req.user?.company_code || 'BSG';
    const result = await conn.execute(
      `SELECT F.DOC_NO, F.DOC_DATE, F.VEHICLE_CODE, F.EMP_ID, E.EMP_NAME AS DRIVER_NAME,
              F.METER_READING, F.FUEL_TYPE, F.QTY_GALLON, F.UNIT_PRICE, F.AMOUNT,
              F.STATION_NAME, F.LOCATION, F.PAYMENT_MODE, F.FUEL_CARD_NO
       FROM TP_VEHICLE_FUELFILLING F
       LEFT JOIN MS_HR_EMP E ON F.EMP_ID = E.EMP_ID AND F.COMPANY_CODE = E.COMPANY_CODE
       WHERE F.COMPANY_CODE = :comp
       ORDER BY F.DOC_DATE DESC, F.DOC_NO DESC`,
      { comp: companyCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    res.status(constants.STATUS_CODES.OK).json({ success: true, data: result.rows });
  } catch (error: any) {
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({ success: false, message: error.message });
  } finally {
    if (conn) await conn.close();
  }
};

export const saveFuelFilling = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn;
  try {
    conn = await getTenantConn();
    const companyCode = req.user?.company_code || 'BSG';
    const userId = req.user?.user_id || 'MHDL_BTS';
    const {
      doc_no, doc_date, vehicle_code, emp_id,
      meter_reading, fuel_type, qty_gallon, unit_price,
      amount, station_name, location, payment_mode, fuel_card_no
    } = req.body;

    const binds = {
      P_COMPANY_CODE: companyCode,
      P_DOC_NO: { dir: oracledb.BIND_INOUT, type: oracledb.STRING, val: doc_no || null },
      P_DOC_DATE: doc_date ? new Date(doc_date) : new Date(),
      P_VEHICLE_CODE: vehicle_code || null,
      P_EMP_ID: emp_id || null,
      P_METER_READING: Number(meter_reading) || 0,
      P_FUEL_TYPE: fuel_type || 'DIESEL',
      P_QTY_GALLON: Number(qty_gallon) || 0,
      P_UNIT_PRICE: Number(unit_price) || 0,
      P_AMOUNT: Number(amount) || 0,
      P_STATION_NAME: station_name || null,
      P_LOCATION: location || null,
      P_PAYMENT_MODE: payment_mode || 'CASH',
      P_FUEL_CARD_NO: fuel_card_no || null,
      P_USER_ID: userId,
      P_OUT_STATUS: { dir: oracledb.BIND_OUT, type: oracledb.STRING },
      P_OUT_MSG: { dir: oracledb.BIND_OUT, type: oracledb.STRING }
    };

    const result: any = await conn.execute(
      `BEGIN PROC_TMS_FUELFILLING_SAVE(:P_COMPANY_CODE, :P_DOC_NO, :P_DOC_DATE, :P_VEHICLE_CODE, :P_EMP_ID, :P_METER_READING, :P_FUEL_TYPE, :P_QTY_GALLON, :P_UNIT_PRICE, :P_AMOUNT, :P_STATION_NAME, :P_LOCATION, :P_PAYMENT_MODE, :P_FUEL_CARD_NO, :P_USER_ID, :P_OUT_STATUS, :P_OUT_MSG); END;`,
      binds,
      { autoCommit: true }
    );

    res.status(constants.STATUS_CODES.OK).json({
      success: result.outBinds.P_OUT_STATUS === 'SUCCESS',
      message: result.outBinds.P_OUT_MSG,
      doc_no: result.outBinds.P_DOC_NO
    });
  } catch (error: any) {
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({ success: false, message: error.message });
  } finally {
    if (conn) await conn.close();
  }
};

export const deleteFuelFilling = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn;
  try {
    conn = await getTenantConn();
    const companyCode = req.user?.company_code || 'BSG';
    const { doc_no } = req.params;

    const binds = {
      P_COMPANY_CODE: companyCode,
      P_DOC_NO: doc_no,
      P_OUT_STATUS: { dir: oracledb.BIND_OUT, type: oracledb.STRING },
      P_OUT_MSG: { dir: oracledb.BIND_OUT, type: oracledb.STRING }
    };

    const result: any = await conn.execute(
      `BEGIN PROC_TMS_FUELFILLING_DELETE(:P_COMPANY_CODE, :P_DOC_NO, :P_OUT_STATUS, :P_OUT_MSG); END;`,
      binds,
      { autoCommit: true }
    );

    res.status(constants.STATUS_CODES.OK).json({
      success: result.outBinds.P_OUT_STATUS === 'SUCCESS',
      message: result.outBinds.P_OUT_MSG
    });
  } catch (error: any) {
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({ success: false, message: error.message });
  } finally {
    if (conn) await conn.close();
  }
};

// ======================== MAINTENANCE ========================
export const getMaintenance = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn;
  try {
    conn = await getTenantConn();
    const companyCode = req.user?.company_code || 'BSG';
    const result = await conn.execute(
      `SELECT M.DOC_TYPE, M.DOC_NO, M.DOC_DATE, M.SERVICE_STATION_NAME,
              M.VEHICLE_CODE, M.CONTACT_PERSON, M.PAYMENT_MODE,
              M.SERVICE_TYPE, M.EMP_ID, E.EMP_NAME AS DRIVER_NAME,
              M.START_METER_READING, M.END_METER_READING, M.REMARKS
       FROM TP_VH_MAINTENANCE_HDR M
       LEFT JOIN MS_HR_EMP E ON M.EMP_ID = E.EMP_ID AND M.COMPANY_CODE = E.COMPANY_CODE
       WHERE M.COMPANY_CODE = :comp
       ORDER BY M.DOC_DATE DESC, M.DOC_NO DESC`,
      { comp: companyCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    res.status(constants.STATUS_CODES.OK).json({ success: true, data: result.rows });
  } catch (error: any) {
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({ success: false, message: error.message });
  } finally {
    if (conn) await conn.close();
  }
};

export const saveMaintenance = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn;
  try {
    conn = await getTenantConn();
    const companyCode = req.user?.company_code || 'BSG';
    const userId = req.user?.user_id || 'MHDL_BTS';
    const {
      doc_type, doc_no, doc_date, service_station_name,
      vehicle_code, contact_person, payment_mode, service_type,
      emp_id, start_meter_reading, end_meter_reading, remarks
    } = req.body;

    const binds = {
      P_COMPANY_CODE: companyCode,
      P_DOC_TYPE: doc_type || 'MT',
      P_DOC_NO: { dir: oracledb.BIND_INOUT, type: oracledb.STRING, val: doc_no || null },
      P_DOC_DATE: doc_date ? new Date(doc_date) : new Date(),
      P_SERVICE_STATION_NAME: service_station_name || null,
      P_VEHICLE_CODE: vehicle_code || null,
      P_CONTACT_PERSON: contact_person || null,
      P_PAYMENT_MODE: payment_mode || 'CASH',
      P_SERVICE_TYPE: service_type || 'PERIODIC',
      P_EMP_ID: emp_id || null,
      P_START_METER_READING: Number(start_meter_reading) || 0,
      P_END_METER_READING: Number(end_meter_reading) || 0,
      P_REMARKS: remarks || null,
      P_USER_ID: userId,
      P_OUT_STATUS: { dir: oracledb.BIND_OUT, type: oracledb.STRING },
      P_OUT_MSG: { dir: oracledb.BIND_OUT, type: oracledb.STRING }
    };

    const result: any = await conn.execute(
      `BEGIN PROC_TMS_MAINTENANCE_SAVE(:P_COMPANY_CODE, :P_DOC_TYPE, :P_DOC_NO, :P_DOC_DATE, :P_SERVICE_STATION_NAME, :P_VEHICLE_CODE, :P_CONTACT_PERSON, :P_PAYMENT_MODE, :P_SERVICE_TYPE, :P_EMP_ID, :P_START_METER_READING, :P_END_METER_READING, :P_REMARKS, :P_USER_ID, :P_OUT_STATUS, :P_OUT_MSG); END;`,
      binds,
      { autoCommit: true }
    );

    res.status(constants.STATUS_CODES.OK).json({
      success: result.outBinds.P_OUT_STATUS === 'SUCCESS',
      message: result.outBinds.P_OUT_MSG,
      doc_no: result.outBinds.P_DOC_NO
    });
  } catch (error: any) {
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({ success: false, message: error.message });
  } finally {
    if (conn) await conn.close();
  }
};

export const deleteMaintenance = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn;
  try {
    conn = await getTenantConn();
    const companyCode = req.user?.company_code || 'BSG';
    const { doc_no } = req.params;

    const binds = {
      P_COMPANY_CODE: companyCode,
      P_DOC_NO: doc_no,
      P_OUT_STATUS: { dir: oracledb.BIND_OUT, type: oracledb.STRING },
      P_OUT_MSG: { dir: oracledb.BIND_OUT, type: oracledb.STRING }
    };

    const result: any = await conn.execute(
      `BEGIN PROC_TMS_MAINTENANCE_DELETE(:P_COMPANY_CODE, :P_DOC_NO, :P_OUT_STATUS, :P_OUT_MSG); END;`,
      binds,
      { autoCommit: true }
    );

    res.status(constants.STATUS_CODES.OK).json({
      success: result.outBinds.P_OUT_STATUS === 'SUCCESS',
      message: result.outBinds.P_OUT_MSG
    });
  } catch (error: any) {
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({ success: false, message: error.message });
  } finally {
    if (conn) await conn.close();
  }
};

// ======================== ACCIDENTS & FINES ========================
export const getAccidentsFines = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn;
  try {
    conn = await getTenantConn();
    const companyCode = req.user?.company_code || 'BSG';
    const result = await conn.execute(
      `SELECT A.DOC_TYPE, A.DOC_NO, A.DOC_DATE, A.VEHICLE_CODE, A.EMP_ID,
              E.EMP_NAME AS DRIVER_NAME, A.CLASSIFICATION, A.FINE_CODE,
              A.AMOUNT, A.LOCATION, A.ACCIDENT_STATUS, A.ACCIDENT_DATE,
              A.POLICE_REP_NO, A.INSURANCE_CLAIM_NO, A.REMARKS
       FROM TP_ACCIDENTS_FINE A
       LEFT JOIN MS_HR_EMP E ON A.EMP_ID = E.EMP_ID AND A.COMPANY_CODE = E.COMPANY_CODE
       WHERE A.COMPANY_CODE = :comp
       ORDER BY A.DOC_DATE DESC, A.DOC_NO DESC`,
      { comp: companyCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    res.status(constants.STATUS_CODES.OK).json({ success: true, data: result.rows });
  } catch (error: any) {
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({ success: false, message: error.message });
  } finally {
    if (conn) await conn.close();
  }
};

export const saveAccidentFine = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn;
  try {
    conn = await getTenantConn();
    const companyCode = req.user?.company_code || 'BSG';
    const userId = req.user?.user_id || 'MHDL_BTS';
    const {
      doc_type, doc_no, doc_date, vehicle_code, emp_id,
      classification, fine_code, amount, location,
      accident_status, accident_date, police_rep_no,
      insurance_claim_no, remarks
    } = req.body;

    const binds = {
      P_COMPANY_CODE: companyCode,
      P_DOC_TYPE: doc_type || 'AF',
      P_DOC_NO: { dir: oracledb.BIND_INOUT, type: oracledb.STRING, val: doc_no || null },
      P_DOC_DATE: doc_date ? new Date(doc_date) : new Date(),
      P_VEHICLE_CODE: vehicle_code || null,
      P_EMP_ID: emp_id || null,
      P_CLASSIFICATION: classification || 'FINE',
      P_FINE_CODE: fine_code || null,
      P_AMOUNT: Number(amount) || 0,
      P_LOCATION: location || null,
      P_ACCIDENT_STATUS: accident_status || 'PENDING',
      P_ACCIDENT_DATE: accident_date ? new Date(accident_date) : new Date(),
      P_POLICE_REP_NO: police_rep_no || null,
      P_INSURANCE_CLAIM_NO: insurance_claim_no || null,
      P_REMARKS: remarks || null,
      P_USER_ID: userId,
      P_OUT_STATUS: { dir: oracledb.BIND_OUT, type: oracledb.STRING },
      P_OUT_MSG: { dir: oracledb.BIND_OUT, type: oracledb.STRING }
    };

    const result: any = await conn.execute(
      `BEGIN PROC_TMS_ACCIDENTS_FINE_SAVE(:P_COMPANY_CODE, :P_DOC_TYPE, :P_DOC_NO, :P_DOC_DATE, :P_VEHICLE_CODE, :P_EMP_ID, :P_CLASSIFICATION, :P_FINE_CODE, :P_AMOUNT, :P_LOCATION, :P_ACCIDENT_STATUS, :P_ACCIDENT_DATE, :P_POLICE_REP_NO, :P_INSURANCE_CLAIM_NO, :P_REMARKS, :P_USER_ID, :P_OUT_STATUS, :P_OUT_MSG); END;`,
      binds,
      { autoCommit: true }
    );

    res.status(constants.STATUS_CODES.OK).json({
      success: result.outBinds.P_OUT_STATUS === 'SUCCESS',
      message: result.outBinds.P_OUT_MSG,
      doc_no: result.outBinds.P_DOC_NO
    });
  } catch (error: any) {
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({ success: false, message: error.message });
  } finally {
    if (conn) await conn.close();
  }
};

export const deleteAccidentFine = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn;
  try {
    conn = await getTenantConn();
    const companyCode = req.user?.company_code || 'BSG';
    const { doc_no } = req.params;

    const binds = {
      P_COMPANY_CODE: companyCode,
      P_DOC_NO: doc_no,
      P_OUT_STATUS: { dir: oracledb.BIND_OUT, type: oracledb.STRING },
      P_OUT_MSG: { dir: oracledb.BIND_OUT, type: oracledb.STRING }
    };

    const result: any = await conn.execute(
      `BEGIN PROC_TMS_ACCIDENTS_FINE_DELETE(:P_COMPANY_CODE, :P_DOC_NO, :P_OUT_STATUS, :P_OUT_MSG); END;`,
      binds,
      { autoCommit: true }
    );

    res.status(constants.STATUS_CODES.OK).json({
      success: result.outBinds.P_OUT_STATUS === 'SUCCESS',
      message: result.outBinds.P_OUT_MSG
    });
  } catch (error: any) {
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({ success: false, message: error.message });
  } finally {
    if (conn) await conn.close();
  }
};

// ======================== DASHBOARD & REPORTS ========================
export const getTMSDashboardStats = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn;
  try {
    conn = await getTenantConn();
    const companyCode = req.user?.company_code || 'BSG';

    const [vCount, dCount, tCount, fSum] = await Promise.all([
      conn.execute(`SELECT COUNT(*) FROM MS_VEHICLE WHERE COMPANY_CODE = :comp`, { comp: companyCode }),
      conn.execute(`SELECT COUNT(*) FROM MS_HR_EMP WHERE COMPANY_CODE = :comp AND (CATEGORY_CODE = 'DRIVER' OR EMP_ID LIKE 'DRV%')`, { comp: companyCode }),
      conn.execute(`SELECT COUNT(*), SUM(CASE WHEN CONFIRMED = 'Y' THEN 1 ELSE 0 END), SUM(CASE WHEN NVL(CONFIRMED, 'N') <> 'Y' AND NVL(CANCELLED, 'N') <> 'Y' THEN 1 ELSE 0 END) FROM TP_DOCUMENT_HDR WHERE COMPANY_CODE = :comp`, { comp: companyCode }),
      conn.execute(`SELECT NVL(SUM(AMOUNT), 0), NVL(SUM(QTY_GALLON), 0) FROM TP_VEHICLE_FUELFILLING WHERE COMPANY_CODE = :comp`, { comp: companyCode })
    ]);

    const activeTripsRes = await conn.execute(
      `SELECT DOC_NO, DOC_DATE, VEHICLE_CODE, EMP_ID, START_POINT, END_POINT, START_DATE, BASE_AMOUNT
       FROM TP_DOCUMENT_HDR
       WHERE COMPANY_CODE = :comp AND NVL(CONFIRMED, 'N') <> 'Y' AND NVL(CANCELLED, 'N') <> 'Y'
       ORDER BY DOC_NO DESC
       FETCH FIRST 5 ROWS ONLY`,
      { comp: companyCode },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    res.status(constants.STATUS_CODES.OK).json({
      success: true,
      data: {
        totalVehicles: vCount.rows ? (vCount.rows[0] as any)[0] : 0,
        totalDrivers: dCount.rows ? (dCount.rows[0] as any)[0] : 0,
        totalTrips: tCount.rows ? (tCount.rows[0] as any)[0] : 0,
        completedTrips: tCount.rows ? (tCount.rows[0] as any)[1] || 0 : 0,
        activeTrips: tCount.rows ? (tCount.rows[0] as any)[2] || 0 : 0,
        totalFuelCost: fSum.rows ? (fSum.rows[0] as any)[0] : 0,
        totalFuelQty: fSum.rows ? (fSum.rows[0] as any)[1] : 0,
        recentActiveTrips: activeTripsRes.rows
      }
    });
  } catch (error: any) {
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({ success: false, message: error.message });
  } finally {
    if (conn) await conn.close();
  }
};

export const getTMSReport = async (req: RequestWithUser, res: Response): Promise<void> => {
  let conn;
  try {
    conn = await getTenantConn();
    const companyCode = req.user?.company_code || 'BSG';
    const { reportType } = req.params;
    const fromDate = req.query.fromDate as string;
    const toDate = req.query.toDate as string;

    let sql = '';
    const binds: any = { comp: companyCode };

    switch (reportType) {
      case 'trip-register':
        sql = `SELECT H.DOC_NO, H.DOC_DATE, H.CLASSIFICATION, H.START_POINT, H.END_POINT,
                      H.START_DATE, H.CONFIRM_DATE, H.START_METER_READING, H.END_METER_READING,
                      (NVL(H.END_METER_READING,0) - NVL(H.START_METER_READING,0)) AS TOTAL_KM,
                      H.VEHICLE_CODE, H.EMP_ID, E.EMP_NAME AS DRIVER_NAME,
                      H.BASE_AMOUNT, H.ADVANCE_AMOUNT, H.CONFIRMED, H.CANCELLED
               FROM TP_DOCUMENT_HDR H
               LEFT JOIN MS_HR_EMP E ON H.EMP_ID = E.EMP_ID AND H.COMPANY_CODE = E.COMPANY_CODE
               WHERE H.COMPANY_CODE = :comp
               ORDER BY H.DOC_NO DESC`;
        break;

      case 'daily-activity':
        sql = `SELECT H.DOC_DATE, COUNT(H.DOC_NO) AS TRIP_COUNT,
                      SUM(NVL(H.END_METER_READING,0) - NVL(H.START_METER_READING,0)) AS TOTAL_KM,
                      SUM(NVL(H.BASE_AMOUNT,0)) AS TOTAL_REVENUE,
                      SUM(NVL(H.ADVANCE_AMOUNT,0)) AS TOTAL_ADVANCE
               FROM TP_DOCUMENT_HDR H
               WHERE H.COMPANY_CODE = :comp
               GROUP BY H.DOC_DATE
               ORDER BY H.DOC_DATE DESC`;
        break;

      case 'driver-efficiency':
        sql = `SELECT E.EMP_ID, E.EMP_NAME, COUNT(H.DOC_NO) AS TOTAL_TRIPS,
                      SUM(NVL(H.END_METER_READING,0) - NVL(H.START_METER_READING,0)) AS TOTAL_KM,
                      SUM(NVL(H.BASE_AMOUNT,0)) AS TOTAL_EARNINGS
               FROM MS_HR_EMP E
               LEFT JOIN TP_DOCUMENT_HDR H ON E.EMP_ID = H.EMP_ID AND E.COMPANY_CODE = H.COMPANY_CODE
               WHERE E.COMPANY_CODE = :comp AND (E.CATEGORY_CODE = 'DRIVER' OR E.EMP_ID LIKE 'DRV%')
               GROUP BY E.EMP_ID, E.EMP_NAME
               ORDER BY TOTAL_KM DESC`;
        break;

      case 'vehicle-efficiency':
        sql = `SELECT V.VEHICLE_NO, V.VEHICLE_REGNO, V.VEHICLE_TYPE,
                      COUNT(H.DOC_NO) AS TOTAL_TRIPS,
                      SUM(NVL(H.END_METER_READING,0) - NVL(H.START_METER_READING,0)) AS TOTAL_KM,
                      NVL(SUM(F.AMOUNT),0) AS TOTAL_FUEL_COST,
                      NVL(SUM(F.QTY_GALLON),0) AS TOTAL_FUEL_QTY
               FROM MS_VEHICLE V
               LEFT JOIN TP_DOCUMENT_HDR H ON V.VEHICLE_NO = H.VEHICLE_CODE AND V.COMPANY_CODE = H.COMPANY_CODE
               LEFT JOIN TP_VEHICLE_FUELFILLING F ON V.VEHICLE_NO = F.VEHICLE_CODE AND V.COMPANY_CODE = F.COMPANY_CODE
               WHERE V.COMPANY_CODE = :comp
               GROUP BY V.VEHICLE_NO, V.VEHICLE_REGNO, V.VEHICLE_TYPE
               ORDER BY TOTAL_KM DESC`;
        break;

      case 'fuel-analysis':
        sql = `SELECT F.VEHICLE_CODE, F.FUEL_TYPE, COUNT(F.DOC_NO) AS FILLING_COUNT,
                      SUM(F.QTY_GALLON) AS TOTAL_GALLONS,
                      AVG(F.UNIT_PRICE) AS AVG_PRICE,
                      SUM(F.AMOUNT) AS TOTAL_AMOUNT
               FROM TP_VEHICLE_FUELFILLING F
               WHERE F.COMPANY_CODE = :comp
               GROUP BY F.VEHICLE_CODE, F.FUEL_TYPE
               ORDER BY TOTAL_AMOUNT DESC`;
        break;

      default:
        res.status(constants.STATUS_CODES.BAD_REQUEST).json({ success: false, message: 'Invalid report type' });
        return;
    }

    const result = await conn.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    res.status(constants.STATUS_CODES.OK).json({ success: true, data: result.rows });
  } catch (error: any) {
    res.status(constants.STATUS_CODES.INTERNAL_SERVER_ERROR).json({ success: false, message: error.message });
  } finally {
    if (conn) await conn.close();
  }
};
