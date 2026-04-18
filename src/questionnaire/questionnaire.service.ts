import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserProfile } from '../database/entities/user-profile.entity.js';

@Injectable()
export class QuestionnaireService {
  constructor(
    @InjectRepository(UserProfile)
    private readonly profileRepo: Repository<UserProfile>,
  ) {}

  async submit(userId: string, answers: {
    age?: number;
    riskTolerance?: string;
    knowledgeLevel?: string;
    occupation?: string;
  }) {
    let profile = await this.profileRepo.findOne({ where: { userId } });
    if (!profile) {
      profile = this.profileRepo.create({ userId });
    }
    Object.assign(profile, answers);
    await this.profileRepo.save(profile);
    return { message: 'Questionnaire submitted', profile };
  }
}
