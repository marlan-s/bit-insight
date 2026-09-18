export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      datasets: {
        Row: {
          created_at: string
          detected_fields: Json
          field_mapping: Json
          id: string
          ingest_errors: Json
          invalid_count: number
          name: string
          record_count: number
          source_format: string
          status: string
          valid_count: number
        }
        Insert: {
          created_at?: string
          detected_fields?: Json
          field_mapping?: Json
          id?: string
          ingest_errors?: Json
          invalid_count?: number
          name: string
          record_count?: number
          source_format: string
          status?: string
          valid_count?: number
        }
        Update: {
          created_at?: string
          detected_fields?: Json
          field_mapping?: Json
          id?: string
          ingest_errors?: Json
          invalid_count?: number
          name?: string
          record_count?: number
          source_format?: string
          status?: string
          valid_count?: number
        }
        Relationships: []
      }
      entities: {
        Row: {
          anomaly_score: number
          dataset_id: string
          entity_id: string
          entity_type: string
          explanation: Json
          features: Json
          id: number
          ip_count: number
          last_seen: string | null
          primary_reason: string | null
          risk_score: number
          scenario: string | null
          tx_count: number
        }
        Insert: {
          anomaly_score?: number
          dataset_id: string
          entity_id: string
          entity_type: string
          explanation?: Json
          features?: Json
          id?: number
          ip_count?: number
          last_seen?: string | null
          primary_reason?: string | null
          risk_score?: number
          scenario?: string | null
          tx_count?: number
        }
        Update: {
          anomaly_score?: number
          dataset_id?: string
          entity_id?: string
          entity_type?: string
          explanation?: Json
          features?: Json
          id?: number
          ip_count?: number
          last_seen?: string | null
          primary_reason?: string | null
          risk_score?: number
          scenario?: string | null
          tx_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "entities_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "datasets"
            referencedColumns: ["id"]
          },
        ]
      }
      model_runs: {
        Row: {
          created_at: string
          dataset_id: string
          id: string
          metrics: Json
          model_type: string
          params: Json
          summary: Json
        }
        Insert: {
          created_at?: string
          dataset_id: string
          id?: string
          metrics?: Json
          model_type: string
          params?: Json
          summary?: Json
        }
        Update: {
          created_at?: string
          dataset_id?: string
          id?: string
          metrics?: Json
          model_type?: string
          params?: Json
          summary?: Json
        }
        Relationships: [
          {
            foreignKeyName: "model_runs_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "datasets"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          dataset_id: string
          destination_ip: string | null
          destination_port: number | null
          fee: number | null
          id: number
          input_amount: number | null
          input_wallet: string | null
          output_amount: number | null
          output_wallet: string | null
          scenario: string | null
          script_type: string | null
          source_ip: string | null
          source_port: number | null
          ts: string | null
          txid: string
        }
        Insert: {
          dataset_id: string
          destination_ip?: string | null
          destination_port?: number | null
          fee?: number | null
          id?: number
          input_amount?: number | null
          input_wallet?: string | null
          output_amount?: number | null
          output_wallet?: string | null
          scenario?: string | null
          script_type?: string | null
          source_ip?: string | null
          source_port?: number | null
          ts?: string | null
          txid: string
        }
        Update: {
          dataset_id?: string
          destination_ip?: string | null
          destination_port?: number | null
          fee?: number | null
          id?: number
          input_amount?: number | null
          input_wallet?: string | null
          output_amount?: number | null
          output_wallet?: string | null
          scenario?: string | null
          script_type?: string | null
          source_ip?: string | null
          source_port?: number | null
          ts?: string | null
          txid?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "datasets"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
