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
            <td style="background: linear-gradient(135deg, #0b63ce 0%, #1e40af 100%); padding: 24px 28px; color: #ffffff;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <div style="font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: #93c5fd; margin-bottom: 6px;">
                      Bayanat Technology &bull; Support Desk
                    </div>
                    <div style="font-size: 21px; font-weight: 700; color: #ffffff; line-height: 1.3;">
                      Ticket #${opts.ticketId}: ${escapeHtml(opts.subject)}
                    </div>
                  </td>
                  <td align="right" valign="top" style="white-space: nowrap; padding-left: 10px;">
                    <span style="display: inline-block; background: rgba(255, 255, 255, 0.2); color: #ffffff; padding: 5px 12px; border-radius: 20px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; border: 1px solid rgba(255, 255, 255, 0.35);">
                      ${escapeHtml(opts.status || 'OPEN')}
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Admin Login Callout -->
          <tr>
            <td style="background-color: #f0f7ff; padding: 14px 28px; border-bottom: 1px solid #dbeafe;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="font-size: 13px; color: #1e40af; line-height: 1.5;">
                    🔐 <strong>Admin Login Notice:</strong> Please log in using <strong>DEVADMIN</strong> at <a href="${portalUrl}" style="color: #1d4ed8; font-weight: 700; text-decoration: underline;" target="_blank">prod-new.bayanattechnology.com</a> to review, assign, or resolve this ticket.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Ticket Details -->
          <tr>
            <td style="padding: 24px 28px;">

              <!-- Meta Table -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 22px; border-collapse: separate; border-spacing: 0; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden;">
                <tr>
                  <td style="padding: 10px 14px; font-size: 12px; font-weight: 600; color: #64748b; border-bottom: 1px solid #e2e8f0; width: 32%;">
                    Raised By:
                  </td>
                  <td style="padding: 10px 14px; font-size: 13px; font-weight: 700; color: #0f172a; border-bottom: 1px solid #e2e8f0;">
                    ${escapeHtml(opts.requesterName)} <span style="font-weight: 500; color: #64748b; font-size: 12px;">(Emp / Login: ${escapeHtml(opts.requesterLogin)})</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 10px 14px; font-size: 12px; font-weight: 600; color: #64748b; border-bottom: 1px solid #e2e8f0;">
                    Company &amp; Tenant:
                  </td>
                  <td style="padding: 10px 14px; font-size: 13px; color: #1e293b; border-bottom: 1px solid #e2e8f0;">
                    <strong>${escapeHtml(opts.companyCode)}</strong> &bull; <span style="color: #475569;">${escapeHtml(opts.tenantId)}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 10px 14px; font-size: 12px; font-weight: 600; color: #64748b; border-bottom: 1px solid #e2e8f0;">
                    Module &amp; Screen:
                  </td>
                  <td style="padding: 10px 14px; font-size: 13px; color: #1e293b; border-bottom: 1px solid #e2e8f0;">
                    <span style="background: #e2e8f0; color: #1e293b; padding: 2px 8px; border-radius: 4px; font-family: monospace; font-size: 12px; font-weight: 600;">${escapeHtml(opts.moduleName || 'General')}</span>
                    ${opts.pageUrl ? `<span style="color: #64748b; font-size: 12px; margin-left: 6px;">(${escapeHtml(opts.pageUrl)})</span>` : ''}
                  </td>
                </tr>
                <tr>
                  <td style="padding: 10px 14px; font-size: 12px; font-weight: 600; color: #64748b;">
                    Priority:
                  </td>
                  <td style="padding: 10px 14px; font-size: 13px; font-weight: 700; color: ${priorityColor};">
                    ${escapeHtml(opts.priority || 'NORMAL')}
                  </td>
                </tr>
              </table>

              <!-- Description Box -->
              <div style="margin-bottom: 22px;">
                <div style="font-size: 12px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 8px;">
                  Issue Description / Comments:
                </div>
                <div style="background-color: #fafafa; border-left: 4px solid #0b63ce; border-top: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; border-radius: 0 8px 8px 0; padding: 15px 18px; font-size: 14px; color: #1e293b; white-space: pre-wrap; line-height: 1.6;">${escapeHtml(opts.message)}</div>
              </div>

              ${opts.note ? `
              <!-- Note / Activity -->
              <div style="margin-bottom: 22px; padding: 12px 16px; background-color: #f8fafc; border-radius: 8px; font-size: 13px; color: #475569; border: 1px solid #e2e8f0;">
                <strong>Update:</strong> ${escapeHtml(opts.note)}
              </div>` : ''}

              <!-- Direct Action Link Button -->
              <div style="text-align: center; margin: 30px 0 14px 0;">
                <a href="${portalUrl}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #0b63ce 0%, #1e40af 100%); color: #ffffff; font-size: 14px; font-weight: 700; text-decoration: none; padding: 13px 32px; border-radius: 8px; box-shadow: 0 4px 14px rgba(11, 99, 206, 0.35);">
                  Open Support Portal &rarr;
                </a>
              </div>
              <div style="text-align: center; font-size: 12px; color: #64748b;">
                Portal: <a href="${portalUrl}" style="color: #0b63ce; text-decoration: underline;" target="_blank">${portalUrl}</a>
                <br>
                <em>(Log in using <strong>DEVADMIN</strong> to review &amp; manage this ticket)</em>
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

