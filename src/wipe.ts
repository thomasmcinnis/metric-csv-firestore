import { Command } from 'commander';
import * as admin from 'firebase-admin';
import * as fs from 'fs-extra';

const program = new Command();

program
  .version('1.0.0')
  .requiredOption('-o, --org <id>', 'Organization ID')
  .option('--execute', 'Apply changes (default is dry run)')
  .parse(process.argv);

const opts = program.opts();
const EXECUTE: boolean = Boolean(opts.execute);
const ORG_ID: string = opts.org;

if (!fs.existsSync('./serviceAccountKey.json')) {
  console.error('serviceAccountKey.json missing.');
  process.exit(1);
}

const serviceAccount = require('../serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

async function main(): Promise<void> {
  console.log(EXECUTE ? '=== LIVE MODE ===' : '=== DRY RUN (pass --execute to write) ===');
  console.log(`Org: ${ORG_ID}\n`);

  const snap = await db.collection('users')
    .where('organization', '==', ORG_ID)
    .get();

  const athletes: { uid: string; name: string; role: string }[] = [];
  const kept: { uid: string; name: string; role: string }[] = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    const role: string = data.role || '(none)';
    const name: string = data.firstName
      ? `${data.firstName} ${data.lastName || ''}`.trim()
      : (data.name || '(no name)');
    if (role === 'coach') {
      kept.push({ uid: doc.id, name, role });
    } else {
      athletes.push({ uid: doc.id, name, role });
    }
  }

  console.log(`Athletes to detach: ${athletes.length}`);
  console.log(`Coaches kept:       ${kept.length}\n`);

  if (kept.length > 0) {
    console.log('Keeping (coaches):');
    for (const c of kept) console.log(`  ${c.uid} — ${c.name}`);
    console.log();
  }

  console.log('Preview (first 20 athletes):');
  for (const a of athletes.slice(0, 20)) {
    console.log(`  ${a.uid} — ${a.name} — role: ${a.role}`);
  }
  if (athletes.length > 20) console.log(`  ... and ${athletes.length - 20} more`);
  console.log();

  if (athletes.length === 0) {
    console.log('Nothing to wipe.');
    process.exit(0);
  }

  if (!EXECUTE) {
    console.log('DRY RUN complete. Run with --execute to apply.');
    process.exit(0);
  }

  console.log('Detaching (5 at a time)...');
  const BATCH = 5;
  let updated = 0;
  let errors = 0;

  for (let idx = 0; idx < athletes.length; idx += BATCH) {
    const slice = athletes.slice(idx, idx + BATCH);
    await Promise.all(slice.map((a) =>
      db.collection('users').doc(a.uid).update({
        organization: FieldValue.delete(),
        organizationStatus: FieldValue.delete(),
      }).then(() => { updated++; })
        .catch((err) => {
          console.error(`  ERROR ${a.uid}: ${err.message}`);
          errors++;
        }),
    ));
    process.stdout.write(`  ${updated}/${athletes.length} (${errors} errors)\r`);
    if (idx + BATCH < athletes.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.log(`\n\nDone. Detached ${updated}, errors ${errors}.`);
  console.log('onUserProfileUpdateV2 trigger cascades org removal to sets/workouts.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
