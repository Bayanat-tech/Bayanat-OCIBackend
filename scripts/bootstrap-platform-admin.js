// Creates a central administrator only. Never copies it into tenant schemas.
require("dotenv").config({ quiet: true });
const db = require("oracledb");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
try {
  db.initOracleClient({ libDir: process.env.ORACLE_INSTANT_CLIENT_PATH });
} catch {}
async function main() {
  const conn = await db.getConnection({
    user: process.env.ORACLE_USER,
    password: process.env.ORACLE_PASSWORD,
    connectString: process.env.ORACLE_CONNECTION_STRING,
  });
  try {
    const statements = fs
      .readFileSync(
        path.join(__dirname, "../migrations/20261119_platform_admin.sql"),
        "utf8",
      )
      .replace(/--[^\n]*/g, "")
      .split(";")
      .map((x) => x.trim())
      .filter(Boolean);
    for (const sql of statements) {
      try {
        await conn.execute(sql);
      } catch (e) {
        if (e.errorNum !== 955) throw e;
      }
    }
    const loginid = process.env.PLATFORM_ADMIN_LOGIN || "superadmin";
    if (!/^[A-Za-z0-9_.-]{1,15}$/.test(loginid))
      throw new Error(
        "Use a login of at most 15 letters, numbers, dots, underscores or hyphens.",
      );
    const existing = await conn.execute(
      "SELECT 1 FROM CUSTOMERS.SEC_LOGINTEST WHERE LOWER(LOGINID)=LOWER(:id)",
      { id: loginid },
    );
    if (existing.rows.length) {
      const admin = await conn.execute(
        "SELECT 1 FROM CUSTOMERS.SEC_PLATFORM_ADMIN WHERE LOGINID=:id",
        { id: loginid },
      );
      if (!admin.rows.length)
        throw new Error(
          "Login already exists and is not a platform admin. Choose a new PLATFORM_ADMIN_LOGIN.",
        );
      console.log("Platform administrator already exists; password preserved.");
      return;
    }
    const password =
      process.env.PLATFORM_ADMIN_PASSWORD ||
      crypto.randomBytes(24).toString("base64url");
    if (password.length < 16)
      throw new Error("Use a password of at least 16 characters.");
    const hash = await bcrypt.hash(password, 12);
    // Persist generated credentials outside both repositories before committing the account.
    const credentialDir = path.join(
      process.env.USERPROFILE || process.env.HOME,
      ".codex",
      "credentials",
    );
    fs.mkdirSync(credentialDir, { recursive: true });
    const credentialPath = path.join(
      credentialDir,
      `bayanat-${loginid.replace(/[^a-z0-9.-]/gi, "_")}.txt`,
    );
    fs.writeFileSync(
      credentialPath,
      `Bayanat Platform Super Admin\nLogin: ${loginid}\nPassword: ${password}\nSign in using the normal application login.\n`,
      { flag: "wx", mode: 0o600 },
    );
    await conn.execute(
      `INSERT INTO CUSTOMERS.SEC_LOGINTEST (COMPANY_CODE,LOGINID,USERNAME,STATUS,ACTIVE_FLAG,ID,USERPASS,SEC_PASSWD,PASSWORD,USER_ID,USER_CODE,USERID,APPLICATION,CREATED_BY,CREATED_AT,UPDATED_BY,UPDATED_AT)
      VALUES ('BSG',:loginid,'Platform Super Admin','A','Y',(SELECT NVL(MAX(ID),0)+1 FROM CUSTOMERS.SEC_LOGINTEST),:hash,:hash,:hash,:loginid,:loginid,:loginid,'PLATFORM','bootstrap',SYSTIMESTAMP,'bootstrap',SYSTIMESTAMP)`,
      { loginid, hash },
    );
    await conn.execute(
      "INSERT INTO CUSTOMERS.SEC_PLATFORM_ADMIN (LOGINID,CREATED_BY) VALUES (:loginid,'bootstrap')",
      { loginid },
    );
    await conn.execute(
      `INSERT INTO CUSTOMERS.SEC_PLATFORM_AUDIT (ACTOR,TENANT_ID,ACTION,RESOURCE_NAME,DETAILS) VALUES ('bootstrap','root','INSERT','SEC_PLATFORM_ADMIN',:details)`,
      { details: JSON.stringify({ loginid }) },
    );
    await conn.commit();
    console.log(`Created central platform administrator: ${loginid}`);
    console.log(`Credentials saved to: ${credentialPath}`);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    await conn.close();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
