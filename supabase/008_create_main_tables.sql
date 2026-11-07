-- Automation tables for Hierarchical Production Engine (Skeleton App)
-- Aligned with n8n Chef_Logic_Master workflow

-- Enable uuid-ossp extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Main Presentations Table
CREATE TABLE IF NOT EXISTS public.main_presentations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id TEXT NOT NULL,
    dish_name TEXT NOT NULL,
    presentation_json JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Main Board Tasks Table
CREATE TABLE IF NOT EXISTS public.main_board_tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id TEXT NOT NULL,
    dish_name TEXT NOT NULL,
    tasks_json JSONB DEFAULT '{}'::jsonb,
    staff_role TEXT DEFAULT 'js',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_main_presentations_client ON public.main_presentations(client_id);
CREATE INDEX IF NOT EXISTS idx_main_board_tasks_client ON public.main_board_tasks(client_id);
