import { Request, Response } from "express";
import oracledb from "oracledb";
import * as XLSX from "xlsx";
import TenantManager from "../../../../database/TenantManager";
import { getCurrentTenantId } from "../../../../middleware/tenantContext.middleware";

const text = (v: any) => (v == null ? "" : String(v));

const formatDate = (v: any) => {
    if (!v) return "";
    const d = new Date(v);
    return isNaN(d.getTime())
        ? String(v)
        : d.toLocaleDateString("en-GB");
};

export const getJobListingReport = async (
    req: Request,
    res: Response
): Promise<void> => {

    let connection;

    try {

        const {
            parameter,
            loginid,
            code1,
            code2,
            code3,
            code4,
            code5,
            code6,
            code7,
            code8,
            code9,
            code10,
            code11,
            code12,
            code13,
            code14,
            code15,
            code16,
            code17,
            code18,
            code19,
            code20
        } = req.body;

        let tenantId = getCurrentTenantId();

        if (!tenantId && loginid) {
            tenantId = await TenantManager.getTenantForUser(loginid);
        }

        if (!tenantId) {
            res.status(400).json({ error: 'tenantId is required' });
            return;
        }

        connection = await TenantManager.getConnection(tenantId);

        const binds: any = {

            parameter,
            loginid,

            code1,
            code2,
            code3,
            code4,
            code5,
            code6,

            code7,
            code8,
            code9,
            code10,
            code11,
            code12,
            code13,
            code14,
            code15,
            code16,
            code17,
            code18,
            code19,
            code20,

            number1: null,
            number2: null,
            number3: null,
            number4: null,

            date1: null,
            date2: null,
            date3: null,
            date4: null,

            out_sql: {
                dir: oracledb.BIND_OUT,
                type: oracledb.STRING,
                maxSize: 32767,
            },
        };

        const sqlResult = await connection.execute(

            `
            DECLARE
                V_SQL VARCHAR2(32767);
            BEGIN

                PROC_BUILD_DYNAMIC_SQL_COMMON20(

                    :parameter,
                    :loginid,

                    :code1,
                    :code2,
                    :code3,
                    :code4,
                    :code5,
                    :code6,
                    :code7,
                    :code8,
                    :code9,
                    :code10,
                    :code11,
                    :code12,
                    :code13,
                    :code14,
                    :code15,
                    :code16,
                    :code17,
                    :code18,
                    :code19,
                    :code20,

                    :number1,
                    :number2,
                    :number3,
                    :number4,

                    :date1,
                    :date2,
                    :date3,
                    :date4,

                    V_SQL

                );

                :out_sql := V_SQL;

            END;
            `,
            binds
        );

        const dynamicSql = (sqlResult.outBinds as any).out_sql;

        const data = await connection.execute(
            dynamicSql,
            [],
            {
                outFormat: oracledb.OUT_FORMAT_OBJECT
            }
        );
        console.log("dynamicSql", dynamicSql);

        const rows = data.rows as any[];

        let body = "";

        rows.forEach((r: any) => {

            body += `

            <tr>

                <td>${text(r.DEPT_NAME)}</td>

                <td>${text(r.JOB_TYPE)}</td>

                <td>${text(r.JOB_NO)}</td>

                <td>${text(r.PRIN_NAME)}</td>
                
                <td>${text(r.JOB_CLASS)}</td>
                <td>${formatDate(r.JOB_DATE)}</td>
                <td>${formatDate(r.CONFIRME_DATE)}</td>
                <td>${text(r.GRN_NO)}</td>
                 <td>${text(r.GRN_DATE)}</td>

                <td>${text(r.INV_NO)}</td>

                <td>${formatDate(r.INV_DATE)}</td>

                <td style="text-align:right">
                    ${text(r.ACT_BILL_AMT)}
                </td>

                <td>${text(r.USER_ID)}</td>


                <td>${text(r.CONFIRMED)}</td>

                <td>${text(r.INVOICED)}</td>

            </tr>

            `;

        });

        const html = `

<!DOCTYPE html>

<html>

<head>

<meta charset="utf-8"/>

<title>Job Listing Report</title>

<style>

body{

font-family:Arial;

font-size:11px;

margin:20px;

}

.header{

text-align:center;

margin-bottom:20px;

}

.company{

font-size:22px;

font-weight:bold;

}

.report{

font-size:16px;

font-weight:bold;

margin-top:5px;

}

table{

width:100%;

border-collapse:collapse;

}

th{

background:#0d4d89;

color:white;

padding:6px;

border:1px solid gray;

}

td{

padding:4px;

border:1px solid gray;

}

tr:nth-child(even){

background:#f5f5f5;

}

.footer{

margin-top:15px;

text-align:center;

font-size:10px;

}

.print{

margin-bottom:15px;

}

button{

padding:10px 20px;

background:#0d4d89;

color:white;

border:none;

cursor:pointer;

}

</style>

</head>

<body>

<div class="print">

<button onclick="window.print()">

Print / Save PDF

</button>

</div>

<div class="header">

<div class="company">

AL MADINA LOGISTICS SERVICES COMPANY

</div>

<div class="report">

Transaction Report - Job Listing

</div>

<div>

Date :
${formatDate(new Date())}

&nbsp;&nbsp;&nbsp;

User :
${loginid}

</div>

</div>

<table>

<thead>

<tr>

<th>Department</th>

<th>Job Type</th>

<th>Job No</th>

<th>Principal</th>
<th>Job Class</th>

<th>Job Date</th>
<th>Confirme Date</th>

<th>GRN/DN</th>
<th>GRN/DN Date</th>

<th>Invoice No</th>

<th>Invoice Dt</th>

<th>Bill Amt</th>

<th>User</th>

<th>Confirmed</th>

<th>Invoiced</th>

</tr>

</thead>

<tbody>

${body}

</tbody>

</table>

<div class="footer">

Generated by Aware ERP

</div>

</body>

</html>

`;

        res.setHeader("Content-Type", "text/html");

        res.send(html);

    } catch (err: any) {

        console.log(err);

        res.status(500).json({

            success: false,

            message: err.message

        });

    } finally {

        if (connection) {

            try {

                await connection.close();

            } catch { }

        }

    }

};

function buildJobListingWorkbook(rows: any[]) {
    const headerMap = [
        { key: 'DEPT_NAME', label: 'Department' },
        { key: 'JOB_TYPE', label: 'Job Type' },
        { key: 'JOB_NO', label: 'Job No' },
        { key: 'PRIN_NAME', label: 'Principal' },
        { key: 'JOB_CLASS', label: 'Job Class' },
        { key: 'JOB_DATE', label: 'Job Date' },
        { key: 'CONFIRME_DATE', label: 'Confirme Date' },
        { key: 'GRN_NO', label: 'GRN/DN' },
        { key: 'GRN_DATE', label: 'GRN/DN Date' },
        { key: 'INV_NO', label: 'Invoice No' },
        { key: 'INV_DATE', label: 'Invoice Dt' },
        { key: 'ACT_BILL_AMT', label: 'Bill Amt' },
        { key: 'USER_ID', label: 'User' },
        { key: 'CONFIRMED', label: 'Confirmed' },
        { key: 'INVOICED', label: 'Invoiced' },
    ];

    const sheetData = rows.map((row) => {
        const output: Record<string, any> = {};
        headerMap.forEach((header) => {
            let value = row[header.key];
            if (header.key === 'JOB_DATE' || header.key === 'CONFIRME_DATE' || header.key === 'GRN_DATE' || header.key === 'INV_DATE') {
                value = formatDate(value);
            }
            output[header.label] = value;
        });
        return output;
    });

    const worksheet = XLSX.utils.json_to_sheet(sheetData, { header: headerMap.map((item) => item.label), skipHeader: false });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Job Listing');
    return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
}

export const exportJobListingReportExcel = async (
    req: Request,
    res: Response
): Promise<void> => {
    let connection;

    try {
        const {
            parameter,
            loginid,
            code1,
            code2,
            code3,
            code4,
            code5,
            code6,
            code7,
            code8,
            code9,
            code10,
            code11,
            code12,
            code13,
            code14,
            code15,
            code16,
            code17,
            code18,
            code19,
            code20
        } = req.body;

        let tenantId = getCurrentTenantId();

        if (!tenantId && loginid) {
            tenantId = await TenantManager.getTenantForUser(loginid);
        }

        if (!tenantId) {
            res.status(400).json({ error: 'tenantId is required' });
            return;
        }

        connection = await TenantManager.getConnection(tenantId);

        const binds: any = {
            parameter,
            loginid,
            code1,
            code2,
            code3,
            code4,
            code5,
            code6,
            code7,
            code8,
            code9,
            code10,
            code11,
            code12,
            code13,
            code14,
            code15,
            code16,
            code17,
            code18,
            code19,
            code20,
            number1: null,
            number2: null,
            number3: null,
            number4: null,
            date1: null,
            date2: null,
            date3: null,
            date4: null,
            out_sql: {
                dir: oracledb.BIND_OUT,
                type: oracledb.STRING,
                maxSize: 32767,
            },
        };

        const sqlResult = await connection.execute(
            `
            DECLARE
                V_SQL VARCHAR2(32767);
            BEGIN

                PROC_BUILD_DYNAMIC_SQL_COMMON20(

                    :parameter,
                    :loginid,

                    :code1,
                    :code2,
                    :code3,
                    :code4,
                    :code5,
                    :code6,
                    :code7,
                    :code8,
                    :code9,
                    :code10,
                    :code11,
                    :code12,
                    :code13,
                    :code14,
                    :code15,
                    :code16,
                    :code17,
                    :code18,
                    :code19,
                    :code20,

                    :number1,
                    :number2,
                    :number3,
                    :number4,

                    :date1,
                    :date2,
                    :date3,
                    :date4,

                    V_SQL

                );

                :out_sql := V_SQL;

            END;
            `,
            binds
        );

        const dynamicSql = (sqlResult.outBinds as any).out_sql;

        const data = await connection.execute(
            dynamicSql,
            [],
            {
                outFormat: oracledb.OUT_FORMAT_OBJECT
            }
        );

        const rows = data.rows as any[];
        const buffer = buildJobListingWorkbook(rows);

        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="wms_joblisting_report.xlsx"`);
        res.end(buffer);
    } catch (err: any) {
        console.log(err);
        res.status(500).json({
            success: false,
            message: err.message
        });
    } finally {
        if (connection) {
            try {
                await connection.close();
            } catch { }
        }
    }
};

