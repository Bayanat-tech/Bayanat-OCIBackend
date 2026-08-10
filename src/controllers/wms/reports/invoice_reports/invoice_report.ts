import { Request, Response } from "express";
import oracledb from "oracledb";
import { getConn } from "../../../../res/oracleDbConnect";
import { execDynamicProc, normalize, ReportRow } from "../../../../res/helperFunction";


const report = {
    'AMKSA' : {
        parameter: 'INVOICE_AMKSA',
    }
}

const invoice_report = async (
    req: Request,
    res: Response
): Promise<void> => {
    const { prin_code, invoice_no, company_code } : { prin_code?: string; invoice_no?: string; company_code?: string } = req.query;

    const conn   = await getConn(req);
    console.log("Request Query Parameters:", { prin_code, invoice_no, company_code });
    const result = await execDynamicProc(
        conn,
        "PROC_BUILD_DYNAMIC_INVOICE",
        {
            parameter: report[company_code as keyof typeof report]?.parameter || '',
            code1: company_code || '',
            code2: prin_code || '',
        }
    );

    console.log("Dynamic SQL Result:", result);


    res.status(200).json({
        message: "Invoice report endpoint is working!!!!",
        success: true,
        result : result
    });
};

export default invoice_report;