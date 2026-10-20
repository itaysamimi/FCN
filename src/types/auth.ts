export type CurrentUser = {
  id: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
};

export type FamilyMember = {
  id: string;
  displayName: string;
  email: string;
  isAdmin: boolean;
  status: "pending" | "active";
};
