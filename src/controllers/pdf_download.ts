// reportPdf.controller.js
import puppeteer from "puppeteer";

/** One shared browser; a new page per request keeps it fast */
let browserPromise : any = null;

const getBrowser = () => {
  if (!browserPromise) {
    browserPromise = puppeteer
      .launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      })
      .catch((e) => {
        browserPromise = null;
        throw e;
      });
  }
  return browserPromise;
};

const resetBrowser = () => {
  browserPromise = null;
};

/**
 * POST body: { html: string, orientation?: "portrait"|"landscape", marginMm?: number }
 * Responds with application/pdf
 */
export async function generateReportPdf(req : any, res : any) {
  const { html, orientation = "portrait", marginMm = 5 } = req.body || {};

  if (typeof html !== "string" || !html.trim()) {
    return res.status(400).json({ error: "html is required" });
  }

  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();

    // Report HTML comes from the client — never run scripts on the server
    await page.setJavaScriptEnabled(false);
    await page.emulateMediaType("print");

    await page.setContent(html, { waitUntil: "networkidle0", timeout: 60000 });
    await page.evaluateHandle("document.fonts && document.fonts.ready");

    const pdf = await page.pdf({
      preferCSSPageSize: true, // uses @page from the injected HTML
      format: "A4",
      landscape: orientation === "landscape",
      margin: {
        top: `${marginMm}mm`,
        right: `${marginMm}mm`,
        bottom: `${marginMm}mm`,
        left: `${marginMm}mm`,
      },
      printBackground: true,
      displayHeaderFooter: false,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", pdf.length);
    res.send(Buffer.from(pdf));
  } catch (err) {
    console.error("report-pdf failed:", err);
    if (/Target closed|Protocol error|Session closed|browser has disconnected/i.test(String(err))) {
      resetBrowser();
    }
    res.status(500).json({ error: "PDF generation failed" });
  } finally {
    await page?.close().catch(() => {});
  }
}