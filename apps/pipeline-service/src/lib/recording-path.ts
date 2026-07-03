/**
 * Parses the fixed recording path convention:
 *   {account_id}/{YYYY-MM-DD}/{YYYYMMDD-HHMMSS}_{phone}-all.mp3
 *
 * Only "-all" mixdown files are pipeline input; per-leg files and anything
 * else in the bucket is ignored (returns null, not an error).
 */
export interface ParsedRecordingPath {
  accountExternalId: string;
  recordedAt: Date;
  phoneNumber: string;
}

const PATTERN =
  /^(?<account>[^/]+)\/(?<date>\d{4}-\d{2}-\d{2})\/(?<ts>\d{8}-\d{6})_(?<phone>[^/]+?)-all\.mp3$/;

export function parseRecordingPath(objectName: string): ParsedRecordingPath | null {
  const m = PATTERN.exec(objectName);
  if (!m?.groups) return null;
  const { account, ts, phone } = m.groups as {
    account: string;
    date: string;
    ts: string;
    phone: string;
  };
  const year = Number(ts.slice(0, 4));
  const month = Number(ts.slice(4, 6));
  const day = Number(ts.slice(6, 8));
  const hour = Number(ts.slice(9, 11));
  const minute = Number(ts.slice(11, 13));
  const second = Number(ts.slice(13, 15));
  // Recording timestamps are wall-clock at the dialer; stored as UTC.
  const recordedAt = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (Number.isNaN(recordedAt.getTime())) return null;
  return { accountExternalId: account, recordedAt, phoneNumber: phone };
}
