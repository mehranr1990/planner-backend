import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Query,
  Param,
  Headers,
  Res,
  Inject,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import { VerifiedSessionGuard } from '../../../platform/auth/session.guard.js';
import { CurrentActor } from '../../../platform/auth/request-actor.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { ZodValidationPipe } from '../../../bootstrap/zod-validation.pipe.js';
import { revisionTag } from '../../../bootstrap/concurrency.js';
import {
  SocialGuard,
  socialId,
  socialPage,
  socialEmpty,
  socialBody,
  socialExpected,
  socialResult,
} from './social.controller.js';
import { SocialActivitiesService } from '../application/activities.service.js';
import { SocialPlanningService } from '../application/activity-planning.service.js';
import { SocialExpensesService } from '../application/expenses.service.js';
import type { LedgerRef } from '../application/expenses.service.js';
type A = RequestActor;
type K = string | undefined;
const pipe = <T extends z.ZodType>(s: T) => new ZodValidationPipe(s);
const tag = <T extends { revision: number }>(r: Response, v: T) => {
  r.setHeader('ETag', revisionTag(v.revision));
  return v;
};
@Controller('social-activities')
@UseGuards(VerifiedSessionGuard, SocialGuard)
export class SocialActivitiesController {
  constructor(
    @Inject(SocialActivitiesService)
    private readonly s: SocialActivitiesService,
    @Inject(SocialPlanningService) private readonly p: SocialPlanningService,
  ) {}
  @Get() list(
    @CurrentActor() a: A,
    @Query(pipe(c.SocialActivityListQuerySchema))
    q: z.infer<typeof c.SocialActivityListQuerySchema>,
  ) {
    return this.s.list(a, q);
  }
  @Post() async create(
    @CurrentActor() a: A,
    @Body(pipe(c.SocialActivityCreateSchema))
    b: z.infer<typeof c.SocialActivityCreateSchema>,
    @Headers('idempotency-key') k: K,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(r, await this.s.create(a, b, k));
  }
  @Get('calendar') calendar(
    @CurrentActor() a: A,
    @Query(pipe(c.SocialActivityCalendarQuerySchema))
    q: z.infer<typeof c.SocialActivityCalendarQuerySchema>,
  ) {
    return this.p.calendarFeed(a, q);
  }
  @Get(':id') async read(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Query(socialEmpty) _q: unknown,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(r, await this.s.read(a, id));
  }
  @Patch(':id') async patch(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Body(pipe(c.SocialActivityPatchSchema))
    b: z.infer<typeof c.SocialActivityPatchSchema>,
    @Headers('idempotency-key') k: K,
    @Headers('if-match') v: K,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(r, await this.s.patch(a, id, b, socialExpected(v), k));
  }
  @Post(':id/lifecycle/:action') async lifecycle(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Param('action', pipe(c.SocialActivityLifecycleActionSchema))
    action: z.infer<typeof c.SocialActivityLifecycleActionSchema>,
    @Body(socialBody) _b: unknown,
    @Headers('idempotency-key') k: K,
    @Headers('if-match') v: K,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(
      r,
      await this.s.lifecycle(a, id, action, socialExpected(v), k),
    );
  }
  @Post(':id/join') join(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Body(socialBody) _b: unknown,
    @Headers('idempotency-key') k: K,
  ) {
    return this.s.join(a, id, k);
  }
  @Post(':id/rsvp') rsvp(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Body(pipe(c.SocialActivityRsvpSchema))
    b: z.infer<typeof c.SocialActivityRsvpSchema>,
    @Headers('idempotency-key') k: K,
  ) {
    return this.s.rsvp(a, id, b, k);
  }
  @Post(':id/leave') leave(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Body(socialBody) _b: unknown,
    @Headers('idempotency-key') k: K,
  ) {
    return this.s.leave(a, id, k);
  }
  @Get(':id/participants') participants(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Query(socialPage) q: z.infer<typeof c.SocialPageQuerySchema>,
  ) {
    return this.s.participants(a, id, q);
  }
  @Post(':id/invitations') invite(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Body(pipe(c.SocialActivityInviteSchema))
    b: z.infer<typeof c.SocialActivityInviteSchema>,
    @Headers('idempotency-key') k: K,
  ) {
    return this.s.invite(a, id, b, k);
  }
  @Post(':id/participants/:participantId/remove') async remove(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Param('participantId', socialId) pid: string,
    @Body(socialBody) _b: unknown,
    @Headers('idempotency-key') k: K,
    @Headers('if-match') v: K,
    @Res({ passthrough: true }) r: Response,
  ) {
    return tag(r, await this.s.remove(a, id, pid, socialExpected(v), k));
  }
  @Put(':id/participants/:participantId/role') async role(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Param('participantId', socialId) pid: string,
    @Body(pipe(c.SocialActivityRoleSchema))
    b: z.infer<typeof c.SocialActivityRoleSchema>,
    @Headers('idempotency-key') k: K,
    @Headers('if-match') v: K,
    @Res({ passthrough: true }) r: Response,
  ) {
    return tag(r, await this.s.role(a, id, pid, b, socialExpected(v), k));
  }
  @Get(':id/items') items(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Query(socialPage) q: z.infer<typeof c.SocialPageQuerySchema>,
  ) {
    return this.p.items(a, id, q);
  }
  @Post(':id/items') async createItem(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Body(pipe(c.SocialActivityItemCreateSchema))
    b: z.infer<typeof c.SocialActivityItemCreateSchema>,
    @Headers('idempotency-key') k: K,
    @Res({ passthrough: true }) r: Response,
  ) {
    return tag(r, await this.p.createItem(a, id, b, k));
  }
  @Patch(':id/items/:itemId') async patchItem(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Param('itemId', socialId) itemId: string,
    @Body(pipe(c.SocialActivityItemPatchSchema))
    b: z.infer<typeof c.SocialActivityItemPatchSchema>,
    @Headers('idempotency-key') k: K,
    @Headers('if-match') v: K,
    @Res({ passthrough: true }) r: Response,
  ) {
    return tag(
      r,
      await this.p.changeItem(a, id, itemId, b, socialExpected(v), k),
    );
  }
  @Delete(':id/items/:itemId') async deleteItem(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Param('itemId', socialId) itemId: string,
    @Body(socialBody) _b: unknown,
    @Headers('idempotency-key') k: K,
    @Headers('if-match') v: K,
    @Res({ passthrough: true }) r: Response,
  ) {
    return tag(
      r,
      await this.p.changeItem(a, id, itemId, null, socialExpected(v), k),
    );
  }
  @Post(':id/items/:itemId/task') task(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Param('itemId', socialId) itemId: string,
    @Body(socialBody) _b: unknown,
    @Headers('idempotency-key') k: K,
  ) {
    return this.p.task(a, id, itemId, k);
  }
  @Get(':id/polls') polls(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Query(socialPage) q: z.infer<typeof c.SocialPageQuerySchema>,
  ) {
    return this.p.polls(a, id, q);
  }
  @Post(':id/polls') async createPoll(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Body(pipe(c.SocialActivityPollCreateSchema))
    b: z.infer<typeof c.SocialActivityPollCreateSchema>,
    @Headers('idempotency-key') k: K,
    @Res({ passthrough: true }) r: Response,
  ) {
    return tag(r, await this.p.createPoll(a, id, b, k));
  }
  @Put(':id/polls/:pollId/vote') vote(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Param('pollId', socialId) pollId: string,
    @Body(pipe(c.SocialActivityVoteSchema))
    b: z.infer<typeof c.SocialActivityVoteSchema>,
    @Headers('idempotency-key') k: K,
  ) {
    return this.p.vote(a, id, pollId, b, k);
  }
  @Post(':id/polls/:pollId/close') async closePoll(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Param('pollId', socialId) pollId: string,
    @Body(pipe(c.SocialActivityPollCloseSchema))
    b: z.infer<typeof c.SocialActivityPollCloseSchema>,
    @Headers('idempotency-key') k: K,
    @Headers('if-match') v: K,
    @Res({ passthrough: true }) r: Response,
  ) {
    return tag(
      r,
      await this.p.closePoll(a, id, pollId, b, socialExpected(v), k),
    );
  }
  @Get(':id/free-busy') busy(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Query(socialEmpty) _q: unknown,
  ) {
    return this.p.busy(a, id);
  }
  @Put(':id/free-busy') shareBusy(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Body(socialBody) _b: unknown,
    @Headers('idempotency-key') k: K,
  ) {
    return this.p.shareBusy(a, id, k);
  }
  @Delete(':id/free-busy') revokeBusy(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Body(socialBody) _b: unknown,
    @Headers('idempotency-key') k: K,
  ) {
    return this.p.revokeBusy(a, id, k);
  }
  @Put(':id/conversation') async conversation(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Body(pipe(c.SocialActivityConversationSchema))
    b: z.infer<typeof c.SocialActivityConversationSchema>,
    @Headers('idempotency-key') k: K,
    @Headers('if-match') v: K,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(
      r,
      await this.s.conversation(a, id, b, socialExpected(v), k),
    );
  }
  @Delete(':id') async deleteActivity(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Body(socialBody) _b: unknown,
    @Headers('idempotency-key') k: K,
    @Headers('if-match') v: K,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(
      r,
      await this.s.deleteActivity(a, id, socialExpected(v), k),
    );
  }
  @Post(':id/restore') async restore(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Body(socialBody) _b: unknown,
    @Headers('idempotency-key') k: K,
    @Headers('if-match') v: K,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(r, await this.s.restore(a, id, socialExpected(v), k));
  }
  @Post(':id/items/:itemId/restore') async restoreItem(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Param('itemId', socialId) itemId: string,
    @Body(socialBody) _b: unknown,
    @Headers('idempotency-key') k: K,
    @Headers('if-match') v: K,
    @Res({ passthrough: true }) r: Response,
  ) {
    return tag(
      r,
      await this.p.restoreItem(a, id, itemId, socialExpected(v), k),
    );
  }
  @Post(':id/succession') async nominate(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Body(pipe(c.SocialActivitySuccessionSchema))
    b: z.infer<typeof c.SocialActivitySuccessionSchema>,
    @Headers('idempotency-key') k: K,
    @Headers('if-match') v: K,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(
      r,
      await this.s.nominate(a, id, b, socialExpected(v), k),
    );
  }
  @Post(':id/succession/:action') async succession(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Param('action', pipe(c.SocialActivitySuccessionActionSchema))
    action: z.infer<typeof c.SocialActivitySuccessionActionSchema>,
    @Body(socialBody) _b: unknown,
    @Headers('idempotency-key') k: K,
    @Headers('if-match') v: K,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(
      r,
      await this.s.succession(a, id, action, socialExpected(v), k),
    );
  }
  @Post(':id/conversation/open') async openConversation(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Body(pipe(c.SocialActivityConversationOpenSchema))
    b: z.infer<typeof c.SocialActivityConversationOpenSchema>,
    @Headers('idempotency-key') k: K,
    @Headers('if-match') v: K,
    @Res({ passthrough: true }) r: Response,
  ) {
    return socialResult(
      r,
      await this.s.openConversation(a, id, b, socialExpected(v), k),
    );
  }
  @Post(':id/conversation/join') joinConversation(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Body(socialBody) _b: unknown,
    @Headers('idempotency-key') k: K,
  ) {
    return this.s.joinConversation(a, id, k);
  }
  @Put(':id/reminder') reminder(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Body(pipe(c.SocialActivityReminderSchema))
    b: z.infer<typeof c.SocialActivityReminderSchema>,
    @Headers('idempotency-key') k: K,
  ) {
    return this.s.reminder(a, id, b, k);
  }
}
@Controller('social-notices')
@UseGuards(VerifiedSessionGuard, SocialGuard)
export class SocialNoticesController {
  constructor(
    @Inject(SocialPlanningService) private readonly p: SocialPlanningService,
  ) {}
  @Get() list(
    @CurrentActor() a: A,
    @Query(socialPage) q: z.infer<typeof c.SocialPageQuerySchema>,
  ) {
    return this.p.notices(a, q);
  }
  @Post(':id/read') read(
    @CurrentActor() a: A,
    @Param('id', socialId) id: string,
    @Body(socialBody) _b: unknown,
    @Headers('idempotency-key') k: K,
  ) {
    return this.p.readNotice(a, id, k);
  }
}
/** Same ledger contract for Group-level and Activity-level expenses. */
function ledgerController(prefix: string, kind: LedgerRef['kind']) {
  @Controller(prefix)
  @UseGuards(VerifiedSessionGuard, SocialGuard)
  class LedgerController {
    constructor(
      @Inject(SocialExpensesService) readonly e: SocialExpensesService,
    ) {}
    @Get(':id/expenses') list(
      @CurrentActor() a: A,
      @Param('id', socialId) id: string,
      @Query(socialPage) q: z.infer<typeof c.SocialPageQuerySchema>,
    ) {
      return this.e.list(a, { kind, id }, q);
    }
    @Post(':id/expenses') async create(
      @CurrentActor() a: A,
      @Param('id', socialId) id: string,
      @Body(pipe(c.SocialExpenseCreateSchema))
      b: z.infer<typeof c.SocialExpenseCreateSchema>,
      @Headers('idempotency-key') k: K,
      @Res({ passthrough: true }) r: Response,
    ) {
      return tag(r, await this.e.create(a, { kind, id }, b, k));
    }
    @Get(':id/expenses/:expenseId') async read(
      @CurrentActor() a: A,
      @Param('id', socialId) id: string,
      @Param('expenseId', socialId) expenseId: string,
      @Query(socialEmpty) _q: unknown,
      @Res({ passthrough: true }) r: Response,
    ) {
      return tag(r, await this.e.read(a, { kind, id }, expenseId));
    }
    @Get(':id/expenses/:expenseId/history') history(
      @CurrentActor() a: A,
      @Param('id', socialId) id: string,
      @Param('expenseId', socialId) expenseId: string,
      @Query(socialEmpty) _q: unknown,
    ) {
      return this.e.history(a, { kind, id }, expenseId);
    }
    @Post(':id/expenses/:expenseId/revisions') async revise(
      @CurrentActor() a: A,
      @Param('id', socialId) id: string,
      @Param('expenseId', socialId) expenseId: string,
      @Body(pipe(c.SocialExpenseInputSchema))
      b: z.infer<typeof c.SocialExpenseInputSchema>,
      @Headers('idempotency-key') k: K,
      @Headers('if-match') v: K,
      @Res({ passthrough: true }) r: Response,
    ) {
      return tag(
        r,
        await this.e.revise(
          a,
          { kind, id },
          expenseId,
          b,
          socialExpected(v),
          k,
        ),
      );
    }
    @Post(':id/expenses/:expenseId/decisions/:action') async decide(
      @CurrentActor() a: A,
      @Param('id', socialId) id: string,
      @Param('expenseId', socialId) expenseId: string,
      @Param('action', pipe(c.SocialExpenseDecisionActionSchema))
      action: z.infer<typeof c.SocialExpenseDecisionActionSchema>,
      @Body(pipe(c.SocialExpenseDecisionSchema))
      b: z.infer<typeof c.SocialExpenseDecisionSchema>,
      @Headers('idempotency-key') k: K,
      @Headers('if-match') v: K,
      @Res({ passthrough: true }) r: Response,
    ) {
      return tag(
        r,
        await this.e.decide(
          a,
          { kind, id },
          expenseId,
          action,
          b,
          socialExpected(v),
          k,
        ),
      );
    }
    @Post(':id/expenses/:expenseId/finance-posting/preview') financePreview(
      @CurrentActor() a: A,
      @Param('id', socialId) id: string,
      @Param('expenseId', socialId) expenseId: string,
      @Body(pipe(c.SocialFinancePostingRequestSchema))
      b: z.infer<typeof c.SocialFinancePostingRequestSchema>,
    ) {
      return this.e.financePreview(a, { kind, id }, expenseId, b);
    }
    @Post(':id/expenses/:expenseId/finance-posting') financePost(
      @CurrentActor() a: A,
      @Param('id', socialId) id: string,
      @Param('expenseId', socialId) expenseId: string,
      @Body(pipe(c.SocialFinancePostingConfirmSchema))
      b: z.infer<typeof c.SocialFinancePostingConfirmSchema>,
      @Headers('idempotency-key') k: K,
    ) {
      return this.e.financePost(a, { kind, id }, expenseId, b, k);
    }
    @Get(':id/balances') all(
      @CurrentActor() a: A,
      @Param('id', socialId) id: string,
      @Query(socialEmpty) _q: unknown,
    ) {
      return this.e.balances(a, { kind, id }, true);
    }
    @Get(':id/balances/me') mine(
      @CurrentActor() a: A,
      @Param('id', socialId) id: string,
      @Query(socialEmpty) _q: unknown,
    ) {
      return this.e.balances(a, { kind, id }, false);
    }
    @Get(':id/settlements') settlements(
      @CurrentActor() a: A,
      @Param('id', socialId) id: string,
      @Query(socialPage) q: z.infer<typeof c.SocialPageQuerySchema>,
    ) {
      return this.e.settlements(a, { kind, id }, q);
    }
    @Post(':id/settlements') async settle(
      @CurrentActor() a: A,
      @Param('id', socialId) id: string,
      @Body(pipe(c.SocialSettlementCreateSchema))
      b: z.infer<typeof c.SocialSettlementCreateSchema>,
      @Headers('idempotency-key') k: K,
      @Res({ passthrough: true }) r: Response,
    ) {
      return tag(r, await this.e.settle(a, { kind, id }, b, k));
    }
    @Post(':id/settlements/:settlementId/decisions/:action')
    async decideSettlement(
      @CurrentActor() a: A,
      @Param('id', socialId) id: string,
      @Param('settlementId', socialId) settlementId: string,
      @Param('action', pipe(c.SocialSettlementActionSchema))
      action: z.infer<typeof c.SocialSettlementActionSchema>,
      @Body(pipe(c.SocialSettlementDecisionSchema))
      b: z.infer<typeof c.SocialSettlementDecisionSchema>,
      @Headers('idempotency-key') k: K,
      @Headers('if-match') v: K,
      @Res({ passthrough: true }) r: Response,
    ) {
      return tag(
        r,
        await this.e.decideSettlement(
          a,
          { kind, id },
          settlementId,
          action,
          b,
          socialExpected(v),
          k,
        ),
      );
    }
  }
  return LedgerController;
}
export const SocialGroupLedgerController = ledgerController(
  'social-groups',
  'GROUP',
);
export const SocialActivityLedgerController = ledgerController(
  'social-activities',
  'ACTIVITY',
);
