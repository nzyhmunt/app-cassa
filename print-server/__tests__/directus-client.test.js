/**
 * @file __tests__/directus-client.test.js
 * @description Unit tests for directus-client.js — pure functions and deduplication.
 *
 * Tested without mocking the Directus SDK (no I/O): uses pure exported functions
 * directly from the module.
 *
 * Covers:
 *  1. _mapDirectusPrinters — mapping Directus records → printer.js format
 *  2. _inFlightJobs        — in-process deduplication Set
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { _mapDirectusPrinters, _inFlightJobs } = require('../directus-client.js');

// ── _mapDirectusPrinters ──────────────────────────────────────────────────────

describe('_mapDirectusPrinters — mapping Directus record → printer config', () => {
  it('returns empty array for non-array input', () => {
    expect(_mapDirectusPrinters(null)).toEqual([]);
    expect(_mapDirectusPrinters(undefined)).toEqual([]);
    expect(_mapDirectusPrinters('not-an-array')).toEqual([]);
  });

  it('returns empty array when input is an empty array', () => {
    expect(_mapDirectusPrinters([])).toEqual([]);
  });

  it('filters out http-type printers (used by hook push, not pull mode)', () => {
    const raw = [
      { id: 'p-http', name: 'HTTP Printer', connection_type: 'http', url: 'http://print:3001/print' },
    ];
    expect(_mapDirectusPrinters(raw)).toEqual([]);
  });

  it('maps a tcp printer with all fields', () => {
    const raw = [
      {
        id: 'p-tcp',
        name: 'Cucina TCP',
        connection_type: 'tcp',
        tcp_host: '192.168.1.100',
        tcp_port: 9100,
        tcp_timeout: 5000,
      },
    ];
    const result = _mapDirectusPrinters(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'p-tcp',
      name: 'Cucina TCP',
      type: 'tcp',
      host: '192.168.1.100',
      port: 9100,
      timeout: 5000,
    });
  });

  it('applies default tcp_port and tcp_timeout when omitted', () => {
    const raw = [
      { id: 'p-tcp2', name: 'Bar', connection_type: 'tcp', tcp_host: '10.0.0.5' },
    ];
    const result = _mapDirectusPrinters(raw);
    expect(result[0].port).toBe(9100);
    expect(result[0].timeout).toBe(5000);
    expect(result[0].host).toBe('10.0.0.5');
  });

  it('applies default tcp_host when tcp_host is falsy', () => {
    const raw = [
      { id: 'p-tcp3', name: 'TCP no host', connection_type: 'tcp', tcp_host: '' },
    ];
    const result = _mapDirectusPrinters(raw);
    expect(result[0].host).toBe('127.0.0.1');
  });

  it('maps a file printer with a custom device path', () => {
    const raw = [
      { id: 'p-file', name: 'USB Cassa', connection_type: 'file', file_device: '/dev/usb/lp1' },
    ];
    const result = _mapDirectusPrinters(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'p-file',
      name: 'USB Cassa',
      type: 'file',
      device: '/dev/usb/lp1',
    });
  });

  it('applies default file_device /dev/usb/lp0 when omitted', () => {
    const raw = [
      { id: 'p-file2', name: 'USB Default', connection_type: 'file' },
    ];
    const result = _mapDirectusPrinters(raw);
    expect(result[0].device).toBe('/dev/usb/lp0');
  });

  it('uses id as name fallback when name is missing', () => {
    const raw = [
      { id: 'p-noname', connection_type: 'tcp', tcp_host: '10.0.0.1' },
    ];
    const result = _mapDirectusPrinters(raw);
    expect(result[0].name).toBe('p-noname');
  });

  it('returns only tcp and file printers from a mixed list', () => {
    const raw = [
      { id: 'p1', name: 'TCP',  connection_type: 'tcp',  tcp_host: '10.0.0.1', tcp_port: 9100, tcp_timeout: 5000 },
      { id: 'p2', name: 'File', connection_type: 'file', file_device: '/dev/usb/lp0' },
      { id: 'p3', name: 'HTTP', connection_type: 'http', url: 'http://print/print' },
    ];
    const result = _mapDirectusPrinters(raw);
    expect(result).toHaveLength(2);
    expect(result.map(p => p.id)).toEqual(['p1', 'p2']);
  });

  it('does not include `device` on tcp printer or `host/port/timeout` on file printer', () => {
    const raw = [
      { id: 'tcp1',  connection_type: 'tcp',  tcp_host: '10.0.0.1', tcp_port: 9100, tcp_timeout: 5000 },
      { id: 'file1', connection_type: 'file', file_device: '/dev/usb/lp0' },
    ];
    const [tcp, file] = _mapDirectusPrinters(raw);
    expect(tcp).not.toHaveProperty('device');
    expect(file).not.toHaveProperty('host');
    expect(file).not.toHaveProperty('port');
    expect(file).not.toHaveProperty('timeout');
  });
});

// ── _inFlightJobs — in-process dedup Set ─────────────────────────────────────

describe('_inFlightJobs — in-process deduplication Set', () => {
  beforeEach(() => {
    // Clear the Set before each test to avoid residual state
    _inFlightJobs.clear();
  });

  it('is a Set instance', () => {
    expect(_inFlightJobs).toBeInstanceOf(Set);
  });

  it('starts empty (or is cleared between tests)', () => {
    expect(_inFlightJobs.size).toBe(0);
  });

  it('can be used to track and release in-flight log_ids', () => {
    const logId = 'log_test-dedup-001';

    // Simulates the addition from processJob
    _inFlightJobs.add(logId);
    expect(_inFlightJobs.has(logId)).toBe(true);

    // Verify that a second "process" must give up (job already in Set)
    expect(_inFlightJobs.has(logId)).toBe(true); // => skip

    // Simulates the finally block of processJob
    _inFlightJobs.delete(logId);
    expect(_inFlightJobs.has(logId)).toBe(false);
  });

  it('tracks different log_ids independently', () => {
    _inFlightJobs.add('job-A');
    _inFlightJobs.add('job-B');
    expect(_inFlightJobs.has('job-A')).toBe(true);
    expect(_inFlightJobs.has('job-B')).toBe(true);
    expect(_inFlightJobs.has('job-C')).toBe(false);

    _inFlightJobs.delete('job-A');
    expect(_inFlightJobs.has('job-A')).toBe(false);
    expect(_inFlightJobs.has('job-B')).toBe(true);
  });
});
