import { Command } from 'commander';
import * as admin from 'firebase-admin';
import * as fs from 'fs-extra';
import * as csvtojson from 'csvtojson';

const program = new Command();
program
  .version('1.0.0')
  .requiredOption('-f, --file <path>', 'CSV file (same format as upload)')
  .requiredOption('-o, --org <id>', 'Organization ID')
  .option('--execute', 'Apply changes (default is dry run)')
  .parse(process.argv);

const opts = program.opts();
const EXECUTE: boolean = Boolean(opts.execute);
const ORG_ID: string = opts.org;
const CSV: string = opts.file;

if (!fs.existsSync('./serviceAccountKey.json')) {
  console.error('serviceAccountKey.json missing.');
  process.exit(1);
}
const serviceAccount = require('../serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function getOrCreateSquad(
  orgId: string, squadName: string,
): Promise<string> {
  const snap = await db.collection('squads')
    .where('organization', '==', orgId)
    .where('name', '==', squadName)
    .limit(1).get();
  if (!snap.empty) return snap.docs[0].id;
  const res = await db.collection('squads').add({
    name: squadName, organization: orgId,
  });
  return res.id;
}

async function main(): Promise<void> {
  console.log(EXECUTE ? '=== LIVE MODE ===' : '=== DRY RUN (pass --execute to write) ===');
  console.log(`Org: ${ORG_ID}\n`);

  const fileContent = await fs.readFile(CSV, 'utf-8');
  const rows = await csvtojson().fromString(fileContent);

  const orgDoc = await db.collection('organizations').doc(ORG_ID).get();
  const orgStatus: string = orgDoc.data()?.status || 'subscribed';

  type Plan = {
    uid: string;
    email: string;
    name: string;
    squadNames: string[];
    pendingReqIds: string[];
  };
  const plans: Plan[] = [];
  const noUserDoc: { email: string; name: string }[] = [];

  for (const row of rows) {
    const email = String(row.email || '').trim().toLowerCase();
    if (!email) continue;
    const name = `${row.firstName} ${row.lastName}`.trim();

    const userSnap = await db.collection('users')
      .where('email', '==', email).limit(1).get();
    if (userSnap.empty) {
      noUserDoc.push({ email, name });
      continue;
    }
    const uid = userSnap.docs[0].id;
    const squadNames: string[] = row.squads
      ? String(row.squads).split(';').map((s: string) => s.trim()).filter(Boolean)
      : [];

    const pendingSnap = await db.collection('joinOrganizationRequests')
      .where('organization', '==', ORG_ID)
      .where('email', '==', email).get();
    const pendingReqIds = pendingSnap.docs.map((d) => d.id);

    plans.push({ uid, email, name, squadNames, pendingReqIds });
  }

  console.log(`To re-attach: ${plans.length}`);
  console.log(`No user doc (skipped): ${noUserDoc.length}\n`);

  if (noUserDoc.length > 0) {
    console.log('No user doc for:');
    for (const n of noUserDoc) console.log(`  ${n.name} — ${n.email}`);
    console.log();
  }

  console.log('Preview:');
  for (const p of plans) {
    console.log(`  ${p.uid} — ${p.name} — squads: [${p.squadNames.join(', ')}] — clear ${p.pendingReqIds.length} join req(s)`);
  }
  console.log();

  if (!EXECUTE) {
    console.log('DRY RUN complete. Run with --execute to apply.');
    process.exit(0);
  }

  console.log('Applying...');
  const BATCH = 5;
  let done = 0;
  let errors = 0;

  for (let idx = 0; idx < plans.length; idx += BATCH) {
    const slice = plans.slice(idx, idx + BATCH);
    await Promise.all(slice.map(async (p) => {
      try {
        const squadIds: string[] = [];
        for (const name of p.squadNames) {
          squadIds.push(await getOrCreateSquad(ORG_ID, name));
        }
        const update: Record<string, unknown> = {
          organization: ORG_ID,
          organizationStatus: orgStatus,
          role: 'athlete',
        };
        if (squadIds.length > 0) update.squads = squadIds;
        await db.collection('users').doc(p.uid).update(update);
        for (const reqId of p.pendingReqIds) {
          await db.collection('joinOrganizationRequests').doc(reqId).delete();
        }
        done++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ERROR ${p.uid}: ${msg}`);
        errors++;
      }
    }));
    process.stdout.write(`  ${done}/${plans.length} (${errors} errors)\r`);
    if (idx + BATCH < plans.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.log(`\n\nDone. Re-attached ${done}, errors ${errors}.`);
  process.exit(0);
}

main().catch((err) => { console.error('Error:', err); process.exit(1); });
