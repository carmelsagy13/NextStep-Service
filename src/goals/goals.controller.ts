import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { GoalsService } from './goals.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { UpdateGoalDto } from './dto/update-goal.dto.js';

@ApiTags('Goals')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('goals')
export class GoalsController {
  constructor(private readonly goalsService: GoalsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all user goals with progress' })
  getGoals(@CurrentUser() user: { userId: string }) {
    return this.goalsService.getGoals(user.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new goal' })
  createGoal(@CurrentUser() user: { userId: string }, @Body() body: any) {
    return this.goalsService.createGoal(user.userId, body);
  }

  @Post('update')
  @ApiOperation({ summary: 'Update currentAmount and/or isCompleted for a goal (optimistic UI support)' })
  updateGoal(@CurrentUser() user: { userId: string }, @Body() dto: UpdateGoalDto) {
    return this.goalsService.updateGoal(user.userId, dto);
  }

  @Post('delete')
  @ApiOperation({ summary: 'Delete a goal by goalId' })
  deleteGoal(@Body() body: any) {
    return this.goalsService.deleteGoal(body.goalId);
  }
}
