#!/usr/bin/env node
/* =========================================================================
   validate.js — structural checks on the site's data block.

   Usage
   -----
     node scripts/validate.js

   Exits 0 when everything checks out, 1 with a list of problems otherwise.
   Run it after any edit to PRECINCTS or ELECTION, by hand or in CI.

   Why it works this way
   ---------------------
   app.js is a plain browser script, not a module — it touches `document`
   partway down, so it can't be require()d. Everything above the ROLL CALL
   banner is pure data, so we slice there and eval that much in a sandbox.
   No refactor of app.js needed, and nothing to keep in sync.
   ========================================================================= */

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_END = '/* =========================================================\n   ROLL CALL';

const problems = [];
const fail = (msg) => problems.push(msg);

/* ---------- load the data block ---------------------------------------- */

const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const cut = src.indexOf(DATA_END);
if (cut === -1) {
  console.error('validate: could not find the ROLL CALL banner in app.js.');
  console.error('If that comment was renamed, update DATA_END in this script.');
  process.exit(1);
}

const sandbox = {};
vm.createContext(sandbox);
try {
  vm.runInContext(
    src.slice(0, cut) + '\nthis.ELECTION=ELECTION;this.PRECINCTS=PRECINCTS;this.PRECINCT_ORDER=PRECINCT_ORDER;',
    sandbox
  );
} catch (err) {
  console.error('validate: the data block at the top of app.js is not valid JavaScript.');
  console.error(err.message);
  process.exit(1);
}

const { ELECTION, PRECINCTS, PRECINCT_ORDER } = sandbox;

/* ---------- ELECTION ---------------------------------------------------- */

if (typeof ELECTION.active !== 'boolean') {
  fail(`ELECTION.active must be true or false, got ${JSON.stringify(ELECTION.active)}`);
}
for (const field of ['name', 'dateLabel', 'imagePath']) {
  if (typeof ELECTION[field] !== 'string' || !ELECTION[field].trim()) {
    fail(`ELECTION.${field} must be a non-empty string`);
  }
}

/* ---------- PRECINCTS --------------------------------------------------- */

const EXPECTED = ['A1','A2','A3','B1','B2','B3','C1','C2','C3','D1','D2','D3'];

const missingOrder = EXPECTED.filter((c) => !PRECINCT_ORDER.includes(c));
const extraOrder   = PRECINCT_ORDER.filter((c) => !EXPECTED.includes(c));
if (missingOrder.length) fail(`PRECINCT_ORDER is missing: ${missingOrder.join(', ')}`);
if (extraOrder.length)   fail(`PRECINCT_ORDER has unexpected entries: ${extraOrder.join(', ')}`);

const orphanKeys = Object.keys(PRECINCTS).filter((c) => !PRECINCT_ORDER.includes(c));
if (orphanKeys.length) {
  fail(`PRECINCTS has entries not listed in PRECINCT_ORDER (they will not render): ${orphanKeys.join(', ')}`);
}

for (const code of PRECINCT_ORDER) {
  const p = PRECINCTS[code];
  if (!p) { fail(`${code}: listed in PRECINCT_ORDER but missing from PRECINCTS`); continue; }

  // People — always exactly two seats. "Vacant" is a valid occupant.
  if (!Array.isArray(p.people) || p.people.length !== 2) {
    fail(`${code}: expected exactly 2 people, got ${Array.isArray(p.people) ? p.people.length : typeof p.people}`);
  } else {
    p.people.forEach((name, i) => {
      if (typeof name !== 'string' || !name.trim()) {
        fail(`${code}: person ${i + 1} is empty — use 'Vacant' for an unfilled seat`);
      }
    });
  }

  // Email follows the precinct code, lowercased.
  const expectedEmail = `${code.toLowerCase()}@ptgop.com`;
  if (p.email !== expectedEmail) {
    fail(`${code}: email should be ${expectedEmail}, found ${JSON.stringify(p.email)}`);
  }

  // Polling place — presence only. The values themselves are not this
  // script's business; it just makes sure a card won't render blank.
  if (!p.polling || typeof p.polling !== 'object') {
    fail(`${code}: missing polling block`);
  } else {
    for (const field of ['name', 'street', 'city', 'zip']) {
      if (typeof p.polling[field] !== 'string' || !p.polling[field].trim()) {
        fail(`${code}: polling.${field} is empty`);
      }
    }
  }

  // Ballot pages must be a non-negative integer.
  if (!Number.isInteger(p.ballotPages) || p.ballotPages < 0) {
    fail(`${code}: ballotPages must be a whole number 0 or greater, got ${JSON.stringify(p.ballotPages)}`);
  }
}

/* ---------- ballot images ----------------------------------------------- */
/* Only enforced while an election is active — between elections the images
   are allowed to be stale or absent, which is what `active: false` means. */

const ballotDir = path.join(ROOT, ELECTION.imagePath.replace(/^\//, ''));

if (ELECTION.active) {
  const withBallots = PRECINCT_ORDER.filter((c) => (PRECINCTS[c]?.ballotPages || 0) > 0);

  if (!withBallots.length) {
    fail('ELECTION.active is true but no precinct has ballotPages > 0 — the ballot grid would render empty');
  }

  for (const code of withBallots) {
    for (let i = 0; i < PRECINCTS[code].ballotPages; i++) {
      const rel = path.join(ELECTION.imagePath.replace(/^\//, ''), `${code}-${i}.png`);
      if (!fs.existsSync(path.join(ROOT, rel))) {
        fail(`${code}: ballotPages is ${PRECINCTS[code].ballotPages} but ${rel} is missing`);
      }
    }
  }

  // A leftover page from a longer previous ballot would never be shown and
  // usually means ballotPages was set too low.
  if (fs.existsSync(ballotDir)) {
    for (const file of fs.readdirSync(ballotDir)) {
      const m = file.match(/^([A-D][1-3])-(\d+)\.png$/);
      if (!m) continue;
      const [, code, page] = m;
      const declared = PRECINCTS[code]?.ballotPages || 0;
      if (Number(page) >= declared) {
        fail(`${ELECTION.imagePath}/${file} is never shown — ${code} declares ballotPages: ${declared}`);
      }
    }
  }
}

/* ---------- report ------------------------------------------------------ */

if (problems.length) {
  console.error(`validate: ${problems.length} problem${problems.length === 1 ? '' : 's'} found\n`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error('');
  process.exit(1);
}

console.log(`validate: OK — ${PRECINCT_ORDER.length} precincts, election ${ELECTION.active ? 'active' : 'inactive'}`);
