import * as admin from 'firebase-admin';
import * as fs from 'fs-extra';
import * as csvtojson from 'csvtojson';

interface UserData {
  firstName: string;
  lastName: string;
  organization: string;
  email: string;
  gender: string;
  dateOfBirth?: FirebaseFirestore.Timestamp;
  squads?: string[];
}

let db: FirebaseFirestore.Firestore;

function initializeFirestore() {
  if (!fs.existsSync('./serviceAccountKey.json')) {
    throw new Error(
      "The serviceAccountKey.json file is missing. Please make sure you've followed the setup instructions in README.md.",
    );
  }
  const serviceAccount = require('../serviceAccountKey.json');

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  db = admin.firestore();
}

async function getOrCreateSquad(
  db: FirebaseFirestore.Firestore,
  organizationId: string,
  squadName: string,
): Promise<string> {
  const squadRef = db
    .collection('squads')
    .where('organizationId', '==', organizationId)
    .where('name', '==', squadName)
    .limit(1);
  const squadSnapshot = await squadRef.get();

  if (squadSnapshot.empty) {
    // Create new squad
    const squadData = {
      name: squadName,
      organizationId: organizationId,
    };
    const res = await db.collection('squads').add(squadData);
    return res.id;
  } else {
    // Return existing squad ID
    return squadSnapshot.docs[0].id;
  }
}

export async function uploadCSV(
  filePath: string,
  organizationId: string,
): Promise<void> {
  if (!db) {
    initializeFirestore();
  }

  const fileContent = await fs.readFile(filePath, 'utf-8');
  const jsonArray = await csvtojson().fromString(fileContent);

  const batch = db.batch();
  for (let row of jsonArray) {
    const docRef = db.collection('userCreationRequests').doc();
    const data: UserData = {
      firstName: row.firstName,
      lastName: row.lastName,
      organization: row.organization,
      email: row.email,
      gender: row.gender,
    };

    if (row.squads) {
      const squadNames = row.squads.split(';').map((s: string) => s.trim());
      const squadIds = await Promise.all(
        squadNames.map((name: string) =>
          getOrCreateSquad(db, organizationId, name),
        ),
      );
      data.squads = squadIds;
    }

    if (row.dateOfBirth) {
      data.dateOfBirth = admin.firestore.Timestamp.fromDate(
        new Date(row.dateOfBirth),
      );
    }

    batch.set(docRef, data);
  }
  await batch.commit();
}
