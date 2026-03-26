export const roles = ["owner", "admin", "hr", "hr_mason", "hr_huntme", "agent"] as const;
export type Role = (typeof roles)[number];

export const hrTeams = ["mason", "huntme"] as const;
export type HrTeam = (typeof hrTeams)[number];

export const accessRequestStatuses = ["none", "pending", "approved", "rejected"] as const;
export type AccessRequestStatus = (typeof accessRequestStatuses)[number];

export const moderationStatuses = ["pending", "approved", "rejected"] as const;
export type ModerationStatus = (typeof moderationStatuses)[number];

export const workflowStatuses = [
  "на рассмотрении",
  "назначено собеседование",
  "не пришел(ла)",
  "отказано",
  "регистрация"
] as const;
export type WorkflowStatus = (typeof workflowStatuses)[number];

export const formTypes = ["operator", "model"] as const;
export type FormType = (typeof formTypes)[number];

export const squads = ["dan", "aroirken", "liamkizz"] as const;
export type Squad = (typeof squads)[number];

export type FormFieldKey =
  | "candidateName"
  | "age"
  | "city"
  | "phone"
  | "phoneNumber"
  | "interviewDate"
  | "experience"
  | "availability"
  | "contentType"
  | "comment";

export type FormDraft = Record<FormFieldKey, string>;

export interface UserRecord {
  telegramId: number;
  username: string | null;
  firstName: string;
  lastName: string | null;
  roles: Role[];
  squad: Squad | null;
  isActive: boolean;
  accessRequestStatus: AccessRequestStatus;
  accessRequestedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FormRecord {
  id: number;
  formType: FormType;
  agentTelegramId: number;
  agentUsername: string | null;
  hrTeam: HrTeam | null;
  squad: Squad | null;
  photoFileId: string | null;
  candidateName: string;
  age: string;
  city: string;
  phone: string;
  phoneNumber: string;
  experience: string;
  availability: string;
  contentType: string;
  comment: string;
  moderationStatus: ModerationStatus;
  workflowStatus: WorkflowStatus;
  interviewDate: string | null;
  rejectionReason: string | null;
  approvedAt: string | null;
  reviewedBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileStats {
  total: number;
  pendingModeration: number;
  approved: number;
  rejected: number;
  workflow: Record<WorkflowStatus, number>;
}

export interface BotStats {
  total: number;
  operator: number;
  model: number;
  approved: number;
  rejected: number;
  pending: number;
  registration: number;
  inReview: number;
  interviewAssigned: number;
  declined: number;
  topAgents: Array<{
    telegramId: number;
    label: string;
    count: number;
  }>;
}

export interface BotChartPoint {
  label: string;
  created: number;
  approved: number;
  registration: number;
}
