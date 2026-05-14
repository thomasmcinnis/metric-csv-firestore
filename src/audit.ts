import * as admin from 'firebase-admin';
import * as fs from 'fs-extra';

const ORG_ID = 'HP8Zk36t6O6d4cdxCzbj';
const CSV = '/Users/jacobtober/Downloads/2026-roster-formatted.csv';

if (!fs.existsSync('./serviceAccountKey.json')) {
  console.error('serviceAccountKey.json missing.');
  process.exit(1);
}
const serviceAccount = require('../serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function main(): Promise<void> {
  const csv = fs.readFileSync(CSV, 'utf-8').split('\n').slice(1)
    .filter((l) => l.trim().length > 0);
  const expected = csv.map((line) => {
    const cols = line.split(',');
    return { email: cols[2].trim().toLowerCase(), name: `${cols[0]} ${cols[1]}` };
  });

  const usersSnap = await db.collection('users')
    .where('organization', '==', ORG_ID).get();
  const inOrgEmails = new Set<string>();
  for (const d of usersSnap.docs) {
    const e = (d.data().email || '').toLowerCase();
    if (e) inOrgEmails.add(e);
  }

  const ucrSnap = await db.collection('userCreationRequests')
    .where('organization', '==', ORG_ID).get();
  const pending: { email: string; status: string }[] = [];
  for (const d of ucrSnap.docs) {
    const data = d.data();
    pending.push({
      email: (data.email || '').toLowerCase(),
      status: data.status || data.processedAt ? 'processed' : 'pending',
    });
  }

  console.log(`Expected from CSV: ${expected.length}`);
  console.log(`In users (org=${ORG_ID}): ${inOrgEmails.size}`);
  console.log(`userCreationRequests with this org: ${ucrSnap.size}\n`);

  const missing = expected.filter((e) => !inOrgEmails.has(e.email));
  console.log(`MISSING (${missing.length}):`);
  for (const m of missing) console.log(`  ${m.name} — ${m.email}`);

  console.log('\nuserCreationRequest sample (first 5):');
  for (const d of ucrSnap.docs.slice(0, 5)) {
    console.log(`  ${d.id}`, JSON.stringify(d.data()));
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
