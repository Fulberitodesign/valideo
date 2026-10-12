// Validéo · moneroo-checkout
// Crée un paiement Moneroo pour l'abonnement choisi et renvoie l'adresse de la page de paiement.
// Appelée par l'application avec la session de l'utilisateur connecté.
// Secrets requis (Supabase > Edge Functions > Secrets) : MONEROO_SECRET_KEY, SITE_URL (facultatif)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

// Prix en francs CFA (XOF, sans décimales), fixés côté serveur : le navigateur ne choisit jamais le montant
const PRICES: Record<string, Record<string, number>> = {
  solo: { month: 6600, year: 65600 },
  pro: { month: 12500, year: 124600 },
  studio: { month: 26200, year: 262400 },
};
const NAMES: Record<string, string> = { solo: 'Solo', pro: 'Pro', studio: 'Studio' };
const METHODS: Record<string, string[]> = { mobile: ['mtn_bj', 'moov_bj'], card: ['card_xof'] };

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405);
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'Connexion requise' }, 401);

    const { plan, period, method } = await req.json();
    const amount = PRICES[plan]?.[period];
    if (!amount) return json({ error: 'Offre ou période inconnue' }, 400);
    const secret = Deno.env.get('MONEROO_SECRET_KEY');
    if (!secret) return json({ error: 'Le paiement en ligne n\'est pas encore configuré' }, 503);

    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: pay, error: e1 } = await admin.from('payments')
      .insert({ user_id: user.id, plan, period, method: METHODS[method] ? method : null, amount, currency: 'XOF', status: 'pending' })
      .select().single();
    if (e1) throw e1;

    const full = String(user.user_metadata?.full_name || user.user_metadata?.name || '').trim();
    const [first, ...rest] = (full || user.email || 'Client').split(' ');
    const site = Deno.env.get('SITE_URL') || 'https://fulberitodesign.github.io/valideo/';
    const body: Record<string, unknown> = {
      amount, currency: 'XOF',
      description: `Validéo ${NAMES[plan]} · ${period === 'year' ? '1 an' : '1 mois'}`,
      return_url: `${site}app.html?paiement=${pay.id}`,
      customer: { email: user.email, first_name: first || 'Client', last_name: rest.join(' ') || 'Validéo' },
      metadata: { payment_id: String(pay.id), user_id: String(user.id), plan: String(plan), period: String(period) },
    };
    if (METHODS[method]) body.methods = METHODS[method];

    const r = await fetch('https://api.moneroo.io/v1/payments/initialize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    const checkout = j?.data?.checkout_url ?? j?.checkout_url, providerId = j?.data?.id ?? j?.id;
    if (!r.ok || !checkout) {
      await admin.from('payments').update({ status: 'failed' }).eq('id', pay.id);
      return json({ error: j?.message || 'Moneroo a refusé la demande de paiement' }, 502);
    }
    await admin.from('payments').update({ provider_id: String(providerId) }).eq('id', pay.id);
    return json({ checkout_url: checkout, payment_id: pay.id });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
