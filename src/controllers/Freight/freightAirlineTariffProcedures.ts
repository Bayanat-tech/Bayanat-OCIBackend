import { Request, Response } from "express";
import oracledb from "oracledb";
import TenantManager from "../../../src/database/TenantManager";
import { getCurrentTenantId } from "../../../src/middleware/tenantContext.middleware";

type Connection = oracledb.Connection;

export const frtAirlineTariffList = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const result = await connection.execute(
      `BEGIN
         PROC_FRT_AIRLINE_TARIFF_LIST(
           :p_company_code,
           :p_search,
           :p_result
         );
       END;`,
      {
        p_company_code: req.body.company_code ?? req.body.COMPANY_CODE,
        p_search: req.body.search ?? req.body.SEARCH ?? null,
        p_result: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const rows = await rowsFromCursor((result.outBinds as any).p_result);
    res.json({ success: true, data: rows, totalCount: rows.length });
  });
};

export const frtAirlineTariffGet = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const result = await connection.execute(
      `BEGIN
         PROC_FRT_AIRLINE_TARIFF_GET(
           :p_company_code,
           :p_air_tariff_no,
           :p_result
         );
       END;`,
      {
        p_company_code: req.body.company_code ?? req.body.COMPANY_CODE,
        p_air_tariff_no: req.body.air_tariff_no ?? req.body.AIR_TARIFF_NO,
        p_result: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const rows = await rowsFromCursor((result.outBinds as any).p_result);
    res.json({ success: true, data: rows[0] ?? null });
  });
};

export const frtAirlineTariffSave = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const tariff = req.body.tariff ?? req.body;
    const result = await connection.execute(
      `BEGIN
         PROC_FRT_AIRLINE_TARIFF_SAVE(
           :p_company_code,
           :p_air_tariff_no,
           :p_airline_code,
           :p_airline_name,
           :p_source,
           :p_destination,
           :p_iata_code,
           :p_curr_code,
           :p_minimum,
           :p_normal,
           :p_k_45,
           :p_k_100,
           :p_k_250,
           :p_k_300,
           :p_k_500,
           :p_k_1000,
           :p_hard_freight,
           :p_perishable,
           :p_direct_via,
           :p_restriction,
           :p_restriction_det,
           :p_user_id,
           :p_air_tariff_no_out
         );
       END;`,
      {
        p_company_code: value(tariff.company_code ?? tariff.COMPANY_CODE),
        p_air_tariff_no: value(tariff.air_tariff_no ?? tariff.AIR_TARIFF_NO),
        p_airline_code: value(tariff.airline_code ?? tariff.AIRLINE_CODE),
        p_airline_name: value(tariff.airline_name ?? tariff.AIRLINE_NAME),
        p_source: value(tariff.source ?? tariff.SOURCE),
        p_destination: value(tariff.destination ?? tariff.DESTINATION),
        p_iata_code: value(tariff.iata_code ?? tariff.IATA_CODE),
        p_curr_code: value(tariff.curr_code ?? tariff.CURR_CODE),
        p_minimum: numberValue(tariff.minimum ?? tariff.MINIMUM),
        p_normal: numberValue(tariff.normal ?? tariff.NORMAL),
        p_k_45: numberValue(tariff.k_45 ?? tariff.K_45),
        p_k_100: numberValue(tariff.k_100 ?? tariff.K_100),
        p_k_250: numberValue(tariff.k_250 ?? tariff.K_250),
        p_k_300: numberValue(tariff.k_300 ?? tariff.K_300),
        p_k_500: numberValue(tariff.k_500 ?? tariff.K_500),
        p_k_1000: numberValue(tariff.k_1000 ?? tariff.K_1000),
        p_hard_freight: value(tariff.hard_freight ?? tariff.HARD_FREIGHT),
        p_perishable: value(tariff.perishable ?? tariff.PERISHABLE),
        p_direct_via: value(tariff.direct_via ?? tariff.DIRECT_VIA),
        p_restriction: value(tariff.restriction ?? tariff.RESTRICTION),
        p_restriction_det: value(tariff.restriction_det ?? tariff.RESTRICTION_DET),
        p_user_id: value(tariff.user_id ?? tariff.USER_ID ?? req.body.user_id ?? req.body.USER_ID),
        p_air_tariff_no_out: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
      },
      { autoCommit: true }
    );

    res.json({
      success: true,
      message: "Airline tariff saved successfully",
      data: { air_tariff_no: (result.outBinds as any).p_air_tariff_no_out },
    });
  });
};

export const frtAirlineTariffDelete = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    await connection.execute(
      `BEGIN
         PROC_FRT_AIRLINE_TARIFF_DELETE(
           :p_company_code,
           :p_air_tariff_no
         );
       END;`,
      {
        p_company_code: req.body.company_code ?? req.body.COMPANY_CODE,
        p_air_tariff_no: req.body.air_tariff_no ?? req.body.AIR_TARIFF_NO,
      },
      { autoCommit: true }
    );

    res.json({ success: true, message: "Airline tariff deleted successfully" });
  });
};

export const frtAirlineTariffReport = async (req: Request, res: Response): Promise<void> => {
  await withConnection(res, async (connection) => {
    const result = await connection.execute(
      `BEGIN
         PROC_FRT_AIRLINE_TARIFF_REPORT(
           :p_company_code,
           :p_airline_code,
           :p_source,
           :p_destination,
           :p_iata_code,
           :p_result
         );
       END;`,
      {
        p_company_code: req.body.company_code ?? req.body.COMPANY_CODE,
        p_airline_code: allToNull(req.body.airline_code ?? req.body.AIRLINE_CODE),
        p_source: allToNull(req.body.source ?? req.body.SOURCE),
        p_destination: allToNull(req.body.destination ?? req.body.DESTINATION),
        p_iata_code: allToNull(req.body.iata_code ?? req.body.IATA_CODE),
        p_result: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const rows = await rowsFromCursor((result.outBinds as any).p_result);
    res.json({ success: true, data: rows, totalCount: rows.length });
  });
};

async function withConnection(res: Response, handler: (connection: Connection) => Promise<void>) {
  let connection: Connection | undefined;
  try {
    const tenantId = getCurrentTenantId();
    if (!tenantId) {
      res.status(400).json({ success: false, message: "Tenant not found" });
      return;
    }

    connection = await TenantManager.getConnection(tenantId);
    await handler(connection);
  } catch (error: any) {
    console.error("Freight airline tariff procedure error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to execute Freight airline tariff procedure",
      details: error?.message || "Unknown error",
    });
  } finally {
    if (connection) await connection.close();
  }
}

async function rowsFromCursor(cursor: any) {
  if (!cursor) return [];
  try {
    return await cursor.getRows(10000);
  } finally {
    await cursor.close();
  }
}

function value(input: unknown) {
  if (input === undefined || input === null) return null;
  const text = String(input).trim();
  return text ? text : null;
}

function numberValue(input: unknown) {
  const text = value(input);
  if (text === null) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function allToNull(input: unknown) {
  const text = value(input);
  if (!text || text.toLowerCase() === "all") return null;
  return text;
}
