// Hand-written types matching supabase/migrations/0001_initial_schema.sql.
// Future: regenerate via `supabase gen types typescript` once the CLI is wired up.
//
// This file is the canonical source of DB row shapes. UI code should NOT import
// from here directly — it should consume DTOs returned by the server's services.
// Server-side repositories and services are the legitimate consumers.
//
// IMPORTANT: every Table entry must include `Relationships: []` (even an empty
// tuple) and the top-level schema must include `Views`, `Functions`,
// `CompositeTypes`. Otherwise supabase-js falls back to `any` and rpc/select
// inference silently degrades to `never`.

export type BusinessType =
  | "patur"
  | "murshe"
  | "ltd"
  | "amuta"
  | "agudat_shitufit";

export type TaskStatus = "new" | "received" | "in_progress" | "done";

export type TaskPriority = "urgent" | "normal" | "optional";

export type UserRole = "owner" | "admin" | "employee";

export type NotificationType =
  | "task_assigned"
  | "task_status_changed"
  | "task_due_soon"
  | "task_overdue";

// Return shape of the public.bootstrap_org RPC.
export type BootstrapOrgResult = {
  org_id: string;
  created: boolean;
};

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          org_code: string;
          name: string;
          phone: string | null;
          email: string | null;
          address: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_code: string;
          name: string;
          phone?: string | null;
          email?: string | null;
          address?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["organizations"]["Insert"]>;
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          org_id: string;
          role: UserRole;
          full_name: string;
          email: string;
          avatar_url: string | null;
          phone: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          org_id: string;
          role?: UserRole;
          full_name: string;
          email: string;
          avatar_url?: string | null;
          phone?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "profiles_org_id_fkey";
            columns: ["org_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      clients: {
        Row: {
          id: string;
          org_id: string;
          name: string;
          business_type: BusinessType | null;
          tax_id: string | null;
          email: string | null;
          phone: string | null;
          address: string | null;
          notes: string | null;
          is_active: boolean;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          name: string;
          business_type?: BusinessType | null;
          tax_id?: string | null;
          email?: string | null;
          phone?: string | null;
          address?: string | null;
          notes?: string | null;
          is_active?: boolean;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["clients"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "clients_org_id_fkey";
            columns: ["org_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "clients_created_by_fkey";
            columns: ["created_by"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      client_contacts: {
        Row: {
          id: string;
          client_id: string;
          name: string;
          role: string | null;
          phone: string | null;
          email: string | null;
          is_primary: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          name: string;
          role?: string | null;
          phone?: string | null;
          email?: string | null;
          is_primary?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["client_contacts"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "client_contacts_client_id_fkey";
            columns: ["client_id"];
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
        ];
      };
      tasks: {
        Row: {
          id: string;
          org_id: string;
          title: string;
          description: string | null;
          due_at: string;
          status: TaskStatus;
          priority: TaskPriority;
          creator_id: string;
          assigned_to: string | null;
          client_id: string | null;
          completed_at: string | null;
          archived_at: string | null;
          deleted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          title: string;
          description?: string | null;
          due_at: string;
          status?: TaskStatus;
          priority?: TaskPriority;
          creator_id: string;
          assigned_to?: string | null;
          client_id?: string | null;
          completed_at?: string | null;
          archived_at?: string | null;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["tasks"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "tasks_org_id_fkey";
            columns: ["org_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_creator_id_fkey";
            columns: ["creator_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_assigned_to_fkey";
            columns: ["assigned_to"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_client_id_fkey";
            columns: ["client_id"];
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          task_id: string | null;
          type: NotificationType;
          title: string;
          body: string | null;
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          task_id?: string | null;
          type: NotificationType;
          title: string;
          body?: string | null;
          read_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["notifications"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_task_id_fkey";
            columns: ["task_id"];
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Enums: {
      business_type: BusinessType;
      task_status: TaskStatus;
      task_priority: TaskPriority;
      user_role: UserRole;
      notification_type: NotificationType;
    };
    Functions: {
      bootstrap_org: {
        Args: {
          p_org_name: string;
          p_org_code: string;
          p_full_name: string;
        };
        Returns: BootstrapOrgResult;
      };
    };
    CompositeTypes: { [_ in never]: never };
  };
}

// Convenience aliases used by server-side code.
export type Organization = Database["public"]["Tables"]["organizations"]["Row"];
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Client = Database["public"]["Tables"]["clients"]["Row"];
export type ClientContact = Database["public"]["Tables"]["client_contacts"]["Row"];
export type Task = Database["public"]["Tables"]["tasks"]["Row"];
export type Notification = Database["public"]["Tables"]["notifications"]["Row"];
