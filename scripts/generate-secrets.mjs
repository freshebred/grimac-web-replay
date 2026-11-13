import {randomBytes} from 'node:crypto';
console.log('Generate these locally; do not commit the output.');
console.log(`INGEST_TOKEN=${randomBytes(32).toString('hex')}`);
