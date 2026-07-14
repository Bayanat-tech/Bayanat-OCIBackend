type SuggestionInput = {
  subject?: string;
  message?: string;
  module?: string;
};

type SupportRule = {
  category: string;
  priority: "LOW" | "NORMAL" | "MEDIUM" | "HIGH" | "CRITICAL";
  developerGroup: string;
  suggestedReply: string;
  keywords: string[];
  slaMinutes: number;
};

const SUPPORT_RULES: SupportRule[] = [
  {
    category: "Login and access",
    priority: "HIGH",
    developerGroup: "Security",
    keywords: ["login", "password", "access", "permission", "unauthorized", "token", "session", "otp"],
    slaMinutes: 240,
    suggestedReply: "We are checking your access issue now. Please share the login ID and the exact screen where the issue appears.",
  },
  {
    category: "Application error",
    priority: "HIGH",
    developerGroup: "Application Support",
    keywords: ["error", "failed", "exception", "not working", "crash", "blank", "500", "400", "ora-", "sql"],
    slaMinutes: 240,
    suggestedReply: "We are checking this error now. Please keep the screen open and share the screenshot or exact error message if available.",
  },
  {
    category: "Finance document",
    priority: "MEDIUM",
    developerGroup: "Finance",
    keywords: ["invoice", "payment", "purchase", "voucher", "receipt", "account", "finance", "document", "attachment"],
    slaMinutes: 480,
    suggestedReply: "We are checking the finance document flow. Please confirm the document number and attach a screenshot if the issue repeats.",
  },
  {
    category: "WMS operation",
    priority: "MEDIUM",
    developerGroup: "WMS",
    keywords: ["wms", "warehouse", "inventory", "stock", "barcode", "inbound", "outbound", "pick", "dispatch"],
    slaMinutes: 480,
    suggestedReply: "We are checking the WMS transaction. Please share the warehouse, item code, and document number.",
  },
  {
    category: "Performance",
    priority: "MEDIUM",
    developerGroup: "Platform",
    keywords: ["slow", "loading", "timeout", "hang", "performance", "delay"],
    slaMinutes: 360,
    suggestedReply: "We are checking the performance issue. Please confirm which screen is slow and the approximate time it takes to load.",
  },
  {
    category: "Report or export",
    priority: "NORMAL",
    developerGroup: "Reports",
    keywords: ["report", "export", "excel", "pdf", "print", "download"],
    slaMinutes: 720,
    suggestedReply: "We are checking the report/export issue. Please share the report name and filter values used.",
  },
];

const MODULE_GROUP_HINTS: Record<string, string> = {
  WMS: "WMS",
  FINANCE: "Finance",
  FMS: "Finance",
  VMS: "Vendor",
  SECURITY: "Security",
  "BT-SUPPORT": "Application Support",
};

export class SupportAssistantService {
  static suggest(input: SuggestionInput) {
    const subject = cleanText(input.subject);
    const message = cleanText(input.message);
    const moduleName = cleanText(input.module).toUpperCase();
    const text = `${subject} ${message} ${moduleName}`.toLowerCase();
    const scored = SUPPORT_RULES.map((rule) => {
      const matchedKeywords = rule.keywords.filter((keyword) => text.includes(keyword.toLowerCase()));
      const moduleBoost = MODULE_GROUP_HINTS[moduleName] === rule.developerGroup ? 2 : 0;
      return {
        rule,
        score: matchedKeywords.length + moduleBoost,
        matchedKeywords,
      };
    }).sort((first, second) => second.score - first.score);

    const best = scored[0]?.score > 0 ? scored[0] : null;
    const fallbackGroup = MODULE_GROUP_HINTS[moduleName] || "Application Support";
    const rule = best?.rule || {
      category: "General support",
      priority: "NORMAL" as const,
      developerGroup: fallbackGroup,
      keywords: [],
      slaMinutes: 720,
      suggestedReply: "We have received your request and the support team is checking it now.",
    };

    const confidence = best ? Math.min(95, 45 + best.score * 15) : 35;
    return {
      category: rule.category,
      priority: rule.priority,
      developerGroup: rule.developerGroup,
      slaMinutes: rule.slaMinutes,
      confidence,
      matchedKeywords: best?.matchedKeywords || [],
      suggestedReply: rule.suggestedReply,
      quickReplies: [
        rule.suggestedReply,
        "Please share a screenshot so we can verify faster.",
        "Thank you. We will update you shortly.",
      ],
      source: "RULE_BASED_PHASE_1",
      cost: "FREE",
    };
  }
}

function cleanText(value: unknown) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}
