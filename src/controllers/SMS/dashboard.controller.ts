import { Request, Response } from "express";
import { selectSmsDashboardView } from "../../services/smsTenant.service";

async function sendDashboardView(req: Request, res: Response, viewName: string) {
  try {
    const data = await selectSmsDashboardView(viewName, req.query.sales_name ? String(req.query.sales_name) : undefined);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export const getSalesPipelineSummary = (req: Request, res: Response) => sendDashboardView(req, res, "vw_sales_pipeline_summary");

export const getSalesPerformance = (req: Request, res: Response) => sendDashboardView(req, res, "vw_sales_performance");

export const getDealProbabilityAnalysis = (req: Request, res: Response) => sendDashboardView(req, res, "vw_deal_probability_analysis");

export const getMonthlyPipelineForecast = (req: Request, res: Response) => sendDashboardView(req, res, "vw_monthly_pipeline_forecast");

export const getNextActionsOverview = (req: Request, res: Response) => sendDashboardView(req, res, "vw_next_actions_overview");

export const getSegmentPerformance = (req: Request, res: Response) => sendDashboardView(req, res, "vw_segment_performance");
