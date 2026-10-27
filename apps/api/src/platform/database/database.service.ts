import { Inject, Injectable } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client.js';
import { APP_CONFIG } from '../../bootstrap/configuration.module.js';
import type { AppConfig } from '../../bootstrap/environment.js';

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly client: PrismaClient;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    const adapter = new PrismaPg({
      connectionString: config.DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: config.DB_HEALTH_TIMEOUT_MS,
      query_timeout: config.DB_HEALTH_TIMEOUT_MS,
      statement_timeout: config.DB_HEALTH_TIMEOUT_MS,
    });
    this.client = new PrismaClient({ adapter, log: [] });
  }

  async checkConnection(): Promise<void> {
    await this.client.$queryRaw`SELECT 1`;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.$disconnect();
  }
}
