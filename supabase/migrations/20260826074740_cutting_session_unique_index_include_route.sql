-- Drop old unique index that doesn't account for different operations
DROP INDEX IF EXISTS idx_cutting_sessions_factory_order_session;

-- Recreate with order_route_id so same session_no in different operations is allowed
CREATE UNIQUE INDEX idx_cutting_sessions_factory_order_session
  ON public.cutting_sessions (factory_id, order_id, colorway_id, session_no, order_route_id);;
