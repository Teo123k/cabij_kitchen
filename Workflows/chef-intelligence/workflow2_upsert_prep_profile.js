const baseUrl = $env.SUPABASE_URL || $env.VITE_SUPABASE_URL;
const serviceKey = $env.SUPABASE_SERVICE_ROLE_KEY || $env.SUPABASE_SERVICE_KEY || $env.VITE_SUPABASE_ANON_KEY;

if (!baseUrl || !serviceKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in n8n environment.');
}

const payload = items[0]?.json || {};
const prepProfile = payload.prep_profile;
if (!prepProfile) {
  throw new Error('Missing prep_profile payload for upsert.');
}

const response = await fetch(
  `${baseUrl}/rest/v1/recipe_prep_profiles?on_conflict=recipe_ref_id,client_id,profile_version`,
  {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(prepProfile),
  }
);

const text = await response.text();
const data = text ? JSON.parse(text) : null;
if (!response.ok) {
  throw new Error(`Failed to upsert recipe_prep_profiles: ${response.status} ${response.statusText} ${text}`);
}

return [{
  json: {
    ...payload,
    prep_profile_upsert: Array.isArray(data) ? data[0] : data,
  },
}];
