import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_PATH = path.resolve(__dirname, '../../data/selfies-map.json');

function readStore() {
  try {
    if (!fs.existsSync(STORE_PATH)) {
      const initial = {};
      fs.writeFileSync(STORE_PATH, JSON.stringify(initial, null, 2), 'utf8');
      return initial;
    }
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading selfies map:', err);
    return {};
  }
}

function writeStore(data) {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing selfies map:', err);
  }
}

export const selfieStore = {
  set(attendanceId, selfiePath) {
    const store = readStore();
    store[attendanceId] = selfiePath;
    writeStore(store);
  },
  get(attendanceId) {
    const store = readStore();
    return store[attendanceId] || null;
  }
};
