# Metric CSV Uploader Instructions

This CLI app just takes a csv and adds each row to the `userCreationRequest` collection in Firestore.

## Setting up the CSV file

### Create required squads in Firestore

1. Go to the squads collection in Firestore
2. Filter by the organization ID of the org you are doing the bulk upload for
3. Add any new squad documents as required
4. Note the ID string for each squad

### Create a CSV

You must have a CSV file with the following formatting:

```txt
firstName,lastName,organization,email,gender,squads
Bob,Smith,K1hFmAw79rybBOujEmFM,example@email.com,Male,"[""BgHPOSVNpjYJqNcZTzzK"",""AnotherSquadID""]"
```

> **Note**: Note that the array of squadIDs are contained in quotations, wrapped by double quotes inside the braces, and the comma seperation is also wrapped in quotes. Failure to have the correct quotations will throw a parsing error in the app.


## Setting up the app

### Prerequisites

- Node.js and npm installed.

### Dependencies

To install the required dependencies for this project, navigate to the project's root directory in your terminal and run:

```bash
npm install
```

### Adding Your serviceAccountKey.json

1. Obtain your `serviceAccountKey.json` from Firebase:
   - Go to the Firebase Console.
   - Select Metric VBT project.
   - Navigate to `Project Settings > Service accounts`.
   - Click on `Generate new private key`.
   - This will download the `serviceAccountKey.json`. (You might have to rename it this from a long name.)

2. Move the downloaded `serviceAccountKey.json` to the root of this project.

> **Note**: This file contains sensitive information. Ensure you do not share it, commit it, or expose it in any public areas.

### Building the App

To build the application, run:

```bash
npx tsc
```

This will compile the TypeScript `src` files and place the output in the `dist` directory.

## Running the App

To run the, navigate to the project's root directory and execute:

```bash
node dist/upload.js -f path_to_your_csv_file.csv
```

Replace `path_to_your_csv_file.csv` with the path to your actual CSV file.

Assuming you have the file saved in your Documents folder that would be like this:

```bash
node dist/upload.js -f ~/Documents/your-csv-filename.csv
```

It is advisable to watch the `userCreationRequest` collection in Firestore to observe the documents being written and then handled by the Firebase function, and also making random checks of various new users to ensure success.