import type { Enums, Tables } from "./database.types";

export type BusinessType = Enums<"business_type">;
export type TaskStatus = Enums<"task_status">;
export type TaskPriority = Enums<"task_priority">;
export type UserRole = Enums<"user_role">;
export type NotificationType = Enums<"notification_type">;
export type InvitationStatus = Enums<"invitation_status">;
export type ConversationKind = Enums<"conversation_kind">;

export type BootstrapOrgResult = {
  org_id: string;
  created: boolean;
};

export type AcceptInvitationResult = {
  org_id: string;
  role: UserRole;
  created: boolean;
};

export type PreviewInvitationResult = {
  email: string;
  role: UserRole;
  org_name: string;
  status: InvitationStatus;
  expires_at: string;
};

export type Organization = Tables<"organizations">;
export type Profile = Tables<"profiles">;
export type Client = Tables<"clients">;
export type ClientContact = Tables<"client_contacts">;
export type Task = Tables<"tasks">;
export type Message = Tables<"messages">;
export type Conversation = Tables<"conversations">;
export type ConversationParticipant = Tables<"conversation_participants">;
export type Notification = Tables<"notifications">;
export type Invitation = Tables<"invitations">;
export type OrganizationMembership = Tables<"organization_memberships">;
