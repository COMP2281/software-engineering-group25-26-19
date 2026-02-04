export type ScrapeStatus = "idle" | "running" | "failed" | "success";

export type DashboardSummary = {
  totalCourses: number;
  universitiesCovered: number;
  lastSuccessfulScrapeAt: string | null;
  status: ScrapeStatus;
  issuesCount: number;
};

export type HistogramBin = {
  range: string;
  count: number;
};

export type FeeHistogram = {
  feeType: "home" | "international";
  bins: HistogramBin[];
};

export type FeeHistogramResponse = {
  home: FeeHistogram;
  international: FeeHistogram;
};

