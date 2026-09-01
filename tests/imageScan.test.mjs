// Synthetic tests for multi-image scan helpers (client planner + server parts).
// FICTIONAL data only. No DOM/canvas is exercised (compression is browser-only).
//
// Run (where Node exists) from repo root:  node tests/imageScan.test.mjs
import { createServer } from 'vite';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log('PASS ' + label); } else { fail++; console.log('FAIL ' + label); } };

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });

try {
  const { planImageAdditions, removeImageAt, MAX_SCAN_IMAGES } =
    await vite.ssrLoadModule('/src/lib/imageScan.js');
  const { buildImageParts, MAX_SCAN_IMAGES: SERVER_MAX } =
    await vite.ssrLoadModule('/server/imageParts.js');

  ok('client and server caps agree (5)', MAX_SCAN_IMAGES === 5 && SERVER_MAX === 5);

  // Client planner: accept within cap, cap the overflow, refuse when full.
  ok('accepts 1 into empty', planImageAdditions(0, 1).accepted === 1);
  ok('accepts up to the cap', planImageAdditions(0, 5).accepted === 5);
  ok('caps more than 5 to 5', planImageAdditions(0, 8).accepted === 5 && !!planImageAdditions(0, 8).note);
  ok('respects already-added images', planImageAdditions(3, 5).accepted === 2);
  ok('refuses when already full', planImageAdditions(5, 2).accepted === 0 && !!planImageAdditions(5, 2).note);

  // Removing an image leaves the rest intact and in order.
  const imgs = ['a', 'b', 'c'];
  const afterRemove = removeImageAt(imgs, 1);
  ok('remove leaves the rest intact', afterRemove.length === 2 && afterRemove[0] === 'a' && afterRemove[1] === 'c');
  ok('remove does not mutate original', imgs.length === 3);

  // Server buildImageParts: single-image (legacy) still works.
  const single = buildImageParts({ image: 'data:image/jpeg;base64,AAA' });
  ok('single image -> one part', single.length === 1);
  ok('single image strips data-url prefix', single[0].inlineData.data === 'AAA');

  // Multiple images -> multiple parts.
  const multi = buildImageParts({ images: ['data:image/jpeg;base64,AAA', 'BBB', 'CCC'] });
  ok('multiple images -> multiple parts', multi.length === 3);

  // More than 5 images is capped to 5.
  const capped = buildImageParts({ images: ['1', '2', '3', '4', '5', '6', '7'] });
  ok('server caps at 5', capped.length === 5);

  // image + images combine, still capped.
  const combined = buildImageParts({ image: 'x', images: ['1', '2', '3', '4', '5'] });
  ok('image + images combine and cap at 5', combined.length === 5);

  // Empty body -> no parts (endpoint returns 400).
  ok('empty body -> no parts', buildImageParts({}).length === 0);
  ok('non-string entries ignored', buildImageParts({ images: [null, 123, '', 'ok'] }).length === 1);

  // ---- BulkUpload Photo mode: combined statement, one account, overlap dedupe ----
  const { flagDuplicateActivityRows } = await vite.ssrLoadModule('/src/lib/dedupeTransactions.js');
  const { prepareImportAccountAssignment } = await vite.ssrLoadModule('/src/lib/accountOptions.js');

  // E (payload): 3 screenshots are sent as ONE scan request (a single parts list),
  // not one request per screenshot.
  const threeShots = buildImageParts({ images: ['data:image/jpeg;base64,S1', 'S2', 'S3'] });
  ok('E: 3 screenshots -> one combined scan payload', threeShots.length === 3);

  // Simulated combined parse from 3 overlapping screenshots (Starbucks repeats).
  const D = '2026-08-15';
  const combinedParsed = [
    { transaction_date: D, description: 'Starbucks', merchant_display: 'Starbucks', amount: -9.5 },
    { transaction_date: D, description: 'Uber', merchant_display: 'Uber', amount: -12 },
    { transaction_date: D, description: 'Starbucks', merchant_display: 'Starbucks', amount: -9.5 }, // overlap
  ];

  // G: one destination account applies to the WHOLE combined statement.
  const assigned = prepareImportAccountAssignment(combinedParsed, 'BG Checking');
  ok('G: one destination applied to combined statement', assigned.every((r) => r.account_name === 'BG Checking'));

  // F: combined rows run through account-aware within-batch dedupe -- the repeated
  // Starbucks from the overlapping screenshot is blocked; distinct rows survive.
  const flagged = flagDuplicateActivityRows(
    assigned.map((r) => ({ date: r.transaction_date, description: r.description, amount: r.amount, account: r.account_name })),
    []
  );
  ok('F: overlapping screenshot row is blocked', flagged[2].willFailSave === true);
  ok('F: distinct rows are not blocked', flagged[0].willFailSave === false && flagged[1].willFailSave === false);
} finally {
  await vite.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
