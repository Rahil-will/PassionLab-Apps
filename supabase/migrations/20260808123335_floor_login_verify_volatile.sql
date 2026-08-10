-- Hotfix: floor PIN verify functions write to floor_login_attempts — must not be STABLE.
-- Applied on live 2026-08-08 before audit_remediation migration.

ALTER FUNCTION public.verify_floor_pin(uuid, text) VOLATILE;
ALTER FUNCTION public.verify_floor_login_by_email(text, text) VOLATILE;
