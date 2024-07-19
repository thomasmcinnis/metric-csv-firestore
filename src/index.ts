import { Command } from 'commander';
import { uploadCSV } from './uploader';

const program = new Command();

program
  .version('1.1.0')
  // TODO: add flag to globally remove invite email supression on athlete creation
  .requiredOption('-f, --file <path>', 'CSV file to upload')
  .requiredOption('-o, --org <id>', 'Organization ID')
  .action(async (options) => {
    try {
      await uploadCSV(options.file, options.org);
      console.log('Upload successful');
    } catch (error) {
      console.error('Upload failed', error);
    }
  })
  .parse(process.argv);
