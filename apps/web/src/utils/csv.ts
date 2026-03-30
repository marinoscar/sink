import type { SmsMessageItem } from '../types';

function escapeCsvField(field: string): string {
  if (field.includes('"') || field.includes(',') || field.includes('\n') || field.includes('\r')) {
    return '"' + field.replace(/"/g, '""') + '"';
  }
  return field;
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function exportMessagesToCsv(messages: SmsMessageItem[]): void {
  const header = 'Date,Sender,Message,Device,SIM';
  const rows = messages.map((msg) => {
    const date = escapeCsvField(formatDateTime(msg.smsTimestamp));
    const sender = escapeCsvField(msg.sender);
    const body = escapeCsvField(msg.body);
    const device = escapeCsvField(msg.device.name);
    const sim = escapeCsvField(msg.carrierName || (msg.simSlotIndex !== null ? `SIM ${msg.simSlotIndex + 1}` : ''));
    return `${date},${sender},${body},${device},${sim}`;
  });

  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const today = new Date().toISOString().slice(0, 10);
  const link = document.createElement('a');
  link.href = url;
  link.download = `messages-${today}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
