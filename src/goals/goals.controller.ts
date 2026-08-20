import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiOkResponse,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { GoalsService } from './goals.service.js';
import { StepIsolationGuard } from './guards/step-isolation.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { UpdateGoalDto } from './dto/update-goal.dto.js';
import { DismissGoalDto } from './dto/dismiss-goal.dto.js';
import { GoalResponseDto } from './dto/goal-response.dto.js';
import { UserGoalStatus } from '../database/entities/user-goal.entity.js';

@ApiTags('Goals')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('goals')
export class GoalsController {
  constructor(private readonly goalsService: GoalsService) {}

  @Get('recommended')
  @ApiOperation({
    summary: "Get recommended roadmap goals for the user's current step",
    description:
      "Returns only roadmap_goals whose step_id exactly matches the user's current_step, sorted by priority ASC. Goals from other steps are never returned.",
  })
  getRecommendedGoals(@CurrentUser() user: { userId: string }) {
    return this.goalsService.getRecommendedGoals(user.userId);
  }

  @Get()
  @ApiOperation({
    summary:
      'Get user goals with progress, optionally filtered by lifecycle status',
  })
  @ApiQuery({ name: 'status', required: false, enum: UserGoalStatus })
  @ApiOkResponse({
    type: [GoalResponseDto],
    description:
      'MARKETING goals carry a populated `marketing` block; goals whose sponsored offer is no longer live are returned as `personal` with `marketing: null`.',
  })
  getGoals(
    @CurrentUser() user: { userId: string },
    @Query('status') status?: UserGoalStatus,
  ) {
    return this.goalsService.getGoals(user.userId, status);
  }

  @Post()
  @UseGuards(StepIsolationGuard)
  @ApiOperation({
    summary: 'Create a new goal',
    description:
      "If roadmapGoalId is provided, the referenced roadmap_goal must belong to the user's current step (enforced by StepIsolationGuard).",
  })
  createGoal(@CurrentUser() user: { userId: string }, @Body() body: any) {
    return this.goalsService.createGoal(user.userId, body);
  }

  @Post('update')
  @ApiOperation({
    summary:
      'Update currentAmount and/or lifecycle status for a goal (optimistic UI support)',
  })
  updateGoal(
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdateGoalDto,
  ) {
    return this.goalsService.updateGoal(user.userId, dto);
  }

  @Post('dismiss')
  @ApiOperation({
    summary: 'Mark a goal as not relevant for the user',
    description:
      'Retires the task (status `abandoned`) and records why it did not fit, so later goal selection can avoid the same mismatch. Undo by calling POST /goals/update with status `active`, which also clears the recorded feedback.',
  })
  dismissGoal(
    @CurrentUser() user: { userId: string },
    @Body() dto: DismissGoalDto,
  ) {
    return this.goalsService.dismissGoal(user.userId, dto);
  }

  @Post('delete')
  @ApiOperation({ summary: 'Delete a goal by goalId' })
  deleteGoal(@Body() body: any) {
    return this.goalsService.deleteGoal(body.goalId);
  }
}
