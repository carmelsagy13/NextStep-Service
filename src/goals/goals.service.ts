import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserGoal } from '../database/entities/user-goal.entity.js';

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

  async updateGoal(body: any) {
    const { goalId, ...updates } = body;
    const result = await this.goalRepo.update(goalId, updates);
    if (result.affected === 0) throw new NotFoundException('Goal not found');
    return { message: 'Goal updated' };
  }

  async deleteGoal(goalId: string) {
    const result = await this.goalRepo.delete(goalId);
    if (result.affected === 0) throw new NotFoundException('Goal not found');
    return { message: 'Goal deleted' };
  }
}
