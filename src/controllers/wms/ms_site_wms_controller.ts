import oracledb from "oracledb";
import { RequestHandler, Response } from "express";

const getValue = (obj: any, key: string) =>
  obj?.[key] ?? obj?.[key.toLowerCase()] ?? obj?.[key.toUpperCase()] ?? null;

const clip = (val: any, max: number): string | null => {
  if (val === null || val === undefined) return null;
  const str = String(val).trim();
  if (str.length === 0) return null;
  return str.length > max ? str.slice(0, max) : str;
};

const MAX_LEN = {
  SITE_CODE: 5,
  SITE_IND: 10,
  SITE_TYPE: 5,
  SITE_NAME: 50,
  CHARGE_IND: 2,
  LOC_TYPE: 3,
  COMPANY_CODE: 5,
  USER_ID: 10,
  PRIN_CODE: 5,
  GROUP_CODE: 5,
  SITE_ADDR1: 40,
  SITE_ADDR2: 40,
  SITE_ADDR3: 40,
  SITE_ADDR4: 40,
  CITY: 40,
  COUNTRY_CODE: 5,
  CONTACT_NAME: 50,
  TEL_NO: 40,
  SITE_CLASS: 2,
  STATUS: 1,
  WH_CODE: 2,
  PICKING_OUT: 1,
  SITE_VOLUME: 30,
  INC_STORAGE: 1,
  DIV_CODE: 5,
  SITE_RPT_NAME: 20,
  USABLE_LOC: 20
} as const;

export const updateSiteMaster: RequestHandler = async (req, res: Response) => {
  let connection;

  try {
    console.log("UPDATE SITE MASTER API HIT");
    console.log("Incoming body:", req.body);

    let rows: any[];

    if (Array.isArray(req.body)) {
      rows = req.body;
    } else if (Array.isArray(req.body?.rows)) {
      rows = req.body.rows;
    } else if (req.body && typeof req.body === "object") {
      rows = [req.body];
    } else {
      rows = [];
    }

    if (rows.length === 0) {
      res.status(400).json({ error: "No site rows provided" });
      return;
    }

    // Required-field guard before touching the DB
    const missingRequired = rows
      .map((s, idx) => ({ idx, s }))
      .filter(({ s }) =>
        !getValue(s, "SITE_CODE") ||
        !getValue(s, "SITE_IND") ||
        !getValue(s, "SITE_NAME") ||
        !getValue(s, "COMPANY_CODE")
      );

    if (missingRequired.length > 0) {
      res.status(400).json({
        error: "Missing required fields",
        details: missingRequired.map(({ idx }) => `Row ${idx}: SITE_CODE, SITE_IND, SITE_NAME, and COMPANY_CODE are required`)
      });
      return;
    }

    connection = await oracledb.getConnection();

    for (const s of rows) {
      await connection.execute(
        `BEGIN
           PROC_UPDATE_SITE_MASTER(
             :p_site_code, :p_site_ind, :p_site_type, :p_site_name,
             :p_charge_ind, :p_loc_type, :p_company_code, :p_user_id,
             :p_prin_code, :p_group_code, :p_site_addr1, :p_site_addr2,
             :p_site_addr3, :p_site_addr4, :p_city, :p_country_code,
             :p_contact_name, :p_tel_no, :p_site_class, :p_status,
             :p_wh_code, :p_picking_out, :p_site_volume, :p_inc_storage,
             :p_div_code, :p_site_rpt_name, :p_usable_loc
           );
         END;`,
        {
          p_site_code: clip(getValue(s, "SITE_CODE"), MAX_LEN.SITE_CODE),
          p_site_ind: clip(getValue(s, "SITE_IND"), MAX_LEN.SITE_IND),
          p_site_type: clip(getValue(s, "SITE_TYPE"), MAX_LEN.SITE_TYPE),
          p_site_name: clip(getValue(s, "SITE_NAME"), MAX_LEN.SITE_NAME),
          p_charge_ind: clip(getValue(s, "CHARGE_IND"), MAX_LEN.CHARGE_IND),
          p_loc_type: clip(getValue(s, "LOC_TYPE"), MAX_LEN.LOC_TYPE),
          p_company_code: clip(getValue(s, "COMPANY_CODE"), MAX_LEN.COMPANY_CODE),
          p_user_id: clip(getValue(s, "USER_ID"), MAX_LEN.USER_ID),
          p_prin_code: clip(getValue(s, "PRIN_CODE"), MAX_LEN.PRIN_CODE),
          p_group_code: clip(getValue(s, "GROUP_CODE"), MAX_LEN.GROUP_CODE),
          p_site_addr1: clip(getValue(s, "SITE_ADDR1"), MAX_LEN.SITE_ADDR1),
          p_site_addr2: clip(getValue(s, "SITE_ADDR2"), MAX_LEN.SITE_ADDR2),
          p_site_addr3: clip(getValue(s, "SITE_ADDR3"), MAX_LEN.SITE_ADDR3),
          p_site_addr4: clip(getValue(s, "SITE_ADDR4"), MAX_LEN.SITE_ADDR4),
          p_city: clip(getValue(s, "CITY"), MAX_LEN.CITY),
          p_country_code: clip(getValue(s, "COUNTRY_CODE"), MAX_LEN.COUNTRY_CODE),
          p_contact_name: clip(getValue(s, "CONTACT_NAME"), MAX_LEN.CONTACT_NAME),
          p_tel_no: clip(getValue(s, "TEL_NO"), MAX_LEN.TEL_NO),
          p_site_class: clip(getValue(s, "SITE_CLASS"), MAX_LEN.SITE_CLASS),
          p_status: clip(getValue(s, "STATUS"), MAX_LEN.STATUS),
          p_wh_code: clip(getValue(s, "WH_CODE"), MAX_LEN.WH_CODE),
          p_picking_out: clip(getValue(s, "PICKING_OUT"), MAX_LEN.PICKING_OUT),
          p_site_volume: clip(getValue(s, "SITE_VOLUME"), MAX_LEN.SITE_VOLUME),
          p_inc_storage: clip(getValue(s, "INC_STORAGE"), MAX_LEN.INC_STORAGE),
          p_div_code: clip(getValue(s, "DIV_CODE"), MAX_LEN.DIV_CODE),
          p_site_rpt_name: clip(getValue(s, "SITE_RPT_NAME"), MAX_LEN.SITE_RPT_NAME),
          p_usable_loc: clip(getValue(s, "USABLE_LOC"), MAX_LEN.USABLE_LOC)
        },
        { autoCommit: false } // commit once after the whole loop succeeds
      );
    }

    await connection.commit();

    res.json({ success: true, message: "Site master updated successfully" });

  } catch (err) {
    console.error("updateSiteMaster error:", err);
    if (connection) {
      try { await connection.rollback(); } catch (rbErr) { console.error("rollback error:", rbErr); }
    }
    res.status(500).json({
      success: false,
      error: "Site master update failed",
      details: err instanceof Error ? err.message : "Unknown error"
    });
  } finally {
    if (connection) await connection.close();
  }
};