import { exec } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";

const execAsync = promisify(exec);

export type SystemHealthReport = {
  server: {
    hostname: string;
    platform: string;
    nodeVersion: string;
    processUptimeSeconds: number;
    systemUptimeSeconds: number;
    loadAverage: [number, number, number];
    cpuCount: number;
  };
  memory: {
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    usedPercent: number;
    processRssBytes: number;
    processHeapUsedBytes: number;
  };
  disk:
    | { available: true; totalBytes: number; usedBytes: number; usedPercent: number }
    | { available: false };
  database: { connected: boolean; latencyMs: number | null; error?: string };
  redis: { configured: boolean; connected: boolean; latencyMs: number | null; error?: string };
  checkedAt: string;
};

/**
 * Diagnostik server ringan untuk konsol admin — bukan pengganti stack
 * monitoring (Prometheus/Grafana dsb), cukup untuk deteksi dini di VPS
 * tunggal (RAM/disk hampir habis, DB/Redis terputus) tanpa memasang
 * infrastruktur baru. Lihat juga Sentry untuk error aplikasi (modul terpisah).
 */
export class SystemHealthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: Redis | null
  ) {}

  async report(): Promise<SystemHealthReport> {
    const [database, redis, disk] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkDisk()
    ]);

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memoryUsage = process.memoryUsage();

    return {
      server: {
        hostname: os.hostname(),
        platform: `${os.platform()} ${os.release()}`,
        nodeVersion: process.version,
        processUptimeSeconds: Math.round(process.uptime()),
        systemUptimeSeconds: Math.round(os.uptime()),
        loadAverage: os.loadavg() as [number, number, number],
        cpuCount: os.cpus().length
      },
      memory: {
        totalBytes: totalMem,
        freeBytes: freeMem,
        usedBytes: usedMem,
        usedPercent: Math.round((usedMem / totalMem) * 1000) / 10,
        processRssBytes: memoryUsage.rss,
        processHeapUsedBytes: memoryUsage.heapUsed
      },
      disk,
      database,
      redis,
      checkedAt: new Date().toISOString()
    };
  }

  private async checkDatabase(): Promise<SystemHealthReport["database"]> {
    const start = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { connected: true, latencyMs: Date.now() - start };
    } catch (error) {
      return {
        connected: false,
        latencyMs: null,
        error: error instanceof Error ? error.message : "Kesalahan tidak diketahui"
      };
    }
  }

  private async checkRedis(): Promise<SystemHealthReport["redis"]> {
    if (!this.redis) {
      return { configured: false, connected: false, latencyMs: null };
    }
    const start = Date.now();
    try {
      await this.redis.ping();
      return { configured: true, connected: true, latencyMs: Date.now() - start };
    } catch (error) {
      return {
        configured: true,
        connected: false,
        latencyMs: null,
        error: error instanceof Error ? error.message : "Kesalahan tidak diketahui"
      };
    }
  }

  /**
   * `df` bisa tidak tersedia di sebagian lingkungan (mis. container
   * terbatas) — ini diagnostik opsional, bukan pemeriksaan fail-closed.
   * Kegagalannya tidak boleh menjatuhkan seluruh laporan kesehatan.
   */
  private async checkDisk(): Promise<SystemHealthReport["disk"]> {
    try {
      const { stdout } = await execAsync("df -Pk / | tail -1");
      const parts = stdout.trim().split(/\s+/);
      const totalKb = Number(parts[1]);
      const usedKb = Number(parts[2]);
      if (!Number.isFinite(totalKb) || !Number.isFinite(usedKb) || totalKb <= 0) {
        return { available: false };
      }
      return {
        available: true,
        totalBytes: totalKb * 1024,
        usedBytes: usedKb * 1024,
        usedPercent: Math.round((usedKb / totalKb) * 1000) / 10
      };
    } catch {
      return { available: false };
    }
  }
}
