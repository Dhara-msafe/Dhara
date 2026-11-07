/**
 * Family Journey — read-only contact source for the picker.
 *
 * Reads the two Trusted Circle lists the user already has and merges them.
 * It NEVER invites, messages, writes, or modifies either list.
 */
import { getCircle } from '../women/api';
import { listAcceptedRecipients } from '../trustedCircle/api';
import type { ContactSource } from './store';

export type PickableContact = { id: string; name: string; phone: string; source: ContactSource };

function normalisePhone(p: string) {
  return (p || '').replace(/\D/g, '').slice(-10);
}

export async function loadPickableContacts(token: string | null): Promise<PickableContact[]> {
  const out: PickableContact[] = [];
  const seen = new Set<string>();

  const device = await getCircle().catch(() => []);
  for (const ct of device) {
    const k = normalisePhone(ct.phone) || `name:${ct.name}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ id: `device:${ct.id}`, name: ct.name, phone: ct.phone, source: 'device' });
  }

  if (token) {
    const accepted = await listAcceptedRecipients(token).catch(() => []);
    for (const link of accepted) {
      const k = normalisePhone(link.contact_phone) || `name:${link.contact_name}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ id: `invite:${link.id}`, name: link.contact_name, phone: link.contact_phone, source: 'invite' });
    }
  }

  return out;
}
