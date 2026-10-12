// Validéo · feexpay-pay
// Paiement des abonnements directement via FeexPay (Mobile Money et carte), sans quitter l'application.
//   { action: 'start', plan, period, country, network, phone, otp? }  → envoie la demande sur le téléphone du client
//   { action: 'start', plan, period, method: 'card', card: 'VISA' | 'MASTERCARD', phone } → renvoie la page de paiement par carte
//   { action: 'check', payment_id }                                     → revérifie le statut auprès de FeexPay et active l'offre
//   Appel de FeexPay (webhook, sans session) avec une référence         → même revérification, puis activation
// À déployer SANS vérification JWT : la session est vérifiée dans le code.
// Secrets requis : FEEXPAY_TOKEN (clé API « fp_… »), FEEXPAY_SHOP_ID
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

// Prix en francs CFA fixés côté serveur : le navigateur ne choisit jamais le montant
const PRICES: Record<string, Record<string, number>> = {
  solo: { month: 6600, year: 65600 },
  pro: { month: 12500, year: 124600 },
  studio: { month: 26200, year: 262400 },
};
const NAMES: Record<string, string> = { solo: 'Solo', pro: 'Pro', studio: 'Studio' };
// Réseaux acceptés par FeexPay (API v2), par pays : indicatif + chemin du « requesttopay »
const NETWORKS: Record<string, { code: string; nets: Record<string, string> }> = {
  BENIN: { code: '229', nets: { MTN: 'mtn', MOOV: 'moov', CELTIIS: 'celtiis_bj' } },
  COTE_D_IVOIRE: { code: '225', nets: { MTN: 'mtn_ci', MOOV: 'moov_ci', ORANGE: 'orange_ci', WAVE: 'wave_ci' } },
  TOGO: { code: '228', nets: { TOGOCOM: 'togocom_tg', MOOV: 'moov_tg' } },
  SENEGAL: { code: '221', nets: { ORANGE: 'orange_sn', FREE: 'free_sn', WAVE: 'wave_sn' } },
  BURKINA_FASO: { code: '226', nets: { MOOV: 'moov_bf', ORANGE: 'orange_bf', WAVE: 'wave_bf' } },
  CONGO_BRAZZAVILLE: { code: '242', nets: { MTN: 'mtn_cg' } },
};
const API = 'https://api-v2.feexpay.me/api';
const SITE = Deno.env.get('SITE_URL') || 'https://fulberitodesign.github.io/valideo/';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const admin = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

// Lit le statut chez FeexPay et, s'il est réussi, active l'offre une seule fois
async function settle(pay: Record<string, any>) {
  if (pay.status !== 'pending' || !pay.provider_id) return { status: pay.status };
  const r = await fetch(`${API}/transactions/public/single/status/${encodeURIComponent(pay.provider_id)}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${Deno.env.get('FEEXPAY_TOKEN')}` },
  });
  const s = await r.json().catch(() => ({}));
  const st = String(s?.status || '').toUpperCase();
  const db = admin();
  if (st === 'SUCCESSFUL' || st === 'SUCCESS') {
    const paid = Number(s?.amount);
    if (Number.isFinite(paid) && paid > 0 && paid < pay.amount * 0.9) {
      await db.from('payments').update({ status: 'mismatch' }).eq('id', pay.id).eq('status', 'pending');
      return { status: 'mismatch' };
    }
    // Le passage pending → success ne réussit qu'une fois : l'offre n'est jamais prolongée deux fois
    const { data: won } = await db.from('payments').update({ status: 'success', paid_at: new Date().toISOString() })
      .eq('id', pay.id).eq('status', 'pending').select('id');
    if (won?.length) {
      const { data: prof } = await db.from('profiles').select('plan_until').eq('id', pay.user_id).maybeSingle();
      const now = new Date(), base = prof?.plan_until && new Date(prof.plan_until) > now ? new Date(prof.plan_until) : now;
      if (pay.period === 'year') base.setFullYear(base.getFullYear() + 1); else base.setMonth(base.getMonth() + 1);
      await db.from('profiles').update({ plan: pay.plan, plan_until: base.toISOString().slice(0, 10) }).eq('id', pay.user_id);
    }
    return { status: 'success', plan: pay.plan };
  }
  if (st === 'FAILED' || st === 'INSUFFICIENT_FUNDS' || st === 'CANCELLED' || st === 'CANCELED') {
    await db.from('payments').update({ status: st.startsWith('CANCEL') ? 'cancelled' : 'failed' }).eq('id', pay.id).eq('status', 'pending');
    const reason = String(s?.reason || '');
    return { status: 'failed', reason: st === 'INSUFFICIENT_FUNDS' || /LOW_BALANCE/.test(reason) ? 'Solde insuffisant' : /PAYER.?NOT.?FOUND/.test(reason) ? 'Numéro introuvable chez l’opérateur' : '' };
  }
  return { status: 'pending' };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const url = Deno.env.get('SUPABASE_URL')!;
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data: { user } } = await userClient.auth.getUser().catch(() => ({ data: { user: null } }));

    // Notification de FeexPay : on ne croit pas son contenu, on revérifie la référence auprès de leur API
    if (!body.action) {
      const ref = String(body.reference || body.transaction_id || body?.data?.reference || '');
      if (!ref) return json({ ok: true });
      const { data: pay } = await admin().from('payments').select('*').eq('provider_id', ref).maybeSingle();
      if (pay) await settle(pay);
      return json({ ok: true });
    }
    if (!user) return json({ error: 'Connexion requise' }, 401);

    if (body.action === 'check') {
      const { data: pay } = await admin().from('payments').select('*').eq('id', body.payment_id).eq('user_id', user.id).maybeSingle();
      if (!pay) return json({ error: 'Paiement introuvable' }, 404);
      return json(await settle(pay));
    }

    if (body.action !== 'start') return json({ error: 'Action inconnue' }, 400);
    const { plan, period } = body;
    const amount = PRICES[plan]?.[period];
    if (!amount) return json({ error: 'Offre ou période inconnue' }, 400);
    const token = Deno.env.get('FEEXPAY_TOKEN'), shop = Deno.env.get('FEEXPAY_SHOP_ID');
    if (!token || !shop) return json({ error: 'Le paiement en ligne n\'est pas encore configuré' }, 503);

    const card = body.method === 'card';
    const country = NETWORKS[body.country] ? body.country : 'BENIN';
    const reseau = NETWORKS[country].nets[body.network];
    if (!card && !reseau) return json({ error: 'Choisis ton opérateur Mobile Money' }, 400);
    let local = String(body.phone || '').replace(/\D/g, '');
    if (local.startsWith(NETWORKS[country].code) && local.length > 10) local = local.slice(NETWORKS[country].code.length);
    if (local.length < 8) return json({ error: 'Numéro de téléphone incomplet' }, 400);
    const phone = NETWORKS[country].code + local;

    const db = admin();
    const { data: pay, error: e1 } = await db.from('payments')
      .insert({ user_id: user.id, provider: 'feexpay', plan, period, method: card ? 'card' : 'mobile', amount, currency: 'XOF', status: 'pending' })
      .select().single();
    if (e1) throw e1;

    const full = String(user.user_metadata?.full_name || user.user_metadata?.name || '').trim() || (user.email || 'Client').split('@')[0];
    const [first, ...rest] = full.split(' ');
    const description = `Valideo ${NAMES[plan]} ${period === 'year' ? '1 an' : '1 mois'}`;
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` };
    const back = `${SITE}app.html?paiement=${pay.id}`;
    const names = { first_name: first || 'Client', last_name: rest.join(' ') || 'Valideo' };
    const r = card
      ? await fetch(`${API}/transactions/public/requesttopay/init`, { method: 'POST', headers, body: JSON.stringify({
          shop, amount: String(amount), currency: 'XOF', ...names, email: user.email, phoneNumber: phone,
          city: 'Cotonou', zip: '00229', country: 'BJ', description, callback_info: String(pay.id) }) })
      : await fetch(`${API}/transactions/public/requesttopay/${reseau}`, { method: 'POST', headers, body: JSON.stringify({
          shop, amount, phoneNumber: Number(phone), ...names, description, callback_info: { payment_id: String(pay.id) },
          return_url: back, cancel_url: back, ...(body.otp ? { otp: String(body.otp) } : {}) }) });
    const raw = await r.text();
    let j: Record<string, any> = {}; try { j = JSON.parse(raw); } catch { /* réponse non JSON */ }
    const reference = j?.reference || j?.data?.reference;
    if (!r.ok || !reference) {
      console.log('FeexPay refus', r.status, raw.slice(0, 800));
      await db.from('payments').update({ status: 'failed' }).eq('id', pay.id);
      const why = String(j?.message || j?.responsemsg || j?.detail || j?.error || j?.errors && JSON.stringify(j.errors) || '');
      return json({ error: `${why || 'FeexPay a refusé la demande de paiement'} (code ${r.status}${why ? '' : ' · ' + raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 160)})` }, 502);
    }
    await db.from('payments').update({ provider_id: String(reference) }).eq('id', pay.id);
    const out: Record<string, unknown> = { payment_id: pay.id, reference };
    const link = j?.paymentUrl || j?.payment_url || j?.url || j?.data?.url || j?.redirect_url;
    if (link) out.url = link;
    // Certains réseaux répondent tout de suite
    if (String(j?.status || '').toUpperCase() === 'SUCCESSFUL') Object.assign(out, await settle({ ...pay, provider_id: String(reference) }));
    return json(out);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
