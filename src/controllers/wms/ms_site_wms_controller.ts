import oracledb from "oracledb";
import { Request, Response } from "express";

const getValue = (obj: any, key: string) =>
  obj[key] ?? obj[key.toLowerCase()] ?? obj[key.toUpperCase()] ?? null;

export async function updateSiteMaster(req: Request, res: Response) {
  let connection;

  try {
    console.log("UPDATE SITE MASTER API HIT");
    console.log("Incoming body:", req.body);

    connection = await oracledb.getConnection();

    const siteRows = [req.body].map((s: any) => ({
      SITE_CODE: getValue(s, "SITE_CODE"),
      SITE_IND: getValue(s, "SITE_IND"),
      SITE_TYPE: getValue(s, "SITE_TYPE"),
      SITE_NAME: getValue(s, "SITE_NAME"),
      CHARGE_IND: getValue(s, "CHARGE_IND"),
      LOC_TYPE: getValue(s, "LOC_TYPE"),
      COMPANY_CODE: getValue(s, "COMPANY_CODE"),
      USER_ID: getValue(s, "USER_ID"),
      PRIN_CODE: getValue(s, "PRIN_CODE"),
      GROUP_CODE: getValue(s, "GROUP_CODE"),
      SITE_ADDR1: getValue(s, "SITE_ADDR1"),
      SITE_ADDR2: getValue(s, "SITE_ADDR2"),
      SITE_ADDR3: getValue(s, "SITE_ADDR3"),
      SITE_ADDR4: getValue(s, "SITE_ADDR4"),
      CITY: getValue(s, "CITY"),
      COUNTRY_CODE: getValue(s, "COUNTRY_CODE"),
      CONTACT_NAME: getValue(s, "CONTACT_NAME"),
      TEL_NO: getValue(s, "TEL_NO"),
      SITE_CLASS: getValue(s, "SITE_CLASS"),
      STATUS: getValue(s, "STATUS"),
      WH_CODE: getValue(s, "WH_CODE"),
      PICKING_OUT: getValue(s, "PICKING_OUT"),
      SITE_VOLUME: getValue(s, "SITE_VOLUME"),
      INC_STORAGE: getValue(s, "INC_STORAGE"),
      DIV_CODE: getValue(s, "DIV_CODE"),
      SITE_RPT_NAME: getValue(s, "SITE_RPT_NAME"),
      USABLE_LOC: getValue(s, "USABLE_LOC")
    }));

    await connection.execute(
      `
      BEGIN
        PROC_UPDATE_SITE_MASTER(:p_site_tab);
      END;
      `,
      {
        p_site_tab: {
          type: "T_SITE_TAB",
          val: siteRows
        }
      }
    );

    res.json({ message: "Site master updated successfully" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Site master update failed" });
  } finally {
    if (connection) await connection.close();
  }
}
