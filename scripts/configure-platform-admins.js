// Authorized account migration: preserve the production password and scope QA to WMSTST.
require("dotenv").config({ quiet: true });
const db = require("oracledb");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
try {
  db.initOracleClient({ libDir: process.env.ORACLE_INSTANT_CLIENT_PATH });
} catch {}
async function run() {
  const activateQA = process.argv.includes("--activate-qa");
  if (activateQA) {
    const origin =
      process.env.PLATFORM_ADMIN_API_URL ||
      "https://prod-new.bayanattechnology.com";
    if (!origin.startsWith("https://"))
      throw new Error(
        "QA activation requires the deployed HTTPS backend, not a local preview.",
      );
    const credentialFile = path.join(
      process.env.USERPROFILE || process.env.HOME,
      ".codex",
      "credentials",
      "bayanat-prodadmin.txt",
    );
    const password = fs
      .readFileSync(credentialFile, "utf8")
      .match(/Password: (.+)/)?.[1];
    if (!password)
      throw new Error(
        "The production administrator credential file is required for activation verification.",
      );
    const login = await fetch(new URL("/api/auth/login", origin), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "prodadmin", password }),
      signal: AbortSignal.timeout(20000),
    });
    const session = await login.json();
    if (!login.ok || !session.data?.token)
      throw new Error(
        "Unable to verify the deployed administrator session. QA remains inactive.",
      );
    const response = await fetch(new URL("/api/auth/me", origin), {
      headers: { Authorization: "Bearer " + session.data.token },
      signal: AbortSignal.timeout(20000),
    });
    const profile = await response.json();
    if (
      !response.ok ||
      profile.data?.user?.platformPolicyVersion !== 2 ||
      profile.data?.user?.platformAccess?.scope !== "ALL"
    )
      throw new Error(
        "Deploy the scoped backend before activating QA. The current backend has not advertised policy version 2.",
      );
  }
  const c = await db.getConnection({
    user: process.env.ORACLE_USER,
    password: process.env.ORACLE_PASSWORD,
    connectString: process.env.ORACLE_CONNECTION_STRING,
  });
  const credentialDir = path.join(
    process.env.USERPROFILE || process.env.HOME,
    ".codex",
    "credentials",
  );
  fs.mkdirSync(credentialDir, { recursive: true });
  try {
    for (const file of [
      "20261119_platform_admin.sql",
      "20261120_platform_admin_scope.sql",
    ]) {
      for (const sql of fs
        .readFileSync(path.join(__dirname, "../migrations", file), "utf8")
        .replace(/--[^\n]*/g, "")
        .split(";")
        .map((x) => x.trim())
        .filter(Boolean)) {
        try {
          await c.execute(sql);
        } catch (e) {
          if (![955, 1430].includes(e.errorNum)) throw e;
        }
      }
    }
    const rows = async (sql, binds = {}) =>
      (await c.execute(sql, binds, { outFormat: db.OUT_FORMAT_OBJECT })).rows ||
      [];
    await c.execute(
      "LOCK TABLE CUSTOMERS.SEC_LOGINTEST IN EXCLUSIVE MODE WAIT 5",
    );
    const find = async (id) =>
      (
        await rows(
          "SELECT LOGINID FROM CUSTOMERS.SEC_LOGINTEST WHERE LOWER(LOGINID)=:id",
          { id },
        )
      )[0];
    const old = await find("superadmin");
    const prod = await find("prodadmin");
    if (old && prod)
      throw new Error(
        "Both superadmin and prodadmin exist. Account collision requires review; no accounts changed.",
      );
    if (old) {
      const member = await rows(
        "SELECT 1 FROM CUSTOMERS.SEC_PLATFORM_ADMIN WHERE LOGINID=:id",
        { id: old.LOGINID },
      );
      if (!member.length)
        throw new Error(
          "Existing superadmin is not a platform administrator; refusing to rename it.",
        );
      await c.execute(
        "UPDATE CUSTOMERS.SEC_PLATFORM_ADMIN SET LOGINID='prodadmin',ADMIN_SCOPE='ALL' WHERE LOGINID=:old",
        { old: old.LOGINID },
      );
      await c.execute(
        "UPDATE CUSTOMERS.SEC_PLATFORM_ADMIN_TENANT SET LOGINID='prodadmin' WHERE LOGINID=:old",
        { old: old.LOGINID },
      );
      await c.execute(
        "UPDATE CUSTOMERS.USER_TENANT_MAPPING SET LOGINID='prodadmin' WHERE LOGINID=:old",
        { old: old.LOGINID },
      );
      await c.execute(
        `UPDATE CUSTOMERS.SEC_LOGINTEST SET LOGINID='prodadmin',USERNAME='Production Administrator',
        USER_ID=CASE WHEN USER_ID=:old THEN 'prodadmin' ELSE USER_ID END,
        USER_CODE=CASE WHEN USER_CODE=:old THEN 'prodadmin' ELSE USER_CODE END,
        USERID=CASE WHEN USERID=:old THEN 'prodadmin' ELSE USERID END,
        UPDATED_BY='admin-setup',UPDATED_AT=SYSTIMESTAMP WHERE LOGINID=:old`,
        { old: old.LOGINID },
      );
      console.log(
        "Renamed superadmin to prodadmin; existing password preserved.",
      );
    }
    async function ensure(id, name, scope) {
      if (await find(id)) {
        const member = await rows(
          "SELECT 1 FROM CUSTOMERS.SEC_PLATFORM_ADMIN WHERE LOGINID=:id",
          { id },
        );
        if (!member.length)
          throw new Error(
            `${id} is already used by a non-administrator; refusing to elevate it.`,
          );
        await c.execute(
          "UPDATE CUSTOMERS.SEC_PLATFORM_ADMIN SET ADMIN_SCOPE=:scope WHERE LOGINID=:id",
          { scope, id },
        );
      } else {
        const password = crypto.randomBytes(24).toString("base64url");
        const hash = await bcrypt.hash(password, 12);
        const file = path.join(credentialDir, `bayanat-${id}.txt`);
        fs.writeFileSync(
          file,
          `Bayanat ${name}\nLogin: ${id}\nPassword: ${password}\n`,
          { flag: "wx", mode: 0o600 },
        );
        await c.execute(
          `INSERT INTO CUSTOMERS.SEC_LOGINTEST (COMPANY_CODE,LOGINID,USERNAME,STATUS,ACTIVE_FLAG,ID,USERPASS,SEC_PASSWD,PASSWORD,USER_ID,USER_CODE,USERID,APPLICATION,CREATED_BY,CREATED_AT)
          VALUES ('BSG',:id,:name,'A','Y',(SELECT NVL(MAX(ID),0)+1 FROM CUSTOMERS.SEC_LOGINTEST),:hash,:hash,:hash,:id,:id,:id,'PLATFORM','admin-setup',SYSTIMESTAMP)`,
          { id, name, hash },
        );
        await c.execute(
          "INSERT INTO CUSTOMERS.SEC_PLATFORM_ADMIN (LOGINID,ADMIN_SCOPE,CREATED_BY) VALUES (:id,:scope,'admin-setup')",
          { id, scope },
        );
        console.log(`Created ${id}. Credentials saved to ${file}`);
      }
    }
    await ensure("prodadmin", "Production Administrator", "ALL");
    await ensure("qaadmin", "QA Administrator", "SCOPED");
    // Older deployed versions treat every active platform member as unrestricted.
    // Hold the new QA login until the deployed backend proves it supports scopes.
    await c.execute(
      "UPDATE CUSTOMERS.SEC_LOGINTEST SET ACTIVE_FLAG=:flag WHERE LOGINID='qaadmin'",
      { flag: activateQA ? "Y" : "N" },
    );
    if (activateQA)
      await c.execute(
        "UPDATE CUSTOMERS.SEC_PLATFORM_ADMIN SET IS_ACTIVE='Y' WHERE LOGINID='qaadmin'",
      );
    await c.execute(
      "DELETE FROM CUSTOMERS.SEC_PLATFORM_ADMIN_TENANT WHERE LOGINID IN ('prodadmin','qaadmin')",
    );
    for (const tenant of ["root", "WMSTST_TENANT"])
      await c.execute(
        "INSERT INTO CUSTOMERS.SEC_PLATFORM_ADMIN_TENANT (LOGINID,TENANT_ID) VALUES ('qaadmin',:tenant)",
        { tenant },
      );
    await c.execute(
      `INSERT INTO CUSTOMERS.SEC_PLATFORM_AUDIT (ACTOR,TENANT_ID,ACTION,RESOURCE_NAME,DETAILS)
      VALUES ('admin-setup','root','UPDATE','ADMIN_SCOPE',:details)`,
      {
        details: JSON.stringify({
          prodadmin: "ALL",
          qaadmin: ["root", "WMSTST_TENANT"],
          renamed: Boolean(old),
        }),
      },
    );
    await c.commit();
    const previousFile = path.join(credentialDir, "bayanat-superadmin.txt");
    const prodFile = path.join(credentialDir, "bayanat-prodadmin.txt");
    if (old && fs.existsSync(previousFile) && !fs.existsSync(prodFile))
      fs.writeFileSync(
        prodFile,
        fs
          .readFileSync(previousFile, "utf8")
          .replace(/Login: superadmin/g, "Login: prodadmin")
          .replace("Platform Super Admin", "Production Administrator"),
        { flag: "wx", mode: 0o600 },
      );
    console.log(
      "Verified configuration: prodadmin = all tenants; qaadmin = CUSTOMERS and WMSTST only.",
    );
    console.log(
      activateQA
        ? "QA login activated after deployed-policy verification."
        : "QA login is safely held inactive. After deployment, run npm run admin:configure -- --activate-qa.",
    );
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    await c.close();
  }
}
run().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
