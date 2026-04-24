import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserGoal } from '../database/entities/user-goal.entity.js';
import { UpdateGoalDto } from './dto/update-goal.dto.js';

@Injectable()
export class GoalsService {
  constructor(
    @InjectRepository(UserGoal)
    private readonly goalRepo: Repository<UserGoal>,
  ) {}

  async getGoals(userId: string) {
    return this.goalRepo.find({ where: { userId } });
  }

  async createGoal(userId: string, body: any) {
    const goal = this.goalRepo.create({ userId, ...body });
    return this.goalRepo.save(goal);
  }

  async updateGoal(userId: string, dto: UpdateGoalDto) {
    const goal = await this.goalRepo.findOne({ where: { goalId: dto.goalId } });

    if (!goal) throw new NotFoundException('Goal not found');
    if (goal.userId !== userId) throw new ForbiddenException('You do not have permission to update this goal');

    // Only update the explicitly allowed fields to respect the goal's original structure
    if (dto.currentAmount !== undefined) {
      goal.currentAmount = dto.currentAmount;
    }
    if (dto.isCompleted !== undefined) {
      goal.isCompleted = dto.isCompleted;
    }

    return this.goalRepo.save(goal);
  }

  async deleteGoal(goalId: string) {
    const result = await this.goalRepo.delete(goalId);
    if (result.affected === 0) throw new NotFoundException('Goal not found');
    return { message: 'Goal deleted' };
  }
}
