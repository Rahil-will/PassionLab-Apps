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
      app_configuration: {
        Row: {
          allowed_apps: Json
          created_at: string
          factory_id: string
          id: string
          step_type: string
          updated_at: string
        }
        Insert: {
          allowed_apps?: Json
          created_at?: string
          factory_id: string
          id?: string
          step_type: string
          updated_at?: string
        }
        Update: {
          allowed_apps?: Json
          created_at?: string
          factory_id?: string
          id?: string
          step_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_configuration_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
        ]
      }
      assigned_resources: {
        Row: {
          capacity: number
          created_at: string
          department_id: string | null
          description: string | null
          factory_id: string
          id: string
          resource_name: string
          resource_type: string
          status: string
          updated_at: string
        }
        Insert: {
          capacity?: number
          created_at?: string
          department_id?: string | null
          description?: string | null
          factory_id: string
          id?: string
          resource_name: string
          resource_type?: string
          status?: string
          updated_at?: string
        }
        Update: {
          capacity?: number
          created_at?: string
          department_id?: string | null
          description?: string | null
          factory_id?: string
          id?: string
          resource_name?: string
          resource_type?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assigned_resources_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assigned_resources_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          factory_id: string
          id: string
          metadata: Json
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          factory_id: string
          id?: string
          metadata?: Json
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          factory_id?: string
          id?: string
          metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_sessions: {
        Row: {
          aql_level: string | null
          colorway_id: string | null
          completed_at: string | null
          department_id: string
          factory_id: string
          failed: number
          id: string
          line_allocation_id: string | null
          logged_at: string
          logged_by: string | null
          lot_size: number
          major_failed: number
          minor_failed: number
          order_id: string
          order_route_id: string
          passed: number
          pieces_json: Json
          resource_id: string | null
          result: string | null
          sample_size: number
          shift_id: string | null
          status: string
        }
        Insert: {
          aql_level?: string | null
          colorway_id?: string | null
          completed_at?: string | null
          department_id: string
          factory_id: string
          failed?: number
          id?: string
          line_allocation_id?: string | null
          logged_at?: string
          logged_by?: string | null
          lot_size?: number
          major_failed?: number
          minor_failed?: number
          order_id: string
          order_route_id: string
          passed?: number
          pieces_json?: Json
          resource_id?: string | null
          result?: string | null
          sample_size?: number
          shift_id?: string | null
          status?: string
        }
        Update: {
          aql_level?: string | null
          colorway_id?: string | null
          completed_at?: string | null
          department_id?: string
          factory_id?: string
          failed?: number
          id?: string
          line_allocation_id?: string | null
          logged_at?: string
          logged_by?: string | null
          lot_size?: number
          major_failed?: number
          minor_failed?: number
          order_id?: string
          order_route_id?: string
          passed?: number
          pieces_json?: Json
          resource_id?: string | null
          result?: string | null
          sample_size?: number
          shift_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_sessions_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_sessions_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_sessions_line_allocation_id_fkey"
            columns: ["line_allocation_id"]
            isOneToOne: false
            referencedRelation: "line_allocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_sessions_logged_by_fkey"
            columns: ["logged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_sessions_order_route_id_fkey"
            columns: ["order_route_id"]
            isOneToOne: false
            referencedRelation: "order_routing_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_sessions_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "assigned_resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_sessions_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_sessions_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "v_shift_minutes"
            referencedColumns: ["shift_id"]
          },
        ]
      }
      batch_production: {
        Row: {
          activity_no: string | null
          available_mins: number | null
          colorway_id: string | null
          comment: string | null
          created_at: string
          department_id: string
          duration_mins: number | null
          efficiency_pct: number | null
          end_time: string
          factory_id: string
          headcount_by_category: Json
          id: string
          line_allocation_id: string | null
          log_date: string
          logged_at: string
          logged_by: string | null
          order_id: string
          order_route_id: string
          produced_by_size: Json
          produced_mins: number | null
          produced_qty: number
          ref_no: string | null
          resource_id: string | null
          sam: number | null
          shift_id: string | null
          start_time: string
          updated_at: string
          worker_count: number | null
        }
        Insert: {
          activity_no?: string | null
          available_mins?: number | null
          colorway_id?: string | null
          comment?: string | null
          created_at?: string
          department_id: string
          duration_mins?: number | null
          efficiency_pct?: number | null
          end_time: string
          factory_id: string
          headcount_by_category?: Json
          id?: string
          line_allocation_id?: string | null
          log_date?: string
          logged_at?: string
          logged_by?: string | null
          order_id: string
          order_route_id: string
          produced_by_size?: Json
          produced_mins?: number | null
          produced_qty?: number
          ref_no?: string | null
          resource_id?: string | null
          sam?: number | null
          shift_id?: string | null
          start_time: string
          updated_at?: string
          worker_count?: number | null
        }
        Update: {
          activity_no?: string | null
          available_mins?: number | null
          colorway_id?: string | null
          comment?: string | null
          created_at?: string
          department_id?: string
          duration_mins?: number | null
          efficiency_pct?: number | null
          end_time?: string
          factory_id?: string
          headcount_by_category?: Json
          id?: string
          line_allocation_id?: string | null
          log_date?: string
          logged_at?: string
          logged_by?: string | null
          order_id?: string
          order_route_id?: string
          produced_by_size?: Json
          produced_mins?: number | null
          produced_qty?: number
          ref_no?: string | null
          resource_id?: string | null
          sam?: number | null
          shift_id?: string | null
          start_time?: string
          updated_at?: string
          worker_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "batch_production_colorway_id_fkey"
            columns: ["colorway_id"]
            isOneToOne: false
            referencedRelation: "colorways"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_production_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_production_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_production_line_allocation_id_fkey"
            columns: ["line_allocation_id"]
            isOneToOne: false
            referencedRelation: "line_allocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_production_logged_by_fkey"
            columns: ["logged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_production_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "style_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_production_order_route_id_fkey"
            columns: ["order_route_id"]
            isOneToOne: false
            referencedRelation: "order_routing_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_production_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "assigned_resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_production_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_production_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "v_shift_minutes"
            referencedColumns: ["shift_id"]
          },
        ]
      }
      buyers: {
        Row: {
          code: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          contact_role: string | null
          country: string | null
          created_at: string
          currency: string | null
          destination: string | null
          destination_countries: string[]
          factory_id: string
          id: string
          name: string
          over_shipment_pct: number | null
          packing_rule: string | null
          ship_mode: string | null
          ship_mode_options: Json
          shipment_type_options: Json
          status: string | null
          type: string | null
          under_shipment_pct: number | null
          updated_at: string
        }
        Insert: {
          code?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          contact_role?: string | null
          country?: string | null
          created_at?: string
          currency?: string | null
          destination?: string | null
          destination_countries?: string[]
          factory_id: string
          id?: string
          name: string
          over_shipment_pct?: number | null
          packing_rule?: string | null
          ship_mode?: string | null
          ship_mode_options?: Json
          shipment_type_options?: Json
          status?: string | null
          type?: string | null
          under_shipment_pct?: number | null
          updated_at?: string
        }
        Update: {
          code?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          contact_role?: string | null
          country?: string | null
          created_at?: string
          currency?: string | null
          destination?: string | null
          destination_countries?: string[]
          factory_id?: string
          id?: string
          name?: string
          over_shipment_pct?: number | null
          packing_rule?: string | null
          ship_mode?: string | null
          ship_mode_options?: Json
          shipment_type_options?: Json
          status?: string | null
          type?: string | null
          under_shipment_pct?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "buyers_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
        ]
      }
      colorway_materials: {
        Row: {
          category: string
          colorway_id: string
          cons_overridden: boolean
          cons_per_pc: number | null
          created_at: string
          extras: Json
          fabric_color: string | null
          fabric_color_ref: string | null
          fabric_id: string | null
          factory_id: string
          id: string
          kind: string
          line_key: string | null
          mill_short_closed: boolean
          mill_short_closed_at: string | null
          mill_short_closed_by: string | null
          mill_short_closed_reason: string | null
          name: string
          order_id: string
          placement: string
          process_loss_pct: number | null
          seq: number
          total_cons: number | null
          type: string
          unit: string
          updated_at: string
          wastage_pct: number | null
        }
        Insert: {
          category: string
          colorway_id: string
          cons_overridden?: boolean
          cons_per_pc?: number | null
          created_at?: string
          extras?: Json
          fabric_color?: string | null
          fabric_color_ref?: string | null
          fabric_id?: string | null
          factory_id: string
          id?: string
          kind?: string
          line_key?: string | null
          mill_short_closed?: boolean
          mill_short_closed_at?: string | null
          mill_short_closed_by?: string | null
          mill_short_closed_reason?: string | null
          name?: string
          order_id: string
          placement?: string
          process_loss_pct?: number | null
          seq?: number
          total_cons?: number | null
          type?: string
          unit?: string
          updated_at?: string
          wastage_pct?: number | null
        }
        Update: {
          category?: string
          colorway_id?: string
          cons_overridden?: boolean
          cons_per_pc?: number | null
          created_at?: string
          extras?: Json
          fabric_color?: string | null
          fabric_color_ref?: string | null
          fabric_id?: string | null
          factory_id?: string
          id?: string
          kind?: string
          line_key?: string | null
          mill_short_closed?: boolean
          mill_short_closed_at?: string | null
          mill_short_closed_by?: string | null
          mill_short_closed_reason?: string | null
          name?: string
          order_id?: string
          placement?: string
          process_loss_pct?: number | null
          seq?: number
          total_cons?: number | null
          type?: string
          unit?: string
          updated_at?: string
          wastage_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "colorway_materials_colorway_id_fkey"
            columns: ["colorway_id"]
            isOneToOne: false
            referencedRelation: "colorways"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "colorway_materials_fabric_id_fkey"
            columns: ["fabric_id"]
            isOneToOne: false
            referencedRelation: "mm_fabrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "colorway_materials_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "colorway_materials_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "style_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      colorways: {
        Row: {
          adj_qty: number
          close_comment: string | null
          close_reason: string | null
          closed_at: string | null
          color_code: string | null
          completion_status: string
          created_at: string
          factory_id: string
          id: string
          name: string
          order_id: string
          planning_remarks: string | null
          qty: number
          ready_to_ship_at: string | null
          ready_to_ship_by: string | null
          reaudit_opened_at: string | null
          reaudit_opened_by: string | null
          reaudit_reason: string | null
          shipment_floor_status: string
          shipped_closed_at: string | null
          shipped_closed_by: string | null
          sizes: Json
          updated_at: string
        }
        Insert: {
          adj_qty?: number
          close_comment?: string | null
          close_reason?: string | null
          closed_at?: string | null
          color_code?: string | null
          completion_status?: string
          created_at?: string
          factory_id: string
          id?: string
          name?: string
          order_id: string
          planning_remarks?: string | null
          qty?: number
          ready_to_ship_at?: string | null
          ready_to_ship_by?: string | null
          reaudit_opened_at?: string | null
          reaudit_opened_by?: string | null
          reaudit_reason?: string | null
          shipment_floor_status?: string
          shipped_closed_at?: string | null
          shipped_closed_by?: string | null
          sizes?: Json
          updated_at?: string
        }
        Update: {
          adj_qty?: number
          close_comment?: string | null
          close_reason?: string | null
          closed_at?: string | null
          color_code?: string | null
          completion_status?: string
          created_at?: string
          factory_id?: string
          id?: string
          name?: string
          order_id?: string
          planning_remarks?: string | null
          qty?: number
          ready_to_ship_at?: string | null
          ready_to_ship_by?: string | null
          reaudit_opened_at?: string | null
          reaudit_opened_by?: string | null
          reaudit_reason?: string | null
          shipment_floor_status?: string
          shipped_closed_at?: string | null
          shipped_closed_by?: string | null
          sizes?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "colorways_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "colorways_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "style_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      control_panel_audit_logs: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          factory_id: string | null
          id: string
          metadata: Json | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          factory_id?: string | null
          id?: string
          metadata?: Json | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          factory_id?: string | null
          id?: string
          metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "control_panel_audit_logs_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
        ]
      }
      cutting_bundles: {
        Row: {
          bundle_no: string
          bundle_sequence: number
          colorway_id: string | null
          created_at: string
          created_by: string
          fabric_component_id: string | null
          fabric_type: string
          factory_id: string
          handover_slip_id: string | null
          id: string
          lay_id: string
          lay_no: number
          lot_id: string
          lot_no: string
          order_id: string
          piece_from: number
          piece_to: number
          qty: number
          session_id: string
          session_no: string
          size: string
          status: string
        }
        Insert: {
          bundle_no: string
          bundle_sequence: number
          colorway_id?: string | null
          created_at?: string
          created_by: string
          fabric_component_id?: string | null
          fabric_type: string
          factory_id: string
          handover_slip_id?: string | null
          id?: string
          lay_id: string
          lay_no: number
          lot_id: string
          lot_no: string
          order_id: string
          piece_from: number
          piece_to: number
          qty: number
          session_id: string
          session_no: string
          size: string
          status?: string
        }
        Update: {
          bundle_no?: string
          bundle_sequence?: number
          colorway_id?: string | null
          created_at?: string
          created_by?: string
          fabric_component_id?: string | null
          fabric_type?: string
          factory_id?: string
          handover_slip_id?: string | null
          id?: string
          lay_id?: string
          lay_no?: number
          lot_id?: string
          lot_no?: string
          order_id?: string
          piece_from?: number
          piece_to?: number
          qty?: number
          session_id?: string
          session_no?: string
          size?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "cutting_bundles_colorway_id_fkey"
            columns: ["colorway_id"]
            isOneToOne: false
            referencedRelation: "colorways"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cutting_bundles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cutting_bundles_fabric_component_id_fkey"
            columns: ["fabric_component_id"]
            isOneToOne: false
            referencedRelation: "fabric_components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cutting_bundles_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cutting_bundles_handover_slip_id_fkey"
            columns: ["handover_slip_id"]
            isOneToOne: false
            referencedRelation: "handover_slips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cutting_bundles_lay_id_fkey"
            columns: ["lay_id"]
            isOneToOne: false
            referencedRelation: "cutting_lays"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cutting_bundles_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "cutting_session_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cutting_bundles_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "style_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cutting_bundles_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "cutting_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      cutting_lays: {
        Row: {
          bundles_generated: boolean
          comments: string | null
          created_at: string
          cut_no: string | null
          end_time: string | null
          fabric_component_id: string | null
          fabric_consumption: number | null
          fabric_shade: string | null
          factory_id: string
          id: string
          lay_length: number | null
          lay_length_unit: string | null
          lay_no: number
          logged_by: string
          lot_id: string
          marker: string | null
          marker_length: number | null
          marker_no: string | null
          marker_width: number | null
          number_of_plies: number | null
          pattern_no: string | null
          ply_count: number | null
          qty_by_size: Json
          session_id: string
          start_time: string | null
          total_qty: number
        }
        Insert: {
          bundles_generated?: boolean
          comments?: string | null
          created_at?: string
          cut_no?: string | null
          end_time?: string | null
          fabric_component_id?: string | null
          fabric_consumption?: number | null
          fabric_shade?: string | null
          factory_id: string
          id?: string
          lay_length?: number | null
          lay_length_unit?: string | null
          lay_no: number
          logged_by: string
          lot_id: string
          marker?: string | null
          marker_length?: number | null
          marker_no?: string | null
          marker_width?: number | null
          number_of_plies?: number | null
          pattern_no?: string | null
          ply_count?: number | null
          qty_by_size?: Json
          session_id: string
          start_time?: string | null
          total_qty?: number
        }
        Update: {
          bundles_generated?: boolean
          comments?: string | null
          created_at?: string
          cut_no?: string | null
          end_time?: string | null
          fabric_component_id?: string | null
          fabric_consumption?: number | null
          fabric_shade?: string | null
          factory_id?: string
          id?: string
          lay_length?: number | null
          lay_length_unit?: string | null
          lay_no?: number
          logged_by?: string
          lot_id?: string
          marker?: string | null
          marker_length?: number | null
          marker_no?: string | null
          marker_width?: number | null
          number_of_plies?: number | null
          pattern_no?: string | null
          ply_count?: number | null
          qty_by_size?: Json
          session_id?: string
          start_time?: string | null
          total_qty?: number
        }
        Relationships: [
          {
            foreignKeyName: "cutting_lays_fabric_component_id_fkey"
            columns: ["fabric_component_id"]
            isOneToOne: false
            referencedRelation: "fabric_components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cutting_lays_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cutting_lays_logged_by_fkey"
            columns: ["logged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cutting_lays_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "cutting_session_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cutting_lays_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "cutting_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      cutting_session_lots: {
        Row: {
          created_at: string
          factory_id: string
          id: string
          lot_no: string
          lot_type: string | null
          session_id: string
          sort_order: number
          total_qty: number
        }
        Insert: {
          created_at?: string
          factory_id: string
          id?: string
          lot_no: string
          lot_type?: string | null
          session_id: string
          sort_order?: number
          total_qty?: number
        }
        Update: {
          created_at?: string
          factory_id?: string
          id?: string
          lot_no?: string
          lot_type?: string | null
          session_id?: string
          sort_order?: number
          total_qty?: number
        }
        Relationships: [
          {
            foreignKeyName: "cutting_session_lots_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cutting_session_lots_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "cutting_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      cutting_sessions: {
        Row: {
          available_mins: number | null
          colorway_id: string | null
          comments: string | null
          cumulative_cut_by_size: Json
          cut_end_time: string | null
          cut_start_time: string | null
          cutting_table: string | null
          department_id: string
          duration_mins: number | null
          efficiency_pct: number | null
          end_time: string
          fabric_component_id: string | null
          fabric_type: string
          factory_id: string
          flow_unlocked_through: number
          headcount_by_category: Json
          id: string
          line_allocation_id: string | null
          log_date: string
          logged_at: string
          logged_by: string
          order_id: string
          order_route_id: string | null
          produced_mins: number | null
          ref_no: string | null
          resource_id: string | null
          sam: number | null
          session_no: string
          shift_id: string | null
          size_ratio: Json
          start_time: string
          total_headcount: number
          total_qty: number
        }
        Insert: {
          available_mins?: number | null
          colorway_id?: string | null
          comments?: string | null
          cumulative_cut_by_size?: Json
          cut_end_time?: string | null
          cut_start_time?: string | null
          cutting_table?: string | null
          department_id: string
          duration_mins?: number | null
          efficiency_pct?: number | null
          end_time: string
          fabric_component_id?: string | null
          fabric_type?: string
          factory_id: string
          flow_unlocked_through?: number
          headcount_by_category?: Json
          id?: string
          line_allocation_id?: string | null
          log_date?: string
          logged_at?: string
          logged_by: string
          order_id: string
          order_route_id?: string | null
          produced_mins?: number | null
          ref_no?: string | null
          resource_id?: string | null
          sam?: number | null
          session_no: string
          shift_id?: string | null
          size_ratio?: Json
          start_time: string
          total_headcount?: number
          total_qty?: number
        }
        Update: {
          available_mins?: number | null
          colorway_id?: string | null
          comments?: string | null
          cumulative_cut_by_size?: Json
          cut_end_time?: string | null
          cut_start_time?: string | null
          cutting_table?: string | null
          department_id?: string
          duration_mins?: number | null
          efficiency_pct?: number | null
          end_time?: string
          fabric_component_id?: string | null
          fabric_type?: string
          factory_id?: string
          flow_unlocked_through?: number
          headcount_by_category?: Json
          id?: string
          line_allocation_id?: string | null
          log_date?: string
          logged_at?: string
          logged_by?: string
          order_id?: string
          order_route_id?: string | null
          produced_mins?: number | null
          ref_no?: string | null
          resource_id?: string | null
          sam?: number | null
          session_no?: string
          shift_id?: string | null
          size_ratio?: Json
          start_time?: string
          total_headcount?: number
          total_qty?: number
        }
        Relationships: [
          {
            foreignKeyName: "cutting_sessions_colorway_id_fkey"
            columns: ["colorway_id"]
            isOneToOne: false
            referencedRelation: "colorways"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cutting_sessions_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cutting_sessions_fabric_component_id_fkey"
            columns: ["fabric_component_id"]
            isOneToOne: false
            referencedRelation: "fabric_components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cutting_sessions_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cutting_sessions_line_allocation_id_fkey"
            columns: ["line_allocation_id"]
            isOneToOne: false
            referencedRelation: "line_allocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cutting_sessions_logged_by_fkey"
            columns: ["logged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cutting_sessions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "style_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cutting_sessions_order_route_id_fkey"
            columns: ["order_route_id"]
            isOneToOne: false
            referencedRelation: "order_routing_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cutting_sessions_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "assigned_resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cutting_sessions_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cutting_sessions_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "v_shift_minutes"
            referencedColumns: ["shift_id"]
          },
        ]
      }
      dashboard_configs: {
        Row: {
          access_token: string
          created_at: string
          created_by: string | null
          dashboard_type: string
          department_id: string | null
          factory_id: string
          id: string
          is_active: boolean
          name: string
          resource_id: string | null
          updated_at: string
        }
        Insert: {
          access_token?: string
          created_at?: string
          created_by?: string | null
          dashboard_type: string
          department_id?: string | null
          factory_id: string
          id?: string
          is_active?: boolean
          name: string
          resource_id?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string
          created_at?: string
          created_by?: string | null
          dashboard_type?: string
          department_id?: string | null
          factory_id?: string
          id?: string
          is_active?: boolean
          name?: string
          resource_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_configs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dashboard_configs_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dashboard_configs_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dashboard_configs_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "assigned_resources"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboard_links: {
        Row: {
          created_at: string
          description: string | null
          factory_id: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
          target_url: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          factory_id: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          target_url: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          factory_id?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          target_url?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_links_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
        ]
      }
      defects: {
        Row: {
          created_at: string
          defects: Json
          department_id: string | null
          factory_id: string
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          defects?: Json
          department_id?: string | null
          factory_id: string
          id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          defects?: Json
          department_id?: string | null
          factory_id?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "defects_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "defects_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
        ]
      }
      department_workforce_rates: {
        Row: {
          cost_per_hour: number
          created_at: string
          department_id: string
          effective_month: string
          factory_id: string
          id: string
          is_current: boolean
          label: string
          shift_id: string
          sort_order: number
          superseded_by: string | null
        }
        Insert: {
          cost_per_hour?: number
          created_at?: string
          department_id: string
          effective_month: string
          factory_id: string
          id?: string
          is_current?: boolean
          label: string
          shift_id: string
          sort_order?: number
          superseded_by?: string | null
        }
        Update: {
          cost_per_hour?: number
          created_at?: string
          department_id?: string
          effective_month?: string
          factory_id?: string
          id?: string
          is_current?: boolean
          label?: string
          shift_id?: string
          sort_order?: number
          superseded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "department_workforce_rates_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_workforce_rates_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_workforce_rates_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_workforce_rates_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "v_shift_minutes"
            referencedColumns: ["shift_id"]
          },
          {
            foreignKeyName: "department_workforce_rates_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "department_workforce_rates"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          created_at: string
          factory_id: string
          id: string
          is_native: boolean
          name: string
          planning_mode: string
          role: string
          sequence: number
          supervisor_enabled: boolean
          transaction_enabled: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          factory_id: string
          id?: string
          is_native?: boolean
          name: string
          planning_mode?: string
          role?: string
          sequence?: number
          supervisor_enabled?: boolean
          transaction_enabled?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          factory_id?: string
          id?: string
          is_native?: boolean
          name?: string
          planning_mode?: string
          role?: string
          sequence?: number
          supervisor_enabled?: boolean
          transaction_enabled?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "departments_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
        ]
      }
      doc_sequences: {
        Row: {
          doc_type: string
          factory_id: string
          last_no: number
          year: number
        }
        Insert: {
          doc_type: string
          factory_id: string
          last_no?: number
          year: number
        }
        Update: {
          doc_type?: string
          factory_id?: string
          last_no?: number
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "doc_sequences_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
        ]
      }
      fabric_components: {
        Row: {
          code: string
          created_at: string
          department_id: string
          fabric_type: string
          factory_id: string
          id: string
          is_active: boolean
          is_primary: boolean
          remarks: string | null
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          department_id: string
          fabric_type: string
          factory_id: string
          id?: string
          is_active?: boolean
          is_primary?: boolean
          remarks?: string | null
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          department_id?: string
          fabric_type?: string
          factory_id?: string
          id?: string
          is_active?: boolean
          is_primary?: boolean
          remarks?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fabric_components_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fabric_components_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
        ]
      }
      factories: {
        Row: {
          audit_apps: Json
          code: string
          country: string
          created_at: string
          default_shift_id: string | null
          id: string
          name: string
          production_apps: Json
          shipment_apps: Json
          timezone: string
          transaction_apps: Json
          type: string | null
          updated_at: string
          workforce_apps: Json
        }
        Insert: {
          audit_apps?: Json
          code: string
          country?: string
          created_at?: string
          default_shift_id?: string | null
          id?: string
          name: string
          production_apps?: Json
          shipment_apps?: Json
          timezone?: string
          transaction_apps?: Json
          type?: string | null
          updated_at?: string
          workforce_apps?: Json
        }
        Update: {
          audit_apps?: Json
          code?: string
          country?: string
          created_at?: string
          default_shift_id?: string | null
          id?: string
          name?: string
          production_apps?: Json
          shipment_apps?: Json
          timezone?: string
          transaction_apps?: Json
          type?: string | null
          updated_at?: string
          workforce_apps?: Json
        }
        Relationships: [
          {
            foreignKeyName: "factories_default_shift_id_fkey"
            columns: ["default_shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "factories_default_shift_id_fkey"
            columns: ["default_shift_id"]
            isOneToOne: false
            referencedRelation: "v_shift_minutes"
            referencedColumns: ["shift_id"]
          },
        ]
      }
      factory_modules: {
        Row: {
          config: Json
          created_at: string
          enabled: boolean
          enabled_at: string | null
          factory_id: string
          id: string
          module_key: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          enabled?: boolean
          enabled_at?: string | null
          factory_id: string
          id?: string
          module_key: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          enabled?: boolean
          enabled_at?: string | null
          factory_id?: string
          id?: string
          module_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "factory_modules_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
        ]
      }
      floor_login_attempts: {
        Row: {
          attempted_at: string
          email: string | null
          id: string
          profile_id: string | null
          success: boolean
        }
        Insert: {
          attempted_at?: string
          email?: string | null
          id?: string
          profile_id?: string | null
          success?: boolean
        }
        Update: {
          attempted_at?: string
          email?: string | null
          id?: string
          profile_id?: string | null
          success?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "floor_login_attempts_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      floor_user_access: {
        Row: {
          created_at: string
          department_id: string | null
          factory_id: string
          grant_ended_at: string | null
          id: string
          operation_id: string
          profile_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          department_id?: string | null
          factory_id: string
          grant_ended_at?: string | null
          id?: string
          operation_id: string
          profile_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          department_id?: string | null
          factory_id?: string
          grant_ended_at?: string | null
          id?: string
          operation_id?: string
          profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "floor_user_access_unified_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "floor_user_access_unified_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "floor_user_access_unified_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "floor_user_access_unified_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      handover_slips: {
        Row: {
          challan_number: string | null
          colorway_id: string | null
          factory_id: string
          from_department_id: string
          from_line_allocation_id: string | null
          from_visit_id: string | null
          handover_status: boolean | null
          id: string
          loss_closed_at: string | null
          loss_closed_by: string | null
          loss_rejection_id: string | null
          loss_remark: string | null
          notes: string | null
          order_id: string
          qty_by_size: Json
          received_at: string | null
          received_by: string | null
          received_notes: string | null
          received_qty: number | null
          received_qty_by_size: Json
          sent_at: string
          sent_by: string | null
          sent_qty: number
          status: string
          to_department_id: string
          to_visit_id: string | null
        }
        Insert: {
          challan_number?: string | null
          colorway_id?: string | null
          factory_id: string
          from_department_id: string
          from_line_allocation_id?: string | null
          from_visit_id?: string | null
          handover_status?: boolean | null
          id?: string
          loss_closed_at?: string | null
          loss_closed_by?: string | null
          loss_rejection_id?: string | null
          loss_remark?: string | null
          notes?: string | null
          order_id: string
          qty_by_size?: Json
          received_at?: string | null
          received_by?: string | null
          received_notes?: string | null
          received_qty?: number | null
          received_qty_by_size?: Json
          sent_at?: string
          sent_by?: string | null
          sent_qty?: number
          status?: string
          to_department_id: string
          to_visit_id?: string | null
        }
        Update: {
          challan_number?: string | null
          colorway_id?: string | null
          factory_id?: string
          from_department_id?: string
          from_line_allocation_id?: string | null
          from_visit_id?: string | null
          handover_status?: boolean | null
          id?: string
          loss_closed_at?: string | null
          loss_closed_by?: string | null
          loss_rejection_id?: string | null
          loss_remark?: string | null
          notes?: string | null
          order_id?: string
          qty_by_size?: Json
          received_at?: string | null
          received_by?: string | null
          received_notes?: string | null
          received_qty?: number | null
          received_qty_by_size?: Json
          sent_at?: string
          sent_by?: string | null
          sent_qty?: number
          status?: string
          to_department_id?: string
          to_visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "handover_slips_colorway_id_fkey"
            columns: ["colorway_id"]
            isOneToOne: false
            referencedRelation: "colorways"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handover_slips_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handover_slips_from_department_id_fkey"
            columns: ["from_department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handover_slips_from_line_allocation_id_fkey"
            columns: ["from_line_allocation_id"]
            isOneToOne: false
            referencedRelation: "line_allocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handover_slips_loss_closed_by_fkey"
            columns: ["loss_closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handover_slips_loss_rejection_id_fkey"
            columns: ["loss_rejection_id"]
            isOneToOne: false
            referencedRelation: "rejections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handover_slips_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "style_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handover_slips_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handover_slips_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handover_slips_to_department_id_fkey"
            columns: ["to_department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      hourly_counts: {
        Row: {
          colorway_id: string | null
          count: number
          count_by_size: Json
          department_id: string
          factory_id: string
          hour_slot: string
          id: string
          line_allocation_id: string | null
          log_date: string
          logged_at: string
          logged_by: string | null
          order_id: string
          order_route_id: string
          produced_mins: number | null
          resource_id: string | null
          sam: number | null
          shift_id: string | null
        }
        Insert: {
          colorway_id?: string | null
          count?: number
          count_by_size?: Json
          department_id: string
          factory_id: string
          hour_slot: string
          id?: string
          line_allocation_id?: string | null
          log_date?: string
          logged_at?: string
          logged_by?: string | null
          order_id: string
          order_route_id: string
          produced_mins?: number | null
          resource_id?: string | null
          sam?: number | null
          shift_id?: string | null
        }
        Update: {
          colorway_id?: string | null
          count?: number
          count_by_size?: Json
          department_id?: string
          factory_id?: string
          hour_slot?: string
          id?: string
          line_allocation_id?: string | null
          log_date?: string
          logged_at?: string
          logged_by?: string | null
          order_id?: string
          order_route_id?: string
          produced_mins?: number | null
          resource_id?: string | null
          sam?: number | null
          shift_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hourly_counts_colorway_id_fkey"
            columns: ["colorway_id"]
            isOneToOne: false
            referencedRelation: "colorways"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hourly_counts_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hourly_counts_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hourly_counts_line_allocation_id_fkey"
            columns: ["line_allocation_id"]
            isOneToOne: false
            referencedRelation: "line_allocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hourly_counts_logged_by_fkey"
            columns: ["logged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hourly_counts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "style_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hourly_counts_order_route_id_fkey"
            columns: ["order_route_id"]
            isOneToOne: false
            referencedRelation: "order_routing_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hourly_counts_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "assigned_resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hourly_counts_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hourly_counts_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "v_shift_minutes"
            referencedColumns: ["shift_id"]
          },
        ]
      }
      inspection_sessions: {
        Row: {
          colorway_id: string | null
          created_at: string
          defect_summary: Json
          defective_pct: number | null
          department_id: string
          dhu: number | null
          ended_at: string | null
          factory_id: string
          failed: number
          failed_by_size: Json
          first_time_pass: number
          first_time_pass_by_size: Json
          ftr_pct: number | null
          hour_slot: string
          id: string
          line_allocation_id: string | null
          log_date: string
          logged_at: string
          logged_by: string | null
          order_id: string
          order_route_id: string
          passed: number
          passed_by_size: Json
          produced_mins: number | null
          resource_id: string | null
          rework_by_size: Json
          rework_passed: number
          sam: number | null
          shift_id: string | null
          started_at: string
          total_inspected: number
          updated_at: string
        }
        Insert: {
          colorway_id?: string | null
          created_at?: string
          defect_summary?: Json
          defective_pct?: number | null
          department_id: string
          dhu?: number | null
          ended_at?: string | null
          factory_id: string
          failed?: number
          failed_by_size?: Json
          first_time_pass?: number
          first_time_pass_by_size?: Json
          ftr_pct?: number | null
          hour_slot: string
          id?: string
          line_allocation_id?: string | null
          log_date?: string
          logged_at?: string
          logged_by?: string | null
          order_id: string
          order_route_id: string
          passed?: number
          passed_by_size?: Json
          produced_mins?: number | null
          resource_id?: string | null
          rework_by_size?: Json
          rework_passed?: number
          sam?: number | null
          shift_id?: string | null
          started_at?: string
          total_inspected?: number
          updated_at?: string
        }
        Update: {
          colorway_id?: string | null
          created_at?: string
          defect_summary?: Json
          defective_pct?: number | null
          department_id?: string
          dhu?: number | null
          ended_at?: string | null
          factory_id?: string
          failed?: number
          failed_by_size?: Json
          first_time_pass?: number
          first_time_pass_by_size?: Json
          ftr_pct?: number | null
          hour_slot?: string
          id?: string
          line_allocation_id?: string | null
          log_date?: string
          logged_at?: string
          logged_by?: string | null
          order_id?: string
          order_route_id?: string
          passed?: number
          passed_by_size?: Json
          produced_mins?: number | null
          resource_id?: string | null
          rework_by_size?: Json
          rework_passed?: number
          sam?: number | null
          shift_id?: string | null
          started_at?: string
          total_inspected?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inspection_sessions_colorway_id_fkey"
            columns: ["colorway_id"]
            isOneToOne: false
            referencedRelation: "colorways"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_sessions_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_sessions_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_sessions_line_allocation_id_fkey"
            columns: ["line_allocation_id"]
            isOneToOne: false
            referencedRelation: "line_allocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_sessions_logged_by_fkey"
            columns: ["logged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_sessions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "style_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_sessions_order_route_id_fkey"
            columns: ["order_route_id"]
            isOneToOne: false
            referencedRelation: "order_routing_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_sessions_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "assigned_resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_sessions_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_sessions_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "v_shift_minutes"
            referencedColumns: ["shift_id"]
          },
        ]
      }
      line_allocations: {
        Row: {
          colorway_id: string | null
          completed_is_true: boolean
          created_at: string
          daily_target: number
          department_id: string | null
          department_name: string | null
          end_date: string | null
          factory_id: string
          handover_available_qty: number | null
          handover_comments: string | null
          handover_completed_at: string | null
          handover_completed_by: string | null
          handover_produced_qty: number | null
          handover_sent_qty: number | null
          hourly_target: number | null
          id: string
          kpi_inputs: Json | null
          line_id: string | null
          order_id: string
          production_comments: string | null
          production_completed_at: string | null
          production_completed_by: string | null
          production_planned_qty: number | null
          production_produced_qty: number | null
          qty: number
          sam: number | null
          start_date: string | null
          status: string
          updated_at: string
          visit_id: string | null
        }
        Insert: {
          colorway_id?: string | null
          completed_is_true?: boolean
          created_at?: string
          daily_target?: number
          department_id?: string | null
          department_name?: string | null
          end_date?: string | null
          factory_id: string
          handover_available_qty?: number | null
          handover_comments?: string | null
          handover_completed_at?: string | null
          handover_completed_by?: string | null
          handover_produced_qty?: number | null
          handover_sent_qty?: number | null
          hourly_target?: number | null
          id?: string
          kpi_inputs?: Json | null
          line_id?: string | null
          order_id: string
          production_comments?: string | null
          production_completed_at?: string | null
          production_completed_by?: string | null
          production_planned_qty?: number | null
          production_produced_qty?: number | null
          qty?: number
          sam?: number | null
          start_date?: string | null
          status?: string
          updated_at?: string
          visit_id?: string | null
        }
        Update: {
          colorway_id?: string | null
          completed_is_true?: boolean
          created_at?: string
          daily_target?: number
          department_id?: string | null
          department_name?: string | null
          end_date?: string | null
          factory_id?: string
          handover_available_qty?: number | null
          handover_comments?: string | null
          handover_completed_at?: string | null
          handover_completed_by?: string | null
          handover_produced_qty?: number | null
          handover_sent_qty?: number | null
          hourly_target?: number | null
          id?: string
          kpi_inputs?: Json | null
          line_id?: string | null
          order_id?: string
          production_comments?: string | null
          production_completed_at?: string | null
          production_completed_by?: string | null
          production_planned_qty?: number | null
          production_produced_qty?: number | null
          qty?: number
          sam?: number | null
          start_date?: string | null
          status?: string
          updated_at?: string
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "line_allocations_colorway_id_fkey"
            columns: ["colorway_id"]
            isOneToOne: false
            referencedRelation: "colorways"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "line_allocations_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "line_allocations_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "line_allocations_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "assigned_resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "line_allocations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "style_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_defect_types: {
        Row: {
          created_at: string
          factory_id: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          created_at?: string
          factory_id: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          created_at?: string
          factory_id?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "mm_defect_types_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_doc_sequences: {
        Row: {
          doc_type: string
          factory_id: string
          next_no: number
        }
        Insert: {
          doc_type: string
          factory_id: string
          next_no?: number
        }
        Update: {
          doc_type?: string
          factory_id?: string
          next_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "mm_doc_sequences_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_end_bit_returns: {
        Row: {
          created_at: string
          created_by: string | null
          cutting_lay_id: string | null
          factory_id: string
          id: string
          mill_shade: string | null
          qty: number
          qty_uom: string | null
          returned_at: string
          returned_by: string | null
          stock_unit_id: string
          store_challan_id: string | null
          style_name: string | null
          tested_shade: string | null
          unit_code: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          cutting_lay_id?: string | null
          factory_id: string
          id?: string
          mill_shade?: string | null
          qty: number
          qty_uom?: string | null
          returned_at?: string
          returned_by?: string | null
          stock_unit_id: string
          store_challan_id?: string | null
          style_name?: string | null
          tested_shade?: string | null
          unit_code?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          cutting_lay_id?: string | null
          factory_id?: string
          id?: string
          mill_shade?: string | null
          qty?: number
          qty_uom?: string | null
          returned_at?: string
          returned_by?: string | null
          stock_unit_id?: string
          store_challan_id?: string | null
          style_name?: string | null
          tested_shade?: string | null
          unit_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mm_end_bit_returns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_end_bit_returns_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_end_bit_returns_returned_by_fkey"
            columns: ["returned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_end_bit_returns_stock_unit_id_fkey"
            columns: ["stock_unit_id"]
            isOneToOne: false
            referencedRelation: "mm_stock_units"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_fabric_constructions: {
        Row: {
          created_at: string
          created_by: string | null
          fabric_type_id: string
          factory_id: string
          id: string
          is_active: boolean
          name: string
          seq: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          fabric_type_id: string
          factory_id: string
          id?: string
          is_active?: boolean
          name: string
          seq?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          fabric_type_id?: string
          factory_id?: string
          id?: string
          is_active?: boolean
          name?: string
          seq?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mm_fabric_constructions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_fabric_constructions_fabric_type_id_fkey"
            columns: ["fabric_type_id"]
            isOneToOne: false
            referencedRelation: "mm_fabric_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_fabric_constructions_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_fabric_constructions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_fabric_form_fields: {
        Row: {
          col_span: number
          column_name: string | null
          created_at: string
          created_by: string | null
          fabric_type_id: string | null
          factory_id: string
          group_id: string
          help: string | null
          id: string
          input_type: string
          is_system: boolean
          key: string
          label: string
          locked_when_used: boolean
          options: Json
          override_of: string | null
          placeholder: string | null
          required: boolean
          required_when: Json | null
          seq: number
          spec_key: string | null
          storage: string
          updated_at: string
          updated_by: string | null
          visible: boolean
          visible_when: Json | null
        }
        Insert: {
          col_span?: number
          column_name?: string | null
          created_at?: string
          created_by?: string | null
          fabric_type_id?: string | null
          factory_id: string
          group_id: string
          help?: string | null
          id?: string
          input_type: string
          is_system?: boolean
          key: string
          label: string
          locked_when_used?: boolean
          options?: Json
          override_of?: string | null
          placeholder?: string | null
          required?: boolean
          required_when?: Json | null
          seq?: number
          spec_key?: string | null
          storage: string
          updated_at?: string
          updated_by?: string | null
          visible?: boolean
          visible_when?: Json | null
        }
        Update: {
          col_span?: number
          column_name?: string | null
          created_at?: string
          created_by?: string | null
          fabric_type_id?: string | null
          factory_id?: string
          group_id?: string
          help?: string | null
          id?: string
          input_type?: string
          is_system?: boolean
          key?: string
          label?: string
          locked_when_used?: boolean
          options?: Json
          override_of?: string | null
          placeholder?: string | null
          required?: boolean
          required_when?: Json | null
          seq?: number
          spec_key?: string | null
          storage?: string
          updated_at?: string
          updated_by?: string | null
          visible?: boolean
          visible_when?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "mm_fabric_form_fields_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_fabric_form_fields_fabric_type_id_fkey"
            columns: ["fabric_type_id"]
            isOneToOne: false
            referencedRelation: "mm_fabric_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_fabric_form_fields_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_fabric_form_fields_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "mm_fabric_form_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_fabric_form_fields_override_of_fkey"
            columns: ["override_of"]
            isOneToOne: false
            referencedRelation: "mm_fabric_form_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_fabric_form_fields_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_fabric_form_groups: {
        Row: {
          collapsible: boolean
          created_at: string
          created_by: string | null
          default_open: boolean
          fabric_type_id: string | null
          factory_id: string
          id: string
          is_system: boolean
          key: string
          label: string
          seq: number
          updated_at: string
          updated_by: string | null
          visible: boolean
        }
        Insert: {
          collapsible?: boolean
          created_at?: string
          created_by?: string | null
          default_open?: boolean
          fabric_type_id?: string | null
          factory_id: string
          id?: string
          is_system?: boolean
          key: string
          label: string
          seq?: number
          updated_at?: string
          updated_by?: string | null
          visible?: boolean
        }
        Update: {
          collapsible?: boolean
          created_at?: string
          created_by?: string | null
          default_open?: boolean
          fabric_type_id?: string | null
          factory_id?: string
          id?: string
          is_system?: boolean
          key?: string
          label?: string
          seq?: number
          updated_at?: string
          updated_by?: string | null
          visible?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "mm_fabric_form_groups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_fabric_form_groups_fabric_type_id_fkey"
            columns: ["fabric_type_id"]
            isOneToOne: false
            referencedRelation: "mm_fabric_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_fabric_form_groups_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_fabric_form_groups_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_fabric_stages: {
        Row: {
          can_cut: boolean
          code: string
          created_at: string
          factory_id: string
          is_active: boolean
          is_initial: boolean
          label: string
          seq: number
          updated_at: string
        }
        Insert: {
          can_cut?: boolean
          code: string
          created_at?: string
          factory_id: string
          is_active?: boolean
          is_initial?: boolean
          label: string
          seq?: number
          updated_at?: string
        }
        Update: {
          can_cut?: boolean
          code?: string
          created_at?: string
          factory_id?: string
          is_active?: boolean
          is_initial?: boolean
          label?: string
          seq?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mm_fabric_stages_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_fabric_types: {
        Row: {
          created_at: string
          created_by: string | null
          factory_id: string
          fpt_max_points: number | null
          id: string
          is_active: boolean
          name: string
          remarks: string | null
          requires_shade_band: boolean
          row_version: number
          seq: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          factory_id: string
          fpt_max_points?: number | null
          id?: string
          is_active?: boolean
          name: string
          remarks?: string | null
          requires_shade_band?: boolean
          row_version?: number
          seq?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          factory_id?: string
          fpt_max_points?: number | null
          id?: string
          is_active?: boolean
          name?: string
          remarks?: string | null
          requires_shade_band?: boolean
          row_version?: number
          seq?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mm_fabric_types_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_fabric_types_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_fabric_types_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_fabrics: {
        Row: {
          code: string
          color_method: string
          composition: Json
          composition_text: string
          construction_id: string
          created_at: string
          created_by: string | null
          dedupe_key: string
          design_ref: string | null
          fabric_type_id: string
          factory_id: string
          greige_gsm: number | null
          greige_width_in: number | null
          gsm: number
          hsn_code: string | null
          id: string
          image_url: string | null
          merged_into_id: string | null
          name: string
          remarks: string | null
          row_version: number
          spec_values: Json
          status: string
          supplier_article_no: string | null
          uom: string
          updated_at: string
          updated_by: string | null
          width_form: string
          width_in: number
        }
        Insert: {
          code: string
          color_method: string
          composition: Json
          composition_text: string
          construction_id: string
          created_at?: string
          created_by?: string | null
          dedupe_key: string
          design_ref?: string | null
          fabric_type_id: string
          factory_id: string
          greige_gsm?: number | null
          greige_width_in?: number | null
          gsm: number
          hsn_code?: string | null
          id?: string
          image_url?: string | null
          merged_into_id?: string | null
          name: string
          remarks?: string | null
          row_version?: number
          spec_values?: Json
          status?: string
          supplier_article_no?: string | null
          uom: string
          updated_at?: string
          updated_by?: string | null
          width_form: string
          width_in: number
        }
        Update: {
          code?: string
          color_method?: string
          composition?: Json
          composition_text?: string
          construction_id?: string
          created_at?: string
          created_by?: string | null
          dedupe_key?: string
          design_ref?: string | null
          fabric_type_id?: string
          factory_id?: string
          greige_gsm?: number | null
          greige_width_in?: number | null
          gsm?: number
          hsn_code?: string | null
          id?: string
          image_url?: string | null
          merged_into_id?: string | null
          name?: string
          remarks?: string | null
          row_version?: number
          spec_values?: Json
          status?: string
          supplier_article_no?: string | null
          uom?: string
          updated_at?: string
          updated_by?: string | null
          width_form?: string
          width_in?: number
        }
        Relationships: [
          {
            foreignKeyName: "mm_fabrics_construction_id_fkey"
            columns: ["construction_id"]
            isOneToOne: false
            referencedRelation: "mm_fabric_constructions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_fabrics_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_fabrics_fabric_type_id_fkey"
            columns: ["fabric_type_id"]
            isOneToOne: false
            referencedRelation: "mm_fabric_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_fabrics_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_fabrics_merged_into_id_fkey"
            columns: ["merged_into_id"]
            isOneToOne: false
            referencedRelation: "mm_fabrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_fabrics_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_facilities: {
        Row: {
          address: string | null
          code: string
          contact: string | null
          created_at: string
          created_by: string | null
          factory_id: string
          id: string
          is_active: boolean
          kind: string
          name: string
          ownership: string
          remarks: string | null
          row_version: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          address?: string | null
          code: string
          contact?: string | null
          created_at?: string
          created_by?: string | null
          factory_id: string
          id?: string
          is_active?: boolean
          kind: string
          name: string
          ownership: string
          remarks?: string | null
          row_version?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          address?: string | null
          code?: string
          contact?: string | null
          created_at?: string
          created_by?: string | null
          factory_id?: string
          id?: string
          is_active?: boolean
          kind?: string
          name?: string
          ownership?: string
          remarks?: string | null
          row_version?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mm_facilities_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_facility_process_types: {
        Row: {
          facility_id: string
          factory_id: string
          process_type_id: string
        }
        Insert: {
          facility_id: string
          factory_id: string
          process_type_id: string
        }
        Update: {
          facility_id?: string
          factory_id?: string
          process_type_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mm_facility_process_types_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "mm_facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_facility_process_types_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_facility_process_types_process_type_id_fkey"
            columns: ["process_type_id"]
            isOneToOne: false
            referencedRelation: "mm_process_types"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_factory_features: {
        Row: {
          enabled: boolean
          factory_id: string
          feature_key: string
        }
        Insert: {
          enabled?: boolean
          factory_id: string
          feature_key: string
        }
        Update: {
          enabled?: boolean
          factory_id?: string
          feature_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "mm_factory_features_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_fpt_thresholds: {
        Row: {
          buyer_id: string | null
          created_at: string
          fabric_type_id: string | null
          factory_id: string
          id: string
          max_points: number
        }
        Insert: {
          buyer_id?: string | null
          created_at?: string
          fabric_type_id?: string | null
          factory_id: string
          id?: string
          max_points: number
        }
        Update: {
          buyer_id?: string | null
          created_at?: string
          fabric_type_id?: string | null
          factory_id?: string
          id?: string
          max_points?: number
        }
        Relationships: [
          {
            foreignKeyName: "mm_fpt_thresholds_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "buyers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_fpt_thresholds_fabric_type_id_fkey"
            columns: ["fabric_type_id"]
            isOneToOne: false
            referencedRelation: "mm_fabric_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_fpt_thresholds_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_in_challan_lines: {
        Row: {
          challan_id: string
          created_at: string
          created_by: string | null
          factory_id: string
          id: string
          line_status: string
          received_at: string | null
          received_by: string | null
          remarks: string | null
          stock_unit_id: string
        }
        Insert: {
          challan_id: string
          created_at?: string
          created_by?: string | null
          factory_id: string
          id?: string
          line_status?: string
          received_at?: string | null
          received_by?: string | null
          remarks?: string | null
          stock_unit_id: string
        }
        Update: {
          challan_id?: string
          created_at?: string
          created_by?: string | null
          factory_id?: string
          id?: string
          line_status?: string
          received_at?: string | null
          received_by?: string | null
          remarks?: string | null
          stock_unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mm_in_challan_lines_challan_id_fkey"
            columns: ["challan_id"]
            isOneToOne: false
            referencedRelation: "mm_in_challans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_in_challan_lines_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_in_challan_lines_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_in_challan_lines_stock_unit_id_fkey"
            columns: ["stock_unit_id"]
            isOneToOne: false
            referencedRelation: "mm_stock_units"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_in_challans: {
        Row: {
          challan_no: string
          created_at: string
          created_by: string | null
          factory_id: string
          grn_no: string | null
          id: string
          invoice_ref: string | null
          received_at: string | null
          received_by: string | null
          reference_no: string | null
          remarks: string | null
          row_version: number
          sent_at: string | null
          sent_by: string | null
          source: string
          status: string
          style_material_id: string | null
          supplier_name: string | null
          to_location: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          challan_no: string
          created_at?: string
          created_by?: string | null
          factory_id: string
          grn_no?: string | null
          id?: string
          invoice_ref?: string | null
          received_at?: string | null
          received_by?: string | null
          reference_no?: string | null
          remarks?: string | null
          row_version?: number
          sent_at?: string | null
          sent_by?: string | null
          source: string
          status: string
          style_material_id?: string | null
          supplier_name?: string | null
          to_location?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          challan_no?: string
          created_at?: string
          created_by?: string | null
          factory_id?: string
          grn_no?: string | null
          id?: string
          invoice_ref?: string | null
          received_at?: string | null
          received_by?: string | null
          reference_no?: string | null
          remarks?: string | null
          row_version?: number
          sent_at?: string | null
          sent_by?: string | null
          source?: string
          status?: string
          style_material_id?: string | null
          supplier_name?: string | null
          to_location?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mm_in_challans_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_in_challans_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_in_challans_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_in_challans_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_in_challans_style_material_id_fkey"
            columns: ["style_material_id"]
            isOneToOne: false
            referencedRelation: "mm_style_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_in_challans_style_material_id_fkey"
            columns: ["style_material_id"]
            isOneToOne: false
            referencedRelation: "mm_v_style_fabric_reconciliation"
            referencedColumns: ["style_material_id"]
          },
          {
            foreignKeyName: "mm_in_challans_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_inspection_defects: {
        Row: {
          created_at: string
          defect_code: string | null
          defect_type_id: string | null
          factory_id: string
          hole: boolean
          id: string
          inspection_id: string
          points: number
          position_from: number | null
          size_band: string | null
        }
        Insert: {
          created_at?: string
          defect_code?: string | null
          defect_type_id?: string | null
          factory_id: string
          hole?: boolean
          id?: string
          inspection_id: string
          points: number
          position_from?: number | null
          size_band?: string | null
        }
        Update: {
          created_at?: string
          defect_code?: string | null
          defect_type_id?: string | null
          factory_id?: string
          hole?: boolean
          id?: string
          inspection_id?: string
          points?: number
          position_from?: number | null
          size_band?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mm_inspection_defects_defect_type_id_fkey"
            columns: ["defect_type_id"]
            isOneToOne: false
            referencedRelation: "mm_defect_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_inspection_defects_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_inspection_defects_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "mm_warehouse_inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_lay_unit_consumptions: {
        Row: {
          closing_qty: number
          consumed_qty: number | null
          created_at: string
          created_by: string | null
          cutting_lay_id: string
          end_bit_action: string
          factory_id: string
          id: string
          movement_line_id: string | null
          opening_qty: number
          plies: number | null
          recorded_at: string
          recorded_by: string | null
          row_version: number
          seq: number
          shortage_qty: number | null
          stock_unit_id: string
          updated_at: string
          updated_by: string | null
          used_qty: number | null
        }
        Insert: {
          closing_qty: number
          consumed_qty?: number | null
          created_at?: string
          created_by?: string | null
          cutting_lay_id: string
          end_bit_action?: string
          factory_id: string
          id?: string
          movement_line_id?: string | null
          opening_qty: number
          plies?: number | null
          recorded_at?: string
          recorded_by?: string | null
          row_version?: number
          seq?: number
          shortage_qty?: number | null
          stock_unit_id: string
          updated_at?: string
          updated_by?: string | null
          used_qty?: number | null
        }
        Update: {
          closing_qty?: number
          consumed_qty?: number | null
          created_at?: string
          created_by?: string | null
          cutting_lay_id?: string
          end_bit_action?: string
          factory_id?: string
          id?: string
          movement_line_id?: string | null
          opening_qty?: number
          plies?: number | null
          recorded_at?: string
          recorded_by?: string | null
          row_version?: number
          seq?: number
          shortage_qty?: number | null
          stock_unit_id?: string
          updated_at?: string
          updated_by?: string | null
          used_qty?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "mm_lay_unit_consumptions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_lay_unit_consumptions_cutting_lay_id_fkey"
            columns: ["cutting_lay_id"]
            isOneToOne: false
            referencedRelation: "cutting_lays"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_lay_unit_consumptions_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_lay_unit_consumptions_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_lay_unit_consumptions_stock_unit_id_fkey"
            columns: ["stock_unit_id"]
            isOneToOne: false
            referencedRelation: "mm_stock_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_lay_unit_consumptions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_locations: {
        Row: {
          capacity_note: string | null
          capacity_rolls: number | null
          code: string
          created_at: string
          created_by: string | null
          department_id: string | null
          factory_id: string
          id: string
          is_active: boolean
          is_pickable: boolean
          location_type: string
          name: string
          parent_id: string | null
          row_version: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          capacity_note?: string | null
          capacity_rolls?: number | null
          code: string
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          factory_id: string
          id?: string
          is_active?: boolean
          is_pickable?: boolean
          location_type: string
          name: string
          parent_id?: string | null
          row_version?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          capacity_note?: string | null
          capacity_rolls?: number | null
          code?: string
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          factory_id?: string
          id?: string
          is_active?: boolean
          is_pickable?: boolean
          location_type?: string
          name?: string
          parent_id?: string | null
          row_version?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mm_locations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_locations_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_locations_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_locations_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "mm_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_locations_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_machines: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          facility_id: string
          factory_id: string
          id: string
          is_active: boolean
          machine_kind: string
          name: string
          row_version: number
          specs: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          facility_id: string
          factory_id: string
          id?: string
          is_active?: boolean
          machine_kind: string
          name: string
          row_version?: number
          specs?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          facility_id?: string
          factory_id?: string
          id?: string
          is_active?: boolean
          machine_kind?: string
          name?: string
          row_version?: number
          specs?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mm_machines_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "mm_facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_machines_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_mill_batch_style_intents: {
        Row: {
          batch_id: string
          created_at: string
          created_by: string | null
          factory_id: string
          style_material_id: string
        }
        Insert: {
          batch_id: string
          created_at?: string
          created_by?: string | null
          factory_id: string
          style_material_id: string
        }
        Update: {
          batch_id?: string
          created_at?: string
          created_by?: string | null
          factory_id?: string
          style_material_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mm_mill_batch_style_intents_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "mm_mill_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_mill_batch_style_intents_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_mill_batch_style_intents_style_material_id_fkey"
            columns: ["style_material_id"]
            isOneToOne: false
            referencedRelation: "mm_style_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_mill_batch_style_intents_style_material_id_fkey"
            columns: ["style_material_id"]
            isOneToOne: false
            referencedRelation: "mm_v_style_fabric_reconciliation"
            referencedColumns: ["style_material_id"]
          },
        ]
      }
      mm_mill_batches: {
        Row: {
          batch_kind: string | null
          batch_no: string
          color_ref: string | null
          created_at: string
          created_by: string | null
          fabric_id: string | null
          fabric_ref_name: string | null
          fabric_type_id: string
          facility_id: string | null
          factory_id: string
          id: string
          initial_stage_code: string
          mill_ref: string | null
          production_date: string
          remarks: string | null
          row_version: number
          style_material_id: string | null
          updated_at: string
          updated_by: string | null
          yarn_count: string | null
          yarn_lot: string | null
        }
        Insert: {
          batch_kind?: string | null
          batch_no: string
          color_ref?: string | null
          created_at?: string
          created_by?: string | null
          fabric_id?: string | null
          fabric_ref_name?: string | null
          fabric_type_id: string
          facility_id?: string | null
          factory_id: string
          id?: string
          initial_stage_code?: string
          mill_ref?: string | null
          production_date?: string
          remarks?: string | null
          row_version?: number
          style_material_id?: string | null
          updated_at?: string
          updated_by?: string | null
          yarn_count?: string | null
          yarn_lot?: string | null
        }
        Update: {
          batch_kind?: string | null
          batch_no?: string
          color_ref?: string | null
          created_at?: string
          created_by?: string | null
          fabric_id?: string | null
          fabric_ref_name?: string | null
          fabric_type_id?: string
          facility_id?: string | null
          factory_id?: string
          id?: string
          initial_stage_code?: string
          mill_ref?: string | null
          production_date?: string
          remarks?: string | null
          row_version?: number
          style_material_id?: string | null
          updated_at?: string
          updated_by?: string | null
          yarn_count?: string | null
          yarn_lot?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mm_mill_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_mill_batches_fabric_id_fkey"
            columns: ["fabric_id"]
            isOneToOne: false
            referencedRelation: "mm_fabrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_mill_batches_fabric_type_id_fkey"
            columns: ["fabric_type_id"]
            isOneToOne: false
            referencedRelation: "mm_fabric_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_mill_batches_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "mm_facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_mill_batches_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_mill_batches_style_material_id_fkey"
            columns: ["style_material_id"]
            isOneToOne: false
            referencedRelation: "mm_style_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_mill_batches_style_material_id_fkey"
            columns: ["style_material_id"]
            isOneToOne: false
            referencedRelation: "mm_v_style_fabric_reconciliation"
            referencedColumns: ["style_material_id"]
          },
          {
            foreignKeyName: "mm_mill_batches_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_mill_rolls: {
        Row: {
          attributes: Json
          color_ref: string | null
          created_at: string
          created_by: string | null
          dispatched_at: string | null
          fabric_type_id: string
          factory_id: string
          id: string
          in_challan_id: string | null
          length_m: number | null
          lot_no: string | null
          mill_batch_id: string
          parent_mill_roll_id: string | null
          qc_result: string | null
          roll_id: string
          row_version: number
          shade: string | null
          status: string
          style_material_id: string | null
          unit_code: string
          updated_at: string
          updated_by: string | null
          weight_kg: number | null
        }
        Insert: {
          attributes?: Json
          color_ref?: string | null
          created_at?: string
          created_by?: string | null
          dispatched_at?: string | null
          fabric_type_id: string
          factory_id: string
          id?: string
          in_challan_id?: string | null
          length_m?: number | null
          lot_no?: string | null
          mill_batch_id: string
          parent_mill_roll_id?: string | null
          qc_result?: string | null
          roll_id: string
          row_version?: number
          shade?: string | null
          status?: string
          style_material_id?: string | null
          unit_code: string
          updated_at?: string
          updated_by?: string | null
          weight_kg?: number | null
        }
        Update: {
          attributes?: Json
          color_ref?: string | null
          created_at?: string
          created_by?: string | null
          dispatched_at?: string | null
          fabric_type_id?: string
          factory_id?: string
          id?: string
          in_challan_id?: string | null
          length_m?: number | null
          lot_no?: string | null
          mill_batch_id?: string
          parent_mill_roll_id?: string | null
          qc_result?: string | null
          roll_id?: string
          row_version?: number
          shade?: string | null
          status?: string
          style_material_id?: string | null
          unit_code?: string
          updated_at?: string
          updated_by?: string | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "mm_mill_rolls_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_mill_rolls_fabric_type_id_fkey"
            columns: ["fabric_type_id"]
            isOneToOne: false
            referencedRelation: "mm_fabric_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_mill_rolls_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_mill_rolls_in_challan_id_fkey"
            columns: ["in_challan_id"]
            isOneToOne: false
            referencedRelation: "mm_in_challans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_mill_rolls_mill_batch_id_fkey"
            columns: ["mill_batch_id"]
            isOneToOne: false
            referencedRelation: "mm_mill_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_mill_rolls_parent_mill_roll_id_fkey"
            columns: ["parent_mill_roll_id"]
            isOneToOne: false
            referencedRelation: "mm_mill_rolls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_mill_rolls_roll_id_fkey"
            columns: ["roll_id"]
            isOneToOne: false
            referencedRelation: "mm_rolls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_mill_rolls_style_material_id_fkey"
            columns: ["style_material_id"]
            isOneToOne: false
            referencedRelation: "mm_style_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_mill_rolls_style_material_id_fkey"
            columns: ["style_material_id"]
            isOneToOne: false
            referencedRelation: "mm_v_style_fabric_reconciliation"
            referencedColumns: ["style_material_id"]
          },
          {
            foreignKeyName: "mm_mill_rolls_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_process_challans: {
        Row: {
          challan_no: string
          created_at: string
          created_by: string | null
          factory_id: string
          id: string
          origin: string
          parent_challan_id: string | null
          process_type_id: string
          purpose: string
          remarks: string | null
          reprocess_reason: string | null
          returned_at: string | null
          sent_at: string
          status: string
          unit_facility_id: string | null
          unit_ref_no: string | null
          updated_at: string
          updated_by: string | null
          vendor_id: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          challan_no: string
          created_at?: string
          created_by?: string | null
          factory_id: string
          id?: string
          origin: string
          parent_challan_id?: string | null
          process_type_id: string
          purpose?: string
          remarks?: string | null
          reprocess_reason?: string | null
          returned_at?: string | null
          sent_at?: string
          status?: string
          unit_facility_id?: string | null
          unit_ref_no?: string | null
          updated_at?: string
          updated_by?: string | null
          vendor_id?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          challan_no?: string
          created_at?: string
          created_by?: string | null
          factory_id?: string
          id?: string
          origin?: string
          parent_challan_id?: string | null
          process_type_id?: string
          purpose?: string
          remarks?: string | null
          reprocess_reason?: string | null
          returned_at?: string | null
          sent_at?: string
          status?: string
          unit_facility_id?: string | null
          unit_ref_no?: string | null
          updated_at?: string
          updated_by?: string | null
          vendor_id?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mm_process_challans_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_process_challans_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_process_challans_parent_challan_id_fkey"
            columns: ["parent_challan_id"]
            isOneToOne: false
            referencedRelation: "mm_process_challans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_process_challans_process_type_id_fkey"
            columns: ["process_type_id"]
            isOneToOne: false
            referencedRelation: "mm_process_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_process_challans_unit_facility_id_fkey"
            columns: ["unit_facility_id"]
            isOneToOne: false
            referencedRelation: "mm_facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_process_challans_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_process_challans_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "mm_process_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_process_lots: {
        Row: {
          challan_id: string
          created_at: string
          created_by: string | null
          ended_at: string | null
          factory_id: string
          id: string
          lot_no: string
          machine_id: string | null
          remarks: string | null
          started_at: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          challan_id: string
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          factory_id: string
          id?: string
          lot_no: string
          machine_id?: string | null
          remarks?: string | null
          started_at?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          challan_id?: string
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          factory_id?: string
          id?: string
          lot_no?: string
          machine_id?: string | null
          remarks?: string | null
          started_at?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mm_process_lots_challan_id_fkey"
            columns: ["challan_id"]
            isOneToOne: false
            referencedRelation: "mm_process_challans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_process_lots_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_process_lots_machine_id_fkey"
            columns: ["machine_id"]
            isOneToOne: false
            referencedRelation: "mm_machines"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_process_out_lines: {
        Row: {
          challan_id: string
          color_ref: string | null
          created_at: string
          factory_id: string
          id: string
          line_status: string
          lot_id: string | null
          lot_no: string | null
          mill_roll_id: string | null
          qty: number
          qty_kg: number | null
          roll_id: string | null
          shade: string | null
          stage_code: string | null
          stock_unit_id: string | null
          unit_code: string
          uom: string
          write_off_reason: string | null
        }
        Insert: {
          challan_id: string
          color_ref?: string | null
          created_at?: string
          factory_id: string
          id?: string
          line_status?: string
          lot_id?: string | null
          lot_no?: string | null
          mill_roll_id?: string | null
          qty: number
          qty_kg?: number | null
          roll_id?: string | null
          shade?: string | null
          stage_code?: string | null
          stock_unit_id?: string | null
          unit_code: string
          uom: string
          write_off_reason?: string | null
        }
        Update: {
          challan_id?: string
          color_ref?: string | null
          created_at?: string
          factory_id?: string
          id?: string
          line_status?: string
          lot_id?: string | null
          lot_no?: string | null
          mill_roll_id?: string | null
          qty?: number
          qty_kg?: number | null
          roll_id?: string | null
          shade?: string | null
          stage_code?: string | null
          stock_unit_id?: string | null
          unit_code?: string
          uom?: string
          write_off_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mm_process_out_lines_challan_id_fkey"
            columns: ["challan_id"]
            isOneToOne: false
            referencedRelation: "mm_process_challans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_process_out_lines_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_process_out_lines_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "mm_process_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_process_out_lines_mill_roll_id_fkey"
            columns: ["mill_roll_id"]
            isOneToOne: false
            referencedRelation: "mm_mill_rolls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_process_out_lines_roll_id_fkey"
            columns: ["roll_id"]
            isOneToOne: false
            referencedRelation: "mm_rolls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_process_out_lines_stock_unit_id_fkey"
            columns: ["stock_unit_id"]
            isOneToOne: false
            referencedRelation: "mm_stock_units"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_process_return_lines: {
        Row: {
          challan_id: string
          color_ref: string | null
          created_at: string
          created_by: string | null
          dye_lot: string | null
          factory_id: string
          grade: string | null
          id: string
          lot_id: string | null
          lot_no: string | null
          mill_roll_id: string | null
          out_line_id: string
          parent_out_line_ids: string[] | null
          qty: number
          qty_kg: number | null
          return_id: string | null
          roll_id: string | null
          same_identity: boolean
          shade: string | null
          stage_code: string | null
          stock_unit_id: string | null
          unit_code: string
          unit_form: string | null
          uom: string
          width_form: string | null
        }
        Insert: {
          challan_id: string
          color_ref?: string | null
          created_at?: string
          created_by?: string | null
          dye_lot?: string | null
          factory_id: string
          grade?: string | null
          id?: string
          lot_id?: string | null
          lot_no?: string | null
          mill_roll_id?: string | null
          out_line_id: string
          parent_out_line_ids?: string[] | null
          qty: number
          qty_kg?: number | null
          return_id?: string | null
          roll_id?: string | null
          same_identity: boolean
          shade?: string | null
          stage_code?: string | null
          stock_unit_id?: string | null
          unit_code: string
          unit_form?: string | null
          uom: string
          width_form?: string | null
        }
        Update: {
          challan_id?: string
          color_ref?: string | null
          created_at?: string
          created_by?: string | null
          dye_lot?: string | null
          factory_id?: string
          grade?: string | null
          id?: string
          lot_id?: string | null
          lot_no?: string | null
          mill_roll_id?: string | null
          out_line_id?: string
          parent_out_line_ids?: string[] | null
          qty?: number
          qty_kg?: number | null
          return_id?: string | null
          roll_id?: string | null
          same_identity?: boolean
          shade?: string | null
          stage_code?: string | null
          stock_unit_id?: string | null
          unit_code?: string
          unit_form?: string | null
          uom?: string
          width_form?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mm_process_return_lines_challan_id_fkey"
            columns: ["challan_id"]
            isOneToOne: false
            referencedRelation: "mm_process_challans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_process_return_lines_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_process_return_lines_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_process_return_lines_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "mm_process_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_process_return_lines_mill_roll_id_fkey"
            columns: ["mill_roll_id"]
            isOneToOne: false
            referencedRelation: "mm_mill_rolls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_process_return_lines_out_line_id_fkey"
            columns: ["out_line_id"]
            isOneToOne: false
            referencedRelation: "mm_process_out_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_process_return_lines_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "mm_process_returns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_process_return_lines_roll_id_fkey"
            columns: ["roll_id"]
            isOneToOne: false
            referencedRelation: "mm_rolls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_process_return_lines_stock_unit_id_fkey"
            columns: ["stock_unit_id"]
            isOneToOne: false
            referencedRelation: "mm_stock_units"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_process_returns: {
        Row: {
          challan_id: string
          created_at: string
          created_by: string | null
          deliver_to: string
          factory_id: string
          id: string
          in_challan_id: string | null
          remarks: string | null
          return_no: string
          returned_at: string
        }
        Insert: {
          challan_id: string
          created_at?: string
          created_by?: string | null
          deliver_to?: string
          factory_id: string
          id?: string
          in_challan_id?: string | null
          remarks?: string | null
          return_no: string
          returned_at?: string
        }
        Update: {
          challan_id?: string
          created_at?: string
          created_by?: string | null
          deliver_to?: string
          factory_id?: string
          id?: string
          in_challan_id?: string | null
          remarks?: string | null
          return_no?: string
          returned_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mm_process_returns_challan_id_fkey"
            columns: ["challan_id"]
            isOneToOne: false
            referencedRelation: "mm_process_challans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_process_returns_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_process_returns_in_challan_id_fkey"
            columns: ["in_challan_id"]
            isOneToOne: false
            referencedRelation: "mm_in_challans"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_process_types: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          default_return_mode: string
          factory_id: string
          id: string
          machine_kinds: string[]
          name: string
          output_stage_code: string | null
          resets_inspection: boolean
          resets_testing: boolean
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          default_return_mode?: string
          factory_id: string
          id?: string
          machine_kinds?: string[]
          name: string
          output_stage_code?: string | null
          resets_inspection?: boolean
          resets_testing?: boolean
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          default_return_mode?: string
          factory_id?: string
          id?: string
          machine_kinds?: string[]
          name?: string
          output_stage_code?: string | null
          resets_inspection?: boolean
          resets_testing?: boolean
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mm_process_types_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_process_types_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_process_types_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_process_vendor_types: {
        Row: {
          factory_id: string
          process_type_id: string
          vendor_id: string
        }
        Insert: {
          factory_id: string
          process_type_id: string
          vendor_id: string
        }
        Update: {
          factory_id?: string
          process_type_id?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mm_process_vendor_types_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_process_vendor_types_process_type_id_fkey"
            columns: ["process_type_id"]
            isOneToOne: false
            referencedRelation: "mm_process_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_process_vendor_types_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "mm_process_vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_process_vendors: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          factory_id: string
          id: string
          name: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          factory_id: string
          id?: string
          name: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          factory_id?: string
          id?: string
          name?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mm_process_vendors_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_process_vendors_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_process_vendors_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_qc_cut_approvals: {
        Row: {
          approved_at: string
          approved_by: string | null
          codes: string[]
          expires_at: string | null
          factory_id: string
          id: string
          reason: string
          revoked_at: string | null
          revoked_by: string | null
          roll_id: string
        }
        Insert: {
          approved_at?: string
          approved_by?: string | null
          codes: string[]
          expires_at?: string | null
          factory_id: string
          id?: string
          reason: string
          revoked_at?: string | null
          revoked_by?: string | null
          roll_id: string
        }
        Update: {
          approved_at?: string
          approved_by?: string | null
          codes?: string[]
          expires_at?: string | null
          factory_id?: string
          id?: string
          reason?: string
          revoked_at?: string | null
          revoked_by?: string | null
          roll_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mm_qc_cut_approvals_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_qc_cut_approvals_roll_id_fkey"
            columns: ["roll_id"]
            isOneToOne: false
            referencedRelation: "mm_rolls"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_qc_inspection_defects: {
        Row: {
          created_at: string
          defect_code: string | null
          defect_type_id: string | null
          factory_id: string
          hole: boolean
          id: string
          inspection_id: string
          points: number
          position_from: number | null
          size_band: string | null
        }
        Insert: {
          created_at?: string
          defect_code?: string | null
          defect_type_id?: string | null
          factory_id: string
          hole?: boolean
          id?: string
          inspection_id: string
          points: number
          position_from?: number | null
          size_band?: string | null
        }
        Update: {
          created_at?: string
          defect_code?: string | null
          defect_type_id?: string | null
          factory_id?: string
          hole?: boolean
          id?: string
          inspection_id?: string
          points?: number
          position_from?: number | null
          size_band?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mm_qc_inspection_defects_defect_type_id_fkey"
            columns: ["defect_type_id"]
            isOneToOne: false
            referencedRelation: "mm_defect_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_qc_inspection_defects_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_qc_inspection_defects_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "mm_qc_inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_qc_inspections: {
        Row: {
          created_at: string
          created_by: string | null
          cuttable_width: number | null
          deviation_approved_at: string | null
          deviation_approved_by: string | null
          deviation_reason: string | null
          factory_id: string
          id: string
          inspected_at: string
          inspected_length: number | null
          legacy_inspection_id: string | null
          length_uom: string
          origin: string
          override_reason: string | null
          points_per_100_sqyd: number | null
          pts_1: number
          pts_2: number
          pts_3: number
          pts_4: number
          remarks: string | null
          result: string
          result_computed: string | null
          result_override: string | null
          roll_id: string
          round_at_inspection: number
          site_facility_id: string | null
          site_side: string
          stage_code: string | null
          supersedes_id: string | null
          threshold_used: number | null
          total_points: number
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
          width_uom: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          cuttable_width?: number | null
          deviation_approved_at?: string | null
          deviation_approved_by?: string | null
          deviation_reason?: string | null
          factory_id: string
          id?: string
          inspected_at?: string
          inspected_length?: number | null
          legacy_inspection_id?: string | null
          length_uom?: string
          origin?: string
          override_reason?: string | null
          points_per_100_sqyd?: number | null
          pts_1?: number
          pts_2?: number
          pts_3?: number
          pts_4?: number
          remarks?: string | null
          result: string
          result_computed?: string | null
          result_override?: string | null
          roll_id: string
          round_at_inspection: number
          site_facility_id?: string | null
          site_side: string
          stage_code?: string | null
          supersedes_id?: string | null
          threshold_used?: number | null
          total_points?: number
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          width_uom?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          cuttable_width?: number | null
          deviation_approved_at?: string | null
          deviation_approved_by?: string | null
          deviation_reason?: string | null
          factory_id?: string
          id?: string
          inspected_at?: string
          inspected_length?: number | null
          legacy_inspection_id?: string | null
          length_uom?: string
          origin?: string
          override_reason?: string | null
          points_per_100_sqyd?: number | null
          pts_1?: number
          pts_2?: number
          pts_3?: number
          pts_4?: number
          remarks?: string | null
          result?: string
          result_computed?: string | null
          result_override?: string | null
          roll_id?: string
          round_at_inspection?: number
          site_facility_id?: string | null
          site_side?: string
          stage_code?: string | null
          supersedes_id?: string | null
          threshold_used?: number | null
          total_points?: number
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          width_uom?: string
        }
        Relationships: [
          {
            foreignKeyName: "mm_qc_inspections_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_qc_inspections_roll_id_fkey"
            columns: ["roll_id"]
            isOneToOne: false
            referencedRelation: "mm_rolls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_qc_inspections_site_facility_id_fkey"
            columns: ["site_facility_id"]
            isOneToOne: false
            referencedRelation: "mm_facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_qc_inspections_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "mm_qc_inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_qc_test_rolls: {
        Row: {
          factory_id: string
          roll_id: string
          round_at_test: number
          test_id: string
        }
        Insert: {
          factory_id: string
          roll_id: string
          round_at_test: number
          test_id: string
        }
        Update: {
          factory_id?: string
          roll_id?: string
          round_at_test?: number
          test_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mm_qc_test_rolls_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_qc_test_rolls_roll_id_fkey"
            columns: ["roll_id"]
            isOneToOne: false
            referencedRelation: "mm_rolls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_qc_test_rolls_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "mm_qc_tests"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_qc_tests: {
        Row: {
          created_at: string
          created_by: string | null
          deviation_approved_at: string | null
          deviation_approved_by: string | null
          deviation_reason: string | null
          fabric_type_id: string | null
          factory_id: string
          field_values: Json
          id: string
          origin: string
          remarks: string | null
          result: string
          scope_id: string | null
          scope_kind: string
          site_facility_id: string | null
          site_side: string
          stage_code: string | null
          supersedes_id: string | null
          tested_at: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deviation_approved_at?: string | null
          deviation_approved_by?: string | null
          deviation_reason?: string | null
          fabric_type_id?: string | null
          factory_id: string
          field_values?: Json
          id?: string
          origin?: string
          remarks?: string | null
          result: string
          scope_id?: string | null
          scope_kind: string
          site_facility_id?: string | null
          site_side: string
          stage_code?: string | null
          supersedes_id?: string | null
          tested_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deviation_approved_at?: string | null
          deviation_approved_by?: string | null
          deviation_reason?: string | null
          fabric_type_id?: string | null
          factory_id?: string
          field_values?: Json
          id?: string
          origin?: string
          remarks?: string | null
          result?: string
          scope_id?: string | null
          scope_kind?: string
          site_facility_id?: string | null
          site_side?: string
          stage_code?: string | null
          supersedes_id?: string | null
          tested_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mm_qc_tests_fabric_type_id_fkey"
            columns: ["fabric_type_id"]
            isOneToOne: false
            referencedRelation: "mm_fabric_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_qc_tests_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_qc_tests_site_facility_id_fkey"
            columns: ["site_facility_id"]
            isOneToOne: false
            referencedRelation: "mm_facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_qc_tests_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "mm_qc_tests"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_roll_allocations: {
        Row: {
          created_at: string
          created_by: string | null
          event_at: string
          factory_id: string
          from_style_material_id: string | null
          id: string
          mill_roll_id: string | null
          reason: string | null
          roll_id: string
          side: string
          stock_unit_id: string | null
          to_style_material_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          event_at?: string
          factory_id: string
          from_style_material_id?: string | null
          id?: string
          mill_roll_id?: string | null
          reason?: string | null
          roll_id: string
          side: string
          stock_unit_id?: string | null
          to_style_material_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          event_at?: string
          factory_id?: string
          from_style_material_id?: string | null
          id?: string
          mill_roll_id?: string | null
          reason?: string | null
          roll_id?: string
          side?: string
          stock_unit_id?: string | null
          to_style_material_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mm_roll_allocations_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_roll_allocations_mill_roll_id_fkey"
            columns: ["mill_roll_id"]
            isOneToOne: false
            referencedRelation: "mm_mill_rolls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_roll_allocations_roll_id_fkey"
            columns: ["roll_id"]
            isOneToOne: false
            referencedRelation: "mm_rolls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_roll_allocations_stock_unit_id_fkey"
            columns: ["stock_unit_id"]
            isOneToOne: false
            referencedRelation: "mm_stock_units"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_roll_lineage: {
        Row: {
          child_roll_id: string
          created_at: string
          factory_id: string
          parent_roll_id: string
          return_line_id: string | null
        }
        Insert: {
          child_roll_id: string
          created_at?: string
          factory_id: string
          parent_roll_id: string
          return_line_id?: string | null
        }
        Update: {
          child_roll_id?: string
          created_at?: string
          factory_id?: string
          parent_roll_id?: string
          return_line_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mm_roll_lineage_child_roll_id_fkey"
            columns: ["child_roll_id"]
            isOneToOne: false
            referencedRelation: "mm_rolls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_roll_lineage_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_roll_lineage_parent_roll_id_fkey"
            columns: ["parent_roll_id"]
            isOneToOne: false
            referencedRelation: "mm_rolls"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_rolls: {
        Row: {
          created_at: string
          created_by: string | null
          dye_lot: string | null
          fabric_id: string | null
          fabric_type_id: string | null
          factory_id: string
          grade: string | null
          id: string
          insp_valid_from_round: number
          machine_id: string | null
          mill_batch_id: string | null
          origin: string
          origin_facility_id: string | null
          process_round: number
          produced_at: string | null
          roll_code: string
          shift: string | null
          stage_code: string
          test_valid_from_round: number
          unit_form: string
          updated_at: string
          updated_by: string | null
          width_form: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          dye_lot?: string | null
          fabric_id?: string | null
          fabric_type_id?: string | null
          factory_id: string
          grade?: string | null
          id?: string
          insp_valid_from_round?: number
          machine_id?: string | null
          mill_batch_id?: string | null
          origin: string
          origin_facility_id?: string | null
          process_round?: number
          produced_at?: string | null
          roll_code: string
          shift?: string | null
          stage_code?: string
          test_valid_from_round?: number
          unit_form?: string
          updated_at?: string
          updated_by?: string | null
          width_form?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          dye_lot?: string | null
          fabric_id?: string | null
          fabric_type_id?: string | null
          factory_id?: string
          grade?: string | null
          id?: string
          insp_valid_from_round?: number
          machine_id?: string | null
          mill_batch_id?: string | null
          origin?: string
          origin_facility_id?: string | null
          process_round?: number
          produced_at?: string | null
          roll_code?: string
          shift?: string | null
          stage_code?: string
          test_valid_from_round?: number
          unit_form?: string
          updated_at?: string
          updated_by?: string | null
          width_form?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mm_rolls_fabric_id_fkey"
            columns: ["fabric_id"]
            isOneToOne: false
            referencedRelation: "mm_fabrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_rolls_fabric_type_id_fkey"
            columns: ["fabric_type_id"]
            isOneToOne: false
            referencedRelation: "mm_fabric_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_rolls_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_rolls_machine_id_fkey"
            columns: ["machine_id"]
            isOneToOne: false
            referencedRelation: "mm_machines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_rolls_mill_batch_id_fkey"
            columns: ["mill_batch_id"]
            isOneToOne: false
            referencedRelation: "mm_mill_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_rolls_origin_facility_id_fkey"
            columns: ["origin_facility_id"]
            isOneToOne: false
            referencedRelation: "mm_facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_stock_ledger: {
        Row: {
          actor_id: string | null
          balance_after: number
          created_at: string
          created_by: string | null
          entry_type: string
          factory_id: string
          id: string
          location_after: string | null
          location_before: string | null
          note: string | null
          qty: number | null
          qty_after: number | null
          qty_delta: number
          qty_uom: string | null
          ref_id: string | null
          ref_table: string | null
          status_after: string | null
          status_before: string | null
          stock_unit_id: string
          txn_at: string
        }
        Insert: {
          actor_id?: string | null
          balance_after?: number
          created_at?: string
          created_by?: string | null
          entry_type: string
          factory_id: string
          id?: string
          location_after?: string | null
          location_before?: string | null
          note?: string | null
          qty?: number | null
          qty_after?: number | null
          qty_delta?: number
          qty_uom?: string | null
          ref_id?: string | null
          ref_table?: string | null
          status_after?: string | null
          status_before?: string | null
          stock_unit_id: string
          txn_at?: string
        }
        Update: {
          actor_id?: string | null
          balance_after?: number
          created_at?: string
          created_by?: string | null
          entry_type?: string
          factory_id?: string
          id?: string
          location_after?: string | null
          location_before?: string | null
          note?: string | null
          qty?: number | null
          qty_after?: number | null
          qty_delta?: number
          qty_uom?: string | null
          ref_id?: string | null
          ref_table?: string | null
          status_after?: string | null
          status_before?: string | null
          stock_unit_id?: string
          txn_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mm_stock_ledger_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_stock_ledger_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_stock_ledger_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_stock_ledger_location_after_fkey"
            columns: ["location_after"]
            isOneToOne: false
            referencedRelation: "mm_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_stock_ledger_location_before_fkey"
            columns: ["location_before"]
            isOneToOne: false
            referencedRelation: "mm_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_stock_ledger_stock_unit_id_fkey"
            columns: ["stock_unit_id"]
            isOneToOne: false
            referencedRelation: "mm_stock_units"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_stock_units: {
        Row: {
          attributes: Json
          color_ref: string | null
          created_at: string
          created_by: string | null
          current_location_id: string | null
          declared_width_in: number | null
          fabric_type_id: string
          factory_id: string
          hold_at: string | null
          hold_by: string | null
          hold_reason: string | null
          id: string
          in_challan_id: string | null
          is_remnant: boolean
          length_m: number | null
          lot_no: string | null
          mill_batch_id: string | null
          mill_roll_id: string | null
          mill_snapshot: Json | null
          on_hold: boolean
          parent_stock_unit_id: string | null
          qc_result: string | null
          qty_available: number
          qty_declared: number | null
          qty_received: number | null
          qty_uom: string
          roll_id: string
          row_version: number
          shade: string | null
          shade_band: string | null
          shade_band_at: string | null
          shade_band_by: string | null
          source: string
          status: string
          store_challan_id: string | null
          style_material_id: string | null
          tested_shade: string | null
          tested_shade_at: string | null
          tested_shade_by: string | null
          unit_code: string
          unit_kind: string
          uom: string
          updated_at: string
          updated_by: string | null
          weight_kg: number | null
        }
        Insert: {
          attributes?: Json
          color_ref?: string | null
          created_at?: string
          created_by?: string | null
          current_location_id?: string | null
          declared_width_in?: number | null
          fabric_type_id: string
          factory_id: string
          hold_at?: string | null
          hold_by?: string | null
          hold_reason?: string | null
          id?: string
          in_challan_id?: string | null
          is_remnant?: boolean
          length_m?: number | null
          lot_no?: string | null
          mill_batch_id?: string | null
          mill_roll_id?: string | null
          mill_snapshot?: Json | null
          on_hold?: boolean
          parent_stock_unit_id?: string | null
          qc_result?: string | null
          qty_available?: number
          qty_declared?: number | null
          qty_received?: number | null
          qty_uom?: string
          roll_id: string
          row_version?: number
          shade?: string | null
          shade_band?: string | null
          shade_band_at?: string | null
          shade_band_by?: string | null
          source: string
          status: string
          store_challan_id?: string | null
          style_material_id?: string | null
          tested_shade?: string | null
          tested_shade_at?: string | null
          tested_shade_by?: string | null
          unit_code: string
          unit_kind?: string
          uom?: string
          updated_at?: string
          updated_by?: string | null
          weight_kg?: number | null
        }
        Update: {
          attributes?: Json
          color_ref?: string | null
          created_at?: string
          created_by?: string | null
          current_location_id?: string | null
          declared_width_in?: number | null
          fabric_type_id?: string
          factory_id?: string
          hold_at?: string | null
          hold_by?: string | null
          hold_reason?: string | null
          id?: string
          in_challan_id?: string | null
          is_remnant?: boolean
          length_m?: number | null
          lot_no?: string | null
          mill_batch_id?: string | null
          mill_roll_id?: string | null
          mill_snapshot?: Json | null
          on_hold?: boolean
          parent_stock_unit_id?: string | null
          qc_result?: string | null
          qty_available?: number
          qty_declared?: number | null
          qty_received?: number | null
          qty_uom?: string
          roll_id?: string
          row_version?: number
          shade?: string | null
          shade_band?: string | null
          shade_band_at?: string | null
          shade_band_by?: string | null
          source?: string
          status?: string
          store_challan_id?: string | null
          style_material_id?: string | null
          tested_shade?: string | null
          tested_shade_at?: string | null
          tested_shade_by?: string | null
          unit_code?: string
          unit_kind?: string
          uom?: string
          updated_at?: string
          updated_by?: string | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "mm_stock_units_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_stock_units_current_location_id_fkey"
            columns: ["current_location_id"]
            isOneToOne: false
            referencedRelation: "mm_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_stock_units_fabric_type_id_fkey"
            columns: ["fabric_type_id"]
            isOneToOne: false
            referencedRelation: "mm_fabric_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_stock_units_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_stock_units_in_challan_id_fkey"
            columns: ["in_challan_id"]
            isOneToOne: false
            referencedRelation: "mm_in_challans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_stock_units_mill_batch_fk"
            columns: ["mill_batch_id"]
            isOneToOne: false
            referencedRelation: "mm_mill_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_stock_units_mill_roll_fk"
            columns: ["mill_roll_id"]
            isOneToOne: false
            referencedRelation: "mm_mill_rolls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_stock_units_parent_stock_unit_id_fkey"
            columns: ["parent_stock_unit_id"]
            isOneToOne: false
            referencedRelation: "mm_stock_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_stock_units_roll_id_fkey"
            columns: ["roll_id"]
            isOneToOne: false
            referencedRelation: "mm_rolls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_stock_units_shade_band_by_fkey"
            columns: ["shade_band_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_stock_units_store_challan_id_fkey"
            columns: ["store_challan_id"]
            isOneToOne: false
            referencedRelation: "mm_store_challans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_stock_units_style_material_id_fkey"
            columns: ["style_material_id"]
            isOneToOne: false
            referencedRelation: "mm_style_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_stock_units_style_material_id_fkey"
            columns: ["style_material_id"]
            isOneToOne: false
            referencedRelation: "mm_v_style_fabric_reconciliation"
            referencedColumns: ["style_material_id"]
          },
          {
            foreignKeyName: "mm_stock_units_tested_shade_by_fkey"
            columns: ["tested_shade_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_stock_units_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_store_challan_lines: {
        Row: {
          challan_id: string
          created_at: string
          created_by: string | null
          factory_id: string
          id: string
          line_status: string
          received_at: string | null
          received_by: string | null
          stock_unit_id: string
        }
        Insert: {
          challan_id: string
          created_at?: string
          created_by?: string | null
          factory_id: string
          id?: string
          line_status?: string
          received_at?: string | null
          received_by?: string | null
          stock_unit_id: string
        }
        Update: {
          challan_id?: string
          created_at?: string
          created_by?: string | null
          factory_id?: string
          id?: string
          line_status?: string
          received_at?: string | null
          received_by?: string | null
          stock_unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mm_store_challan_lines_challan_id_fkey"
            columns: ["challan_id"]
            isOneToOne: false
            referencedRelation: "mm_store_challans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_store_challan_lines_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_store_challan_lines_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_store_challan_lines_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_store_challan_lines_stock_unit_id_fkey"
            columns: ["stock_unit_id"]
            isOneToOne: false
            referencedRelation: "mm_stock_units"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_store_challans: {
        Row: {
          challan_no: string
          created_at: string
          created_by: string | null
          factory_id: string
          from_location_id: string | null
          id: string
          received_at: string | null
          received_by: string | null
          reference_no: string | null
          remarks: string | null
          row_version: number
          sent_at: string
          sent_by: string | null
          status: string
          style_material_id: string
          to_location_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          challan_no: string
          created_at?: string
          created_by?: string | null
          factory_id: string
          from_location_id?: string | null
          id?: string
          received_at?: string | null
          received_by?: string | null
          reference_no?: string | null
          remarks?: string | null
          row_version?: number
          sent_at?: string
          sent_by?: string | null
          status?: string
          style_material_id: string
          to_location_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          challan_no?: string
          created_at?: string
          created_by?: string | null
          factory_id?: string
          from_location_id?: string | null
          id?: string
          received_at?: string | null
          received_by?: string | null
          reference_no?: string | null
          remarks?: string | null
          row_version?: number
          sent_at?: string
          sent_by?: string | null
          status?: string
          style_material_id?: string
          to_location_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mm_store_challans_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_store_challans_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_store_challans_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "mm_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_store_challans_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_store_challans_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_store_challans_style_material_id_fkey"
            columns: ["style_material_id"]
            isOneToOne: false
            referencedRelation: "mm_style_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_store_challans_style_material_id_fkey"
            columns: ["style_material_id"]
            isOneToOne: false
            referencedRelation: "mm_v_style_fabric_reconciliation"
            referencedColumns: ["style_material_id"]
          },
          {
            foreignKeyName: "mm_store_challans_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "mm_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_store_challans_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_style_materials: {
        Row: {
          colorway_id: string
          colorway_material_id: string | null
          created_at: string
          created_by: string | null
          fabric_id: string | null
          fabric_type_id: string
          factory_id: string
          id: string
          order_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          colorway_id: string
          colorway_material_id?: string | null
          created_at?: string
          created_by?: string | null
          fabric_id?: string | null
          fabric_type_id: string
          factory_id: string
          id?: string
          order_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          colorway_id?: string
          colorway_material_id?: string | null
          created_at?: string
          created_by?: string | null
          fabric_id?: string | null
          fabric_type_id?: string
          factory_id?: string
          id?: string
          order_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mm_style_materials_colorway_id_fkey"
            columns: ["colorway_id"]
            isOneToOne: false
            referencedRelation: "colorways"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_style_materials_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_style_materials_fabric_id_fkey"
            columns: ["fabric_id"]
            isOneToOne: false
            referencedRelation: "mm_fabrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_style_materials_fabric_type_id_fkey"
            columns: ["fabric_type_id"]
            isOneToOne: false
            referencedRelation: "mm_fabric_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_style_materials_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_style_materials_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "style_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_style_materials_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_supplier_return_lines: {
        Row: {
          created_at: string
          factory_id: string
          id: string
          qty: number
          return_id: string
          stock_unit_id: string
        }
        Insert: {
          created_at?: string
          factory_id: string
          id?: string
          qty: number
          return_id: string
          stock_unit_id: string
        }
        Update: {
          created_at?: string
          factory_id?: string
          id?: string
          qty?: number
          return_id?: string
          stock_unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mm_supplier_return_lines_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_supplier_return_lines_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "mm_supplier_returns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_supplier_return_lines_stock_unit_id_fkey"
            columns: ["stock_unit_id"]
            isOneToOne: false
            referencedRelation: "mm_stock_units"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_supplier_returns: {
        Row: {
          created_at: string
          created_by: string | null
          debit_note_ref: string | null
          factory_id: string
          id: string
          reason: string
          return_no: string
          supplier_name: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          debit_note_ref?: string | null
          factory_id: string
          id?: string
          reason: string
          return_no: string
          supplier_name?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          debit_note_ref?: string | null
          factory_id?: string
          id?: string
          reason?: string
          return_no?: string
          supplier_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mm_supplier_returns_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_trim_requirement_params: {
        Row: {
          category: string
          created_at: string
          created_by: string | null
          factory_id: string
          id: string
          is_active: boolean
          row_version: number
          seq: number
          types: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          category: string
          created_at?: string
          created_by?: string | null
          factory_id: string
          id?: string
          is_active?: boolean
          row_version?: number
          seq?: number
          types?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string | null
          factory_id?: string
          id?: string
          is_active?: boolean
          row_version?: number
          seq?: number
          types?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mm_trim_requirement_params_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_trim_requirement_params_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_trim_requirement_params_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_type_requirement_fields: {
        Row: {
          created_at: string
          created_by: string | null
          factory_id: string
          id: string
          is_active: boolean
          key: string
          label: string
          remarks: string | null
          row_version: number
          seq: number
          type_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          factory_id: string
          id?: string
          is_active?: boolean
          key: string
          label: string
          remarks?: string | null
          row_version?: number
          seq?: number
          type_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          factory_id?: string
          id?: string
          is_active?: boolean
          key?: string
          label?: string
          remarks?: string | null
          row_version?: number
          seq?: number
          type_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mm_type_requirement_fields_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_type_requirement_fields_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_type_requirement_fields_type_id_fkey"
            columns: ["type_id"]
            isOneToOne: false
            referencedRelation: "mm_fabric_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_type_requirement_fields_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_type_test_fields: {
        Row: {
          capture_site: string
          created_at: string
          created_by: string | null
          data_type: string
          factory_id: string
          id: string
          is_active: boolean
          key: string
          label: string
          options: Json
          required_at_stages: string[]
          row_version: number
          seq: number
          test_level: string
          type_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          capture_site?: string
          created_at?: string
          created_by?: string | null
          data_type?: string
          factory_id: string
          id?: string
          is_active?: boolean
          key: string
          label: string
          options?: Json
          required_at_stages?: string[]
          row_version?: number
          seq?: number
          test_level?: string
          type_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          capture_site?: string
          created_at?: string
          created_by?: string | null
          data_type?: string
          factory_id?: string
          id?: string
          is_active?: boolean
          key?: string
          label?: string
          options?: Json
          required_at_stages?: string[]
          row_version?: number
          seq?: number
          test_level?: string
          type_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mm_type_test_fields_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_type_test_fields_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_type_test_fields_type_id_fkey"
            columns: ["type_id"]
            isOneToOne: false
            referencedRelation: "mm_fabric_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_type_test_fields_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_warehouse_inspections: {
        Row: {
          created_at: string
          created_by: string | null
          cuttable_width: number | null
          deviation_approved_at: string | null
          deviation_approved_by: string | null
          deviation_reason: string | null
          deviation_reference: string | null
          factory_id: string
          field_values: Json
          id: string
          in_challan_id: string | null
          inherited_from: string | null
          inspected_at: string
          inspected_by: string | null
          inspected_length: number | null
          mill_batch_id: string | null
          mill_roll_id: string | null
          occasion: string
          override_at: string | null
          override_by: string | null
          override_reason: string | null
          points_per_100_sqyd: number | null
          process_challan_id: string | null
          pts_1: number
          pts_2: number
          pts_3: number
          pts_4: number
          remarks: string | null
          result: string
          result_computed: string | null
          result_override: string | null
          row_version: number
          scope_id: string
          scope_kind: string
          shade: string | null
          site: string
          stock_unit_id: string | null
          threshold_used: number | null
          total_points: number | null
          updated_at: string
          updated_by: string | null
          width_uom: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          cuttable_width?: number | null
          deviation_approved_at?: string | null
          deviation_approved_by?: string | null
          deviation_reason?: string | null
          deviation_reference?: string | null
          factory_id: string
          field_values?: Json
          id?: string
          in_challan_id?: string | null
          inherited_from?: string | null
          inspected_at?: string
          inspected_by?: string | null
          inspected_length?: number | null
          mill_batch_id?: string | null
          mill_roll_id?: string | null
          occasion: string
          override_at?: string | null
          override_by?: string | null
          override_reason?: string | null
          points_per_100_sqyd?: number | null
          process_challan_id?: string | null
          pts_1?: number
          pts_2?: number
          pts_3?: number
          pts_4?: number
          remarks?: string | null
          result: string
          result_computed?: string | null
          result_override?: string | null
          row_version?: number
          scope_id: string
          scope_kind: string
          shade?: string | null
          site: string
          stock_unit_id?: string | null
          threshold_used?: number | null
          total_points?: number | null
          updated_at?: string
          updated_by?: string | null
          width_uom?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          cuttable_width?: number | null
          deviation_approved_at?: string | null
          deviation_approved_by?: string | null
          deviation_reason?: string | null
          deviation_reference?: string | null
          factory_id?: string
          field_values?: Json
          id?: string
          in_challan_id?: string | null
          inherited_from?: string | null
          inspected_at?: string
          inspected_by?: string | null
          inspected_length?: number | null
          mill_batch_id?: string | null
          mill_roll_id?: string | null
          occasion?: string
          override_at?: string | null
          override_by?: string | null
          override_reason?: string | null
          points_per_100_sqyd?: number | null
          process_challan_id?: string | null
          pts_1?: number
          pts_2?: number
          pts_3?: number
          pts_4?: number
          remarks?: string | null
          result?: string
          result_computed?: string | null
          result_override?: string | null
          row_version?: number
          scope_id?: string
          scope_kind?: string
          shade?: string | null
          site?: string
          stock_unit_id?: string | null
          threshold_used?: number | null
          total_points?: number | null
          updated_at?: string
          updated_by?: string | null
          width_uom?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mm_warehouse_inspections_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_warehouse_inspections_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_warehouse_inspections_in_challan_id_fkey"
            columns: ["in_challan_id"]
            isOneToOne: false
            referencedRelation: "mm_in_challans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_warehouse_inspections_inherited_from_fkey"
            columns: ["inherited_from"]
            isOneToOne: false
            referencedRelation: "mm_warehouse_inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_warehouse_inspections_inspected_by_fkey"
            columns: ["inspected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_warehouse_inspections_mill_batch_id_fkey"
            columns: ["mill_batch_id"]
            isOneToOne: false
            referencedRelation: "mm_mill_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_warehouse_inspections_mill_roll_id_fkey"
            columns: ["mill_roll_id"]
            isOneToOne: false
            referencedRelation: "mm_mill_rolls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_warehouse_inspections_process_challan_id_fkey"
            columns: ["process_challan_id"]
            isOneToOne: false
            referencedRelation: "mm_process_challans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_warehouse_inspections_stock_unit_id_fkey"
            columns: ["stock_unit_id"]
            isOneToOne: false
            referencedRelation: "mm_stock_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_warehouse_inspections_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      operations: {
        Row: {
          capture_app: string | null
          created_at: string
          department_id: string
          factory_id: string
          id: string
          is_active: boolean
          name: string
          step_type: string
          updated_at: string
        }
        Insert: {
          capture_app?: string | null
          created_at?: string
          department_id: string
          factory_id: string
          id?: string
          is_active?: boolean
          name: string
          step_type?: string
          updated_at?: string
        }
        Update: {
          capture_app?: string | null
          created_at?: string
          department_id?: string
          factory_id?: string
          id?: string
          is_active?: boolean
          name?: string
          step_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "operations_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operations_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
        ]
      }
      order_delivery_target_history: {
        Row: {
          change_reason: string | null
          changed_at: string
          changed_by: string | null
          colorway_id: string | null
          factory_id: string
          id: string
          new_qty_by_size: Json | null
          new_ship_mode: string | null
          new_shipment_type: string | null
          new_target_date: string | null
          old_qty_by_size: Json | null
          old_ship_mode: string | null
          old_shipment_type: string | null
          old_target_date: string | null
          order_id: string
          target_id: string
        }
        Insert: {
          change_reason?: string | null
          changed_at?: string
          changed_by?: string | null
          colorway_id?: string | null
          factory_id: string
          id?: string
          new_qty_by_size?: Json | null
          new_ship_mode?: string | null
          new_shipment_type?: string | null
          new_target_date?: string | null
          old_qty_by_size?: Json | null
          old_ship_mode?: string | null
          old_shipment_type?: string | null
          old_target_date?: string | null
          order_id: string
          target_id: string
        }
        Update: {
          change_reason?: string | null
          changed_at?: string
          changed_by?: string | null
          colorway_id?: string | null
          factory_id?: string
          id?: string
          new_qty_by_size?: Json | null
          new_ship_mode?: string | null
          new_shipment_type?: string | null
          new_target_date?: string | null
          old_qty_by_size?: Json | null
          old_ship_mode?: string | null
          old_shipment_type?: string | null
          old_target_date?: string | null
          order_id?: string
          target_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_delivery_target_history_colorway_id_fkey"
            columns: ["colorway_id"]
            isOneToOne: false
            referencedRelation: "colorways"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_delivery_target_history_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_delivery_target_history_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "style_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_delivery_target_history_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "order_delivery_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      order_delivery_targets: {
        Row: {
          change_history: Json
          colorway_id: string | null
          created_at: string
          destination_country: string | null
          factory_id: string
          id: string
          notes: string | null
          order_id: string
          qty_by_size: Json
          ship_mode: string | null
          shipment_type: string | null
          status: string
          target_date: string
          total_qty: number
          updated_at: string
        }
        Insert: {
          change_history?: Json
          colorway_id?: string | null
          created_at?: string
          destination_country?: string | null
          factory_id: string
          id?: string
          notes?: string | null
          order_id: string
          qty_by_size?: Json
          ship_mode?: string | null
          shipment_type?: string | null
          status?: string
          target_date: string
          total_qty?: number
          updated_at?: string
        }
        Update: {
          change_history?: Json
          colorway_id?: string | null
          created_at?: string
          destination_country?: string | null
          factory_id?: string
          id?: string
          notes?: string | null
          order_id?: string
          qty_by_size?: Json
          ship_mode?: string | null
          shipment_type?: string | null
          status?: string
          target_date?: string
          total_qty?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_delivery_targets_colorway_id_fkey"
            columns: ["colorway_id"]
            isOneToOne: false
            referencedRelation: "colorways"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_delivery_targets_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_delivery_targets_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "style_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_routing_steps: {
        Row: {
          capture_app: string | null
          created_at: string
          dept_id: string
          dept_name: string
          factory_id: string
          id: string
          is_dept_exit_operation: boolean
          is_primary_output: boolean
          operation_def_id: string | null
          operation_name: string | null
          order_id: string
          seq: number
          step_type: string | null
          transaction_app: boolean
          updated_at: string
          visit_id: string | null
          visit_no: number | null
        }
        Insert: {
          capture_app?: string | null
          created_at?: string
          dept_id: string
          dept_name: string
          factory_id: string
          id?: string
          is_dept_exit_operation?: boolean
          is_primary_output?: boolean
          operation_def_id?: string | null
          operation_name?: string | null
          order_id: string
          seq: number
          step_type?: string | null
          transaction_app?: boolean
          updated_at?: string
          visit_id?: string | null
          visit_no?: number | null
        }
        Update: {
          capture_app?: string | null
          created_at?: string
          dept_id?: string
          dept_name?: string
          factory_id?: string
          id?: string
          is_dept_exit_operation?: boolean
          is_primary_output?: boolean
          operation_def_id?: string | null
          operation_name?: string | null
          order_id?: string
          seq?: number
          step_type?: string | null
          transaction_app?: boolean
          updated_at?: string
          visit_id?: string | null
          visit_no?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "order_routing_steps_dept_id_fkey"
            columns: ["dept_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_routing_steps_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_routing_steps_operation_def_id_fkey"
            columns: ["operation_def_id"]
            isOneToOne: false
            referencedRelation: "operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_routing_steps_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "style_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      outsource_work_movements: {
        Row: {
          challan_number: string | null
          colorway_id: string | null
          created_at: string
          department_id: string
          factory_id: string
          id: string
          idempotency_key: string | null
          line_allocation_id: string | null
          linked_send_id: string | null
          logged_by: string | null
          movement_type: string
          notes: string | null
          occurred_at: string
          order_id: string
          order_route_id: string | null
          qty: number
          qty_by_size: Json
          vendor_resource_id: string
          visit_id: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          challan_number?: string | null
          colorway_id?: string | null
          created_at?: string
          department_id: string
          factory_id: string
          id?: string
          idempotency_key?: string | null
          line_allocation_id?: string | null
          linked_send_id?: string | null
          logged_by?: string | null
          movement_type: string
          notes?: string | null
          occurred_at?: string
          order_id: string
          order_route_id?: string | null
          qty: number
          qty_by_size?: Json
          vendor_resource_id: string
          visit_id: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          challan_number?: string | null
          colorway_id?: string | null
          created_at?: string
          department_id?: string
          factory_id?: string
          id?: string
          idempotency_key?: string | null
          line_allocation_id?: string | null
          linked_send_id?: string | null
          logged_by?: string | null
          movement_type?: string
          notes?: string | null
          occurred_at?: string
          order_id?: string
          order_route_id?: string | null
          qty?: number
          qty_by_size?: Json
          vendor_resource_id?: string
          visit_id?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outsource_work_movements_colorway_id_fkey"
            columns: ["colorway_id"]
            isOneToOne: false
            referencedRelation: "colorways"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outsource_work_movements_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outsource_work_movements_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outsource_work_movements_line_allocation_id_fkey"
            columns: ["line_allocation_id"]
            isOneToOne: false
            referencedRelation: "line_allocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outsource_work_movements_linked_send_id_fkey"
            columns: ["linked_send_id"]
            isOneToOne: false
            referencedRelation: "outsource_work_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outsource_work_movements_logged_by_fkey"
            columns: ["logged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outsource_work_movements_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "style_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outsource_work_movements_order_route_id_fkey"
            columns: ["order_route_id"]
            isOneToOne: false
            referencedRelation: "order_routing_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outsource_work_movements_vendor_resource_id_fkey"
            columns: ["vendor_resource_id"]
            isOneToOne: false
            referencedRelation: "assigned_resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outsource_work_movements_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      process_flows: {
        Row: {
          created_at: string
          description: string | null
          factory_id: string
          id: string
          name: string
          steps: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          factory_id: string
          id?: string
          name: string
          steps?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          factory_id?: string
          id?: string
          name?: string
          steps?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "process_flows_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          assigned_apps: Json
          audit_enabled: boolean
          can_produce: boolean
          created_at: string
          department_id: string | null
          email: string | null
          factory_id: string
          floor_pin: string | null
          full_name: string | null
          handover_enabled: boolean
          id: string
          preferred_resource_ids: Json
          shipment_qa_enabled: boolean
          status: string
          updated_at: string
          user_role: string
          workforce_enabled: boolean
        }
        Insert: {
          assigned_apps?: Json
          audit_enabled?: boolean
          can_produce?: boolean
          created_at?: string
          department_id?: string | null
          email?: string | null
          factory_id: string
          floor_pin?: string | null
          full_name?: string | null
          handover_enabled?: boolean
          id: string
          preferred_resource_ids?: Json
          shipment_qa_enabled?: boolean
          status?: string
          updated_at?: string
          user_role?: string
          workforce_enabled?: boolean
        }
        Update: {
          assigned_apps?: Json
          audit_enabled?: boolean
          can_produce?: boolean
          created_at?: string
          department_id?: string | null
          email?: string | null
          factory_id?: string
          floor_pin?: string | null
          full_name?: string | null
          handover_enabled?: boolean
          id?: string
          preferred_resource_ids?: Json
          shipment_qa_enabled?: boolean
          status?: string
          updated_at?: string
          user_role?: string
          workforce_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "profiles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
        ]
      }
      rejections: {
        Row: {
          colorway_id: string | null
          defect_summary: Json | null
          factory_id: string
          id: string
          image_urls: string[] | null
          logged_at: string
          logged_by: string | null
          notes: string | null
          order_id: string
          order_route_id: string | null
          qty: number
          reason_code: string
          reason_detail: string | null
          rejected_date: string
          rejected_qty_by_size: Json | null
          size: string | null
          stage: string
          visit_id: string | null
        }
        Insert: {
          colorway_id?: string | null
          defect_summary?: Json | null
          factory_id: string
          id?: string
          image_urls?: string[] | null
          logged_at?: string
          logged_by?: string | null
          notes?: string | null
          order_id: string
          order_route_id?: string | null
          qty: number
          reason_code: string
          reason_detail?: string | null
          rejected_date?: string
          rejected_qty_by_size?: Json | null
          size?: string | null
          stage: string
          visit_id?: string | null
        }
        Update: {
          colorway_id?: string | null
          defect_summary?: Json | null
          factory_id?: string
          id?: string
          image_urls?: string[] | null
          logged_at?: string
          logged_by?: string | null
          notes?: string | null
          order_id?: string
          order_route_id?: string | null
          qty?: number
          reason_code?: string
          reason_detail?: string | null
          rejected_date?: string
          rejected_qty_by_size?: Json | null
          size?: string | null
          stage?: string
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rejections_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rejections_logged_by_fkey"
            columns: ["logged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rejections_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "style_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rejections_order_route_id_fkey"
            columns: ["order_route_id"]
            isOneToOne: false
            referencedRelation: "order_routing_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          break_end: string | null
          break_start: string | null
          created_at: string
          end_time: string | null
          factory_id: string
          hours: Json
          id: string
          name: string
          productive_mins: number
          start_time: string | null
          type: string
          updated_at: string
        }
        Insert: {
          break_end?: string | null
          break_start?: string | null
          created_at?: string
          end_time?: string | null
          factory_id: string
          hours?: Json
          id?: string
          name: string
          productive_mins?: number
          start_time?: string | null
          type?: string
          updated_at?: string
        }
        Update: {
          break_end?: string | null
          break_start?: string | null
          created_at?: string
          end_time?: string | null
          factory_id?: string
          hours?: Json
          id?: string
          name?: string
          productive_mins?: number
          start_time?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shifts_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_audits: {
        Row: {
          aql_level: string | null
          audit_date: string
          audit_type: string
          colorway_id: string
          completed_at: string | null
          factory_id: string
          failed: number
          id: string
          logged_at: string
          logged_by: string
          lot_size: number
          major_failed: number
          minor_failed: number
          notes: string | null
          order_id: string
          passed: number
          pieces_json: Json
          reaudit_of: string | null
          result: string | null
          sample_size: number
          status: string
        }
        Insert: {
          aql_level?: string | null
          audit_date?: string
          audit_type: string
          colorway_id: string
          completed_at?: string | null
          factory_id: string
          failed?: number
          id?: string
          logged_at?: string
          logged_by: string
          lot_size: number
          major_failed?: number
          minor_failed?: number
          notes?: string | null
          order_id: string
          passed?: number
          pieces_json?: Json
          reaudit_of?: string | null
          result?: string | null
          sample_size: number
          status?: string
        }
        Update: {
          aql_level?: string | null
          audit_date?: string
          audit_type?: string
          colorway_id?: string
          completed_at?: string | null
          factory_id?: string
          failed?: number
          id?: string
          logged_at?: string
          logged_by?: string
          lot_size?: number
          major_failed?: number
          minor_failed?: number
          notes?: string | null
          order_id?: string
          passed?: number
          pieces_json?: Json
          reaudit_of?: string | null
          result?: string | null
          sample_size?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipment_audits_colorway_id_fkey"
            columns: ["colorway_id"]
            isOneToOne: false
            referencedRelation: "colorways"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_audits_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_audits_logged_by_fkey"
            columns: ["logged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_audits_reaudit_of_fkey"
            columns: ["reaudit_of"]
            isOneToOne: false
            referencedRelation: "shipment_audits"
            referencedColumns: ["id"]
          },
        ]
      }
      shipments: {
        Row: {
          awb_number: string | null
          colorway_id: string | null
          destination: string | null
          factory_id: string
          id: string
          invoice_number: string | null
          logged_at: string
          logged_by: string | null
          notes: string | null
          order_id: string
          order_route_id: string | null
          po_number: string | null
          shipment_date: string
          shipment_type: string
          shipped_qty: number
          shipped_qty_by_size: Json
          visit_id: string | null
        }
        Insert: {
          awb_number?: string | null
          colorway_id?: string | null
          destination?: string | null
          factory_id: string
          id?: string
          invoice_number?: string | null
          logged_at?: string
          logged_by?: string | null
          notes?: string | null
          order_id: string
          order_route_id?: string | null
          po_number?: string | null
          shipment_date?: string
          shipment_type: string
          shipped_qty: number
          shipped_qty_by_size?: Json
          visit_id?: string | null
        }
        Update: {
          awb_number?: string | null
          colorway_id?: string | null
          destination?: string | null
          factory_id?: string
          id?: string
          invoice_number?: string | null
          logged_at?: string
          logged_by?: string | null
          notes?: string | null
          order_id?: string
          order_route_id?: string | null
          po_number?: string | null
          shipment_date?: string
          shipment_type?: string
          shipped_qty?: number
          shipped_qty_by_size?: Json
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipments_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_logged_by_fkey"
            columns: ["logged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_order_route_id_fkey"
            columns: ["order_route_id"]
            isOneToOne: false
            referencedRelation: "order_routing_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      size_groups: {
        Row: {
          buyer_id: string | null
          created_at: string
          factory_id: string
          id: string
          name: string
          sizes: Json
          updated_at: string
        }
        Insert: {
          buyer_id?: string | null
          created_at?: string
          factory_id: string
          id?: string
          name: string
          sizes?: Json
          updated_at?: string
        }
        Update: {
          buyer_id?: string | null
          created_at?: string
          factory_id?: string
          id?: string
          name?: string
          sizes?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "size_groups_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "buyers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "size_groups_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
        ]
      }
      style_orders: {
        Row: {
          adj_qty: number
          buyer_id: string | null
          buyer_name: string | null
          created_at: string
          current_dept: string | null
          cutting_allowance: number
          factory_id: string
          garment_type: string | null
          id: string
          image_url: string | null
          internal_order_no: string | null
          job_card_date: string | null
          merchant_name: string | null
          order_date: string | null
          order_qty: number
          order_type: string
          po_number: string
          priority: string
          remarks: string | null
          season: string | null
          sewing_sam: number | null
          shipment_allowance: number
          size_group_name: string | null
          size_labels: string | null
          status: string
          style_name: string
          style_ref: string | null
          updated_at: string
        }
        Insert: {
          adj_qty?: number
          buyer_id?: string | null
          buyer_name?: string | null
          created_at?: string
          current_dept?: string | null
          cutting_allowance?: number
          factory_id: string
          garment_type?: string | null
          id?: string
          image_url?: string | null
          internal_order_no?: string | null
          job_card_date?: string | null
          merchant_name?: string | null
          order_date?: string | null
          order_qty?: number
          order_type?: string
          po_number?: string
          priority?: string
          remarks?: string | null
          season?: string | null
          sewing_sam?: number | null
          shipment_allowance?: number
          size_group_name?: string | null
          size_labels?: string | null
          status?: string
          style_name: string
          style_ref?: string | null
          updated_at?: string
        }
        Update: {
          adj_qty?: number
          buyer_id?: string | null
          buyer_name?: string | null
          created_at?: string
          current_dept?: string | null
          cutting_allowance?: number
          factory_id?: string
          garment_type?: string | null
          id?: string
          image_url?: string | null
          internal_order_no?: string | null
          job_card_date?: string | null
          merchant_name?: string | null
          order_date?: string | null
          order_qty?: number
          order_type?: string
          po_number?: string
          priority?: string
          remarks?: string | null
          season?: string | null
          sewing_sam?: number | null
          shipment_allowance?: number
          size_group_name?: string | null
          size_labels?: string | null
          status?: string
          style_name?: string
          style_ref?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "style_orders_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "buyers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "style_orders_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
        ]
      }
      support_dropdowns: {
        Row: {
          app_name: string | null
          category: string
          created_at: string
          factory_id: string
          id: string
          updated_at: string
          values: Json
        }
        Insert: {
          app_name?: string | null
          category: string
          created_at?: string
          factory_id: string
          id?: string
          updated_at?: string
          values?: Json
        }
        Update: {
          app_name?: string | null
          category?: string
          created_at?: string
          factory_id?: string
          id?: string
          updated_at?: string
          values?: Json
        }
        Relationships: [
          {
            foreignKeyName: "support_dropdowns_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
        ]
      }
      workforce_logs: {
        Row: {
          colorway_id: string | null
          department_id: string
          factory_id: string
          headcount_by_category: Json
          id: string
          line_allocation_id: string | null
          log_date: string
          logged_at: string
          logged_by: string | null
          order_id: string | null
          order_route_id: string | null
          resource_id: string | null
          shift_id: string | null
          visit_id: string | null
        }
        Insert: {
          colorway_id?: string | null
          department_id: string
          factory_id: string
          headcount_by_category?: Json
          id?: string
          line_allocation_id?: string | null
          log_date?: string
          logged_at?: string
          logged_by?: string | null
          order_id?: string | null
          order_route_id?: string | null
          resource_id?: string | null
          shift_id?: string | null
          visit_id?: string | null
        }
        Update: {
          colorway_id?: string | null
          department_id?: string
          factory_id?: string
          headcount_by_category?: Json
          id?: string
          line_allocation_id?: string | null
          log_date?: string
          logged_at?: string
          logged_by?: string | null
          order_id?: string | null
          order_route_id?: string | null
          resource_id?: string | null
          shift_id?: string | null
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workforce_logs_colorway_id_fkey"
            columns: ["colorway_id"]
            isOneToOne: false
            referencedRelation: "colorways"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workforce_logs_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workforce_logs_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workforce_logs_line_allocation_id_fkey"
            columns: ["line_allocation_id"]
            isOneToOne: false
            referencedRelation: "line_allocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workforce_logs_logged_by_fkey"
            columns: ["logged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workforce_logs_order_route_id_fkey"
            columns: ["order_route_id"]
            isOneToOne: false
            referencedRelation: "order_routing_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workforce_logs_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "assigned_resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workforce_logs_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workforce_logs_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "v_shift_minutes"
            referencedColumns: ["shift_id"]
          },
        ]
      }
    }
    Views: {
      mm_v_mill_accuracy_summary: {
        Row: {
          avg_abs_delta_pct: number | null
          factory_id: string | null
          key: string | null
          max_abs_delta_pct: number | null
          max_declared: number | null
          max_measured: number | null
          mill_batch_id: string | null
          min_declared: number | null
          min_measured: number | null
          sample_count: number | null
        }
        Relationships: []
      }
      mm_v_mill_field_accuracy: {
        Row: {
          declared: number | null
          delta: number | null
          delta_pct: number | null
          factory_id: string | null
          inspected_at: string | null
          key: string | null
          measured: number | null
          mill_batch_id: string | null
          stock_unit_id: string | null
          unit_code: string | null
        }
        Relationships: []
      }
      mm_v_style_fabric_reconciliation: {
        Row: {
          at_cutting: number | null
          balance_check: number | null
          color_name: string | null
          consumed: number | null
          fabric_name: string | null
          factory_id: string | null
          issued_to_cutting: number | null
          on_hand_warehouse: number | null
          order_id: string | null
          qc_deducted: number | null
          received: number | null
          required: number | null
          returned_from_cutting: number | null
          returned_to_supplier: number | null
          shortage: number | null
          style_material_id: string | null
          uom: string | null
          waste: number | null
          written_off: number | null
        }
        Relationships: [
          {
            foreignKeyName: "mm_style_materials_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mm_style_materials_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "style_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      v_cut_to_ship_summary: {
        Row: {
          colorway_id: string | null
          factory_id: string | null
          order_id: string | null
          qty_balance: number | null
          qty_cut: number | null
          qty_rejected: number | null
          qty_shipped: number | null
        }
        Relationships: []
      }
      v_cutting_component_progress: {
        Row: {
          colorway_id: string | null
          fabric_code: string | null
          fabric_component_id: string | null
          fabric_type: string | null
          factory_id: string | null
          is_primary: boolean | null
          operation_id: string | null
          order_id: string | null
          qty: number | null
          qty_by_size: Json | null
          visit_id: string | null
        }
        Relationships: []
      }
      v_daily_audit: {
        Row: {
          aql_level: string | null
          colorway_id: string | null
          defective_pct: number | null
          department_id: string | null
          department_name: string | null
          factory_id: string | null
          failed: number | null
          log_date: string | null
          lots: number | null
          lots_failed: number | null
          lots_pass_pct: number | null
          lots_passed: number | null
          major_failed: number | null
          minor_failed: number | null
          operation_id: string | null
          operation_name: string | null
          order_id: string | null
          passed: number | null
          resource_allocation_id: string | null
          resource_id: string | null
          resource_name: string | null
          samples_inspected: number | null
          shift_id: string | null
          shift_name: string | null
          step_type: string | null
        }
        Relationships: []
      }
      v_daily_production: {
        Row: {
          capture_source: string | null
          colorway_id: string | null
          department_id: string | null
          department_name: string | null
          fabric_component_id: string | null
          factory_id: string | null
          log_date: string | null
          operation_id: string | null
          operation_name: string | null
          order_id: string | null
          produced_mins: number | null
          qty: number | null
          resource_allocation_id: string | null
          resource_id: string | null
          resource_name: string | null
          shift_id: string | null
          shift_name: string | null
          step_type: string | null
        }
        Relationships: []
      }
      v_daily_quality: {
        Row: {
          colorway_id: string | null
          defective_pct: number | null
          department_id: string | null
          department_name: string | null
          dhu: number | null
          factory_id: string | null
          failed: number | null
          first_time_pass: number | null
          ftr_pct: number | null
          inspected: number | null
          log_date: string | null
          operation_id: string | null
          operation_name: string | null
          order_id: string | null
          resource_allocation_id: string | null
          resource_id: string | null
          resource_name: string | null
          rework_pass: number | null
          shift_id: string | null
          shift_name: string | null
          step_type: string | null
          top_defects: Json | null
          total_pass: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inspection_sessions_colorway_id_fkey"
            columns: ["colorway_id"]
            isOneToOne: false
            referencedRelation: "colorways"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_sessions_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_sessions_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_sessions_line_allocation_id_fkey"
            columns: ["resource_allocation_id"]
            isOneToOne: false
            referencedRelation: "line_allocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_sessions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "style_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_sessions_order_route_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "order_routing_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_sessions_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "assigned_resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_sessions_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_sessions_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "v_shift_minutes"
            referencedColumns: ["shift_id"]
          },
        ]
      }
      v_daily_target: {
        Row: {
          colorway_id: string | null
          daily_target: number | null
          department_id: string | null
          factory_id: string | null
          log_date: string | null
          operation_id: string | null
          order_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "line_allocations_colorway_id_fkey"
            columns: ["colorway_id"]
            isOneToOne: false
            referencedRelation: "colorways"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "line_allocations_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "line_allocations_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "line_allocations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "style_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      v_day_floor_board: {
        Row: {
          colorway_id: string | null
          department_id: string | null
          factory_id: string | null
          log_date: string | null
          order_id: string | null
          produced: number | null
          received: number | null
          sent: number | null
        }
        Relationships: []
      }
      v_department_kpis_by_shift: {
        Row: {
          daily_target: number | null
          data_completeness: string | null
          defective_pct: number | null
          department_id: string | null
          dhu: number | null
          factory_id: string | null
          has_output: boolean | null
          has_workforce: boolean | null
          log_date: string | null
          operation_id: string | null
          order_id: string | null
          shift_available_mins: number | null
          shift_efficiency_pct: number | null
          shift_headcount: number | null
          shift_id: string | null
          shift_name: string | null
          shift_output: number | null
          shift_produced_mins: number | null
          shift_productivity: number | null
        }
        Relationships: []
      }
      v_department_progress: {
        Row: {
          available_to_send: number | null
          colorway_id: string | null
          dept_id: string | null
          dept_name: string | null
          factory_id: string | null
          flow_step: number | null
          is_in_flow: boolean | null
          order_id: string | null
          planned_qty: number | null
          qty_produced: number | null
          qty_produced_by_size: Json | null
          qty_received: number | null
          qty_received_by_size: Json | null
          qty_rejected: number | null
          qty_rejected_by_size: Json | null
          qty_sent: number | null
          qty_sent_by_size: Json | null
          remaining_qty: number | null
          status: string | null
          visit_id: string | null
          wip_qty: number | null
          wip_qty_by_size: Json | null
        }
        Relationships: []
      }
      v_operation_progress: {
        Row: {
          capture_app: string | null
          colorway_id: string | null
          dept_id: string | null
          dept_name: string | null
          dept_role: string | null
          factory_id: string | null
          is_primary_output: boolean | null
          operation_id: string | null
          order_id: string | null
          qty_produced: number | null
          qty_produced_by_size: Json | null
          route_seq: number | null
          step_type: string | null
          visit_id: string | null
        }
        Relationships: []
      }
      v_order_journey_by_resource: {
        Row: {
          colorway_id: string | null
          department_id: string | null
          department_name: string | null
          fabric_component_breakdown: Json | null
          factory_id: string | null
          loading_operation_id: string | null
          loading_operation_name: string | null
          loading_qty_produced: number | null
          loading_qty_produced_by_size: Json | null
          operation_id: string | null
          operation_name: string | null
          order_id: string | null
          produced_mins: number | null
          qty_produced: number | null
          qty_received: number | null
          qty_sent: number | null
          resource_allocation_id: string | null
          resource_id: string | null
          resource_name: string | null
          resource_type: string | null
          resource_visit_status: string | null
          sent_qty_by_resource: Json | null
          vendor_balance_qty: number | null
          vendor_name: string | null
          vendor_received_qty: number | null
          vendor_resource_id: string | null
          vendor_sent_qty: number | null
          visit_id: string | null
        }
        Relationships: []
      }
      v_order_rejected_qty_by_size: {
        Row: {
          colorway_id: string | null
          factory_id: string | null
          operation_id: string | null
          order_id: string | null
          rejected_qty: number | null
          size: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rejections_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rejections_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "style_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rejections_order_route_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "order_routing_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      v_outsource_summary: {
        Row: {
          balance_qty: number | null
          colorway_id: string | null
          department_id: string | null
          department_name: string | null
          factory_id: string | null
          operation_id: string | null
          operation_name: string | null
          order_id: string | null
          planned_qty: number | null
          received_qty: number | null
          resource_allocation_id: string | null
          resource_id: string | null
          resource_name: string | null
          sent_qty: number | null
          step_type: string | null
          visit_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outsource_work_movements_colorway_id_fkey"
            columns: ["colorway_id"]
            isOneToOne: false
            referencedRelation: "colorways"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outsource_work_movements_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outsource_work_movements_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outsource_work_movements_line_allocation_id_fkey"
            columns: ["resource_allocation_id"]
            isOneToOne: false
            referencedRelation: "line_allocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outsource_work_movements_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "style_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outsource_work_movements_order_route_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "order_routing_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outsource_work_movements_vendor_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "assigned_resources"
            referencedColumns: ["id"]
          },
        ]
      }
      v_shift_minutes: {
        Row: {
          factory_id: string | null
          productive_mins: number | null
          shift_id: string | null
          shift_name: string | null
          shift_type: string | null
        }
        Insert: {
          factory_id?: string | null
          productive_mins?: number | null
          shift_id?: string | null
          shift_name?: string | null
          shift_type?: string | null
        }
        Update: {
          factory_id?: string | null
          productive_mins?: number | null
          shift_id?: string | null
          shift_name?: string | null
          shift_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shifts_factory_id_fkey"
            columns: ["factory_id"]
            isOneToOne: false
            referencedRelation: "factories"
            referencedColumns: ["id"]
          },
        ]
      }
      v_shift_workforce_summary: {
        Row: {
          available_mins: number | null
          capture_source: string | null
          colorway_id: string | null
          department_id: string | null
          department_name: string | null
          factory_id: string | null
          headcount: number | null
          log_date: string | null
          order_id: string | null
          resource_allocation_id: string | null
          resource_id: string | null
          resource_name: string | null
          shift_id: string | null
          shift_name: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _assert_desktop_factory_scope: {
        Args: { p_factory_id: string }
        Returns: undefined
      }
      _mm_actor_factory_id: { Args: never; Returns: string }
      _mm_actor_id: { Args: never; Returns: string }
      _mm_apply_clearance: {
        Args: { p_unit_ids: string[] }
        Returns: undefined
      }
      _mm_apply_roll_tags_from_payload: {
        Args: { p_batch: string; p_factory: string; p_rolls: Json }
        Returns: undefined
      }
      _mm_challan_header: {
        Args: { p_ch: Database["public"]["Tables"]["mm_in_challans"]["Row"] }
        Returns: Json
      }
      _mm_counts_as_received: { Args: { p_status: string }; Returns: boolean }
      _mm_cutting_param_block: {
        Args: { p_unit: Database["public"]["Tables"]["mm_stock_units"]["Row"] }
        Returns: string
      }
      _mm_err: { Args: { p_code: string; p_message: string }; Returns: Json }
      _mm_fabric_check_spec: {
        Args: { p_factory: string; p_spec: Json; p_type: string }
        Returns: Json
      }
      _mm_fabric_code: { Args: { p_id: string }; Returns: string }
      _mm_fabric_custom_fields: {
        Args: { p_factory: string; p_type: string }
        Returns: {
          input_type: string
          label: string
          locked_when_used: boolean
          options: Json
          required: boolean
          spec_key: string
          visible: boolean
        }[]
      }
      _mm_fabric_duplicate_of: {
        Args: { p_dedupe: string; p_except: string; p_factory: string }
        Returns: string
      }
      _mm_fabric_form_bump: { Args: { p_factory: string }; Returns: number }
      _mm_fabric_form_json: {
        Args: { p_factory: string; p_type: string }
        Returns: Json
      }
      _mm_fabric_form_version: { Args: { p_factory: string }; Returns: number }
      _mm_fabric_guard: { Args: { p_level: string }; Returns: string }
      _mm_fabric_insert: {
        Args: { p_factory: string; p_norm: Json; p_status: string }
        Returns: string
      }
      _mm_fabric_json: { Args: { p_id: string }; Returns: Json }
      _mm_fabric_locked: { Args: { p_id: string }; Returns: boolean }
      _mm_fabric_normalize: {
        Args: { p_factory: string; p_row: Json }
        Returns: Json
      }
      _mm_fabric_normalize_full: {
        Args: { p_factory: string; p_row: Json }
        Returns: Json
      }
      _mm_fabric_reserved_keys: { Args: never; Returns: string[] }
      _mm_fabric_spec_key_used: {
        Args: { p_factory: string; p_key: string; p_type: string }
        Returns: boolean
      }
      _mm_fpt_score: {
        Args: {
          p_length: number
          p_length_uom: string
          p_points: number
          p_width: number
          p_width_uom: string
        }
        Returns: number
      }
      _mm_fpt_threshold: { Args: { p_unit_id: string }; Returns: number }
      _mm_get_mill_line_base: {
        Args: {
          p_colorway_id: string
          p_colorway_material_id: string
          p_order_id: string
        }
        Returns: Json
      }
      _mm_get_unallocated_mill_base: { Args: never; Returns: Json }
      _mm_get_warehouse_board_base: {
        Args: { p_order_ids: string[] }
        Returns: Json
      }
      _mm_guard_err: { Args: { p_sqlerrm: string }; Returns: Json }
      _mm_insert_mill_batch_rolls: {
        Args: {
          p_batch: string
          p_factory: string
          p_loc: string
          p_rolls: Json
          p_sm: string
        }
        Returns: number
      }
      _mm_insert_rolls: {
        Args: {
          p_challan: string
          p_factory: string
          p_freeze: boolean
          p_loc: string
          p_rolls: Json
          p_sm: string
          p_source: string
          p_status: string
        }
        Returns: number
      }
      _mm_is_on_hand: {
        Args: { p_loc_type: string; p_status: string }
        Returns: boolean
      }
      _mm_is_pickable_loc: { Args: { p_loc: string }; Returns: boolean }
      _mm_is_unassigned_loc: { Args: { p_loc: string }; Returns: boolean }
      _mm_juuid: { Args: { p: string }; Returns: string }
      _mm_ledger: {
        Args: {
          p_factory: string
          p_len: number
          p_loc_after: string
          p_loc_before: string
          p_note: string
          p_ref: string
          p_ref_table: string
          p_status_after: string
          p_status_before: string
          p_type: string
          p_unit: string
        }
        Returns: undefined
      }
      _mm_list_warehouse_stock_base: {
        Args: {
          p_buyer?: string
          p_location?: string
          p_page?: number
          p_page_size?: number
          p_search?: string
        }
        Returns: Json
      }
      _mm_loc: { Args: { p_code: string; p_factory: string }; Returns: string }
      _mm_loc_is_under: {
        Args: { p_loc: string; p_root: string }
        Returns: boolean
      }
      _mm_lockdown_table: { Args: { p_table: unknown }; Returns: undefined }
      _mm_lookup_style_material_id: {
        Args: {
          p_colorway_id: string
          p_colorway_material_id: string
          p_factory: string
          p_order_id: string
          p_type_id: string
        }
        Returns: string
      }
      _mm_mill_at_process: { Args: { p_roll: string }; Returns: boolean }
      _mm_mill_cell_status: {
        Args: { p_at_mill: number; p_dispatched: number }
        Returns: string
      }
      _mm_mill_inspect_stale: {
        Args: { p_inspected_at: string; p_mill_roll_id: string }
        Returns: boolean
      }
      _mm_mill_length: {
        Args: { p_unit: Database["public"]["Tables"]["mm_stock_units"]["Row"] }
        Returns: number
      }
      _mm_mill_list_batches_v4_base: {
        Args: { p_filter?: Json }
        Returns: Json
      }
      _mm_mill_short_closed: {
        Args: { p_style_material_id: string }
        Returns: boolean
      }
      _mm_next_doc: {
        Args: { p_factory: string; p_on?: string; p_prefix: string }
        Returns: string
      }
      _mm_next_fabric_code: { Args: { p_factory: string }; Returns: string }
      _mm_next_grn_no: {
        Args: { p_factory: string; p_on: string }
        Returns: string
      }
      _mm_num: { Args: { p_text: string }; Returns: number }
      _mm_ok: { Args: { p_data?: Json }; Returns: Json }
      _mm_param_text: { Args: { p_bag: Json; p_key: string }; Returns: string }
      _mm_payload_line_fabric: {
        Args: { p_factory: string; p_payload: Json }
        Returns: string
      }
      _mm_process_refresh: { Args: { p_id: string }; Returns: undefined }
      _mm_qc_passport: { Args: { p_roll_id: string }; Returns: Json }
      _mm_qc_scope_rolls: {
        Args: { p_factory: string; p_id: string; p_kind: string }
        Returns: string[]
      }
      _mm_qc_threshold: { Args: { p_roll_id: string }; Returns: number }
      _mm_receipt_err: { Args: { p_msg: string }; Returns: Json }
      _mm_receipt_fabric: {
        Args: { p_fabric_id: string; p_factory: string }
        Returns: {
          code: string
          color_method: string
          composition: Json
          composition_text: string
          construction_id: string
          created_at: string
          created_by: string | null
          dedupe_key: string
          design_ref: string | null
          fabric_type_id: string
          factory_id: string
          greige_gsm: number | null
          greige_width_in: number | null
          gsm: number
          hsn_code: string | null
          id: string
          image_url: string | null
          merged_into_id: string | null
          name: string
          remarks: string | null
          row_version: number
          spec_values: Json
          status: string
          supplier_article_no: string | null
          uom: string
          updated_at: string
          updated_by: string | null
          width_form: string
          width_in: number
        }
        SetofOptions: {
          from: "*"
          to: "mm_fabrics"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _mm_receipt_fabric_guc: { Args: never; Returns: string }
      _mm_recv_loc: { Args: { p_factory: string }; Returns: string }
      _mm_refresh_in_challan_status: { Args: { p_id: string }; Returns: string }
      _mm_require_config: { Args: never; Returns: string }
      _mm_require_ops: { Args: { p_key?: string }; Returns: string }
      _mm_resolve_style_material: {
        Args: {
          p_colorway_id: string
          p_colorway_material_id: string
          p_order_id: string
        }
        Returns: Json
      }
      _mm_roll_alive: { Args: { p_roll_id: string }; Returns: boolean }
      _mm_roll_custody: { Args: { p_roll_id: string }; Returns: Json }
      _mm_roll_row: {
        Args: { p_roll_id: string; p_with_passport?: boolean }
        Returns: Json
      }
      _mm_roll_stock: {
        Args: { p_factory: string }
        Returns: {
          bucket: string
          colour: string
          fabric_id: string
          fabric_type_id: string
          mill_roll_id: string
          out_line_id: string
          qty: number
          qty_kg: number
          qty_m: number
          roll_code: string
          roll_id: string
          side: string
          stock_unit_id: string
          style_material_id: string
          uom: string
        }[]
      }
      _mm_roll_style_material: { Args: { p_roll_id: string }; Returns: string }
      _mm_safe_numeric: { Args: { p_text: string }; Returns: number }
      _mm_seed_fabric_constructions: {
        Args: { p_factory: string; p_type_id: string }
        Returns: number
      }
      _mm_seed_fabric_form_schema: {
        Args: { p_factory: string }
        Returns: undefined
      }
      _mm_seed_ops_locations: {
        Args: { p_actor: string; p_factory: string }
        Returns: undefined
      }
      _mm_set_on_hand: {
        Args: { p_qty: number; p_received?: boolean; p_unit_id: string }
        Returns: undefined
      }
      _mm_slugify: { Args: { p_label: string }; Returns: string }
      _mm_stock_location_bucket: {
        Args: { p_cut: string; p_loc: string; p_status: string; p_wh: string }
        Returns: string
      }
      _mm_stock_location_label: { Args: { p_bucket: string }; Returns: string }
      _mm_stock_movement_action: {
        Args: {
          p_entry_type: string
          p_note: string
          p_ref_table: string
          p_status_after: string
        }
        Returns: string
      }
      _mm_stock_movement_kind: {
        Args: {
          p_entry_type: string
          p_note: string
          p_ref_table: string
          p_status_after: string
        }
        Returns: string
      }
      _mm_stock_totals: { Args: { p_rows: Json }; Returns: Json }
      _mm_store_line_missing: { Args: { p_unit_id: string }; Returns: boolean }
      _mm_style_label: { Args: { p_sm: string }; Returns: Json }
      _mm_unit_alloc_ok: {
        Args: {
          p_cut: string
          p_loc: string
          p_status: string
          p_store: string
          p_wh: string
        }
        Returns: boolean
      }
      _mm_unit_clearance: { Args: { p_unit_id: string }; Returns: Json }
      _mm_unit_on_hand: {
        Args: { p_unit: Database["public"]["Tables"]["mm_stock_units"]["Row"] }
        Returns: number
      }
      _mm_unit_on_hold: { Args: { p_unit_id: string }; Returns: boolean }
      _mm_unit_qty_received: {
        Args: { p_unit: Database["public"]["Tables"]["mm_stock_units"]["Row"] }
        Returns: number
      }
      _mm_v4_cut_blocks: {
        Args: { p_stock_unit_id: string; p_style_material_id?: string }
        Returns: Json
      }
      _mm_v4_on: { Args: { p_factory: string }; Returns: boolean }
      _mm_v4_seed_masters: { Args: { p_factory: string }; Returns: undefined }
      _mm_v4_selftest: { Args: { p_admin: string }; Returns: undefined }
      _mm_v4_selftest_wh: { Args: { p_admin: string }; Returns: undefined }
      _upsert_colorway_material: {
        Args: {
          p_colorway_id: string
          p_factory_id: string
          p_mat: Json
          p_order_id: string
          p_seq: number
        }
        Returns: string
      }
      aggregate_order_cut_qty: {
        Args: {
          p_colorway_id?: string
          p_factory_id: string
          p_order_id: string
        }
        Returns: Json
      }
      aggregate_top_defects: {
        Args: { p_limit?: number; summaries: Json[] }
        Returns: Json
      }
      allocation_grained_batch_agg: {
        Args: { p_factory_id: string; p_order_id: string }
        Returns: {
          colorway_id: string
          factory_id: string
          operation_id: string
          order_id: string
          qty_produced: number
          qty_produced_by_size: Json
        }[]
      }
      allocation_grained_hourly_agg: {
        Args: { p_factory_id: string; p_order_id: string }
        Returns: {
          colorway_id: string
          factory_id: string
          operation_id: string
          order_id: string
          qty_produced: number
          qty_produced_by_size: Json
        }[]
      }
      allocation_grained_outsource_agg: {
        Args: { p_factory_id: string; p_order_id: string }
        Returns: {
          colorway_id: string
          factory_id: string
          operation_id: string
          order_id: string
          qty_produced: number
          qty_produced_by_size: Json
        }[]
      }
      allocation_grained_qc_agg: {
        Args: { p_factory_id: string; p_order_id: string }
        Returns: {
          colorway_id: string
          factory_id: string
          operation_id: string
          order_id: string
          qty_produced: number
          qty_produced_by_size: Json
        }[]
      }
      assert_colorway_allows_production: {
        Args: { p_colorway_id: string }
        Returns: Json
      }
      assert_module_enabled: { Args: { p_key: string }; Returns: undefined }
      assert_outsource_vendor_resource: {
        Args: { p_department_id: string; p_vendor_resource_id: string }
        Returns: {
          capacity: number
          created_at: string
          department_id: string | null
          description: string | null
          factory_id: string
          id: string
          resource_name: string
          resource_type: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "assigned_resources"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      audit_pieces_defect_lines: {
        Args: { pieces_json: Json }
        Returns: {
          defect_count: number
          defect_name: string
        }[]
      }
      auto_reject_missing_pcs: {
        Args: {
          p_colorway_id?: string
          p_dry_run?: boolean
          p_factory_id: string
          p_order_id?: string
          p_slip_id?: string
          p_user_id?: string
          p_visit_id?: string
        }
        Returns: Json
      }
      auto_reject_missing_pcs_skip_qc_visit: {
        Args: { p_order_id: string; p_visit_id: string }
        Returns: boolean
      }
      can_desktop_fulfillment_write: { Args: never; Returns: boolean }
      capture_app_for_route_step: {
        Args: { p_factory_id: string; p_operation_def_id: string }
        Returns: string
      }
      capture_matches_alloc_grid: {
        Args: {
          p_capture_alloc_id: string
          p_capture_dept_id: string
          p_capture_route_id: string
          p_grid_alloc_id: string
          p_grid_dept_id: string
          p_grid_route_id: string
        }
        Returns: boolean
      }
      capture_route_step_id: { Args: { p_row: Json }; Returns: string }
      colorway_planned_by_size: {
        Args: { p_colorway_id: string }
        Returns: Json
      }
      compute_capture_session_kpi: {
        Args: {
          p_colorway_id: string
          p_department_id: string
          p_end_time: string
          p_factory_id: string
          p_headcount_by_category: Json
          p_log_date: string
          p_order_id: string
          p_order_route_id: string
          p_produced_qty: number
          p_resource_id: string
          p_start_time: string
        }
        Returns: {
          available_mins: number
          duration_mins: number
          efficiency_pct: number
          produced_mins: number
          sam: number
          worker_count: number
        }[]
      }
      compute_inspection_session_kpi: {
        Args: {
          p_defect_summary: Json
          p_failed: number
          p_passed: number
          p_passed_by_size: Json
          p_rework_by_size: Json
          p_rework_passed: number
          p_total_inspected: number
        }
        Returns: {
          defective_pct: number
          dhu: number
          first_time_pass: number
          first_time_pass_by_size: Json
          ftr_pct: number
        }[]
      }
      create_factory_floor_user: {
        Args: {
          p_assigned_apps?: Json
          p_assigned_operation_ids?: Json
          p_audit_enabled?: boolean
          p_department_id: string
          p_email: string
          p_factory_id: string
          p_floor_pin: string
          p_full_name: string
          p_handover_enabled?: boolean
          p_shipment_qa_enabled?: boolean
          p_status?: string
          p_user_role?: string
          p_workforce_enabled?: boolean
        }
        Returns: string
      }
      current_factory_id: { Args: never; Returns: string }
      current_user_role: { Args: never; Returns: string }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      cutting_component_progress_rows: {
        Args: { p_factory_id?: string; p_order_id?: string }
        Returns: {
          colorway_id: string
          fabric_code: string
          fabric_component_id: string
          fabric_type: string
          factory_id: string
          is_primary: boolean
          operation_id: string
          order_id: string
          qty: number
          qty_by_size: Json
          visit_id: string
        }[]
      }
      cutting_primary_fabric_type: {
        Args: { p_factory_id: string }
        Returns: string
      }
      cutting_refresh_lot_total: {
        Args: { p_lot_id: string }
        Returns: undefined
      }
      cutting_refresh_session_total: {
        Args: { p_session_id: string }
        Returns: undefined
      }
      default_defects_for_department: {
        Args: { p_dept_name: string }
        Returns: Json
      }
      delete_desktop_shipment: {
        Args: { p_factory_id: string; p_shipment_id: string }
        Returns: Json
      }
      delete_style_order: {
        Args: { p_factory_id: string; p_order_id: string }
        Returns: undefined
      }
      department_effective_apps: {
        Args: {
          p_apps: Json
          p_audit: boolean
          p_supervisor: boolean
          p_transaction: boolean
        }
        Returns: Json
      }
      dept_is_floor_production: {
        Args: { p_name: string; p_role: string }
        Returns: boolean
      }
      ensure_department_defects: {
        Args: {
          p_default_defects: Json
          p_department_id: string
          p_factory_id: string
        }
        Returns: Json
      }
      ensure_factory_fabric_components: {
        Args: { p_factory_id: string; p_origin_department_id: string }
        Returns: undefined
      }
      factory_rejection_stage_allowed: {
        Args: { p_factory_id: string; p_stage: string }
        Returns: boolean
      }
      floor_capture: {
        Args: {
          p_factory_id: string
          p_payload: Json
          p_type: string
          p_user_id: string
        }
        Returns: Json
      }
      floor_capture_allocation_complete: {
        Args: { p_payload: Json }
        Returns: Json
      }
      floor_capture_allocation_reopen: {
        Args: { p_payload: Json }
        Returns: Json
      }
      floor_capture_audit_session: {
        Args: { p_factory_id: string; p_payload: Json; p_user_id: string }
        Returns: Json
      }
      floor_capture_batch_upsert: {
        Args: { p_factory_id: string; p_payload: Json; p_user_id: string }
        Returns: Json
      }
      floor_capture_colorway_reaudit_complete: {
        Args: { p_factory_id: string; p_payload: Json; p_user_id: string }
        Returns: Json
      }
      floor_capture_colorway_reaudit_open: {
        Args: { p_factory_id: string; p_payload: Json; p_user_id: string }
        Returns: Json
      }
      floor_capture_colorway_ship_close: {
        Args: { p_factory_id: string; p_payload: Json; p_user_id: string }
        Returns: Json
      }
      floor_capture_cutting_balance: {
        Args: { p_factory_id: string; p_payload: Json; p_user_id: string }
        Returns: Json
      }
      floor_capture_cutting_bundle: {
        Args: { p_payload: Json }
        Returns: string
      }
      floor_capture_cutting_bundles_generate: {
        Args: { p_factory_id: string; p_payload: Json; p_user_id: string }
        Returns: Json
      }
      floor_capture_cutting_fabric_lot_upsert: {
        Args: { p_factory_id: string; p_payload: Json; p_user_id: string }
        Returns: Json
      }
      floor_capture_cutting_lay: { Args: { p_payload: Json }; Returns: string }
      floor_capture_cutting_lay_upsert: {
        Args: { p_factory_id: string; p_payload: Json; p_user_id: string }
        Returns: Json
      }
      floor_capture_cutting_session_flow_progress: {
        Args: { p_factory_id: string; p_payload: Json; p_user_id: string }
        Returns: Json
      }
      floor_capture_cutting_session_flow_resume: {
        Args: { p_factory_id: string; p_payload: Json; p_user_id: string }
        Returns: Json
      }
      floor_capture_cutting_session_lot_upsert: {
        Args: { p_factory_id: string; p_payload: Json; p_user_id: string }
        Returns: Json
      }
      floor_capture_cutting_session_upsert: {
        Args: { p_factory_id: string; p_payload: Json; p_user_id: string }
        Returns: Json
      }
      floor_capture_fail: {
        Args: { p_code: string; p_details?: Json; p_message: string }
        Returns: Json
      }
      floor_capture_handover_amend: {
        Args: { p_factory_id: string; p_payload: Json; p_user_id: string }
        Returns: Json
      }
      floor_capture_hourly_upsert: {
        Args: { p_factory_id: string; p_payload: Json; p_user_id: string }
        Returns: Json
      }
      floor_capture_inspection_session_upsert: {
        Args: { p_factory_id: string; p_payload: Json; p_user_id: string }
        Returns: Json
      }
      floor_capture_shipment_audit_session: {
        Args: { p_factory_id: string; p_payload: Json; p_user_id: string }
        Returns: Json
      }
      floor_capture_shipment_log: {
        Args: { p_factory_id: string; p_payload: Json; p_user_id: string }
        Returns: Json
      }
      floor_capture_shipment_rejection_log: {
        Args: { p_factory_id: string; p_payload: Json; p_user_id: string }
        Returns: Json
      }
      floor_login_rate_limited: {
        Args: { p_email?: string; p_profile_id?: string }
        Returns: boolean
      }
      floor_resolve_operation_step: {
        Args: {
          p_colorway_id: string
          p_expected_capture_app?: string
          p_factory_id: string
          p_flow_step_id: string
          p_skip_app_check?: boolean
          p_user_id: string
        }
        Returns: Json
      }
      floor_resolve_order_route_step: {
        Args: {
          p_expected_capture_app?: string
          p_factory_id: string
          p_order_id: string
          p_order_route_id: string
          p_skip_app_check?: boolean
          p_user_id: string
        }
        Returns: Json
      }
      floor_user_can_log_workforce: {
        Args: { p_profile_id: string }
        Returns: boolean
      }
      floor_user_department_id: {
        Args: { p_profile_id: string }
        Returns: string
      }
      floor_user_derived_apps: { Args: { p_profile_id: string }; Returns: Json }
      floor_user_operation_ids_json: {
        Args: { p_profile_id: string }
        Returns: Json
      }
      floor_validate_handover_steps: {
        Args: {
          p_colorway_id: string
          p_factory_id: string
          p_from_flow_step_id: string
          p_to_flow_step_id: string
        }
        Returns: Json
      }
      get_audit_report: {
        Args: {
          p_colorway_id?: string
          p_date_from: string
          p_date_to: string
          p_department_id?: string
          p_factory_id: string
          p_order_id?: string
        }
        Returns: {
          aql_level: string
          aql_pass_pct: number
          colorway_id: string
          department_id: string
          factory_id: string
          log_date: string
          lots: number
          order_id: string
          total_failed: number
          total_major_failed: number
          total_minor_failed: number
          total_passed: number
          total_samples: number
        }[]
      }
      get_cut_to_ship_detail: {
        Args: { p_factory_id: string; p_order_id: string }
        Returns: Json
      }
      get_cut_to_ship_journey: {
        Args: {
          p_colorway_id?: string
          p_factory_id: string
          p_order_id: string
        }
        Returns: Json[]
      }
      get_cut_to_ship_report: {
        Args: {
          p_balanced_only?: boolean
          p_buyer_id?: string
          p_date_from?: string
          p_date_to?: string
          p_factory_id: string
          p_order_ids?: string[]
        }
        Returns: {
          buyer_name: string
          colorway_id: string
          completion_pct: number
          cut_qty: number
          cut_qty_by_component: Json
          cut_qty_by_size: Json
          cut_qty_source: string
          factory_id: string
          is_balanced: boolean
          last_shipment_date: string
          order_id: string
          order_qty: number
          order_status: string
          po_number: string
          reconciliation_gap: number
          rejected_qty: number
          rejected_qty_by_size: Json
          shipped_qty: number
          shipped_qty_by_size: Json
          style_name: string
          wip_qty: number
          wip_qty_by_size: Json
        }[]
      }
      get_cut_to_ship_report_inner: {
        Args: {
          p_balanced_only?: boolean
          p_buyer_id?: string
          p_date_from?: string
          p_date_to?: string
          p_factory_id: string
          p_order_ids?: string[]
        }
        Returns: {
          buyer_name: string
          colorway_id: string
          completion_pct: number
          cut_qty: number
          cut_qty_by_component: Json
          cut_qty_by_size: Json
          cut_qty_source: string
          factory_id: string
          is_balanced: boolean
          last_shipment_date: string
          order_id: string
          order_qty: number
          order_status: string
          po_number: string
          reconciliation_gap: number
          rejected_qty: number
          rejected_qty_by_size: Json
          shipped_qty: number
          shipped_qty_by_size: Json
          style_name: string
          wip_qty: number
          wip_qty_by_size: Json
        }[]
      }
      get_cutting_department_id: {
        Args: { p_factory_id: string }
        Returns: string
      }
      get_cutting_department_id_for_order: {
        Args: { p_order_id: string }
        Returns: string
      }
      get_day_cutting_sessions: {
        Args: {
          p_date_from: string
          p_date_to: string
          p_department_id: string
          p_factory_id: string
        }
        Returns: {
          buyer_name: string
          color_name: string
          colorway_id: string
          ended_at: string
          fabric_code: string
          fabric_component_id: string
          fabric_type: string
          headcount_by_category: Json
          id: string
          is_primary_fabric: boolean
          is_primary_output: boolean
          lay_no: string
          log_date: string
          operation_def_id: string
          operation_name: string
          order_id: string
          order_route_id: string
          output_qty: number
          po_number: string
          ref_no: string
          resource_id: string
          resource_name: string
          session_no: string
          started_at: string
          style_name: string
          style_ref: string
        }[]
      }
      get_day_origin_report: {
        Args: {
          p_date_from: string
          p_date_to: string
          p_department_id: string
          p_factory_id: string
        }
        Returns: {
          buyer_name: string
          color_name: string
          colorway_id: string
          ended_at: string
          fabric_code: string
          fabric_component_id: string
          fabric_type: string
          headcount_by_category: Json
          id: string
          is_primary_fabric: boolean
          is_primary_output: boolean
          lay_no: string
          log_date: string
          operation_def_id: string
          operation_name: string
          order_id: string
          order_route_id: string
          output_qty: number
          po_number: string
          ref_no: string
          resource_id: string
          resource_name: string
          session_no: string
          started_at: string
          style_name: string
          style_ref: string
        }[]
      }
      get_day_standard_report: {
        Args: {
          p_date_from: string
          p_date_to: string
          p_department_id: string
          p_factory_id: string
        }
        Returns: {
          activity_no: string
          buyer_name: string
          color_name: string
          colorway_id: string
          comment: string
          ended_at: string
          headcount_by_category: Json
          hour_slot: string
          id: string
          inspected_qty: number
          log_date: string
          operation_def_id: string
          operation_name: string
          order_id: string
          order_route_id: string
          po_number: string
          qty: number
          ref_no: string
          resource_id: string
          resource_name: string
          shift_id: string
          source: string
          started_at: string
          style_name: string
          style_ref: string
        }[]
      }
      get_day_terminal_report: {
        Args: {
          p_date_from: string
          p_date_to: string
          p_department_id: string
          p_factory_id: string
        }
        Returns: {
          awb_number: string
          buyer_name: string
          color_name: string
          colorway_id: string
          destination: string
          id: string
          invoice_number: string
          log_date: string
          notes: string
          operation_name: string
          order_id: string
          order_route_id: string
          output_qty: number
          po_number: string
          shipment_type: string
          started_at: string
          style_name: string
          style_ref: string
        }[]
      }
      get_department_kpis: {
        Args: {
          p_date_from: string
          p_date_to: string
          p_department_id: string
          p_factory_id: string
        }
        Returns: {
          daily_target: number | null
          data_completeness: string | null
          defective_pct: number | null
          department_id: string | null
          dhu: number | null
          factory_id: string | null
          has_output: boolean | null
          has_workforce: boolean | null
          log_date: string | null
          operation_id: string | null
          order_id: string | null
          shift_available_mins: number | null
          shift_efficiency_pct: number | null
          shift_headcount: number | null
          shift_id: string | null
          shift_name: string | null
          shift_output: number | null
          shift_produced_mins: number | null
          shift_productivity: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "v_department_kpis_by_shift"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_department_kpis_by_shift: {
        Args: {
          p_date_from: string
          p_date_to: string
          p_department_id: string
          p_factory_id: string
        }
        Returns: {
          daily_target: number
          data_completeness: string
          defective_pct: number
          department_id: string
          dhu: number
          factory_id: string
          has_output: boolean
          has_workforce: boolean
          log_date: string
          operation_id: string
          order_id: string
          shift_available_mins: number
          shift_efficiency_pct: number
          shift_headcount: number
          shift_id: string
          shift_name: string
          shift_output: number
          shift_produced_mins: number
          shift_productivity: number
        }[]
      }
      get_dept_quality_for_date: {
        Args: {
          p_department_id: string
          p_factory_id: string
          p_log_date: string
        }
        Returns: {
          colorway_id: string
          defective_pct: number
          department_id: string
          dhu: number
          factory_id: string
          failed: number
          first_time_pass: number
          ftr_pct: number
          inspected: number
          log_date: string
          operation_id: string
          order_id: string
          resource_id: string
          rework_pass: number
          shift_id: string
          top_defects: Json
          total_pass: number
        }[]
      }
      get_factory_primary_fabric_component: {
        Args: { p_factory_id: string }
        Returns: string
      }
      get_factory_production_summary: {
        Args: { p_factory_id: string }
        Returns: {
          colorway_id: string
          department_id: string
          log_date: string
          operation_id: string
          order_id: string
          output_qty: number
        }[]
      }
      get_factory_schedule_actuals: {
        Args: { p_factory_id: string }
        Returns: {
          colorway_id: string
          department_id: string
          first_output_date: string
          last_output_date: string
          line_allocation_id: string
          operation_id: string
          order_id: string
          qty: number
        }[]
      }
      get_floor_bootstrap: { Args: { p_factory_id: string }; Returns: Json }
      get_floor_users: {
        Args: { p_factory_code: string }
        Returns: {
          assigned_apps: Json
          assigned_operation_ids: Json
          audit_enabled: boolean
          can_log_workforce: boolean
          department_id: string
          full_name: string
          handover_enabled: boolean
          id: string
          user_role: string
          workforce_enabled: boolean
        }[]
      }
      get_handover_report: {
        Args: {
          p_colorway_id?: string
          p_date_from?: string
          p_date_to?: string
          p_factory_id: string
          p_from_department_id?: string
          p_order_id?: string
          p_search?: string
          p_status?: string
          p_to_department_id?: string
        }
        Returns: {
          challan_number: string
          color_code: string
          colorway_id: string
          colorway_name: string
          from_department_id: string
          from_department_name: string
          from_produce_operation_names: string
          from_resource_name: string
          hour_slot: string
          id: string
          log_date: string
          loss_closed_at: string
          loss_closed_by: string
          loss_closed_by_name: string
          loss_rejection_id: string
          loss_remark: string
          missing_in_transit: number
          notes: string
          order_id: string
          po_number: string
          qty_by_size: Json
          received_at: string
          received_by: string
          received_by_name: string
          received_notes: string
          received_qty: number
          received_qty_by_size: Json
          sent_at: string
          sent_by: string
          sent_by_name: string
          sent_qty: number
          shift_id: string
          shift_name: string
          status: string
          style_name: string
          to_department_id: string
          to_department_name: string
          to_produce_operation_names: string
          to_resource_name: string
        }[]
      }
      get_line_allocation_actuals: {
        Args: {
          p_colorway_id?: string
          p_factory_id: string
          p_order_id?: string
        }
        Returns: {
          colorway_id: string
          department_id: string
          first_output_date: string
          last_output_date: string
          line_allocation_id: string
          operation_id: string
          order_id: string
          qty: number
        }[]
      }
      get_line_style_cards: {
        Args: {
          p_capture_app?: string
          p_department_id: string
          p_factory_id: string
          p_operation_def_id: string
          p_resource_id: string
        }
        Returns: Json
      }
      get_my_profile: { Args: never; Returns: Json }
      get_order_colorway_actuals: {
        Args: {
          p_colorway_id?: string
          p_factory_id: string
          p_order_id: string
        }
        Returns: {
          colorway_id: string
          department_id: string
          first_output_date: string
          last_output_date: string
          line_allocation_id: string
          operation_id: string
          order_id: string
          qty: number
        }[]
      }
      get_order_completion_page: {
        Args: {
          p_buyer_id?: string
          p_completion_filter?: string
          p_factory_id: string
          p_include_order_id?: string
          p_page?: number
          p_page_size?: number
          p_search?: string
        }
        Returns: {
          buyer_name: string
          earliest_delivery: string
          id: string
          po_number: string
          style_name: string
          total_count: number
        }[]
      }
      get_order_dept_progress: {
        Args: {
          p_colorway_id: string
          p_date?: string
          p_department_id: string
          p_factory_id: string
          p_order_id: string
        }
        Returns: Json
      }
      get_order_detail_bundle: {
        Args: { p_factory_id: string; p_order_id: string }
        Returns: Json
      }
      get_order_operation_progress: {
        Args: {
          p_colorway_id: string
          p_date?: string
          p_factory_id: string
          p_operation_id: string
          p_order_id: string
        }
        Returns: Json
      }
      get_orders_pipeline_page: {
        Args: {
          p_buyer_id?: string
          p_factory_id: string
          p_page?: number
          p_page_size?: number
          p_pipeline_status?: string
          p_search?: string
        }
        Returns: {
          adj_qty: number
          buyer_id: string
          buyer_name: string
          created_at: string
          id: string
          image_url: string
          order_qty: number
          po_number: string
          priority: string
          season: string
          status: string
          style_name: string
          style_ref: string
          total_count: number
        }[]
      }
      get_shift_for_hour_slot: {
        Args: { p_factory_id: string; p_hour_slot: string }
        Returns: string
      }
      get_shipment_colorway_summary: {
        Args: {
          p_colorway_id: string
          p_factory_id: string
          p_order_id: string
        }
        Returns: Json
      }
      get_style_kpis: {
        Args: { p_factory_id: string; p_order_id: string }
        Returns: {
          daily_target: number | null
          data_completeness: string | null
          defective_pct: number | null
          department_id: string | null
          dhu: number | null
          factory_id: string | null
          has_output: boolean | null
          has_workforce: boolean | null
          log_date: string | null
          operation_id: string | null
          order_id: string | null
          shift_available_mins: number | null
          shift_efficiency_pct: number | null
          shift_headcount: number | null
          shift_id: string | null
          shift_name: string | null
          shift_output: number | null
          shift_produced_mins: number | null
          shift_productivity: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "v_department_kpis_by_shift"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_today_rejections_for_order: {
        Args: {
          p_factory_id: string
          p_order_id: string
          p_rejected_date?: string
        }
        Returns: Json
      }
      handover_exit_operation_id: {
        Args: { p_department_id: string; p_order_id: string }
        Returns: string
      }
      handover_short_qty_by_size: {
        Args: { p_received: Json; p_sent: Json }
        Returns: Json
      }
      hash_floor_pin: { Args: { p_pin: string }; Returns: string }
      infer_hour_slot_for_timestamp: {
        Args: { p_factory_id: string; p_ts: string }
        Returns: string
      }
      infer_shift_id_for_inspection: {
        Args: { p_factory_id: string; p_logged_at: string }
        Returns: string
      }
      inspection_time_in_active_slot: {
        Args: { p_hours: Json; p_t: string }
        Returns: boolean
      }
      is_factory_admin: { Args: never; Returns: boolean }
      is_floor_data_writer: { Args: never; Returns: boolean }
      is_superadmin: { Args: never; Returns: boolean }
      jsonb_map_subtract_nonneg: {
        Args: { p_minuend: Json; p_subtrahend: Json }
        Returns: Json
      }
      jsonb_merge_sum_maps: { Args: { p_maps: Json[] }; Returns: Json }
      jsonb_subtract_maps_nonneg: {
        Args: { p_a: Json; p_b: Json }
        Returns: Json
      }
      jsonb_sum_int_values: { Args: { p_obj: Json }; Returns: number }
      jsonb_sum_merge: {
        Args: { existing: Json; incoming: Json }
        Returns: Json
      }
      jsonb_sum_size_maps: { Args: { p_maps: Json[] }; Returns: Json }
      log_audit_event: {
        Args: {
          p_action: string
          p_entity_id?: string
          p_entity_type: string
          p_factory_id: string
          p_metadata?: Json
        }
        Returns: undefined
      }
      log_desktop_rejection: {
        Args: { p_factory_id: string; p_payload: Json }
        Returns: Json
      }
      log_desktop_rejection_inner: {
        Args: { p_factory_id: string; p_payload: Json }
        Returns: Json
      }
      log_desktop_shipment: {
        Args: { p_factory_id: string; p_payload: Json }
        Returns: Json
      }
      log_desktop_shipment_inner: {
        Args: { p_factory_id: string; p_payload: Json }
        Returns: Json
      }
      log_outsource_work_movement:
        | {
            Args: {
              p_challan_number?: string
              p_colorway_id: string
              p_department_id: string
              p_factory_id: string
              p_idempotency_key?: string
              p_line_allocation_id: string
              p_linked_send_id?: string
              p_movement_type: string
              p_notes?: string
              p_occurred_at?: string
              p_order_id: string
              p_order_route_id: string
              p_qty: number
              p_qty_by_size?: Json
              p_vendor_resource_id: string
              p_visit_id: string
            }
            Returns: string
          }
        | {
            Args: {
              p_challan_number?: string
              p_colorway_id: string
              p_department_id: string
              p_factory_id: string
              p_idempotency_key?: string
              p_line_allocation_id: string
              p_linked_send_id?: string
              p_movement_type: string
              p_notes?: string
              p_occurred_at?: string
              p_order_id: string
              p_order_route_id: string
              p_qty: number
              p_qty_by_size?: Json
              p_user_id: string
              p_vendor_resource_id: string
              p_visit_id: string
            }
            Returns: string
          }
      lookup_line_allocation_kpi: {
        Args: {
          p_colorway_id: string
          p_department_id: string
          p_factory_id: string
          p_log_date: string
          p_operation_id?: string
          p_order_id: string
          p_resource_id: string
        }
        Returns: {
          daily_target: number
          sam: number
        }[]
      }
      mark_style_order_started: {
        Args: { p_factory_id: string; p_order_id: string }
        Returns: undefined
      }
      mm_allocate_mill_rolls_to_style: {
        Args: {
          p_colorway_id: string
          p_colorway_material_id: string
          p_order_id: string
          p_unit_ids: string[]
        }
        Returns: Json
      }
      mm_allocate_rolls_to_style: {
        Args: {
          p_colorway_id: string
          p_colorway_material_id: string
          p_order_id: string
          p_unit_ids: string[]
        }
        Returns: Json
      }
      mm_check_fabric_duplicate: { Args: { p_row: Json }; Returns: Json }
      mm_confirm_received_lengths: {
        Args: { p_challan_id: string; p_lengths: Json }
        Returns: Json
      }
      mm_create_store_challan: {
        Args: {
          p_challan_no?: string
          p_reference_no?: string
          p_remarks?: string
          p_sent_at?: string
          p_style_material_id: string
          p_unit_ids: string[]
        }
        Returns: Json
      }
      mm_deactivate_rack_location: { Args: { p_id: string }; Returns: Json }
      mm_delete_fabric_type: { Args: { p_id: string }; Returns: Json }
      mm_delete_trim_requirement_param: {
        Args: { p_id: string }
        Returns: Json
      }
      mm_dispatch_mill_rolls: {
        Args: {
          p_challan_no: string
          p_reference_no?: string
          p_remarks?: string
          p_sent_at?: string
          p_to_location?: string
          p_unit_ids: string[]
        }
        Returns: Json
      }
      mm_disposition_rejected: {
        Args: {
          p_action: string
          p_reason: string
          p_reference?: string
          p_unit_ids: string[]
        }
        Returns: Json
      }
      mm_enable_module: { Args: { p_config: Json }; Returns: Json }
      mm_exclude_roll: { Args: { p_unit_id: string }; Returns: Json }
      mm_fabric_stock_rolls: { Args: { p_filter?: Json }; Returns: Json }
      mm_fabric_stock_summary: { Args: { p_filter?: Json }; Returns: Json }
      mm_floor_call: {
        Args: {
          p_args: Json
          p_factory_id: string
          p_fn: string
          p_user_id: string
        }
        Returns: Json
      }
      mm_floor_gaps: { Args: never; Returns: Json }
      mm_get_config_bundle: { Args: never; Returns: Json }
      mm_get_expected_board: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_status?: string
        }
        Returns: Json
      }
      mm_get_fabric: { Args: { p_id: string }; Returns: Json }
      mm_get_fabric_form_schema: {
        Args: { p_fabric_type_id?: string }
        Returns: Json
      }
      mm_get_fpt_summary: {
        Args: { p_from?: string; p_group_by?: string; p_to?: string }
        Returns: Json
      }
      mm_get_in_challan_rolls: { Args: { p_id: string }; Returns: Json }
      mm_get_lay_report: { Args: { p_lay_id: string }; Returns: Json }
      mm_get_mill_accuracy: {
        Args: { p_mill_batch_id?: string }
        Returns: Json
      }
      mm_get_mill_board: { Args: { p_order_ids: string[] }; Returns: Json }
      mm_get_mill_line: {
        Args: {
          p_colorway_id: string
          p_colorway_material_id: string
          p_order_id: string
        }
        Returns: Json
      }
      mm_get_ops_context: { Args: never; Returns: Json }
      mm_get_order_fabric_lines: { Args: { p_order_id: string }; Returns: Json }
      mm_get_process_challan: { Args: { p_id: string }; Returns: Json }
      mm_get_rack_ops_board: { Args: never; Returns: Json }
      mm_get_store_challan: { Args: { p_id: string }; Returns: Json }
      mm_get_style_reconciliation: {
        Args: { p_order_id?: string; p_style_material_id?: string }
        Returns: Json
      }
      mm_get_style_warehouse: { Args: { p_order_id: string }; Returns: Json }
      mm_get_supplier_return: { Args: { p_id: string }; Returns: Json }
      mm_get_unallocated_mill: { Args: never; Returns: Json }
      mm_get_v4_config: { Args: never; Returns: Json }
      mm_get_warehouse_board: { Args: { p_order_ids: string[] }; Returns: Json }
      mm_get_warehouse_dashboard: { Args: never; Returns: Json }
      mm_get_warehouse_dispatch_board: {
        Args: { p_order_id?: string }
        Returns: Json
      }
      mm_hold_rolls: {
        Args: { p_reason: string; p_unit_ids: string[] }
        Returns: Json
      }
      mm_list_cutting_rolls: {
        Args: {
          p_colorway_id: string
          p_order_id: string
          p_search?: string
          p_style_material_id?: string
        }
        Returns: Json
      }
      mm_list_end_bit_returns: { Args: never; Returns: Json }
      mm_list_fabric_constructions: {
        Args: { p_fabric_type_id?: string; p_include_inactive?: boolean }
        Returns: Json
      }
      mm_list_fabrics: { Args: { p_filter?: Json }; Returns: Json }
      mm_list_floor_grns: { Args: { p_source?: string }; Returns: Json }
      mm_list_in_challans: {
        Args: { p_source: string; p_status: string }
        Returns: Json
      }
      mm_list_inspection_queue: { Args: never; Returns: Json }
      mm_list_mill_stock: {
        Args: {
          p_alloc?: string
          p_page?: number
          p_page_size?: number
          p_place?: string
          p_search?: string
        }
        Returns: Json
      }
      mm_list_process_challans: { Args: never; Returns: Json }
      mm_list_process_types: { Args: never; Returns: Json }
      mm_list_process_vendors: { Args: never; Returns: Json }
      mm_list_rack_master: { Args: never; Returns: Json }
      mm_list_receive_catalog: { Args: never; Returns: Json }
      mm_list_rolls_v4: { Args: { p_filter?: Json }; Returns: Json }
      mm_list_stock_movements: {
        Args: {
          p_kind?: string
          p_page?: number
          p_page_size?: number
          p_search?: string
        }
        Returns: Json
      }
      mm_list_store_challans: { Args: { p_status: string }; Returns: Json }
      mm_list_store_stock: {
        Args: { p_style_material_id: string }
        Returns: Json
      }
      mm_list_supplier_returns: { Args: never; Returns: Json }
      mm_list_test_fields: { Args: { p_fabric_type_id: string }; Returns: Json }
      mm_list_warehouse_stock: {
        Args: {
          p_buyer?: string
          p_location?: string
          p_page?: number
          p_page_size?: number
          p_search?: string
        }
        Returns: Json
      }
      mm_mark_rolls_consumed: { Args: { p_unit_ids: string[] }; Returns: Json }
      mm_merge_fabric: {
        Args: { p_from_id: string; p_into_id: string; p_reason: string }
        Returns: Json
      }
      mm_mill_add_rolls_v4: {
        Args: { p_batch_id: string; p_rolls: Json }
        Returns: Json
      }
      mm_mill_get_batch_v4: { Args: { p_batch_id: string }; Returns: Json }
      mm_mill_list_batches_v4: { Args: { p_filter?: Json }; Returns: Json }
      mm_mill_save_batch_v4: { Args: { p_payload: Json }; Returns: Json }
      mm_mill_save_batch_v5: { Args: { p_payload: Json }; Returns: Json }
      mm_proc_get_challan: { Args: { p_id: string }; Returns: Json }
      mm_proc_list_challans: { Args: { p_filter?: Json }; Returns: Json }
      mm_proc_return: { Args: { p_payload: Json }; Returns: Json }
      mm_proc_save_lots: {
        Args: { p_challan_id: string; p_lots: Json }
        Returns: Json
      }
      mm_proc_send: { Args: { p_payload: Json }; Returns: Json }
      mm_proc_void_challan: {
        Args: { p_challan_id: string; p_reason: string }
        Returns: Json
      }
      mm_putaway_rolls: {
        Args: { p_location_id: string; p_unit_ids: string[] }
        Returns: Json
      }
      mm_qc_approve_cut_at_risk: {
        Args: {
          p_codes: string[]
          p_expires_at?: string
          p_reason: string
          p_roll_ids: string[]
        }
        Returns: Json
      }
      mm_qc_approve_deviation: {
        Args: { p_id: string; p_kind: string; p_reason: string }
        Returns: Json
      }
      mm_qc_get_roll: { Args: { p_roll_id: string }; Returns: Json }
      mm_qc_get_scope: {
        Args: {
          p_roll_ids?: string[]
          p_scope_id: string
          p_scope_kind: string
        }
        Returns: Json
      }
      mm_qc_list_queue: { Args: { p_filter?: Json }; Returns: Json }
      mm_qc_revoke_cut_at_risk: {
        Args: { p_approval_id: string }
        Returns: Json
      }
      mm_qc_save_inspections: { Args: { p_payload: Json }; Returns: Json }
      mm_qc_save_test: { Args: { p_payload: Json }; Returns: Json }
      mm_qc_void: {
        Args: { p_id: string; p_kind: string; p_reason: string }
        Returns: Json
      }
      mm_quick_create_fabric: { Args: { p_row: Json }; Returns: Json }
      mm_receive_in_challan_lines: {
        Args: { p_challan_id: string; p_unit_ids: string[] }
        Returns: Json
      }
      mm_receive_mill_bundle: { Args: { p_payload: Json }; Returns: Json }
      mm_receive_mill_floor: {
        Args: {
          p_id: string
          p_missing_unit_ids?: string[]
          p_roll_edits: Json
          p_row_version: number
        }
        Returns: Json
      }
      mm_receive_mill_in_challan:
        | {
            Args: { p_id: string; p_roll_edits: Json; p_row_version: number }
            Returns: Json
          }
        | {
            Args: {
              p_id: string
              p_missing_unit_ids: string[]
              p_roll_edits: Json
              p_row_version: number
            }
            Returns: Json
          }
      mm_receive_process_return: {
        Args: { p_id: string; p_rolls: Json }
        Returns: Json
      }
      mm_receive_store_challan:
        | { Args: { p_id: string }; Returns: Json }
        | {
            Args: { p_id: string; p_missing_unit_ids: string[] }
            Returns: Json
          }
      mm_release_rolls: { Args: { p_unit_ids: string[] }; Returns: Json }
      mm_rpt_process_loss: {
        Args: { p_from?: string; p_group_by?: string; p_to?: string }
        Returns: Json
      }
      mm_rpt_quality_by_machine: {
        Args: { p_from?: string; p_to?: string }
        Returns: Json
      }
      mm_save_fabric: { Args: { p_row: Json }; Returns: Json }
      mm_save_fabric_construction: { Args: { p_row: Json }; Returns: Json }
      mm_save_fabric_form_schema: {
        Args: { p_fabric_type_id: string; p_groups: Json }
        Returns: Json
      }
      mm_save_fabric_stage: { Args: { p_row: Json }; Returns: Json }
      mm_save_fabric_type: { Args: { p_row: Json }; Returns: Json }
      mm_save_facility: { Args: { p_row: Json }; Returns: Json }
      mm_save_inspections: {
        Args: { p_rolls: Json; p_scope_id: string; p_scope_kind: string }
        Returns: Json
      }
      mm_save_lay_consumptions: {
        Args: { p_lay_id: string; p_rows: Json; p_style_material_id?: string }
        Returns: Json
      }
      mm_save_machine: { Args: { p_row: Json }; Returns: Json }
      mm_save_mill_batch: {
        Args: {
          p_batch_no: string
          p_colorway_id: string
          p_colorway_material_id: string
          p_mill_ref: string
          p_order_id: string
          p_production_date: string
          p_remarks: string
          p_rolls: Json
        }
        Returns: Json
      }
      mm_save_process_catalog: { Args: { p_payload: Json }; Returns: Json }
      mm_save_process_type_rules: { Args: { p_row: Json }; Returns: Json }
      mm_save_rack_location: {
        Args: { p_row: Json; p_row_version?: number }
        Returns: Json
      }
      mm_save_test_field_rules: { Args: { p_rules: Json }; Returns: Json }
      mm_save_trim_requirement_param: { Args: { p_row: Json }; Returns: Json }
      mm_save_type_requirement_fields: {
        Args: { p_fields: Json; p_type_id: string }
        Returns: Json
      }
      mm_save_type_test_fields: {
        Args: { p_fields: Json; p_type_id: string }
        Returns: Json
      }
      mm_save_unallocated_mill_batch: {
        Args: {
          p_batch_no: string
          p_color_ref: string
          p_fabric_ref_name?: string
          p_fabric_type_id: string
          p_lot_no: string
          p_mill_ref: string
          p_production_date: string
          p_remarks: string
          p_rolls: Json
        }
        Returns: Json
      }
      mm_save_unallocated_mill_batch_v2: {
        Args: {
          p_batch_no: string
          p_color_ref: string
          p_fabric_id: string
          p_lot_no: string
          p_mill_ref: string
          p_production_date: string
          p_remarks: string
          p_rolls: Json
        }
        Returns: Json
      }
      mm_save_unallocated_vendor_grn: {
        Args: {
          p_color_ref: string
          p_fabric_type_id: string
          p_lot_no: string
          p_rolls: Json
          p_supplier_name: string
          p_uom: string
        }
        Returns: Json
      }
      mm_save_unallocated_vendor_grn_v2: {
        Args: {
          p_color_ref: string
          p_fabric_id: string
          p_lot_no: string
          p_rolls: Json
          p_supplier_name: string
          p_uom: string
        }
        Returns: Json
      }
      mm_save_vendor_grn: {
        Args: {
          p_color_ref: string
          p_fabric_type_id: string
          p_grn_date: string
          p_grn_no?: string
          p_invoice_ref: string
          p_lot: string
          p_rolls: Json
          p_style: Json
          p_supplier_name: string
          p_uom: string
        }
        Returns: Json
      }
      mm_save_vendor_roll_tests: {
        Args: { p_id: string; p_roll_results: Json }
        Returns: Json
      }
      mm_save_warehouse_inspections: {
        Args: { p_id: string; p_rolls: Json }
        Returns: Json
      }
      mm_send_to_process: {
        Args: {
          p_challan_no: string
          p_ids: string[]
          p_origin: string
          p_remarks?: string
          p_type_id: string
          p_vendor_id: string
        }
        Returns: Json
      }
      mm_set_batch_fabric: {
        Args: { p_batch_id: string; p_fabric_id: string }
        Returns: Json
      }
      mm_set_batch_style_intents: {
        Args: { p_batch_id: string; p_style_material_ids: string[] }
        Returns: Json
      }
      mm_set_fabric_status: {
        Args: { p_id: string; p_status: string }
        Returns: Json
      }
      mm_set_fabric_v4: { Args: { p_enabled: boolean }; Returns: Json }
      mm_set_factory_feature: {
        Args: { p_enabled: boolean; p_key: string }
        Returns: Json
      }
      mm_set_mill_short_close: {
        Args: {
          p_closed: boolean
          p_colorway_id: string
          p_colorway_material_id: string
          p_order_id: string
          p_reason?: string
        }
        Returns: Json
      }
      mm_set_roll_tags: {
        Args: { p_roll_ids: string[]; p_tags: Json }
        Returns: Json
      }
      mm_set_rolls_fabric: {
        Args: { p_fabric_id: string; p_roll_ids: string[] }
        Returns: Json
      }
      mm_set_shade_bands: { Args: { p_assignments: Json }; Returns: Json }
      mm_short_close_in_challan: {
        Args: { p_challan_id: string; p_reason: string }
        Returns: Json
      }
      mm_unallocate_rolls: { Args: { p_unit_ids: string[] }; Returns: Json }
      mm_update_mill_batch: {
        Args: {
          p_batch_id: string
          p_batch_no: string
          p_color_ref?: string
          p_fabric_ref_name?: string
          p_mill_ref: string
          p_production_date: string
          p_remarks: string
          p_rolls: Json
          p_row_version?: number
          p_test_only?: boolean
        }
        Returns: Json
      }
      mm_update_roll: {
        Args: { p_patch: Json; p_row_version?: number; p_unit_id: string }
        Returns: Json
      }
      mm_wh_list_readiness: { Args: { p_filter?: Json }; Returns: Json }
      mm_wh_save_vendor_grn_v4: { Args: { p_payload: Json }; Returns: Json }
      mm_wh_save_vendor_grn_v5: { Args: { p_payload: Json }; Returns: Json }
      module_config: {
        Args: { p_factory: string; p_key: string }
        Returns: Json
      }
      module_enabled: {
        Args: { p_factory: string; p_key: string }
        Returns: boolean
      }
      next_doc_no: { Args: { p_type: string }; Returns: string }
      next_internal_order_no: {
        Args: { p_factory_id: string }
        Returns: string
      }
      normalize_hour_slot_start: {
        Args: { p_hour_slot: string }
        Returns: string
      }
      operation_progress_rows: {
        Args: { p_factory_id?: string; p_order_id?: string }
        Returns: {
          capture_app: string
          colorway_id: string
          dept_id: string
          dept_name: string
          dept_role: string
          factory_id: string
          is_primary_output: boolean
          operation_id: string
          order_id: string
          qty_produced: number
          qty_produced_by_size: Json
          route_seq: number
          step_type: string
          visit_id: string
        }[]
      }
      order_dept_progress_rows: {
        Args: { p_factory_id?: string; p_order_id?: string }
        Returns: {
          available_to_send: number
          colorway_id: string
          dept_id: string
          dept_name: string
          factory_id: string
          flow_step: number
          is_in_flow: boolean
          order_id: string
          planned_qty: number
          qty_in_transit: number
          qty_missing_in_transit: number
          qty_produced: number
          qty_produced_by_size: Json
          qty_received: number
          qty_received_by_size: Json
          qty_rejected: number
          qty_rejected_by_size: Json
          qty_sent: number
          qty_sent_by_size: Json
          remaining_qty: number
          status: string
          visit_id: string
          wip_qty: number
          wip_qty_by_size: Json
        }[]
      }
      order_journey_by_resource_rows: {
        Args: { p_factory_id?: string; p_order_id?: string }
        Returns: {
          colorway_id: string
          department_id: string
          department_name: string
          fabric_component_breakdown: Json
          factory_id: string
          loading_operation_id: string
          loading_operation_name: string
          loading_qty_produced: number
          loading_qty_produced_by_size: Json
          operation_id: string
          operation_name: string
          order_id: string
          produced_mins: number
          qty_produced: number
          qty_received: number
          qty_sent: number
          resource_allocation_id: string
          resource_id: string
          resource_name: string
          resource_type: string
          resource_visit_status: string
          sent_qty_by_resource: Json
          vendor_balance_qty: number
          vendor_name: string
          vendor_received_qty: number
          vendor_resource_id: string
          vendor_sent_qty: number
          visit_id: string
        }[]
      }
      outsource_movement_size_sum: {
        Args: { p_qty_by_size: Json }
        Returns: number
      }
      outsource_send_returned_qty: {
        Args: { p_send_id: string }
        Returns: number
      }
      outsource_vendor_movement_net: {
        Args: {
          p_colorway_id: string
          p_factory_id: string
          p_movement_type: string
          p_order_id: string
          p_vendor_resource_id: string
          p_visit_id: string
        }
        Returns: number
      }
      outsource_visit_at_vendor_qty: {
        Args: {
          p_colorway_id: string
          p_factory_id: string
          p_order_id: string
          p_visit_id: string
        }
        Returns: number
      }
      outsource_visit_available_for_handover_send: {
        Args: {
          p_colorway_id: string
          p_department_id: string
          p_factory_id: string
          p_order_id: string
          p_visit_id: string
        }
        Returns: number
      }
      outsource_visit_available_for_vendor_send: {
        Args: {
          p_colorway_id: string
          p_department_id: string
          p_factory_id: string
          p_order_id: string
          p_visit_id: string
        }
        Returns: number
      }
      outsource_visit_handover_received_qty: {
        Args: {
          p_colorway_id: string
          p_department_id: string
          p_factory_id: string
          p_order_id: string
          p_visit_id: string
        }
        Returns: number
      }
      outsource_visit_handover_sent_qty: {
        Args: {
          p_colorway_id: string
          p_department_id: string
          p_factory_id: string
          p_order_id: string
          p_visit_id: string
        }
        Returns: number
      }
      outsource_visit_returned_qty: {
        Args: {
          p_colorway_id: string
          p_factory_id: string
          p_order_id: string
          p_visit_id: string
        }
        Returns: number
      }
      profile_dept_can_capture_cutting: {
        Args: { p_factory_id: string; p_user_id: string }
        Returns: boolean
      }
      profile_dept_has_app: {
        Args: { p_app: string; p_factory_id: string; p_user_id: string }
        Returns: boolean
      }
      profile_floor_flags_for_assignment: {
        Args: {
          p_audit_enabled: boolean
          p_department_id: string
          p_handover_enabled: boolean
          p_operation_ids: string[]
          p_shipment_qa_enabled: boolean
          p_workforce_enabled: boolean
        }
        Returns: {
          audit_enabled: boolean
          can_produce: boolean
          handover_enabled: boolean
          shipment_qa_enabled: boolean
          workforce_enabled: boolean
        }[]
      }
      profile_has_capture_app: {
        Args: { p_app: string; p_factory_id: string; p_user_id: string }
        Returns: boolean
      }
      proportional_qty_by_size: {
        Args: { p_planned: Json; p_total: number }
        Returns: Json
      }
      record_floor_login_attempt: {
        Args: { p_email: string; p_profile_id: string; p_success: boolean }
        Returns: undefined
      }
      rejection_audit_label_to_stage: {
        Args: { p_label: string }
        Returns: string
      }
      replace_floor_user_access: {
        Args: {
          p_audit_enabled: boolean
          p_department_id: string
          p_handover_enabled: boolean
          p_operation_ids?: string[]
          p_profile_id: string
          p_shipment_qa_enabled?: boolean
          p_workforce_enabled: boolean
        }
        Returns: undefined
      }
      resolve_capture_line_allocation_id: {
        Args: {
          p_colorway_id: string
          p_existing: string
          p_order_id: string
          p_resource_id: string
          p_route_step_id: string
        }
        Returns: string
      }
      resolve_capture_order_route_id: {
        Args: {
          p_department_id: string
          p_factory_id: string
          p_line_allocation_id: string
          p_order_id: string
          p_order_route_id: string
          p_prefer_capture_apps?: string[]
        }
        Returns: string
      }
      resolve_fabric_component_id: {
        Args: { p_fabric_type: string; p_factory_id: string }
        Returns: string
      }
      resolve_line_allocation_for_route: {
        Args: {
          p_colorway_id: string
          p_order_id: string
          p_route_step_id: string
        }
        Returns: string
      }
      resolve_line_allocation_id: {
        Args: {
          p_colorway_id: string
          p_order_id: string
          p_resource_id: string
          p_route_step_id: string
        }
        Returns: string
      }
      resolve_order_route_context: {
        Args: { p_factory_id: string; p_order_route_id: string }
        Returns: {
          capture_app: string
          department_id: string
          dept_name: string
          operation_def_id: string
          order_id: string
          order_route_id: string
          route_seq: number
          step_label: string
          visit_id: string
        }[]
      }
      resolve_outsource_line_allocation_id: {
        Args: {
          p_colorway_id: string
          p_order_id: string
          p_vendor_resource_id?: string
          p_visit_id: string
        }
        Returns: string
      }
      resolve_rejection_department_id: {
        Args: { p_factory_id: string; p_order_id: string; p_stage: string }
        Returns: string
      }
      save_buyer: {
        Args: {
          p_action: string
          p_code?: string
          p_contact_email?: string
          p_contact_name?: string
          p_contact_phone?: string
          p_contact_role?: string
          p_country?: string
          p_currency?: string
          p_destination?: string
          p_destination_countries?: Json
          p_factory_id: string
          p_id?: string
          p_name?: string
          p_over_shipment_pct?: number
          p_packing_rule?: string
          p_ship_mode?: string
          p_ship_mode_options?: Json
          p_shipment_type_options?: Json
          p_status?: string
          p_type?: string
          p_under_shipment_pct?: number
        }
        Returns: {
          code: string
          contact_email: string
          contact_name: string
          contact_phone: string
          contact_role: string
          country: string
          created_at: string
          currency: string
          destination: string
          destination_countries: string[]
          factory_id: string
          id: string
          name: string
          over_shipment_pct: number
          packing_rule: string
          ship_mode: string
          ship_mode_options: Json
          shipment_type_options: Json
          status: string
          type: string
          under_shipment_pct: number
          updated_at: string
        }[]
      }
      save_colorway_planning_remarks: {
        Args: {
          p_colorway_id: string
          p_factory_id: string
          p_order_id: string
          p_remarks: string
        }
        Returns: string
      }
      save_department: {
        Args: {
          p_action: string
          p_defects?: Json
          p_department?: Json
          p_factory_id: string
          p_id?: string
          p_operations?: Json
          p_workforce_rates?: Json
        }
        Returns: {
          created_at: string
          factory_id: string
          id: string
          is_native: boolean
          name: string
          planning_mode: string
          role: string
          sequence: number
          supervisor_enabled: boolean
          transaction_enabled: boolean
          updated_at: string
        }[]
      }
      save_fabric_components: {
        Args: {
          p_delete_ids?: string[]
          p_factory_id: string
          p_origin_department_id: string
          p_rows: Json
        }
        Returns: {
          code: string
          created_at: string
          department_id: string
          fabric_type: string
          factory_id: string
          id: string
          is_active: boolean
          is_primary: boolean
          remarks: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "fabric_components"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      save_factory_settings: {
        Args: {
          p_audit_apps?: Json
          p_code?: string
          p_country?: string
          p_default_shift_id?: string
          p_factory_id: string
          p_name?: string
          p_production_apps?: Json
          p_shipment_apps?: Json
          p_timezone?: string
          p_transaction_apps?: Json
          p_workforce_apps?: Json
        }
        Returns: {
          audit_apps: Json
          code: string
          country: string
          created_at: string
          default_shift_id: string | null
          id: string
          name: string
          production_apps: Json
          shipment_apps: Json
          timezone: string
          transaction_apps: Json
          type: string | null
          updated_at: string
          workforce_apps: Json
        }
        SetofOptions: {
          from: "*"
          to: "factories"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_line_plan: {
        Args: {
          p_colorway_plans: Json
          p_factory_id: string
          p_order_id: string
        }
        Returns: undefined
      }
      save_operation: {
        Args: {
          p_action: string
          p_capture_app?: string
          p_department_id?: string
          p_factory_id: string
          p_id?: string
          p_name?: string
          p_step_type?: string
        }
        Returns: {
          capture_app: string | null
          created_at: string
          department_id: string
          factory_id: string
          id: string
          is_active: boolean
          name: string
          step_type: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "operations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_order_routing: {
        Args: { p_factory_id: string; p_order_id: string; p_steps: Json }
        Returns: undefined
      }
      save_process_flow: {
        Args: {
          p_action: string
          p_description?: string
          p_factory_id: string
          p_id?: string
          p_name?: string
          p_old_id?: string
          p_steps?: Json
        }
        Returns: {
          created_at: string
          description: string
          factory_id: string
          id: string
          name: string
          steps: Json
          updated_at: string
        }[]
      }
      save_resource: {
        Args: {
          p_action: string
          p_capacity?: number
          p_department_id?: string
          p_description?: string
          p_factory_id: string
          p_id?: string
          p_resource_name?: string
          p_resource_type?: string
          p_status?: string
        }
        Returns: {
          capacity: number
          created_at: string
          department_id: string
          description: string
          factory_id: string
          id: string
          resource_name: string
          resource_type: string
          status: string
          updated_at: string
        }[]
      }
      save_shift: {
        Args: {
          p_action: string
          p_break_end?: string
          p_break_start?: string
          p_end_time?: string
          p_factory_id: string
          p_hours?: Json
          p_id?: string
          p_name?: string
          p_start_time?: string
          p_type?: string
        }
        Returns: {
          break_end: string
          break_start: string
          created_at: string
          end_time: string
          factory_id: string
          hours: Json
          id: string
          name: string
          productive_mins: number
          start_time: string
          type: string
          updated_at: string
        }[]
      }
      save_size_group: {
        Args: {
          p_action: string
          p_buyer_id?: string
          p_factory_id: string
          p_id?: string
          p_name?: string
          p_sizes?: Json
        }
        Returns: {
          buyer_id: string
          created_at: string
          factory_id: string
          id: string
          name: string
          sizes: Json
          updated_at: string
        }[]
      }
      save_style_order: {
        Args: { p_colorways?: Json; p_factory_id: string; p_order: Json }
        Returns: string
      }
      save_support_dropdown: {
        Args: {
          p_action: string
          p_app_name?: string
          p_category?: string
          p_factory_id: string
          p_id?: string
          p_values?: Json
        }
        Returns: {
          app_name: string
          category: string
          created_at: string
          factory_id: string
          id: string
          updated_at: string
          values: Json
        }[]
      }
      seed_factory_app_configuration: {
        Args: { p_factory_id: string }
        Returns: undefined
      }
      seed_factory_native_departments: {
        Args: { p_factory_id: string }
        Returns: undefined
      }
      set_factory_module: {
        Args: { p_config?: Json; p_enabled: boolean; p_key: string }
        Returns: Json
      }
      shift_productive_mins_from_hours: {
        Args: { p_hours: Json }
        Returns: number
      }
      standard_production_alloc_grid: {
        Args: { p_factory_id: string; p_order_id: string }
        Returns: {
          capture_app: string
          colorway_id: string
          department_id: string
          dept_name: string
          dept_role: string
          factory_id: string
          is_primary_output: boolean
          line_allocation_id: string
          operation_id: string
          order_id: string
          planning_mode: string
          step_type: string
          visit_id: string
        }[]
      }
      sync_colorway_ready_to_ship: {
        Args: { p_colorway_id: string; p_order_id: string }
        Returns: undefined
      }
      sync_colorway_ready_to_ship_rpc: {
        Args: {
          p_colorway_id: string
          p_factory_id: string
          p_order_id: string
        }
        Returns: Json
      }
      terminal_route_operation_id: {
        Args: { p_order_id: string }
        Returns: string
      }
      time_in_shift_bounds: {
        Args: { p_end: string; p_start: string; p_t: string }
        Returns: boolean
      }
      validate_assigned_resource_for_department: {
        Args: { p_department_id: string; p_resource_type: string }
        Returns: undefined
      }
      verify_floor_login_by_email: {
        Args: { p_email: string; p_pin: string }
        Returns: Json
      }
      verify_floor_pin: {
        Args: { p_pin: string; p_record_attempt?: boolean; p_user_id: string }
        Returns: Json
      }
      visit_primary_route_step_id: {
        Args: { p_order_id: string; p_visit_id: string }
        Returns: string
      }
      visit_route_step_id: {
        Args: { p_order_id: string; p_step_type?: string; p_visit_id: string }
        Returns: string
      }
      void_outsource_work_movement: {
        Args: { p_movement_id: string; p_reason?: string }
        Returns: undefined
      }
      workforce_log_total_headcount: {
        Args: { p_headcount?: Json }
        Returns: number
      }
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
