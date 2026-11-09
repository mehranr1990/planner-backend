import { Module, type DynamicModule } from '@nestjs/common';
import { MeetingsModule } from './meetings.module.js';
import { AuditModule } from '../../platform/audit/audit.service.js';
import { MeetingsService } from './application/meetings.service.js';
import { MeetingDocuments } from './application/meeting-documents.js';
import { MeetingFiles } from './application/meeting-files.js';
import { AnnouncementsService } from './application/announcements.service.js';
import { MeetingData } from './application/meeting-data.js';
import { MeetingsGuard } from './http/meetings.guard.js';
import { MeetingsController } from './http/meetings.controller.js';
import { MeetingDocumentsController } from './http/meeting-documents.controller.js';
import { AnnouncementsController } from './http/announcements.controller.js';
import { MeetingAttachmentsController } from './http/meeting-attachments.controller.js';
import { AnnouncementAttachmentsController } from './http/announcement-attachments.controller.js';
import { MeetingLifecycle } from './application/meetings-lifecycle.service.js';
import { MeetingLifecycleController } from './http/meetings-lifecycle.controller.js';
import { SpacesModule } from '../spaces/public/index.js';
@Module({})
export class MeetingWorkflowsModule {
  static register(
    tasks: DynamicModule,
    calendar: DynamicModule,
    storage: DynamicModule,
  ): DynamicModule {
    return {
      module: MeetingWorkflowsModule,
      imports: [
        MeetingsModule,
        SpacesModule,
        AuditModule,
        tasks,
        calendar,
        storage,
      ],
      providers: [
        MeetingLifecycle,
        MeetingsService,
        MeetingDocuments,
        MeetingFiles,
        AnnouncementsService,
        MeetingData,
        MeetingsGuard,
      ],
      controllers: [
        MeetingLifecycleController,
        MeetingsController,
        MeetingDocumentsController,
        AnnouncementsController,
        MeetingAttachmentsController,
        AnnouncementAttachmentsController,
      ],
      exports: [
        MeetingLifecycle,
        MeetingsService,
        MeetingDocuments,
        MeetingFiles,
        AnnouncementsService,
        MeetingData,
      ],
    };
  }
}
