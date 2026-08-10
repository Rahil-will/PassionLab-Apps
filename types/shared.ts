export type RoutePath =
  | "#/dashboard"
  | "#/create-order"
  | "#/style-details/:id"
  | "#/style-color-details/:id/:colorId"
  | "#/line-assignment"
  | "#/planning-detail"
  | "#/dept-schedule"
  | "#/status-tracker"
  | "#/floor-day"
  | "#/admin"
  | "#/settings"
  | "#/work-centers"
  | "#/work-centers/departments"
  | "#/work-centers/buyers"
  | "#/work-centers/process-flows"
  | "#/user-management"
  | "#/reports"
  | "#/reports/day"
  | "#/reports/style"
  | "#/reports/department"
  | "#/production/order-completion"
  | "#/planning/transaction-report";

export const RoutePath = {
  DASHBOARD: "#/dashboard",
  CREATE_ORDER: "#/create-order",
  STYLE_DETAILS: "#/style-details/:id",
  STYLE_COLOR_DETAILS: "#/style-color-details/:id/:colorId",
  LINE_ASSIGNMENT: "#/line-assignment",
  PLANNING_DETAIL: "#/planning-detail",
  DEPT_SCHEDULE: "#/dept-schedule",
  STATUS_TRACKER: "#/status-tracker",
  FLOOR_DAY: "#/floor-day",
  ADMIN: "#/admin",
  SETTINGS: "#/settings",
  WORK_CENTERS: "#/work-centers",
  WORK_CENTER_DEPARTMENTS: "#/work-centers/departments",
  WORK_CENTER_BUYERS: "#/work-centers/buyers",
  WORK_CENTER_PROCESS_FLOWS: "#/work-centers/process-flows",
  USER_MANAGEMENT: "#/user-management",
  REPORTS: "#/reports",
  REPORTS_DAY: "#/reports/day",
  REPORTS_STYLE: "#/reports/style",
  REPORTS_DEPARTMENT: "#/reports/department",
  ORDER_COMPLETION: "#/production/order-completion",
  TRANSACTION_REPORT: "#/planning/transaction-report",
} as const;

export type Department =
  | "Cutting"
  | "Sewing"
  | "Washing"
  | "Finishing"
  | "Packing";
