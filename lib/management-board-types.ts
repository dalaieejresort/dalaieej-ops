export type ManagementBoardSectionName =
  | "day"
  | "sales"
  | "inventory"
  | "operations"
  | "quality";

export type ManagementBoardResponse = {
  initialized: boolean;
  sections: Partial<Record<ManagementBoardSectionName, unknown>>;
  sectionUpdatedAt: Partial<Record<ManagementBoardSectionName, string>>;
  updatedAt: string | null;
  checkedAt: string;
};
