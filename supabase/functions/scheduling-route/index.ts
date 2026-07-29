import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
Deno.serve(async (req) => {
  const headers = { 'Content-Type': 'application/json' };
  const key = Deno.env.get('GOOGLE_MAPS_API_KEY');
  if (!key) return new Response(JSON.stringify({ calculated: false, reason: 'google_key_not_configured' }), { headers });
  const { origin, destination } = await req.json();
  if (!origin || !destination) return new Response(JSON.stringify({ error: 'missing_locations' }), { status: 400, headers });
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const cacheKey = (v: unknown) => String(v).trim().toLowerCase();
  const originKey=cacheKey(origin), destinationKey=cacheKey(destination);
  const cached=await db.from('scheduling_travel_cache').select('*').eq('origin_key',originKey).eq('destination_key',destinationKey).gt('expires_at',new Date().toISOString()).maybeSingle();
  if (cached.data) return new Response(JSON.stringify({ calculated:true,cached:true,...cached.data }),{headers});
  // Keep request construction explicit so the API key remains server-side.
  const google=await fetch('https://routes.googleapis.com/directions/v2:computeRoutes',{method:'POST',headers:{'Content-Type':'application/json','X-Goog-Api-Key':key,'X-Goog-FieldMask':'routes.distanceMeters,routes.duration'},body:JSON.stringify({origin:{address:origin},destination:{address:destination},travelMode:'DRIVE'})});
  if (!google.ok) return new Response(JSON.stringify({calculated:false,reason:'route_service_unavailable'}),{status:502,headers});
  const route=(await google.json())?.routes?.[0]; const distance_km=(route?.distanceMeters||0)/1000; const duration_minutes=Math.ceil(parseFloat(route?.duration||'0')/60);
  await db.from('scheduling_travel_cache').upsert({origin_key:originKey,destination_key:destinationKey,distance_km,duration_minutes,calculated_at:new Date().toISOString(),expires_at:new Date(Date.now()+30*86400000).toISOString()});
  return new Response(JSON.stringify({calculated:true,cached:false,distance_km,duration_minutes}),{headers});
});
