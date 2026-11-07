const payload = items[0]?.json || {};

if (payload.workflow3_skipped || !payload.extended_profile) {
  return items;
}

const baseUrl = $env.SUPABASE_URL || $env.VITE_SUPABASE_URL;
const serviceKey = $env.SUPABASE_SERVICE_ROLE_KEY || $env.SUPABASE_SERVICE_KEY || $env.VITE_SUPABASE_ANON_KEY;

if (!baseUrl || !serviceKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in n8n environment.');
}

const response = await fetch(
  `${baseUrl}/rest/v1/recipe_extended_profiles?on_conflict=recipe_ref_id,client_id,extension_type`,
  {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(payload.extended_profile),
  }
);

const text = await response.text();
const data = text ? JSON.parse(text) : null;
if (!response.ok) {
  throw new Error(`Failed to upsert recipe_extended_profiles: ${response.status} ${response.statusText} ${text}`);
}

return [{
  json: {
    ...payload,
    extended_profile_upsert: Array.isArray(data) ? data[0] : data,
  },
}];
