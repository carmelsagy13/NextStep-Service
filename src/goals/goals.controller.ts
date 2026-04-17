import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { GoalsService } from './goals.service.js';

@ApiTags('Goals')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('goals')
export class GoalsController {
  constructor(private readonly goalsService: GoalsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all user goals with progress' })
  getGoals() {
    // TODO: extract userId from JWT
    return this.goalsService.getGoals('placeholder-user-id');
  }

  @Post()
  @ApiOperation({ summary: 'Create a new goal' })
  createGoal(@Body() body: any) {
    // TODO: extract userId from JWT, add DTO
    return this.goalsService.createGoal('placeholder-user-id', body);
  }

  @Post('update')
  @ApiOperation({ summary: 'Update a goal by goalId' })
  updateGoal(@Body() body: any) {
    return this.goalsService.updateGoal(body);
  }

  @Post('delete')
  @ApiOperation({ summary: 'Delete a goal by goalId' })
  deleteGoal(@Body() body: any) {
    return this.goalsService.deleteGoal(body.goalId);
  }
}
