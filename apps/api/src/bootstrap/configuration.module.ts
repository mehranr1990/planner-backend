import { Global, Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { AppConfig } from './environment.js';

export const APP_CONFIG = Symbol('APP_CONFIG');

@Global()
@Module({})
export class ConfigurationModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: ConfigurationModule,
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
    };
  }
}
