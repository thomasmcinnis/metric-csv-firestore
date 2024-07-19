# Metric CSV Uploader Instructions

This CLI app takes a csv of athlete details and adds each row to the
`userCreationRequest` collection in Firestore.

On running, rows from the csv create new athlete records, and create new squads
for the organisation if they don't currently exist.

Additionally, invitation emails are turned off by default, so athletes will not
be notified.

## Format for the CSV file

An example csv is provided in the root directory. Note the column names.

```txt
firstName,lastName,email,gender,dateOfBirth,squads
Bob,Smith,example@email.com,Male,2007-05-19,Hockey;Basketball
```

> [!IMPORTANT]
>
> - `dateOfBirth` and `squads` columns are optional and can be left empty
> - Note the delimetter for squads is semi-colon `;`
> - Dates must be in format `YYYY-MM-DD`

## Set up

### Prerequisites

- Node.js and npm installed.

### Dependencies

To install the required dependencies for this project, navigate to the project's
root directory in your terminal and run:

```bash
npm install
```

### Add your `serviceAccountKey.json`

1. Obtain your `serviceAccountKey.json` from Firebase:

   - Go to the Firebase Console.
   - Select Metric VBT project.
   - Navigate to `Project Settings > Service accounts`.
   - Click on `Generate new private key`.
   - This will download the `serviceAccountKey.json`.
     (You might have to rename it this from a long name.)

2. Move the downloaded `serviceAccountKey.json` to the root of this project.

> [!CAUTION]
>
> This file contains sensitive information. Ensure you do not share it,
> commit it, or expose it to public access. By default it is already excluded
> in the .gitignore file.

### Build the app

To build the application, run:

```bash
npx tsc
```

This will compile the TypeScript files in `./src/` and create an executable
in the `./dist/` directory.

## Run the app

### Options

The app accepts two required options:

- The filepath to the csv denoted by `-f` or `--file` flag
- The organisation document id denoted by the `-o` or `--org` flag

### Executing

To run, navigate to the project's root directory and execute:

```bash
node dist/index.js -f path/to/your/csv/file.csv -o the-org-id
```

Assuming you have the file saved in your Documents folder that would be something
like this:

```bash
node dist/index.js -f ~/Documents/your-csv-filename.csv -o fs8l0oHiXpTc9qhefD6c
```

> [!NOTE]
>
> It is advisable to watch the `userCreationRequest` collection in Firestore to
> observe the documents being written and then handled by the Firebase function,
> and also making random checks of various new users to ensure success.
