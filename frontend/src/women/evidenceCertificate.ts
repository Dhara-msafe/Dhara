import { Platform } from 'react-native';
import * as Sharing from 'expo-sharing';
import type { RecordingItem } from './evidenceStore';
import type { ManifestEntry } from './evidenceManifest';

/**
 * S-B5: Section 63 BSA (Bharatiya Sakshya Adhiniyam, 2023) certificate
 * export — a DRAFT only. DHARA is not a legal authority and cannot issue an
 * official certificate; this fills in the technical facts (hashes, chain,
 * independent timestamp) and leaves the legally-required declarations as
 * blanks for the citizen to complete and sign, consistent with how rights
 * cards ship as reviewed shells rather than authored legal conclusions.
 */

function esc(s: string): string { return s.replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function buildHtml(item: RecordingItem, entry: ManifestEntry): string {
  const gpsLine = entry.gps
    ? `${entry.gps.lat.toFixed(6)}, ${entry.gps.lng.toFixed(6)} (accuracy ~${Math.round(entry.gps.accuracy || 0)}m)`
    : 'Not recorded — citizen did not attach a location to this item.';
  const anchorLine = entry.anchor
    ? `Receipt ${entry.anchor.receiptId} — independent server time ${new Date(entry.anchor.serverTime).toLocaleString()}`
    : 'Not yet timestamped by the server.';
  const backupLine = entry.backup
    ? `Encrypted copy stored at ${new Date(entry.backup.uploadedAt).toLocaleString()}`
    : 'Not backed up to cloud storage.';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>body{padding:24px;font-family:Arial,sans-serif;color:#222;}
h2{color:#1B2B5B;font-size:18px;margin-bottom:4px;}
.warn{background:#FFF8E7;border-left:4px solid #C9973A;padding:10px;font-size:12px;color:#555;margin-bottom:16px;}
table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;}
td{padding:6px 8px;border-bottom:1px solid #eee;vertical-align:top;word-break:break-all;}
td:first-child{font-weight:bold;width:200px;color:#1B2B5B;word-break:normal;}
.blank{border-bottom:1px solid #999;display:inline-block;min-width:260px;height:14px;}
.sig{margin-top:28px;font-size:13px;}
</style></head><body>
<h2>Electronic Record Identification — DRAFT</h2>
<div class="warn"><strong>CITIZEN-PREPARED DRAFT — NOT AN OFFICIAL CERTIFICATE.</strong> Complete every blank below, verify each detail yourself, and have it signed/attested as your advocate or the police station advises before relying on it for a Section 63, Bharatiya Sakshya Adhiniyam 2023 (electronic record) certification.</div>
<table>
<tr><td>Record type</td><td>${esc(item.type)}</td></tr>
<tr><td>Captured on device at</td><td>${esc(new Date(item.createdAt).toLocaleString())}</td></tr>
<tr><td>Location at capture</td><td>${esc(gpsLine)}</td></tr>
<tr><td>File hash (SHA-256)</td><td>${esc(entry.sha256)}</td></tr>
<tr><td>Chain hash (links to the item recorded before it)</td><td>${esc(entry.chainHash)}</td></tr>
<tr><td>Previous item's hash in this chain</td><td>${esc(entry.prevHash)}</td></tr>
<tr><td>Independent timestamp</td><td>${esc(anchorLine)}</td></tr>
<tr><td>Cloud backup</td><td>${esc(backupLine)}</td></tr>
<tr><td>Prepared using</td><td>DHARA Evidence Locker (on-device AES-256 encryption)</td></tr>
</table>
<p style="font-size:13px;">I, <span class="blank"></span>, state that this electronic record was produced by the device described below, operated by me in the ordinary course of recording the item above, and that the hash values above accurately identify the file as it existed at the time stated.</p>
<table>
<tr><td>Device used (make/model)</td><td><span class="blank"></span></td></tr>
<tr><td>Person responsible for the device</td><td><span class="blank"></span></td></tr>
<tr><td>Manner of production</td><td><span class="blank"></span></td></tr>
</table>
<div class="sig">Signature: <span class="blank"></span> &nbsp;&nbsp;&nbsp; Date: <span class="blank"></span></div>
</body></html>`;
}

export async function exportCertificate(item: RecordingItem, entry: ManifestEntry): Promise<void> {
  const html = buildHtml(item, entry);
  if (Platform.OS === 'web') {
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    return;
  }
  const Print = await import('expo-print');
  const { uri } = await Print.printToFileAsync({ html });
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Save evidence certificate (draft)' });
  }
}
