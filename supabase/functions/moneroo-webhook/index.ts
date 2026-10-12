// Validéo · moneroo-webhook
// Reçoit les notifications de Moneroo, vérifie leur signature, revérifie le paiement auprès de l'API,
// puis active l'offre de l'utilisateur. À déployer SANS vérification JWT (Moneroo appelle sans session).
// Secrets requis : MONEROO_SECRET_KEY, MONEROO_WEBHOOK_SECRET
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const ok = (msg = 'ok') => new Response(msg, { status: 200 });

async function hmacHex(secret: string, payload: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function sameText(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Méthode non autorisée', { status: 405 });
  const raw = await req.text();
  const signature = (req.headers.get('X-Moneroo-Signature') || '').trim().toLowerCase();
  const expected = await hmacHex(Deno.env.get('MONEROO_WEBHOOK_SECRET') || '', raw);
  if (!signature || !sameText(signature, expected)) return new Response('Signature invalide', { status: 403 });

  let event: { event?: string; data?: { id?: string } };
  try { event = JSON.parse(raw); } catch { return ok('payload illisible'); }
  const providerId = event?.data?.id ? String(event.data.id) : '';
  if (!providerId) return ok('sans identifiant');

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: pay } = await admin.from('payments').select('*').eq('provider_id', providerId).maybeSingle();
  if (!pay || pay.status === 'success') return ok('déjà traité ou inconnu');

  if (event.event === 'payment.failed' || event.event === 'payment.cancelled') {
    await admin.from('payments').update({ status: event.event === 'payment.failed' ? 'failed' : 'cancelled' }).eq('id', pay.id);
    return ok();
  }
  if (event.event !== 'payment.success') return ok('ignoré');

  // On ne fait jamais confiance au seul webhook : on revérifie le paiement auprès de Moneroo
  const v = await fetch(`https://api.moneroo.io/v1/payments/${encodeURIComponent(providerId)}/verify`, {
    headers: { Authorization: `Bearer ${Deno.env.get('MONEROO_SECRET_KEY')}`, Accept: 'application/json' },
  });
  const vj = await v.json().catch(() => ({}));
  const d = vj?.data ?? {};
  const currency = typeof d.currency === 'object' ? d.currency?.code : d.currency;
  if (d.status !== 'success') return ok('pas encore payé');
  if (currency !== pay.currency || Number(d.amount) < pay.amount || (d.metadata?.payment_id && d.metadata.payment_id !== String(pay.id))) {
    await admin.from('payments').update({ status: 'mismatch' }).eq('id', pay.id);
    return ok('montant ou devise incohérents');
  }

  // Prolonge l'offre à partir de sa date de fin actuelle si elle court encore
  const { data: prof } = await admin.from('profiles').select('plan_until').eq('id', pay.user_id).maybeSingle();
  const now = new Date(), base = prof?.plan_until && new Date(prof.plan_until) > now ? new Date(prof.plan_until) : now;
  if (pay.period === 'year') base.setFullYear(base.getFullYear() + 1); else base.setMonth(base.getMonth() + 1);
  await admin.from('profiles').update({ plan: pay.plan, plan_until: base.toISOString().slice(0, 10) }).eq('id', pay.user_id);
  await admin.from('payments').update({ status: 'success', paid_at: new Date().toISOString() }).eq('id', pay.id);
  return ok();
});
