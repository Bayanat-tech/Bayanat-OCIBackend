export interface SupportEmailOptions {
  title: string;
  ticketId: number;
  subject: string;
  requesterName: string;
  requesterLogin: string;
  companyCode: string;
  tenantId: string;
  moduleName?: string;
  pageUrl?: string;
  priority?: string;
  status?: string;
  message: string;
  note?: string;
}

export function buildSupportEmailHtml(opts: SupportEmailOptions): string {
  const portalUrl = 'https://prod-new.bayanattechnology.com/';
  const priorityColor =
    opts.priority === 'CRITICAL' || opts.priority === 'HIGH' ? '#dc2626' : '#2563eb';
  const statusColor =
    opts.status === 'RESOLVED' || opts.status === 'CLOSED'
      ? '#16a34a'
      : opts.status === 'IN_PROGRESS'
      ? '#d97706'
      : '#2563eb';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(opts.title)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; line-height: 1.5;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 25px 10px;">
    <tr>
      <td align="center">
        <!-- Main Container Card -->
        <table role="presentation" width="100%" style="max-width: 620px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(15, 23, 42, 0.08); border: 1px solid #e2e8f0;">
          
          <!-- Brand & Ticket Banner -->
          <tr>
            <td bgcolor="#0759b4" style="background-color: #0759b4; padding: 22px 28px; color: #ffffff;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: #93c5fd; margin-bottom: 5px;">
                      Bayanat Technology &bull; Support Desk
                    </div>
                    <div style="font-size: 19px; font-weight: 700; color: #ffffff; line-height: 1.3;">
                      Ticket #${opts.ticketId}: ${escapeHtml(opts.subject)}
                    </div>
                  </td>
                  <td align="right" valign="top" style="white-space: nowrap; padding-left: 10px;">
                    <span style="display: inline-block; background-color: rgba(255, 255, 255, 0.2); color: #ffffff; padding: 4px 10px; border-radius: 14px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; border: 1px solid rgba(255, 255, 255, 0.4);">
                      ${escapeHtml(opts.status || 'OPEN')}
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Ticket Details -->
          <tr>
            <td style="padding: 22px 28px 18px 28px;">

              <!-- Meta Table -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 20px; border-collapse: separate; border-spacing: 0; background-color: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden;">
                <tr>
                  <td style="padding: 9px 14px; font-size: 12px; font-weight: 600; color: #64748b; border-bottom: 1px solid #e2e8f0; width: 30%;">
                    Raised By:
                  </td>
                  <td style="padding: 9px 14px; font-size: 13px; font-weight: 700; color: #0f172a; border-bottom: 1px solid #e2e8f0;">
                    ${escapeHtml(opts.requesterName)} <span style="font-weight: 500; color: #64748b; font-size: 12px;">(Emp / Login: ${escapeHtml(opts.requesterLogin)})</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 9px 14px; font-size: 12px; font-weight: 600; color: #64748b; border-bottom: 1px solid #e2e8f0;">
                    Company &amp; Tenant:
                  </td>
                  <td style="padding: 9px 14px; font-size: 13px; color: #1e293b; border-bottom: 1px solid #e2e8f0;">
                    <strong>${escapeHtml(opts.companyCode)}</strong> &bull; <span style="color: #475569;">${escapeHtml(opts.tenantId)}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 9px 14px; font-size: 12px; font-weight: 600; color: #64748b; border-bottom: 1px solid #e2e8f0;">
                    Module &amp; Screen:
                  </td>
                  <td style="padding: 9px 14px; font-size: 13px; color: #1e293b; border-bottom: 1px solid #e2e8f0;">
                    <span style="background-color: #e2e8f0; color: #1e293b; padding: 2px 7px; border-radius: 4px; font-family: monospace; font-size: 12px; font-weight: 600;">${escapeHtml(opts.moduleName || 'General')}</span>
                    ${opts.pageUrl ? `<span style="color: #64748b; font-size: 12px; margin-left: 6px;">(${escapeHtml(opts.pageUrl)})</span>` : ''}
                  </td>
                </tr>
                <tr>
                  <td style="padding: 9px 14px; font-size: 12px; font-weight: 600; color: #64748b;">
                    Priority:
                  </td>
                  <td style="padding: 9px 14px; font-size: 13px; font-weight: 700; color: ${priorityColor};">
                    ${escapeHtml(opts.priority || 'NORMAL')}
                  </td>
                </tr>
              </table>

              <!-- Description Box -->
              <div style="margin-bottom: 20px;">
                <div style="font-size: 11.5px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 7px;">
                  Issue Description / Comments:
                </div>
                <div style="background-color: #fafafa; border-left: 4px solid #0759b4; border-top: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; border-radius: 0 6px 6px 0; padding: 14px 16px; font-size: 13.5px; color: #1e293b; white-space: pre-wrap; line-height: 1.6;">${escapeHtml(opts.message)}</div>
              </div>

              ${opts.note ? `
              <!-- Note / Activity -->
              <div style="margin-bottom: 20px; padding: 11px 14px; background-color: #f8fafc; border-radius: 6px; font-size: 12.5px; color: #475569; border: 1px solid #e2e8f0;">
                <strong>Update:</strong> ${escapeHtml(opts.note)}
              </div>` : ''}

              <!-- Direct Action Button (Solid Cross-Client Outlook Friendly) -->
              <table role="presentation" cellspacing="0" cellpadding="0" align="center" style="margin: 22px auto 10px auto;">
                <tr>
                  <td align="center" bgcolor="#0759b4" style="background-color: #0759b4; border-radius: 6px;">
                    <a href="${portalUrl}" target="_blank" style="display: inline-block; padding: 11px 28px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; font-weight: 700; color: #ffffff !important; text-decoration: none; border-radius: 6px; letter-spacing: 0.3px;">
                      Open Support Desk &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <div style="text-align: center; font-size: 11.5px; color: #64748b; line-height: 1.5; margin-top: 8px;">
                Portal: <a href="${portalUrl}" target="_blank" style="color: #0759b4; font-weight: 600; text-decoration: underline;">${portalUrl}</a>
                <br>
                <em>(Log in using <strong>DEVADMIN</strong> to review and manage this ticket)</em>
              </div>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 16px 28px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 11px; color: #94a3b8; line-height: 1.5;">
              This is an automated notification from the <strong>Bayanat Technology Enterprise Support System</strong>.
              <br>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(text?: string): string {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

