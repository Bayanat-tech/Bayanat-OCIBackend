import oracledb from "oracledb";
const nodemailer = require("nodemailer");

type Connection = oracledb.Connection;

interface TrackerNotificationPayload {
  companyCode: string;
  prinCode: string;
  jobNo: string;
  taskType: string;
  status: "IN_PROGRESS" | "ON_HOLD" | "COMPLETED";
  holdEntity?: string | null;
  holdReason?: string | null;
  holdRemark?: string | null;
  releaseRemark?: string | null;
  actorId?: string | null;
}

const NEXT_STAGE_CONFIG: Record<
  string,
  { nextTask: string; nextRole: string; nextTitle: string; actionDescription: string }
> = {
  FFD_REVIEW: {
    nextTask: "PRO_PERMITS",
    nextRole: "PRO_TEAM",
    nextTitle: "PRO Permits & Inspection",
    actionDescription: "B/L and documents have been approved by FFD. Please submit agricultural/health permits and arrange ministry inspection.",
  },
  PRO_PERMITS: {
    nextTask: "CUSTOMS_BAYAN",
    nextRole: "BAYAN_TEAM",
    nextTitle: "Customs Bayan Declaration",
    actionDescription: "Ministry permits have been approved. Please prepare and submit the Customs Bayan declaration.",
  },
  CUSTOMS_BAYAN: {
    nextTask: "SHIPPING_LINE_DO",
    nextRole: "SHIPPING_LINE",
    nextTitle: "Delivery Order (DO) Collection",
    actionDescription: "Customs Bayan has been declared. Please collect Delivery Order from the shipping line and verify validity date.",
  },
  SHIPPING_LINE_DO: {
    nextTask: "CCRO",
    nextRole: "ROP_TEAM",
    nextTitle: "CCRO / Port Police Clearance",
    actionDescription: "Delivery Order validity confirmed. Please coordinate with Port Police for container seal inspection and gate pass stamp.",
  },
  CCRO: {
    nextTask: "TRANSPORT",
    nextRole: "TRANSPORT_TEAM",
    nextTitle: "Transport Dispatch & Trucking",
    actionDescription: "CCRO clearance and gate pass stamped. Please allocate fleet/truck contractors and dispatch drivers to port.",
  },
  TRANSPORT: {
    nextTask: "DC_OFFLOAD",
    nextRole: "DC_TEAM",
    nextTitle: "DC Warehouse Offloading",
    actionDescription: "Containers have been dispatched from port and are en route to DC. Please prepare the warehouse offload bay.",
  },
  DC_OFFLOAD: {
    nextTask: "COMPLETED",
    nextRole: "CUSTOMER",
    nextTitle: "Shipment Delivered & Closed",
    actionDescription: "All containers have been offloaded in good order at DC. The freight operation is 100% complete and closed.",
  },
};

export async function sendTrackerStageEmail(
  connection: Connection,
  payload: TrackerNotificationPayload
): Promise<void> {
  const emailUser = process.env.EMAIL_USER;
  const emailPass = process.env.EMAIL_PASS;

  if (!emailUser || !emailPass) {
    console.log("[TrackerNotification] Email credentials not configured, skipping email dispatch.");
    return;
  }

  try {
    // 1. Fetch Job & Principal details for contextual email
    const jobRes = await connection.execute(
      `SELECT j.DOC_REF, j.PORT_CODE, j.DESTINATION_PORT, p.PRIN_NAME, p.EMAIL AS PRIN_EMAIL
         FROM TI_JOB j
         LEFT JOIN MS_PRINCIPAL p
           ON p.COMPANY_CODE = j.COMPANY_CODE AND p.PRIN_CODE = j.PRIN_CODE
        WHERE j.COMPANY_CODE = :comp AND j.JOB_NO = :job`,
      { comp: payload.companyCode, job: payload.jobNo },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const jobRow: any = (jobRes.rows as any[])?.[0] || {};
    const docRef = jobRow.DOC_REF || "—";
    const prinName = jobRow.PRIN_NAME || "Valued Principal";
    const prinEmail = jobRow.PRIN_EMAIL;

    // 2. Resolve target stage serial number for user lookup
    const STAGE_SERIAL_MAP: Record<string, number> = {
      FFD_REVIEW: 539,
      PRO_PERMITS: 540,
      CUSTOMS_BAYAN: 541,
      SHIPPING_LINE_DO: 542,
      CCRO: 543,
      TRANSPORT: 544,
      DC_OFFLOAD: 545,
    };

    const nextConfig = NEXT_STAGE_CONFIG[payload.taskType];
    const targetStage = payload.status === "ON_HOLD" ? payload.taskType : (nextConfig?.nextTask || payload.taskType);
    const targetSerial = STAGE_SERIAL_MAP[targetStage] || 539;

    // 3. Query all active users who have access to this stage from SEC_LOGINTEST & SEC_ROLE_FUNCTION_ACCESS_USER
    const userEmails: string[] = [];
    try {
      const userRes = await connection.execute(
        `SELECT DISTINCT NVL(u.EMAIL_ID, u.CONTACT_EMAIL) AS USER_EMAIL
           FROM CUSTOMERS.SEC_LOGINTEST u
           JOIN SEC_ROLE_FUNCTION_ACCESS_USER a
             ON a.LOGINID = u.LOGINID AND a.COMPANY_CODE = :comp
          WHERE a.SERIAL_NO_OR_ROLE_ID = :serial_no
            AND a.SSAVE = 'Y'
            AND u.ACTIVE_FLAG = 'Y'
            AND (u.EMAIL_ID IS NOT NULL OR u.CONTACT_EMAIL IS NOT NULL)`,
        { comp: payload.companyCode, serial_no: targetSerial },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );

      for (const r of (userRes.rows as any[]) || []) {
        const em = String(r.USER_EMAIL || "").trim();
        if (em && em.includes("@") && !userEmails.includes(em)) {
          userEmails.push(em);
        }
      }
    } catch (uErr: any) {
      console.warn("[TrackerNotification] User email lookup notice:", uErr?.message || uErr);
    }

    // 4. Setup Transporter
    const transporter = nodemailer.createTransport({
      service: "Outlook365",
      auth: {
        user: emailUser,
        pass: emailPass,
      },
    });

    let subject = "";
    let htmlContent = "";
    const recipients = userEmails.length > 0 ? userEmails : [prinEmail || emailUser];
    const targetEmail = recipients.join(", ");

    if (payload.status === "ON_HOLD") {
      // ── HOLD ALERT ──
      subject = `⚠️ [HOLD ALERT] Freight Job ${payload.jobNo} On Hold at Stage: ${payload.taskType}`;
      htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #fed7aa; border-radius: 12px; overflow: hidden;">
          <div style="background-color: #f97316; padding: 18px 24px; color: white;">
            <h2 style="margin: 0; font-size: 20px;">Freight Milestone On Hold</h2>
            <p style="margin: 4px 0 0; font-size: 13px; opacity: 0.9;">Action Required for Job: ${payload.jobNo}</p>
          </div>
          <div style="padding: 24px; background-color: #fffaf5; color: #334155; line-height: 1.6;">
            <p><strong>Job Number:</strong> ${payload.jobNo}</p>
            <p><strong>B/L / Document Reference:</strong> ${docRef}</p>
            <p><strong>Principal / Customer:</strong> ${prinName}</p>
            <p><strong>Held Stage:</strong> <span style="color: #c2410c; font-weight: bold;">${payload.taskType}</span></p>
            <p><strong>Held By External Entity:</strong> ${payload.holdEntity || "Operational Review"}</p>
            <p><strong>Hold Reason:</strong> ${payload.holdReason || "Pending clearance"}</p>
            <div style="background-color: #ffedd5; padding: 12px 16px; border-left: 4px solid #f97316; border-radius: 4px; margin: 16px 0;">
              <strong>Remarks:</strong> <em>"${payload.holdRemark || "Operational review requested."}"</em>
            </div>
            <p style="font-size: 12px; color: #64748b; margin-top: 24px;">Logged by user <strong>${payload.actorId}</strong> in Bayanat Freight Tracking System.</p>
          </div>
        </div>
      `;
    } else if (payload.status === "COMPLETED") {
      // ── STAGE ADVANCED NOTIFICATION ──
      const nextConfig = NEXT_STAGE_CONFIG[payload.taskType] || {
        nextTask: "NEXT_STAGE",
        nextRole: "NEXT_TEAM",
        nextTitle: "Next Milestone",
        actionDescription: "The current milestone has finished. Please proceed with the next operational task.",
      };

      subject = `🚀 [STAGE COMPLETED] Freight Job ${payload.jobNo} ➔ Next: ${nextConfig.nextTitle}`;
      htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #cbd5e1; border-radius: 12px; overflow: hidden;">
          <div style="background-color: #00378C; padding: 18px 24px; color: white;">
            <h2 style="margin: 0; font-size: 20px;">Freight Milestone Completed</h2>
            <p style="margin: 4px 0 0; font-size: 13px; opacity: 0.9;">Job: ${payload.jobNo} &bull; Ref: ${docRef}</p>
          </div>
          <div style="padding: 24px; background-color: #ffffff; color: #334155; line-height: 1.6;">
            <p><strong>Completed Stage:</strong> <span style="color: #15803d; font-weight: bold;">✓ ${payload.taskType}</span></p>
            <p><strong>Completed By:</strong> ${payload.actorId}</p>
            <p><strong>Principal:</strong> ${prinName}</p>
            
            <div style="background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 16px; margin: 18px 0;">
              <h4 style="margin: 0 0 6px; color: #1e40af; font-size: 15px;">Next Assigned Step: ${nextConfig.nextTitle} (${nextConfig.nextRole})</h4>
              <p style="margin: 0; font-size: 13px; color: #1e3a8a;">${nextConfig.actionDescription}</p>
            </div>

            <p style="font-size: 12px; color: #64748b; margin-top: 24px;">This notification was auto-generated by the Bayan Freight Management System.</p>
          </div>
        </div>
      `;
    } else if (payload.releaseRemark) {
      // ── HOLD RELEASED NOTIFICATION ──
      subject = `🔓 [HOLD RELEASED] Freight Job ${payload.jobNo} Resumed at Stage: ${payload.taskType}`;
      htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #bbf7d0; border-radius: 12px; overflow: hidden;">
          <div style="background-color: #16a34a; padding: 18px 24px; color: white;">
            <h2 style="margin: 0; font-size: 20px;">Hold Released — Stage Resumed</h2>
            <p style="margin: 4px 0 0; font-size: 13px; opacity: 0.9;">Job: ${payload.jobNo}</p>
          </div>
          <div style="padding: 24px; background-color: #f0fdf4; color: #334155; line-height: 1.6;">
            <p><strong>Stage:</strong> ${payload.taskType}</p>
            <p><strong>Resolution:</strong> <em>"${payload.releaseRemark}"</em></p>
            <p><strong>Released By:</strong> ${payload.actorId}</p>
            <p style="font-size: 12px; color: #64748b; margin-top: 20px;">The operational hold has been resolved and this stage is now actively in progress.</p>
          </div>
        </div>
      `;
    }

    if (subject && htmlContent) {
      await transporter.sendMail({
        from: emailUser,
        to: targetEmail,
        subject,
        html: htmlContent,
      });
      console.log(`[TrackerNotification] Notification email dispatched for Job ${payload.jobNo} (${payload.status}) to ${targetEmail}`);
    }
  } catch (emailErr: any) {
    console.warn(`[TrackerNotification] Failed to send email for Job ${payload.jobNo}:`, emailErr?.message || emailErr);
  }
}
