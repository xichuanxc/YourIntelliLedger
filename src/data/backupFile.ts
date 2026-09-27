/**
 * The ledger as files, and back again (§15.1, §15.2).
 *
 * `exportBackup.ts` decides what a backup says and `importBackup.ts` decides
 * what may be read back; neither knows what a file is. This is the part that
 * touches the platform, kept separate for the usual reason — a share sheet
 * cannot be unit tested and the format can.
 *
 * ## Written to the cache directory, deliberately
 *
 * An export is handed straight to the share sheet, and once the person has
 * put it wherever they wanted it, our copy is litter. Writing to the cache
 * means the system reclaims it when space runs short, rather than the app
 * quietly accumulating copies of somebody's entire financial history in
 * storage that is backed up and never cleaned.
 *
 * ## Three files, not one
 *
 * The JSON is the backup and the only re-importable one. The two CSVs exist
 * because "can I see my own data" usually means "in a spreadsheet", and a
 * nested JSON document is a poor answer to that. Sharing all three together
 * lets the person keep whichever they actually wanted.
 */

import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { clearCatalogCache } from '@/agent/catalogCache';
import { clearHubConfig } from '@/agent/modelConfig';
import { clearProductCache } from '@/capture/productCache';
import { getDb } from '@/data/db';
import { eraseEverything, type EraseSummary } from '@/data/eraseAll';
import {
  billsCsv,
  buildBackup,
  exportFilename,
  itemsCsv,
  toBackupBill,
  type BackupBill,
} from '@/data/exportBackup';
import { parseBackup, restoreBackup, type ImportResult } from '@/data/importBackup';
import { getBill, getReceiptScans, listBills } from '@/data/ledgerRepo';
import { clearPreferences, exportedPreferences } from '@/data/prefs';
import { clearGeocodeCache } from '@/maps/geocodeCache';

/** Where a written export waits to be shared. Swept by the system, not by us. */
const EXPORT_DIRECTORY = 'exports';

export interface ExportSummary {
  bills: number;
  /** The JSON backup's path, for the share sheet and for saying what was made. */
  uri: string;
}

/** Everything in the ledger, as backup records. */
async function collectBills(): Promise<BackupBill[]> {
  const db = await getDb();
  const summaries = await listBills(db);

  const bills: BackupBill[] = [];
  for (const summary of summaries) {
    const bill = await getBill(db, summary.id);
    if (!bill) continue;
    bills.push(toBackupBill(bill, await getReceiptScans(db, summary.id)));
  }
  return bills;
}

function writeInto(directory: Directory, name: string, contents: string): File {
  const file = new File(directory, name);
  // `create` with overwrite, because yesterday's export of the same day is
  // stale the moment a new one is asked for.
  file.create({ overwrite: true });
  file.write(contents);
  return file;
}

/**
 * Writes the three export files and offers them to the share sheet.
 *
 * Throws when there is nothing to export — a share sheet containing an empty
 * backup is a worse answer than being told the ledger is empty.
 */
export async function exportLedger(now: Date = new Date()): Promise<ExportSummary> {
  const bills = await collectBills();
  if (bills.length === 0) {
    throw new Error('There are no bills to export yet.');
  }

  const directory = new Directory(Paths.cache, EXPORT_DIRECTORY);
  if (!directory.exists) directory.create({ intermediates: true });

  const backup = buildBackup(bills, exportedPreferences(), now);
  const json = writeInto(directory, exportFilename('json', now), JSON.stringify(backup, null, 2));
  writeInto(directory, exportFilename('items', now), itemsCsv(bills));
  writeInto(directory, exportFilename('bills', now), billsCsv(bills));

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(json.uri, {
      mimeType: 'application/json',
      dialogTitle: 'Your ledger',
      UTI: 'public.json',
    });
  }

  return { bills: bills.length, uri: json.uri };
}

/**
 * Asks for a backup file and reads it in.
 *
 * Returns null when the picker was dismissed, which is not an error and must
 * not be reported as one.
 */
export async function importLedger(): Promise<ImportResult | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    // Not `application/json`: a file arriving from a cloud drive or a chat
    // app frequently carries no type at all, and filtering on one hides the
    // very file the person is trying to restore.
    type: '*/*',
    copyToCacheDirectory: true,
  });

  if (picked.canceled || !picked.assets?.length) return null;

  const text = await new File(picked.assets[0].uri).text();
  const db = await getDb();
  return restoreBackup(db, parseBackup(text));
}

/**
 * The whole of §15.2, with the caches this build actually has.
 *
 * Listing them here rather than inside `eraseEverything` keeps that function
 * testable without a device, and keeps this list somewhere a person adding a
 * sixth MMKV store is likely to look.
 */
export async function eraseLedger(): Promise<EraseSummary> {
  const db = await getDb();
  return eraseEverything(db, {
    preferences: clearPreferences,
    products: clearProductCache,
    geocodes: clearGeocodeCache,
    catalog: clearCatalogCache,
    hubConfig: clearHubConfig,
  });
}
