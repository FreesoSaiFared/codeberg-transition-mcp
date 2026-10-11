import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

function filename(dir, id) {
  if (!/^[0-9a-f-]{36}$/i.test(id || '')) throw Error('Invalid plan ID');
  return path.join(dir, id + '.json');
}
let serial = Promise.resolve();
export async function savePlan(dir, plan) {
  serial = serial.catch(() => {}).then(async () => {
    await fs.mkdir(dir, {recursive:true, mode:0o700});
    const destination = filename(dir, plan.id);
    const temp = destination + '.' + randomUUID() + '.tmp';
    await fs.writeFile(temp, JSON.stringify(plan, null, 2) + '\n', {mode:0o600});
    await fs.rename(temp, destination);
  });
  return serial;
}
export async function readPlan(dir, id) {
  const p = JSON.parse(await fs.readFile(filename(dir,id), 'utf8'));
  if (p.version !== 1) throw Error('Unsupported plan format');
  return p;
}
export function summarize(plan) {
  const counts = {};
  for (const r of plan.entries) counts[r.status] = (counts[r.status] || 0) + 1;
  return {
    id:plan.id, createdAt:plan.createdAt, destinationForge:plan.destinationForge,
    owner:plan.owner, includeMetadata:plan.includeMetadata, counts,
    confirmationPhrase:'MIGRATE ' + (counts.ready || 0) + ' REPOSITORIES',
    policyUrl:plan.policyUrl, policyNotice:plan.policyNotice,
    entries:plan.entries.map(r => ({
      source:r.full_name, target:r.target, private:r.private,
      status:r.status, blockedReasons:r.blockedReasons || [],
      evidence:r.evidence || null, error:r.error || null,
    })),
  };
}
