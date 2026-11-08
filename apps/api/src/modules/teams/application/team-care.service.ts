import {
  Inject,
  Injectable,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { z } from 'zod';
import * as c from '@mehran/api-contracts';
import type {
  Prisma,
  TeamCase,
  TeamDisclosure,
  TeamCaseEntry,
} from '../../../generated/prisma/client.js';
import { DatabaseService } from '../../../platform/database/database.service.js';
import type { RequestActor } from '../../../platform/auth/request-actor.js';
import { TeamInteractionContext } from './team-interaction.context.js';
import type { Interaction, Member } from './team-interaction.context.js';
type Page = z.infer<typeof c.ProjectPageQuerySchema>;
const partySelect = {
  authorAccessId: true,
  authorGeneration: true,
  subjectAccessId: true,
  subjectGeneration: true,
  reviewerAccessId: true,
  reviewerGeneration: true,
} as const;
type CaseParties = Pick<TeamCase, keyof typeof partySelect>;
const ref = (
  row: CaseParties,
  role: 'author' | 'subject' | 'reviewer',
): Member => ({
  accessId: row[`${role}AccessId` as const],
  generation: row[`${role}Generation` as const],
});
const same = (a: Member, b: Member) =>
  a.accessId === b.accessId && a.generation === b.generation;
const caseView = (r: TeamCase) =>
  c.TeamCaseSchema.parse({
    id: r.id,
    teamId: r.scopeId,
    kind: r.kind,
    author: ref(r, 'author'),
    subject: ref(r, 'subject'),
    reviewer: ref(r, 'reviewer'),
    reason: r.reason,
    evidence: r.evidence,
    state: r.state,
    revision: r.revision,
    createdAt: r.createdAt.toISOString(),
  });
const entryView = (r: TeamCaseEntry) =>
  c.TeamCaseEntrySchema.parse({
    id: r.id,
    caseId: r.caseId,
    kind: r.kind,
    body: r.body,
    createdByActorId: r.createdByActorId,
    createdAt: r.createdAt.toISOString(),
  });
@Injectable()
export class TeamCareService {
  constructor(
    @Inject(TeamInteractionContext) private readonly op: TeamInteractionContext,
    @Inject(DatabaseService) private readonly db: DatabaseService,
  ) {}
  private async hint(id: string, caseId: string) {
    this.op.kernel.assertEnabled();
    const row = await this.db.client.teamCase.findFirst({
      where: {
        id: caseId,
        spaceId: await this.op.kernel.custodySpace(id),
        scopeId: id,
      },
      select: { id: true, ...partySelect },
    });
    if (!row) throw new NotFoundException();
    return row;
  }
  private async disclosureHint(id: string, disclosureId: string) {
    this.op.kernel.assertEnabled();
    const row = await this.db.client.teamDisclosure.findFirst({
      where: {
        id: disclosureId,
        spaceId: await this.op.kernel.custodySpace(id),
        scopeId: id,
      },
    });
    if (!row) throw new NotFoundException();
    return { row, case: await this.hint(id, row.caseId) };
  }
  private async readable(s: Interaction, row: TeamCase) {
    const access = this.op.access(s);
    return (
      (await this.op.kernel.audienceMatches(
        s.tx,
        s.a,
        s.id,
        ref(row, 'author'),
      )) ||
      (await this.op.kernel.audienceMatches(
        s.tx,
        s.a,
        s.id,
        ref(row, 'subject'),
      )) ||
      ((await this.op.kernel.audienceMatches(
        s.tx,
        s.a,
        s.id,
        ref(row, 'reviewer'),
      )) &&
        ['OWNER', 'ADMIN'].includes(access.role ?? ''))
    );
  }
  private async row(s: Interaction, caseId: string) {
    const row = await s.tx.teamCase.findFirst({
      where: { id: caseId, ...this.op.scope(s) },
    });
    if (!row || !(await this.readable(s, row))) throw new NotFoundException();
    return row;
  }
  private async author(s: Interaction, row: TeamCase) {
    if (
      !(await this.op.kernel.audienceMatches(
        s.tx,
        s.a,
        s.id,
        ref(row, 'author'),
      ))
    )
      throw new ForbiddenException();
  }
  private async subject(s: Interaction, row: TeamCase) {
    if (
      !(await this.op.kernel.audienceMatches(
        s.tx,
        s.a,
        s.id,
        ref(row, 'subject'),
      ))
    )
      throw new ForbiddenException();
  }
  private async reviewer(s: Interaction, row: TeamCase) {
    const me = this.op.access(s);
    if (
      !(await this.op.kernel.audienceMatches(
        s.tx,
        s.a,
        s.id,
        ref(row, 'reviewer'),
      )) ||
      !['OWNER', 'ADMIN'].includes(me.role ?? '')
    )
      throw new ForbiddenException();
  }
  private members(r: CaseParties) {
    return [ref(r, 'author'), ref(r, 'subject'), ref(r, 'reviewer')];
  }
  private async audit(s: Interaction, id: string) {
    await this.op.kernel.recordAccess(
      s.tx,
      s.a,
      s.actor,
      s.id,
      id,
      'team.case.read',
    );
  }
  async create(
    actor: RequestActor,
    id: string,
    input: z.infer<typeof c.TeamCaseCreateSchema>,
    key: string | undefined,
  ) {
    const body = c.TeamCaseCreateSchema.parse(input);
    return this.op.write(
      actor,
      id,
      body.kind === 'CORRECTIVE' ? 'work.manage' : 'task.create',
      [body.subject, body.reviewer],
      'team.case.create',
      body.id,
      async (s) => {
        await this.op.member(s, body.subject);
        await this.op.member(s, body.reviewer, ['settings.manage']);
        const me = this.op.access(s);
        if (
          new Set([me.accessId, body.subject.accessId, body.reviewer.accessId])
            .size !== 3
        )
          throw new ConflictException({
            code: 'DISTINCT_CASE_PARTICIPANTS_REQUIRED',
          });
        await this.op.once(s, 'team.case.create', key, body, async () => {
          if (
            (await s.tx.teamCase.count({ where: { ...this.op.scope(s) } })) >=
            1000
          )
            throw new PayloadTooLargeException();
          await this.op.kernel.featureGrowth(s.tx, id, 'team.case');
          await s.begin();
          return s.tx.teamCase.create({
            data: {
              id: body.id,
              ...this.op.scope(s),
              kind: body.kind,
              reason: body.reason,
              evidence: body.evidence,
              authorAccessId: me.accessId,
              authorGeneration: me.generation,
              subjectAccessId: body.subject.accessId,
              subjectGeneration: body.subject.generation,
              reviewerAccessId: body.reviewer.accessId,
              reviewerGeneration: body.reviewer.generation,
            },
          });
        });
        return caseView(await this.row(s, body.id));
      },
      'team.case',
    );
  }
  async read(actor: RequestActor, id: string, caseId: string) {
    return this.op.read(actor, id, async (s) => {
      const row = await this.row(s, caseId);
      await this.audit(s, caseId);
      return caseView(row);
    });
  }
  async list(actor: RequestActor, id: string, q: Page) {
    return this.op.read(actor, id, async (s) => {
      const a = this.op.access(s),
        audience = await this.op.kernel.historicalAudience(s.tx, s.a, s.id),
        where: Prisma.TeamCaseWhereInput = {
          ...this.op.scope(s),
          OR: [
            ...audience.map((m) => ({
              authorAccessId: m.accessId,
              authorGeneration: m.generation,
            })),
            ...audience.map((m) => ({
              subjectAccessId: m.accessId,
              subjectGeneration: m.generation,
            })),
            ...(['OWNER', 'ADMIN'].includes(a.role ?? '')
              ? audience.map((m) => ({
                  reviewerAccessId: m.accessId,
                  reviewerGeneration: m.generation,
                }))
              : []),
          ],
        };
      const page = await this.op.page(s, 'team-cases', q, (after) =>
        s.tx.teamCase
          .findMany({
            where: { ...where, ...(after ? { id: { gt: after } } : {}) },
            orderBy: { id: 'asc' },
            take: q.limit + 1,
          })
          .then((rows) => rows.map(caseView)),
      );
      await this.audit(s, id);
      return page;
    });
  }
  async entries(actor: RequestActor, id: string, caseId: string, q: Page) {
    return this.op.read(actor, id, async (s) => {
      await this.row(s, caseId);
      await this.audit(s, caseId);
      return this.op.page(s, 'team-case-entries:' + caseId, q, (after) =>
        s.tx.teamCaseEntry
          .findMany({
            where: {
              ...this.op.scope(s),
              caseId,
              ...(after ? { id: { gt: after } } : {}),
            },
            orderBy: { id: 'asc' },
            take: q.limit + 1,
          })
          .then((rows) => rows.map(entryView)),
      );
    });
  }
  async entry(
    actor: RequestActor,
    id: string,
    caseId: string,
    revision: number,
    input:
      | z.infer<typeof c.TeamCaseEntryInputSchema>
      | z.infer<typeof c.TeamCaseReviewInputSchema>,
    key: string | undefined,
    review = false,
  ) {
    const hint = await this.hint(id, caseId),
      body = review
        ? c.TeamCaseReviewInputSchema.parse(input)
        : c.TeamCaseEntryInputSchema.parse(input);
    return this.op.write(
      actor,
      id,
      'task.read',
      this.members(hint),
      review ? 'team.case.review' : 'team.case.response',
      body.id,
      async (s) => {
        const row = await this.row(s, caseId);
        if (review) await this.reviewer(s, row);
        else {
          await this.subject(s, row);
          if (
            'kind' in body &&
            body.kind === 'APPEAL' &&
            row.kind !== 'CORRECTIVE'
          )
            throw new ConflictException();
        }
        await this.op.once(
          s,
          review ? 'team.case.review' : 'team.case.response',
          key,
          { caseId, revision, body },
          async () => {
            this.op.match(row.revision, revision);
            if (
              (await s.tx.teamCaseEntry.count({
                where: { ...this.op.scope(s), caseId },
              })) >= 1000
            )
              throw new PayloadTooLargeException();
            await this.op.kernel.featureGrowth(s.tx, id, 'team.case-entry');
            await s.begin();
            const result = await s.tx.teamCaseEntry.create({
              data: {
                id: body.id,
                ...this.op.scope(s),
                caseId,
                kind: 'kind' in body ? body.kind : 'REVIEW',
                body: body.body,
                createdByActorId: this.op.access(s).actorId,
              },
            });
            await s.tx.teamCase.update({
              where: { id: caseId },
              data: {
                state: 'resolution' in body ? body.resolution : 'OPEN',
                revision: { increment: 1 },
              },
            });
            return result;
          },
        );
        return caseView(await this.row(s, caseId));
      },
      'team.case-entry',
    );
  }
  private async proposal(s: Interaction, row: TeamDisclosure) {
    const recipients = await s.tx.teamDisclosureRecipient.findMany({
      where: { ...this.op.scope(s), disclosureId: row.id },
      orderBy: { accessId: 'asc' },
    });
    return c.TeamDisclosureProposalSchema.parse({
      id: row.id,
      caseId: row.caseId,
      sourceRevision: row.sourceRevision,
      audience: row.audience,
      recipients: recipients.map((r) => ({
        accessId: r.accessId,
        generation: r.generation,
      })),
      summary: row.summary,
      expiresAt: row.expiresAt.toISOString(),
      state: row.state,
      revision: row.revision,
      reviewNote: row.reviewNote,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      subjectConsentedAt: row.subjectConsentedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    });
  }
  async proposals(actor: RequestActor, id: string, caseId: string, q: Page) {
    return this.op.read(actor, id, async (s) => {
      await this.row(s, caseId);
      await this.audit(s, caseId);
      return this.op.page(
        s,
        'team-case-disclosures:' + caseId,
        q,
        async (after) =>
          Promise.all(
            (
              await s.tx.teamDisclosure.findMany({
                where: {
                  ...this.op.scope(s),
                  caseId,
                  ...(after ? { id: { gt: after } } : {}),
                },
                orderBy: { id: 'asc' },
                take: q.limit + 1,
              })
            ).map((r) => this.proposal(s, r)),
          ),
      );
    });
  }
  async propose(
    actor: RequestActor,
    id: string,
    caseId: string,
    input: z.infer<typeof c.TeamDisclosureCreateSchema>,
    key: string | undefined,
  ) {
    const body = c.TeamDisclosureCreateSchema.parse(input),
      hint = await this.hint(id, caseId);
    return this.op.write(
      actor,
      id,
      'task.read',
      [...this.members(hint), ...body.recipients],
      'team.disclosure.propose',
      body.id,
      async (s) => {
        const row = await this.row(s, caseId);
        await this.author(s, row);
        for (const m of body.recipients) await this.op.member(s, m);
        if (body.audience === 'TEAM' && row.kind !== 'RECOGNITION')
          throw new ForbiddenException();
        await this.op.once(
          s,
          'team.disclosure.propose',
          key,
          { caseId, body },
          async () => {
            this.op.match(row.revision, body.sourceRevision);
            const expiry = Date.parse(body.expiresAt);
            if (expiry <= +s.now || expiry > +s.now + 30 * 86400000)
              throw new ConflictException({
                code: 'INVALID_DISCLOSURE_EXPIRY',
              });
            if (
              (await s.tx.teamDisclosure.count({
                where: { ...this.op.scope(s), caseId },
              })) >= 100
            )
              throw new PayloadTooLargeException();
            await this.op.kernel.featureGrowth(s.tx, id, 'team.disclosure');
            const epoch = await this.op.kernel.restoreGeneration(s.tx, s.a, id);
            await s.begin();
            const result = await s.tx.teamDisclosure.create({
              data: {
                id: body.id,
                ...this.op.scope(s),
                caseId,
                sourceRevision: body.sourceRevision,
                audience: body.audience,
                summary: body.summary,
                expiresAt: new Date(body.expiresAt),
                restoreGeneration: epoch,
              },
            });
            if (body.recipients.length)
              await s.tx.teamDisclosureRecipient.createMany({
                data: body.recipients.map((m) => ({
                  ...this.op.scope(s),
                  disclosureId: body.id,
                  ...m,
                })),
              });
            return result;
          },
        );
        return this.proposal(
          s,
          await s.tx.teamDisclosure.findUniqueOrThrow({
            where: { id: body.id },
          }),
        );
      },
      'team.disclosure',
    );
  }
  async decide(
    actor: RequestActor,
    id: string,
    disclosureId: string,
    revision: number,
    command:
      | { kind: 'REVIEW'; approve: boolean; reason: string }
      | { kind: 'CONSENT'; consent: boolean }
      | { kind: 'REVOKE' },
  ) {
    const hint = await this.disclosureHint(id, disclosureId);
    return this.op.write(
      actor,
      id,
      'task.read',
      this.members(hint.case),
      'team.disclosure.' + command.kind.toLowerCase(),
      disclosureId,
      async (s) => {
        const row = await this.row(s, hint.row.caseId),
          p = await s.tx.teamDisclosure.findFirstOrThrow({
            where: { id: disclosureId, ...this.op.scope(s), caseId: row.id },
          });
        this.op.match(p.revision, revision);
        if (command.kind === 'REVIEW') await this.reviewer(s, row);
        else if (command.kind === 'CONSENT') {
          await this.subject(s, row);
          if (row.kind !== 'RECOGNITION') throw new ForbiddenException();
        }
        if (command.kind !== 'REVOKE') {
          if (
            p.state === 'REVOKED' ||
            p.state === 'REJECTED' ||
            p.expiresAt <= s.now ||
            p.restoreGeneration !==
              (await this.op.kernel.restoreGeneration(s.tx, s.a, id)) ||
            p.sourceRevision !== row.revision
          )
            throw new ConflictException();
          if (command.kind === 'REVIEW' && p.state !== 'PENDING')
            throw new ConflictException();
          for (const m of this.members(row))
            if (!(await this.op.eligible(s, m, same(m, ref(row, 'reviewer')))))
              throw new ConflictException({
                code: 'CASE_PARTICIPANT_UNAVAILABLE',
              });
          for (const m of await s.tx.teamDisclosureRecipient.findMany({
            where: { ...this.op.scope(s), disclosureId },
          }))
            if (!(await this.op.eligible(s, m))) throw new ConflictException();
        }
        if (p.state === 'REVOKED') throw new ConflictException();
        await s.begin();
        const result = await s.tx.teamDisclosure.update({
          where: { id: disclosureId },
          data: {
            revision: { increment: 1 },
            ...(command.kind === 'REVIEW'
              ? {
                  state: command.approve ? 'APPROVED' : 'REJECTED',
                  reviewNote: command.reason,
                  reviewedAt: s.now,
                }
              : command.kind === 'CONSENT'
                ? { subjectConsentedAt: command.consent ? s.now : null }
                : { state: 'REVOKED' }),
          },
        });
        return this.proposal(s, result);
      },
    );
  }
  async summaries(
    actor: RequestActor,
    id: string,
    q: Page,
    disclosureId?: string,
  ) {
    this.op.kernel.assertEnabled();
    // Hints contain opaque membership references only. All required account fences precede custody.
    const hints = await this.db.client.teamCase.findMany({
      where: {
        spaceId: await this.op.kernel.custodySpace(id),
        scopeId: id,
        TeamDisclosure_Case: { some: { state: 'APPROVED' } },
      },
      select: partySelect,
      take: 1001,
    });
    return this.op.read(
      actor,
      id,
      async (s) => {
        if (hints.length > 1000) throw new PayloadTooLargeException();
        const audience = await this.op.kernel.historicalAudience(
            s.tx,
            s.a,
            s.id,
          ),
          epoch = await this.op.kernel.restoreGeneration(s.tx, s.a, id);
        const where: Prisma.TeamDisclosureWhereInput = {
          ...this.op.scope(s),
          state: 'APPROVED',
          expiresAt: { gt: s.now },
          restoreGeneration: epoch,
          ...(disclosureId ? { id: disclosureId } : {}),
          OR: [
            {
              audience: 'NAMED',
              TeamDisclosureRecipient_Disclosure: {
                some: { OR: audience },
              },
            },
            {
              audience: 'TEAM',
              Case: { kind: 'RECOGNITION' },
              subjectConsentedAt: { not: null },
            },
          ],
        };
        const candidates = await s.tx.teamCase.findMany({
          where: { ...this.op.scope(s), TeamDisclosure_Case: { some: where } },
          select: {
            id: true,
            revision: true,
            kind: true,
            authorAccessId: true,
            authorGeneration: true,
            subjectAccessId: true,
            subjectGeneration: true,
            reviewerAccessId: true,
            reviewerGeneration: true,
          },
          take: 1001,
        });
        if (candidates.length > 1000) throw new PayloadTooLargeException();
        const eligible: Prisma.TeamDisclosureWhereInput[] = [];
        const cache = new Map<string, Promise<boolean>>(),
          current = (m: Member, admin = false) => {
            const key = m.accessId + ':' + m.generation + ':' + admin;
            let result = cache.get(key);
            if (!result) {
              result = (async () => {
                const user = await this.op.kernel.memberUserInTransaction(
                  s.tx,
                  id,
                  m.accessId,
                );
                if (user && !s.locked.includes(user))
                  throw new ConflictException({
                    code: 'CASE_PARTICIPANTS_CHANGED_RESTART',
                  });
                return this.op.eligible(s, m, admin);
              })();
              cache.set(key, result);
            }
            return result;
          };
        for (const row of candidates) {
          if (
            (await current({
              accessId: row.authorAccessId,
              generation: row.authorGeneration,
            })) &&
            (await current({
              accessId: row.subjectAccessId,
              generation: row.subjectGeneration,
            })) &&
            (await current(
              {
                accessId: row.reviewerAccessId,
                generation: row.reviewerGeneration,
              },
              true,
            ))
          )
            eligible.push({
              caseId: row.id,
              sourceRevision: row.revision,
              ...(row.kind === 'RECOGNITION'
                ? { subjectConsentedAt: { not: null } }
                : {}),
            });
        }
        const query = async (after: string | undefined) =>
          eligible.length
            ? (
                await s.tx.teamDisclosure.findMany({
                  where: {
                    AND: [where, { OR: eligible }],
                    ...(after ? { id: { gt: after } } : {}),
                  },
                  orderBy: { id: 'asc' },
                  take: disclosureId ? 1 : q.limit + 1,
                  include: { Case: { select: { kind: true } } },
                })
              ).map((r) =>
                c.TeamDisclosureSummarySchema.parse({
                  id: r.id,
                  kind: r.Case.kind,
                  summary: r.summary,
                  expiresAt: r.expiresAt.toISOString(),
                }),
              )
            : [];
        if (disclosureId) {
          const row = (await query(undefined))[0];
          if (!row) throw new NotFoundException();
          await this.op.kernel.recordAccess(
            s.tx,
            s.a,
            actor,
            id,
            disclosureId,
            'team.disclosure.read',
          );
          return row;
        }
        return this.op.page(s, 'team-disclosures', q, query);
      },
      hints.flatMap((row) => this.members(row)),
    );
  }
}
