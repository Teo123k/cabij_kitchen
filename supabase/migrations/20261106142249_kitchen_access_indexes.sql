ALTER POLICY project_read ON public.operations_projects_v1
USING (EXISTS (SELECT 1 FROM public.kitchen_memberships m WHERE m.client_id = operations_projects_v1.client_id AND m.user_id = (select auth.uid())));
ALTER POLICY project_create ON public.operations_projects_v1
WITH CHECK (revision = 1 AND created_by = (select auth.uid()) AND EXISTS (SELECT 1 FROM public.kitchen_memberships m WHERE m.client_id = operations_projects_v1.client_id AND m.user_id = (select auth.uid()) AND m.role IN ('owner','manager','chef')));
ALTER POLICY project_edit ON public.operations_projects_v1
USING (EXISTS (SELECT 1 FROM public.kitchen_memberships m WHERE m.client_id = operations_projects_v1.client_id AND m.user_id = (select auth.uid()) AND m.role IN ('owner','manager','chef')))
WITH CHECK (EXISTS (SELECT 1 FROM public.kitchen_memberships m WHERE m.client_id = operations_projects_v1.client_id AND m.user_id = (select auth.uid()) AND m.role IN ('owner','manager','chef')));
ALTER POLICY package_read ON public.operations_packages_v1
USING (EXISTS (SELECT 1 FROM public.kitchen_memberships m WHERE m.client_id = operations_packages_v1.client_id AND m.user_id = (select auth.uid())));
ALTER POLICY package_create ON public.operations_packages_v1
WITH CHECK (approved_by = (select auth.uid()) AND EXISTS (SELECT 1 FROM public.kitchen_memberships m WHERE m.client_id = operations_packages_v1.client_id AND m.user_id = (select auth.uid()) AND m.role IN ('owner','manager')));
CREATE INDEX owner_onboarding_claimed_user ON cabij_private.owner_onboarding(claimed_user_id);
CREATE INDEX canonical_alias_ingredient ON public.canonical_ingredient_aliases_v1(canonical_ingredient_id);
CREATE INDEX canonical_alias_approver ON public.canonical_ingredient_aliases_v1(approved_by);
CREATE INDEX price_evidence_ingredient ON public.ingredient_price_evidence_v1(canonical_ingredient_id);
CREATE INDEX price_evidence_reviewer ON public.ingredient_price_evidence_v1(reviewed_by);
CREATE INDEX package_approver ON public.operations_packages_v1(approved_by);
CREATE INDEX project_creator ON public.operations_projects_v1(created_by);
CREATE INDEX version_ingredient_canonical ON public.recipe_version_ingredients_v1(canonical_ingredient_id);
CREATE INDEX recipe_version_approver ON public.recipe_versions_v1(approved_by);
CREATE INDEX recipe_version_creator ON public.recipe_versions_v1(created_by);
