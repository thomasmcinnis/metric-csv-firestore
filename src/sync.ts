import { Command } from 'commander';
import * as admin from 'firebase-admin';
import * as fs from 'fs-extra';
import * as csvtojson from 'csvtojson';
import { input, confirm } from '@inquirer/prompts';

const program = new Command();
program
  .version('1.0.0')
  .option('-f, --file <path>', 'CSV file')
  .option('-o, --org <id>', 'Organization ID')
  .option('--remove-missing-athletes', 'Remove athletes in org but not in CSV')
  .option('--remove-missing-coaches', 'Remove coaches in org but not in CSV')
  .option('--execute', 'Apply changes (default is dry run)')
  .option('--yes', 'Skip interactive prompts (use flags as given)')
  .parse(process.argv);

const opts = program.opts();

if (!fs.existsSync('./serviceAccountKey.json')) {
  console.error('serviceAccountKey.json missing.');
  process.exit(1);
}
const serviceAccount = require('../serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

type CsvRow = {
  firstName: string;
  lastName: string;
  email: string;
  gender: string;
  dateOfBirth?: string;
  squads?: string;
};

type OrgUser = {
  uid: string;
  email: string;
  name: string;
  role: string;
  currentSquads: string[];
};

type Plan = {
  toAttach: { csv: CsvRow; uid: string; email: string; name: string;
    pendingReqIds: string[] }[];
  toCreate: { csv: CsvRow; email: string; name: string }[];
  toUpdateSquads: { uid: string; email: string; name: string;
    nextSquads: string[] }[];
  toRemoveAthletes: OrgUser[];
  toRemoveCoaches: OrgUser[];
  keep: OrgUser[];
};

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

async function squadIdsForNames(
  orgId: string, names: string[], dryRun: boolean,
): Promise<string[]> {
  const ids: string[] = [];
  for (const name of names) {
    if (dryRun) {
      const snap = await db.collection('squads')
        .where('organization', '==', orgId)
        .where('name', '==', name).limit(1).get();
      ids.push(snap.empty ? `<NEW:${name}>` : snap.docs[0].id);
    } else {
      ids.push(await getOrCreateSquad(orgId, name));
    }
  }
  return ids;
}

function csvSquadsFor(row: CsvRow): string[] {
  return row.squads
    ? row.squads.split(';').map((s) => s.trim()).filter(Boolean)
    : [];
}

async function buildPlan(
  orgId: string, csvRows: CsvRow[],
): Promise<Plan> {
  const csvByEmail = new Map<string, CsvRow>();
  for (const r of csvRows) {
    const e = String(r.email || '').trim().toLowerCase();
    if (e) csvByEmail.set(e, { ...r, email: e });
  }

  const orgSnap = await db.collection('users')
    .where('organization', '==', orgId).get();
  const orgByEmail = new Map<string, OrgUser>();
  for (const d of orgSnap.docs) {
    const data = d.data();
    const email = String(data.email || '').toLowerCase();
    if (!email) continue;
    const name = data.firstName
      ? `${data.firstName} ${data.lastName || ''}`.trim()
      : (data.name || '(no name)');
    orgByEmail.set(email, {
      uid: d.id,
      email,
      name,
      role: data.role || '(none)',
      currentSquads: Array.isArray(data.squads) ? data.squads : [],
    });
  }

  // Resolve squad name → id map for org (current state)
  const squadDocs = await db.collection('squads')
    .where('organization', '==', orgId).get();
  const squadNameById = new Map<string, string>();
  for (const d of squadDocs.docs) {
    squadNameById.set(d.id, String(d.data().name || ''));
  }

  const plan: Plan = {
    toAttach: [], toCreate: [], toUpdateSquads: [],
    toRemoveAthletes: [], toRemoveCoaches: [], keep: [],
  };

  for (const [email, csv] of csvByEmail) {
    const inOrg = orgByEmail.get(email);
    if (inOrg) {
      const currentNames = inOrg.currentSquads
        .map((id) => squadNameById.get(id) || '')
        .filter(Boolean).sort();
      const nextNames = csvSquadsFor(csv).slice().sort();
      const sameSquads = currentNames.length === nextNames.length
        && currentNames.every((n, i) => n === nextNames[i]);
      if (!sameSquads) {
        plan.toUpdateSquads.push({
          uid: inOrg.uid, email, name: inOrg.name,
          nextSquads: csvSquadsFor(csv),
        });
      } else {
        plan.keep.push(inOrg);
      }
      continue;
    }
    // Not in org — check if user doc exists
    const userSnap = await db.collection('users')
      .where('email', '==', email).limit(1).get();
    if (userSnap.empty) {
      plan.toCreate.push({ csv, email, name: `${csv.firstName} ${csv.lastName}` });
    } else {
      const pendingSnap = await db.collection('joinOrganizationRequests')
        .where('organization', '==', orgId)
        .where('email', '==', email).get();
      plan.toAttach.push({
        csv,
        uid: userSnap.docs[0].id,
        email,
        name: `${csv.firstName} ${csv.lastName}`,
        pendingReqIds: pendingSnap.docs.map((d) => d.id),
      });
    }
  }

  for (const [email, u] of orgByEmail) {
    if (csvByEmail.has(email)) continue;
    if (u.role === 'coach') plan.toRemoveCoaches.push(u);
    else plan.toRemoveAthletes.push(u);
  }

  return plan;
}

function summarise(
  plan: Plan, removeAthletes: boolean, removeCoaches: boolean,
): void {
  console.log('— Plan —');
  console.log(`  Attach existing users to org:  ${plan.toAttach.length}`);
  console.log(`  Create new users (via UCR):    ${plan.toCreate.length}`);
  console.log(`  Update squads on existing:     ${plan.toUpdateSquads.length}`);
  console.log(`  Keep as-is:                    ${plan.keep.length}`);
  console.log(`  Athletes in org but not CSV:   ${plan.toRemoveAthletes.length} ${removeAthletes ? '(WILL REMOVE)' : '(keep)'}`);
  console.log(`  Coaches in org but not CSV:    ${plan.toRemoveCoaches.length} ${removeCoaches ? '(WILL REMOVE)' : '(keep)'}\n`);

  const sec = (title: string, rows: { name: string; email: string }[]) => {
    if (rows.length === 0) return;
    console.log(title);
    for (const r of rows.slice(0, 20)) console.log(`  ${r.name} — ${r.email}`);
    if (rows.length > 20) console.log(`  ... and ${rows.length - 20} more`);
    console.log();
  };
  sec('Attach:', plan.toAttach);
  sec('Create:', plan.toCreate);
  sec('Update squads:', plan.toUpdateSquads);
  if (removeAthletes) sec('Remove athletes:', plan.toRemoveAthletes);
  if (removeCoaches) sec('Remove coaches:', plan.toRemoveCoaches);
}

async function applyPlan(
  orgId: string, plan: Plan,
  removeAthletes: boolean, removeCoaches: boolean,
): Promise<void> {
  const orgDoc = await db.collection('organizations').doc(orgId).get();
  const orgStatus: string = orgDoc.data()?.status || 'subscribed';

  console.log('\nApplying...');
  let writes = 0;

  // Attach
  for (const a of plan.toAttach) {
    const squadIds = await squadIdsForNames(
      orgId, csvSquadsFor(a.csv), false);
    const update: Record<string, unknown> = {
      organization: orgId,
      organizationStatus: orgStatus,
      role: 'athlete',
    };
    if (squadIds.length > 0) update.squads = squadIds;
    await db.collection('users').doc(a.uid).update(update);
    writes++;
    for (const reqId of a.pendingReqIds) {
      await db.collection('joinOrganizationRequests').doc(reqId).delete();
      writes++;
    }
    process.stdout.write(`  writes: ${writes}\r`);
  }

  // Create (via userCreationRequests — function handles auth + email)
  for (const c of plan.toCreate) {
    const squadIds = await squadIdsForNames(
      orgId, csvSquadsFor(c.csv), false);
    const data: Record<string, unknown> = {
      firstName: c.csv.firstName,
      lastName: c.csv.lastName,
      organization: orgId,
      email: c.email,
      gender: c.csv.gender,
      sendInvite: false,
    };
    if (squadIds.length > 0) data.squads = squadIds;
    if (c.csv.dateOfBirth) {
      data.dateOfBirth = admin.firestore.Timestamp.fromDate(
        new Date(c.csv.dateOfBirth));
    }
    await db.collection('userCreationRequests').add(data);
    writes++;
    process.stdout.write(`  writes: ${writes}\r`);
  }

  // Update squads
  for (const u of plan.toUpdateSquads) {
    const squadIds = await squadIdsForNames(orgId, u.nextSquads, false);
    await db.collection('users').doc(u.uid).update({ squads: squadIds });
    writes++;
    process.stdout.write(`  writes: ${writes}\r`);
  }

  // Removes
  const toRemove: OrgUser[] = [];
  if (removeAthletes) toRemove.push(...plan.toRemoveAthletes);
  if (removeCoaches) toRemove.push(...plan.toRemoveCoaches);
  for (const u of toRemove) {
    await db.collection('users').doc(u.uid).update({
      organization: FieldValue.delete(),
      organizationStatus: FieldValue.delete(),
    });
    writes++;
    process.stdout.write(`  writes: ${writes}\r`);
  }

  console.log(`\nDone. Total writes: ${writes}.`);
  console.log('onUserProfileUpdateV2 cascades org changes to sets/workouts.');
}

async function main(): Promise<void> {
  let file: string = opts.file;
  let org: string = opts.org;
  let removeAthletes: boolean = Boolean(opts.removeMissingAthletes);
  let removeCoaches: boolean = Boolean(opts.removeMissingCoaches);
  let execute: boolean = Boolean(opts.execute);

  if (!opts.yes) {
    if (!file) file = await input({ message: 'CSV path:' });
    if (!org) org = await input({ message: 'Organization ID:' });
  }
  if (!file || !org) {
    console.error('Both -f and -o are required (or run interactively).');
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error(`CSV not found: ${file}`);
    process.exit(1);
  }

  const csvContent = await fs.readFile(file, 'utf-8');
  const rows = (await csvtojson().fromString(csvContent)) as CsvRow[];
  console.log(`\nLoaded ${rows.length} rows from ${file}`);
  console.log(`Org: ${org}\n`);

  if (rows.length === 0) {
    console.error('CSV has no data rows.');
    process.exit(1);
  }

  const EXPECTED = ['firstName', 'lastName', 'email', 'gender',
    'dateOfBirth', 'squads'];
  const REQUIRED = new Set(['firstName', 'lastName', 'email', 'gender']);
  const headers = Object.keys(rows[0]);
  const first = rows[0];

  console.log('— Field mapping (first row) —');
  for (const field of EXPECTED) {
    const present = headers.includes(field);
    const value = present ? String((first as any)[field] ?? '') : '';
    const required = REQUIRED.has(field);
    const status = present
      ? (value.trim() === '' && required ? 'MISSING VALUE' : 'OK')
      : (required ? 'MISSING COLUMN' : 'optional, absent');
    const display = value.length > 60 ? value.slice(0, 57) + '...' : value;
    console.log(`  ${field.padEnd(13)} → ${status.padEnd(15)} ${display}`);
  }
  const unexpected = headers.filter((h) => !EXPECTED.includes(h));
  if (unexpected.length > 0) {
    console.log(`  Unexpected columns (ignored): ${unexpected.join(', ')}`);
  }
  console.log();

  const missingRequired = [...REQUIRED].filter(
    (f) => !headers.includes(f) || String((first as any)[f] ?? '').trim() === '');
  if (missingRequired.length > 0) {
    console.error(`Required field(s) missing/empty on first row: ${missingRequired.join(', ')}`);
    console.error('Fix the CSV and re-run.');
    process.exit(1);
  }

  if (!opts.yes) {
    const looksRight = await confirm({
      message: 'Does the field mapping above look correct?',
      default: true,
    });
    if (!looksRight) {
      console.log('Aborted. Fix the CSV columns and re-run.');
      process.exit(0);
    }
  }

  const plan = await buildPlan(org, rows);

  if (!opts.yes) {
    removeAthletes = await confirm({
      message: `Remove athletes in the organization but not listed on the CSV? (${plan.toRemoveAthletes.length} found)`,
      default: false,
    });
    removeCoaches = await confirm({
      message: `Remove any coaches in the organization but not in the CSV? (${plan.toRemoveCoaches.length} found)`,
      default: false,
    });
  }

  summarise(plan, removeAthletes, removeCoaches);

  const nothingToDo = plan.toAttach.length === 0
    && plan.toCreate.length === 0
    && plan.toUpdateSquads.length === 0
    && (!removeAthletes || plan.toRemoveAthletes.length === 0)
    && (!removeCoaches || plan.toRemoveCoaches.length === 0);
  if (nothingToDo) {
    console.log('Nothing to do.');
    process.exit(0);
  }

  if (!opts.yes && !execute) {
    execute = await confirm({ message: 'Apply changes?', default: false });
  }
  if (!execute) {
    console.log('Dry run only. Re-run with --execute (or confirm in prompt).');
    process.exit(0);
  }

  await applyPlan(org, plan, removeAthletes, removeCoaches);
  process.exit(0);
}

main().catch((err) => { console.error('Error:', err); process.exit(1); });
