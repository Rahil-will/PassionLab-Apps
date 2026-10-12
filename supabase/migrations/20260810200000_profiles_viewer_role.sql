-- Allow desktop read-only viewer accounts in profiles.user_role.

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_user_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_user_role_check CHECK (
    user_role = ANY (
      ARRAY[
        'superadmin'::text,
        'admin'::text,
        'viewer'::text,
        'quality_manager'::text,
        'supervisor'::text,
        'auditor'::text,
        'operator'::text
      ]
    )
  );
