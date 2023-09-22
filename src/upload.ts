import * as admin from "firebase-admin";
import * as fs from "fs-extra";
import * as csvtojson from "csvtojson";
import { Command } from "commander";

// Check if the file exists
if (!fs.existsSync("./serviceAccountKey.json")) {
  console.error("Error: The serviceAccountKey.json file is missing. Please make sure you've followed the setup instructions in README.md.");
  process.exit(1);
}

const serviceAccount = require("../serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const program = new Command();

program
  .version("1.0.0")
  .option("-f, --file <path>", "CSV file to upload")
  .action(async (options) => {
    if (options.file) {

      const fileContent = await fs.readFile(options.file, "utf-8");
      const jsonArray = await csvtojson().fromString(fileContent);

      const batch = db.batch();
      for (let row of jsonArray) {
        const docRef = db.collection("userCreationRequests").doc();
        batch.set(docRef, {
          firstName: row.firstName,
          lastName: row.lastName,
          organization: row.organization,
          email: row.email,
          gender: row.gender,
          squads: JSON.parse(row.squads),
        });
      }
      await batch.commit();
      console.log("Upload successful");
    } else {
      console.log("Please import a CVS with -f <filepath>");
    }
  })
  .parse(process.argv);
