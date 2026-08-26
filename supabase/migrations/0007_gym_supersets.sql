-- ============================================================================
-- Gym module — "Superset" grouping
-- ============================================================================
-- Seventh Gym migration. Run this AFTER 0001–0006 have already been applied.
--
-- A superset is 2+ exercises that must be completed together, in a fixed
-- order, within one session (or one group plan) — e.g. exercise 1 then 2
-- then 3, repeated for however many sets each has. Each exercise keeps its
-- own independent sets/reps/load — a superset has no attributes of its own,
-- it's purely a grouping + ordering concept. So no new table is needed: just
-- a nullable grouping-key column on the two item tables. Membership is a
-- plain uuid shared by every item in the same superset; there's no FK to
-- anything else, it's generated client-side purely to group rows together.
--
-- Contiguity (a superset's members always sit next to each other in
-- sort_order) is enforced by the application, not the database — same as
-- sort_order itself already is.
-- ============================================================================

alter table gym_session_items add column if not exists superset_id uuid;
create index if not exists idx_gym_session_items_superset on gym_session_items (session_id, superset_id) where superset_id is not null;

alter table gym_group_plan_items add column if not exists superset_id uuid;
create index if not exists idx_gym_group_plan_items_superset on gym_group_plan_items (plan_id, superset_id) where superset_id is not null;
