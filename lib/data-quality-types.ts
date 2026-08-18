export type DataQualityCheck = {
  id:
    | "normalized_coverage"
    | "line_total_mismatch"
    | "duplicate_orders"
    | "duplicate_lines"
    | "missing_business_date"
    | "pending_operations"
    | "payment_mismatch"
    | "zero_sales_sessions";
  label: string;
  detail: string;
  count: number;
  severity: "ok" | "warning" | "error";
  repairable?: boolean;
};

export type DataQualityReport = {
  status: "healthy" | "attention";
  businessDate: string | null;
  checkedAt: string;
  summary: {
    salesOrders: number;
    normalizedOrders: number;
    coveragePercent: number;
    issueCount: number;
    repairableOrders: number;
    legacySummaryOrders: number;
  };
  checks: DataQualityCheck[];
};
