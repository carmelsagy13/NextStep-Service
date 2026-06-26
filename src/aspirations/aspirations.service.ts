import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  UserAspiration,
  UserAspirationStatus,
} from '../database/entities/user-aspiration.entity.js';
import {
  GoalTypeCatalog,
  GoalAttributeSpec,
} from '../database/entities/goal-type-catalog.entity.js';
import { CreateAspirationDto } from './dto/create-aspiration.dto.js';
import { UpdateAspirationDto } from './dto/update-aspiration.dto.js';
import { AspirationSyncService } from './aspiration-sync.service.js';

/** One goal's data as captured by the onboarding questionnaire. */
export interface OnboardingGoalInput {
  goalTypeCode: string;
  targetAmount?: number | null;
  timeframeMonths?: number | null;
}

@Injectable()
export class AspirationsService {
  constructor(
    @InjectRepository(UserAspiration)
    private readonly aspirationRepo: Repository<UserAspiration>,
    @InjectRepository(GoalTypeCatalog)
    private readonly catalogRepo: Repository<GoalTypeCatalog>,
    private readonly sync: AspirationSyncService,
  ) {}

  // ── Catalog ────────────────────────────────────────────────────────────

  /** The active goal types a user can choose from (drives a dynamic UI). */
  getGoalTypes(): Promise<GoalTypeCatalog[]> {
    return this.catalogRepo.find({
      where: { isActive: true },
      order: { defaultPriority: 'ASC' },
    });
  }

  // ── Read ─────────────────────────────────────────────────────────────────

  /** All of the user's aspirations that are not abandoned, newest-tuned first. */
  getAspirations(userId: string): Promise<UserAspiration[]> {
    return this.aspirationRepo.find({
      where: [
        { userId, status: UserAspirationStatus.ACTIVE },
        { userId, status: UserAspirationStatus.ACHIEVED },
      ],
      order: { createdAt: 'ASC' },
    });
  }

  // ── Create ───────────────────────────────────────────────────────────────

  async createAspiration(
    userId: string,
    dto: CreateAspirationDto,
  ): Promise<UserAspiration> {
    const type = await this.requireGoalType(dto.goalTypeCode);

    const existing = await this.aspirationRepo.findOne({
      where: { userId, goalTypeCode: dto.goalTypeCode },
    });
    if (existing && existing.status === UserAspirationStatus.ACTIVE) {
      throw new BadRequestException(
        `An active goal of type '${dto.goalTypeCode}' already exists; update it instead.`,
      );
    }

    const attributes = this.validateAttributes(type, dto.attributes);
    this.assertTargetsAllowed(type, dto.targetAmount, dto.targetDate);

    // Reactivate a previously-abandoned aspiration of the same type rather than
    // violating the (user_id, goal_type_code) uniqueness constraint.
    const aspiration =
      existing ??
      this.aspirationRepo.create({ userId, goalTypeCode: dto.goalTypeCode });
    aspiration.title = type.label.he;
    aspiration.targetAmount = dto.targetAmount ?? null;
    aspiration.targetDate = dto.targetDate ? new Date(dto.targetDate) : null;
    aspiration.attributes = attributes;
    aspiration.status = UserAspirationStatus.ACTIVE;
    aspiration.revision = (existing?.revision ?? 0) + 1;
    aspiration.lastSyncedRevision = null;

    const saved = await this.aspirationRepo.save(aspiration);
    await this.sync.syncUserGoalsForAspirations(userId);
    return saved;
  }

  // ── Update ───────────────────────────────────────────────────────────────

  async updateAspiration(
    userId: string,
    aspirationId: string,
    dto: UpdateAspirationDto,
  ): Promise<UserAspiration> {
    const aspiration = await this.aspirationRepo.findOne({
      where: { aspirationId, userId },
    });
    if (!aspiration) throw new NotFoundException('Aspiration not found');

    const type = await this.requireGoalType(aspiration.goalTypeCode);
    let material = false;

    if (dto.targetAmount !== undefined) {
      this.assertTargetsAllowed(type, dto.targetAmount, undefined);
      if (Number(dto.targetAmount) !== Number(aspiration.targetAmount)) {
        aspiration.targetAmount = dto.targetAmount;
        material = true;
      }
    }
    if (dto.targetDate !== undefined) {
      this.assertTargetsAllowed(type, undefined, dto.targetDate);
      const next = dto.targetDate ? new Date(dto.targetDate) : null;
      if (this.toIso(next) !== this.toIso(aspiration.targetDate)) {
        aspiration.targetDate = next;
        material = true;
      }
    }
    if (dto.attributes !== undefined) {
      const validated = this.validateAttributes(type, dto.attributes);
      if (JSON.stringify(validated) !== JSON.stringify(aspiration.attributes)) {
        aspiration.attributes = validated;
        material = true;
      }
    }
    if (dto.status !== undefined && dto.status !== aspiration.status) {
      aspiration.status = dto.status;
    }

    // A material change invalidates the linked tasks → bump revision so the
    // sync pass re-tunes them.
    if (material) {
      aspiration.revision += 1;
    }

    const saved = await this.aspirationRepo.save(aspiration);
    if (material) await this.sync.syncUserGoalsForAspirations(userId);
    return saved;
  }

  // ── Delete (soft) ─────────────────────────────────────────────────────────

  async abandonAspiration(
    userId: string,
    aspirationId: string,
  ): Promise<{ message: string }> {
    const aspiration = await this.aspirationRepo.findOne({
      where: { aspirationId, userId },
    });
    if (!aspiration) throw new NotFoundException('Aspiration not found');
    aspiration.status = UserAspirationStatus.ABANDONED;
    await this.aspirationRepo.save(aspiration);
    return { message: 'Aspiration abandoned' };
  }

  // ── Onboarding bridge (called by the questionnaire) ───────────────────────

  /**
   * Reconcile the user's aspirations against the goal selections captured by the
   * onboarding questionnaire: upsert one aspiration per selected goal type and
   * abandon any previously-active aspiration that was deselected. Runs a single
   * task re-sync at the end. Returns the resulting active aspirations.
   */
  async upsertFromOnboarding(
    userId: string,
    selections: OnboardingGoalInput[],
  ): Promise<UserAspiration[]> {
    const types = await this.catalogRepo.find({ where: { isActive: true } });
    const typeByCode = new Map(types.map((t) => [t.code, t]));

    const existing = await this.aspirationRepo.find({ where: { userId } });
    const existingByCode = new Map(existing.map((a) => [a.goalTypeCode, a]));
    const selectedCodes = new Set(selections.map((s) => s.goalTypeCode));

    const toSave: UserAspiration[] = [];

    for (const sel of selections) {
      const type = typeByCode.get(sel.goalTypeCode);
      if (!type) continue; // unknown/inactive goal type — ignore silently

      const attributes =
        sel.timeframeMonths != null && type.supportsTimeframe
          ? { timeframeMonths: Number(sel.timeframeMonths) }
          : null;
      const targetAmount =
        sel.targetAmount != null && type.supportsAmount
          ? Number(sel.targetAmount)
          : null;
      const targetDate =
        sel.timeframeMonths != null && type.supportsTimeframe
          ? this.dateFromMonths(Number(sel.timeframeMonths))
          : null;

      const current = existingByCode.get(sel.goalTypeCode);
      const aspiration =
        current ??
        this.aspirationRepo.create({ userId, goalTypeCode: sel.goalTypeCode });

      const material =
        !current ||
        current.status !== UserAspirationStatus.ACTIVE ||
        Number(current.targetAmount) !== Number(targetAmount) ||
        this.toIso(current.targetDate) !== this.toIso(targetDate) ||
        JSON.stringify(current.attributes) !== JSON.stringify(attributes);

      aspiration.title = type.label.he;
      aspiration.targetAmount = targetAmount;
      aspiration.targetDate = targetDate;
      aspiration.attributes = attributes;
      aspiration.status = UserAspirationStatus.ACTIVE;
      if (material) {
        aspiration.revision = (aspiration.revision ?? 0) + 1;
      }
      toSave.push(aspiration);
    }

    // Abandon active aspirations the user deselected.
    for (const a of existing) {
      if (
        a.status === UserAspirationStatus.ACTIVE &&
        !selectedCodes.has(a.goalTypeCode)
      ) {
        a.status = UserAspirationStatus.ABANDONED;
        toSave.push(a);
      }
    }

    if (toSave.length) await this.aspirationRepo.save(toSave);
    await this.sync.syncUserGoalsForAspirations(userId);
    return this.getAspirations(userId);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async requireGoalType(code: string): Promise<GoalTypeCatalog> {
    const type = await this.catalogRepo.findOne({ where: { code } });
    if (!type || !type.isActive) {
      throw new BadRequestException(`Unknown or inactive goal type '${code}'`);
    }
    return type;
  }

  private assertTargetsAllowed(
    type: GoalTypeCatalog,
    targetAmount: number | null | undefined,
    targetDate: string | null | undefined,
  ): void {
    if (targetAmount != null && !type.supportsAmount) {
      throw new BadRequestException(
        `Goal type '${type.code}' does not support a target amount`,
      );
    }
    if (targetDate != null && !type.supportsTimeframe) {
      throw new BadRequestException(
        `Goal type '${type.code}' does not support a target date`,
      );
    }
  }

  /**
   * Validate the free-form attributes blob against the goal type's declared
   * schema: required keys must be present and values must match the declared
   * type. Unknown keys are dropped. Returns the cleaned object (or null).
   */
  private validateAttributes(
    type: GoalTypeCatalog,
    attributes: Record<string, unknown> | undefined,
  ): Record<string, unknown> | null {
    const schema = type.attributeSchema ?? [];
    if (!schema.length) return attributes ?? null;

    const input = attributes ?? {};
    const cleaned: Record<string, unknown> = {};

    for (const spec of schema) {
      const raw = input[spec.key];
      if (raw === undefined || raw === null) {
        if (spec.required) {
          throw new BadRequestException(
            `Missing required attribute '${spec.key}' for goal type '${type.code}'`,
          );
        }
        continue;
      }
      cleaned[spec.key] = this.coerceAttribute(type.code, spec, raw);
    }
    return Object.keys(cleaned).length ? cleaned : null;
  }

  private coerceAttribute(
    typeCode: string,
    spec: GoalAttributeSpec,
    raw: unknown,
  ): unknown {
    const fail = () => {
      throw new BadRequestException(
        `Attribute '${spec.key}' for goal type '${typeCode}' must be a ${spec.type}`,
      );
    };
    switch (spec.type) {
      case 'number': {
        const n = Number(raw);
        if (!Number.isFinite(n)) fail();
        return n;
      }
      case 'boolean':
        if (typeof raw !== 'boolean') fail();
        return raw;
      case 'string':
        if (typeof raw !== 'string') fail();
        return raw;
      case 'date': {
        const d = new Date(raw as string);
        if (Number.isNaN(d.getTime())) fail();
        return d.toISOString().slice(0, 10);
      }
      case 'string[]':
        if (!Array.isArray(raw) || raw.some((v) => typeof v !== 'string')) {
          fail();
        }
        return raw;
      default:
        return raw;
    }
  }

  private dateFromMonths(months: number): Date | null {
    if (!Number.isFinite(months) || months <= 0) return null;
    const d = new Date();
    d.setMonth(d.getMonth() + Math.round(months));
    return d;
  }

  private toIso(d: Date | string | null): string | null {
    if (!d) return null;
    return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
  }
}
