import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Body,
  Query,
  Param,
  Headers,
  Req,
  Res,
  Inject,
  UseGuards,
  HttpCode,
  BadRequestException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { pipeline } from 'node:stream/promises';
import { crc32 } from 'node:zlib';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { Throttle } from '@nestjs/throttler';
import * as c from '@mehran/api-contracts';
import { VerifiedSessionGuard } from '../../../platform/auth/session.guard.js';
import { CurrentActor } from '../../../platform/auth/request-actor.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { ZodValidationPipe } from '../../../bootstrap/zod-validation.pipe.js';
import {
  expectedRevision,
  revisionTag,
} from '../../../bootstrap/concurrency.js';
import { FileThrottleGuard } from '../../../platform/storage/public/index.js';
import { CompanyGuard } from './companies.controller.js';
import { CompaniesService } from '../application/companies.service.js';
import { CompanyGoalsService } from '../application/company-goals.service.js';
import { CompanyRoomsService } from '../application/company-rooms.service.js';
import { CompanyKnowledgePagesService } from '../application/company-knowledge-pages.service.js';
import { CompanyPaymentRunsService } from '../application/company-payment-runs.service.js';
import { CompanyEmployeeFilesService } from '../application/company-employee-files.service.js';
const uuid = new ZodValidationPipe(c.CompanyCreateSchema.shape.id),
  empty = new ZodValidationPipe(c.BackendCompletionEmptySchema),
  page = new ZodValidationPipe(c.ProjectPageQuerySchema),
  body = <T extends z.ZodType>(schema: T) => new ZodValidationPipe(schema);
type Page = z.infer<typeof c.ProjectPageQuerySchema>;
function rev(v: string | undefined) {
  const n = expectedRevision(v);
  if (n === undefined) throw new BadRequestException();
  return n;
}
function tagged<T extends { revision: number }>(res: Response, value: T) {
  res.setHeader('ETag', revisionTag(value.revision));
  return value;
}
function attachment(res: Response, name: string) {
  const encoded = encodeURIComponent(name).replace(
    /[!'()*]/g,
    (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase(),
  );
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="download"; filename*=UTF-8''${encoded}`,
  );
}
/** OD-2 goals, OD-3 rooms/heat, OD-6 knowledge pages, OD-7 payment runs (context routes). */
@Controller('companies/:id/contexts/:scopeId')
@UseGuards(VerifiedSessionGuard, CompanyGuard)
export class CompanyGapContextController {
  constructor(
    @Inject(CompanyGoalsService) private readonly goals: CompanyGoalsService,
    @Inject(CompanyRoomsService) private readonly rooms: CompanyRoomsService,
    @Inject(CompanyKnowledgePagesService)
    private readonly pages: CompanyKnowledgePagesService,
    @Inject(CompanyPaymentRunsService)
    private readonly runs: CompanyPaymentRunsService,
  ) {}
  // OD-2
  @Get('goals') async goalList(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(page) q: Page,
  ) {
    return c.CompanyGoalPageSchema.strip().parse(
      await this.goals.list(a, id, scopeId, q),
    );
  }
  @Post('goals') async goalCreate(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(empty) _q: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Body(body(c.CompanyGoalCreateSchema))
    input: z.infer<typeof c.CompanyGoalCreateSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      c.CompanyGoalSchema.strip().parse(
        await this.goals.create(a, id, scopeId, input, key),
      ),
    );
  }
  @Get('goals/:goalId') async goal(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('goalId', uuid) goalId: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      c.CompanyGoalSchema.strip().parse(
        await this.goals.read(a, id, scopeId, goalId),
      ),
    );
  }
  @Patch('goals/:goalId') async goalPatch(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('goalId', uuid) goalId: string,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Body(body(c.CompanyGoalPatchSchema))
    input: z.infer<typeof c.CompanyGoalPatchSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      c.CompanyGoalSchema.strip().parse(
        await this.goals.patch(a, id, scopeId, goalId, rev(match), input),
      ),
    );
  }
  @Post('goals/:goalId/key-results') async keyResultCreate(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('goalId', uuid) goalId: string,
    @Query(empty) _q: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Body(body(c.CompanyKeyResultCreateSchema))
    input: z.infer<typeof c.CompanyKeyResultCreateSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      c.CompanyGoalSchema.strip().parse(
        await this.goals.addKeyResult(a, id, scopeId, goalId, input, key),
      ),
    );
  }
  @Patch('goals/:goalId/key-results/:keyResultId') async keyResultPatch(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('goalId', uuid) goalId: string,
    @Param('keyResultId', uuid) keyResultId: string,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Body(body(c.CompanyKeyResultPatchSchema))
    input: z.infer<typeof c.CompanyKeyResultPatchSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      await this.goals.patchKeyResult(
        a,
        id,
        scopeId,
        goalId,
        keyResultId,
        rev(match),
        input,
      ),
    );
  }
  @Post('goals/:goalId/key-results/:keyResultId/checkins') keyResultRecord(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('goalId', uuid) goalId: string,
    @Param('keyResultId', uuid) keyResultId: string,
    @Query(empty) _q: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Body(body(c.CompanyKeyResultCheckinCreateSchema))
    input: z.infer<typeof c.CompanyKeyResultCheckinCreateSchema>,
  ) {
    return this.goals.record(a, id, scopeId, goalId, keyResultId, input, key);
  }
  @Get('goals/:goalId/key-results/:keyResultId/checkins') keyResultCheckins(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('goalId', uuid) goalId: string,
    @Param('keyResultId', uuid) keyResultId: string,
    @Query(page) q: Page,
  ) {
    return this.goals.checkins(a, id, scopeId, goalId, keyResultId, q);
  }
  // OD-3
  @Put('resources/:resourceId/room') async roomProfile(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('resourceId', uuid) resourceId: string,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Body(body(c.CompanyRoomProfileInputSchema))
    input: z.infer<typeof c.CompanyRoomProfileInputSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      await this.rooms.setProfile(
        a,
        id,
        scopeId,
        resourceId,
        rev(match),
        input,
      ),
    );
  }
  @Put('allocations/:allocationId/title') async bookingTitle(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('allocationId', uuid) allocationId: string,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Body(body(c.RoomBookingTitlePutSchema))
    input: z.infer<typeof c.RoomBookingTitlePutSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      await this.rooms.setBookingTitle(
        a,
        id,
        scopeId,
        allocationId,
        rev(match),
        input,
      ),
    );
  }
  @Get('rooms') roomList(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(body(c.CompanyRoomQuerySchema))
    q: z.infer<typeof c.CompanyRoomQuerySchema>,
  ) {
    return this.rooms.rooms(a, id, scopeId, q);
  }
  @Get('reports/utilization') utilization(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(body(c.CompanyUtilizationQuerySchema))
    q: z.infer<typeof c.CompanyUtilizationQuerySchema>,
  ) {
    return this.rooms.utilization(a, id, scopeId, q);
  }
  // OD-6
  @Get('knowledge/documents/:documentId/page') async page(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('documentId', uuid) documentId: string,
    @Query(body(c.KnowledgePageQuerySchema))
    q: z.infer<typeof c.KnowledgePageQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      await this.pages.page(a, id, scopeId, documentId, q.number),
    );
  }
  @Post('knowledge/documents/:documentId/page/versions')
  @HttpCode(200)
  async pageSave(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('documentId', uuid) documentId: string,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Body(body(c.KnowledgePageSaveSchema))
    input: z.infer<typeof c.KnowledgePageSaveSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      await this.pages.save(a, id, scopeId, documentId, rev(match), input),
    );
  }
  @Post('knowledge/documents/:documentId/page/publish')
  @HttpCode(200)
  async pagePublish(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('documentId', uuid) documentId: string,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Body(body(c.KnowledgePagePublishSchema))
    input: z.infer<typeof c.KnowledgePagePublishSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      await this.pages.publish(a, id, scopeId, documentId, rev(match), input),
    );
  }
  @Post('knowledge/documents/:documentId/page/acknowledge')
  @HttpCode(200)
  async pageAck(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('documentId', uuid) documentId: string,
    @Query(empty) _q: unknown,
    @Body(empty) _b: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      await this.pages.acknowledge(a, id, scopeId, documentId),
    );
  }
  @Get('knowledge/documents/:documentId/page/acknowledgements') pageAcks(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('documentId', uuid) documentId: string,
    @Query(empty) _q: unknown,
  ) {
    return this.pages.acknowledgements(a, id, scopeId, documentId);
  }
  @Post('knowledge/documents/:documentId/page/remind')
  @HttpCode(200)
  pageRemind(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('documentId', uuid) documentId: string,
    @Query(empty) _q: unknown,
    @Body(empty) _b: unknown,
  ) {
    return this.pages.remind(a, id, scopeId, documentId);
  }
  @Get('notifications') notifications(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(page) q: Page,
  ) {
    return this.pages.notifications(a, id, scopeId, q);
  }
  @Post('notifications/:notificationId/read') @HttpCode(200) readNotification(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('notificationId', uuid) notificationId: string,
    @Query(empty) _q: unknown,
    @Body(empty) _b: unknown,
  ) {
    return this.pages.readNotification(a, id, scopeId, notificationId);
  }
  // OD-7
  @Get('finance/payment-runs/eligible') async runEligible(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(empty) _q: unknown,
  ) {
    return c.PaymentRunEligibleSchema.strip().parse(
      await this.runs.eligible(a, id, scopeId),
    );
  }
  @Get('finance/payment-runs') async runList(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(page) q: Page,
  ) {
    return c.PaymentRunPageSchema.strip().parse(
      await this.runs.list(a, id, scopeId, q),
    );
  }
  @Post('finance/payment-runs') async runCreate(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Query(empty) _q: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Body(body(c.PaymentRunCreateSchema))
    input: z.infer<typeof c.PaymentRunCreateSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      c.PaymentRunSchema.strip().parse(
        await this.runs.create(a, id, scopeId, input, key),
      ),
    );
  }
  @Get('finance/payment-runs/:runId') async run(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('runId', uuid) runId: string,
    @Query(empty) _q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      c.PaymentRunSchema.strip().parse(
        await this.runs.read(a, id, scopeId, runId),
      ),
    );
  }
  @Post('finance/payment-runs/:runId/confirm') @HttpCode(200) async runConfirm(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('runId', uuid) runId: string,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Body(body(c.PaymentRunConfirmSchema))
    input: z.infer<typeof c.PaymentRunConfirmSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      c.PaymentRunSchema.strip().parse(
        await this.runs.confirm(a, id, scopeId, runId, rev(match), input),
      ),
    );
  }
  @Post('finance/payment-runs/:runId/cancel') @HttpCode(200) async runCancel(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('scopeId', uuid) scopeId: string,
    @Param('runId', uuid) runId: string,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Body(empty) _b: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      c.PaymentRunSchema.strip().parse(
        await this.runs.cancel(a, id, scopeId, runId, rev(match)),
      ),
    );
  }
}
/** OD-8 / C9 sealed employee files, OD-5 department transfers and unit moves (company routes). */
@Controller('companies/:id')
@UseGuards(VerifiedSessionGuard, CompanyGuard)
export class CompanyGapController {
  constructor(
    @Inject(CompanyEmployeeFilesService)
    private readonly files: CompanyEmployeeFilesService,
    @Inject(CompaniesService) private readonly companies: CompaniesService,
  ) {}
  @Get('employee-grants') async grants(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
  ) {
    return c.EmployeeGrantListSchema.strip().parse(
      await this.files.grants(a, id),
    );
  }
  @Post('employee-grants') async grant(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Body(body(c.EmployeeGrantCreateSchema))
    input: z.infer<typeof c.EmployeeGrantCreateSchema>,
  ) {
    return c.EmployeeGrantSchema.strip().parse(
      await this.files.grant(a, id, input, key),
    );
  }
  @Post('employee-grants/:grantId/revoke') @HttpCode(200) async revoke(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('grantId', uuid) grantId: string,
    @Query(empty) _q: unknown,
    @Body(empty) _b: unknown,
  ) {
    return c.EmployeeGrantSchema.strip().parse(
      await this.files.revoke(a, id, grantId),
    );
  }
  @Get('employee-files/:subjectAccessId') async file(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('subjectAccessId', uuid) subjectAccessId: string,
    @Query(empty) _q: unknown,
  ) {
    return c.EmployeeFileSchema.parse(
      JSON.parse(JSON.stringify(await this.files.file(a, id, subjectAccessId))),
    );
  }
  @Post('employee-files/:subjectAccessId/access-requests')
  @HttpCode(200)
  request(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('subjectAccessId', uuid) subjectAccessId: string,
    @Query(empty) _q: unknown,
    @Body(empty) _b: unknown,
  ) {
    return this.files.requestAccess(a, id, subjectAccessId);
  }
  @Post('employee-files/:subjectAccessId/documents') async addDocument(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('subjectAccessId', uuid) subjectAccessId: string,
    @Query(empty) _q: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Body(body(c.EmployeeDocumentCreateSchema))
    input: z.infer<typeof c.EmployeeDocumentCreateSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return tagged(
      res,
      await this.files.addDocument(a, id, subjectAccessId, input, key),
    );
  }
  @Post('employee-files/:subjectAccessId/documents/:documentId/complete')
  @HttpCode(200)
  @UseGuards(FileThrottleGuard)
  @Throttle({ files: { limit: 10, ttl: 60000 } })
  async complete(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('subjectAccessId', uuid) subjectAccessId: string,
    @Param('documentId', uuid) documentId: string,
    @Headers('if-match') match: string | undefined,
    @Query(empty) _q: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!req.is('application/octet-stream'))
      throw new UnsupportedMediaTypeException();
    try {
      return tagged(
        res,
        await this.files.complete(
          a,
          id,
          subjectAccessId,
          documentId,
          rev(match),
          req,
          req.headers['content-length'],
        ),
      );
    } catch (e) {
      res.setHeader('Connection', 'close');
      req.resume();
      throw e;
    }
  }
  @Get('employee-files/:subjectAccessId/documents/:documentId/download')
  @UseGuards(FileThrottleGuard)
  async download(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('subjectAccessId', uuid) subjectAccessId: string,
    @Param('documentId', uuid) documentId: string,
    @Query(empty) _q: unknown,
    @Res() res: Response,
  ) {
    const { file, stream } = await this.files.download(
      a,
      id,
      subjectAccessId,
      documentId,
    );
    attachment(res, file.filename);
    res.setHeader('Content-Length', file.actualSize!);
    try {
      await pipeline(stream, res);
    } catch {
      res.destroy();
    }
  }
  @Post('employee-files/:subjectAccessId/documents/:documentId/remove')
  @HttpCode(200)
  remove(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('subjectAccessId', uuid) subjectAccessId: string,
    @Param('documentId', uuid) documentId: string,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Body(empty) _b: unknown,
  ) {
    return this.files.remove(a, id, subjectAccessId, documentId, rev(match));
  }
  /** Uncompressed ZIP (stored entries, CRC-32 in data descriptors) of READY documents; access re-checked and logged. */
  @Get('employee-files/:subjectAccessId/pack')
  @UseGuards(FileThrottleGuard)
  async pack(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Param('subjectAccessId', uuid) subjectAccessId: string,
    @Query(empty) _q: unknown,
    @Res() res: Response,
  ) {
    const { files, open } = await this.files.pack(a, id, subjectAccessId);
    attachment(res, 'employee-file.zip');
    const central: Buffer[] = [];
    let offset = 0;
    const write = (b: Buffer) =>
      new Promise<void>((resolve, reject) =>
        res.write(b, (e) => (e ? reject(e) : resolve())),
      );
    try {
      for (const [index, f] of files.entries()) {
        const name = Buffer.from(`${index + 1}-${f.filename}`, 'utf8');
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0x0808, 6);
        local.writeUInt16LE(name.length, 26);
        await write(Buffer.concat([local, name]));
        let crc = 0,
          size = 0;
        for await (const chunk of await open(f)) {
          const b = chunk as Buffer;
          crc = crc32(b, crc);
          size += b.length;
          await write(b);
        }
        const descriptor = Buffer.alloc(16);
        descriptor.writeUInt32LE(0x08074b50, 0);
        descriptor.writeUInt32LE(crc >>> 0, 4);
        descriptor.writeUInt32LE(size, 8);
        descriptor.writeUInt32LE(size, 12);
        await write(descriptor);
        const entry = Buffer.alloc(46);
        entry.writeUInt32LE(0x02014b50, 0);
        entry.writeUInt16LE(20, 4);
        entry.writeUInt16LE(20, 6);
        entry.writeUInt16LE(0x0808, 8);
        entry.writeUInt32LE(crc >>> 0, 16);
        entry.writeUInt32LE(size, 20);
        entry.writeUInt32LE(size, 24);
        entry.writeUInt16LE(name.length, 28);
        entry.writeUInt32LE(offset, 42);
        central.push(Buffer.concat([entry, name]));
        offset += 30 + name.length + size + 16;
      }
      const directory = Buffer.concat(central);
      const end = Buffer.alloc(22);
      end.writeUInt32LE(0x06054b50, 0);
      end.writeUInt16LE(files.length, 8);
      end.writeUInt16LE(files.length, 10);
      end.writeUInt32LE(directory.length, 12);
      end.writeUInt32LE(offset, 16);
      await write(Buffer.concat([directory, end]));
      res.end();
    } catch {
      res.destroy();
    }
  }
  /** OD-5: preview moving a unit under another department (refusals are explicit). */
  @Get('context-moves/preview') async movePreview(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Query(body(c.ContextMoveQuerySchema))
    q: z.infer<typeof c.ContextMoveQuerySchema>,
  ) {
    return c.ContextMovePreviewSchema.parse(
      await this.companies.contextMovePreview(a, id, q),
    );
  }
  @Post('context-moves') async move(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Body(body(c.ContextMoveCreateSchema))
    input: z.infer<typeof c.ContextMoveCreateSchema>,
  ) {
    return c.ContextMoveSchema.parse(
      await this.companies.contextMove(a, id, rev(match), input),
    );
  }
  @Get('department-transfers/preview') async transferPreview(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Query(body(c.DepartmentTransferQuerySchema))
    q: z.infer<typeof c.DepartmentTransferQuerySchema>,
  ) {
    return c.DepartmentTransferPreviewSchema.parse(
      await this.companies.access.transferPreview(a, id, q),
    );
  }
  @Post('department-transfers') async transfer(
    @CurrentActor() a: RequestActor,
    @Param('id', uuid) id: string,
    @Query(empty) _q: unknown,
    @Headers('if-match') match: string | undefined,
    @Body(body(c.DepartmentTransferCreateSchema))
    input: z.infer<typeof c.DepartmentTransferCreateSchema>,
  ) {
    return c.DepartmentTransferSchema.parse(
      await this.companies.access.transfer(a, id, {
        ...input,
        revision: rev(match),
      }),
    );
  }
}
